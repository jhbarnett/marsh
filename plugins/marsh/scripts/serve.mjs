#!/usr/bin/env node
// marsh serve — cockpit: horizontal kanban rows over an embedded live session.
// Zero dependencies. Writes are string-scoped edits only:
//   POST /move  rewrites the `column:` frontmatter line, nothing else
//   POST /reply rewrites the "## Your reply" zone, nothing else
//   POST /send  types literal keystrokes into the tmux session (never Enter)
// Theme comes from workbench/theme.json (theme_sync.py extracts it from the
// operator's terminal config); dark/light variants follow system appearance.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, readdirSync, watch, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const CARDS_DIR = flag('dir', 'workbench/cards');
const PORT = Number(flag('port', 4643));
const SESSION = flag('session', null);
const TERM_URL = flag('term', 'http://127.0.0.1:4644');
const TMUX = flag('tmux', 'marsh');
const COLUMNS = ['inbox', 'ready', 'in-progress', 'awaiting-decision', 'in-review', 'done'];

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- theme ----------
const FALLBACK = {
  background: '#111111', foreground: '#dddddd', cursor: '#dddddd', selectionBg: '#333333',
  palette: ['#111111', '#cc6666', '#44aa66', '#f0c674', '#8ab4f8', '#b294bb', '#8abeb7', '#c5c8c6',
            '#666666', '#d54e53', '#b9ca4a', '#e7c547', '#7aa6da', '#c397d8', '#70c0b1', '#eaeaea'],
};
function loadTheme() {
  try { return JSON.parse(readFileSync('workbench/theme.json', 'utf8')); }
  catch { return { source: 'default', dark: FALLBACK, light: FALLBACK }; }
}
function cssVars(t) {
  const p = t.palette ?? FALLBACK.palette;
  return `--bg:${t.background};--fg:${t.foreground};--panel:${p[0]};--sel:${t.selectionBg ?? p[8]};` +
         `--dim:${p[8]};--accent:${p[4]};--ok:${p[2]};--warn:${p[3]};--err:${p[1]};--cursor:${t.cursor ?? t.foreground};`;
}

// ---------- cards ----------
function parseCard(path) {
  const raw = readFileSync(path, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+): ?(.*)$/);
    if (kv) fm[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1');
  }
  const body = m[2];
  const zone = (name) => {
    const z = body.match(new RegExp(`^## ${name}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'));
    return z ? z[1].trim() : '';
  };
  const artifacts = [...m[1].matchAll(/^ {4}- (.+)$/gm)].map((a) => a[1]);
  const ref = (k) => (m[1].match(new RegExp(`^ {2}${k}: (.+)$`, 'm'))?.[1] ?? 'null');
  return {
    file: basename(path),
    issue: fm.issue, title: fm.title, lane: fm.lane, gate: fm.gate, url: fm.url,
    column: COLUMNS.includes(fm.column) ? fm.column : 'inbox',
    updated: fm.updated,
    branch: ref('branch'), pr: ref('pr'), artifacts,
    summary: zone('Summary'),
    decision: zone('Decision needed').replace(/<!--[\s\S]*?-->/g, '').trim(),
    reply: zone('Your reply').replace(/<!--[\s\S]*?-->/g, '').trim(),
  };
}

const cards = () =>
  existsSync(CARDS_DIR)
    ? readdirSync(CARDS_DIR).filter((f) => f.endsWith('.md')).map((f) => parseCard(join(CARDS_DIR, f))).filter(Boolean)
    : [];

const safePath = (file) => {
  const p = join(CARDS_DIR, basename(file));
  if (!p.endsWith('.md') || !existsSync(p)) throw new Error(`no such card: ${file}`);
  return p;
};

function moveCard(file, column) {
  if (!COLUMNS.includes(column)) throw new Error(`bad column: ${column}`);
  const p = safePath(file);
  writeFileSync(p, readFileSync(p, 'utf8').replace(/^column: .*$/m, `column: ${column}`));
}

function writeReply(file, text) {
  const p = safePath(file);
  writeFileSync(p, readFileSync(p, 'utf8').replace(/(^## Your reply\n)[\s\S]*?(?=^## )/m, `$1${text.trim()}\n\n`));
}

// ---------- session transcript tail ----------
function findSession() {
  if (SESSION) return SESSION;
  const root = join(homedir(), '.claude', 'projects');
  let best = null;
  try {
    for (const d of readdirSync(root)) {
      if (!d.includes('local-marsh')) continue;
      const dir = join(root, d);
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.jsonl')) continue;
        const p = join(dir, f);
        const mt = statSync(p).mtimeMs;
        if (!best || mt > best.mt) best = { p, mt };
      }
    }
  } catch { /* no sessions */ }
  return best?.p ?? null;
}

function extractMsg(row) {
  try {
    if (row.type === 'assistant') {
      const parts = (row.message?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text);
      const text = parts.join('\n').trim();
      if (text) return { role: 'marsh', text };
    } else if (row.type === 'user') {
      const c = row.message?.content;
      let text = '';
      if (typeof c === 'string') text = c;
      else if (Array.isArray(c) && !c.some((x) => x.type === 'tool_result'))
        text = c.filter((x) => x.type === 'text').map((x) => x.text).join('\n');
      text = text.trim();
      if (text && !text.startsWith('<')) return { role: 'you', text };
    }
  } catch { /* skip malformed */ }
  return null;
}

const ring = [];
let sessionPath = findSession();
let offset = 0;
if (sessionPath && existsSync(sessionPath)) {
  const size = statSync(sessionPath).size;
  const start = Math.max(0, size - 200_000);
  const fd = openSync(sessionPath, 'r');
  const buf = Buffer.alloc(size - start);
  readSync(fd, buf, 0, buf.length, start);
  closeSync(fd);
  for (const l of buf.toString('utf8').split('\n').slice(start > 0 ? 1 : 0)) {
    if (!l.trim()) continue;
    try { const msg = extractMsg(JSON.parse(l)); if (msg) pushMsg(msg, false); } catch { /* skip */ }
  }
  offset = size;
}

function pushMsg(msg, broadcast = true) {
  msg.text = msg.text.length > 4000 ? msg.text.slice(0, 4000) + ' …[truncated]' : msg.text;
  ring.push(msg);
  if (ring.length > 200) ring.shift();
  if (broadcast) sse('chat', msg);
}

let partial = '';
setInterval(() => {
  const latest = findSession();
  if (latest && latest !== sessionPath) {
    sessionPath = latest;
    offset = statSync(latest).size;
    partial = '';
    pushMsg({ role: 'sys', text: `switched to session ${basename(latest)}` });
    return;
  }
  if (!sessionPath || !existsSync(sessionPath)) return;
  const size = statSync(sessionPath).size;
  if (size <= offset) return;
  const fd = openSync(sessionPath, 'r');
  const buf = Buffer.alloc(size - offset);
  readSync(fd, buf, 0, buf.length, offset);
  closeSync(fd);
  offset = size;
  const chunk = partial + buf.toString('utf8');
  const lines = chunk.split('\n');
  partial = lines.pop() ?? '';
  for (const l of lines) {
    if (!l.trim()) continue;
    try { const msg = extractMsg(JSON.parse(l)); if (msg) pushMsg(msg); } catch { /* skip */ }
  }
}, 1000);

// ---------- html ----------
function cardHtml(c) {
  const badge = (t, cls) => (t && t !== 'null' ? `<span class="badge ${cls}">${esc(t)}</span>` : '');
  return `<div class="card" draggable="true" data-file="${esc(c.file)}">
  <div class="head"><a href="${esc(c.url)}" target="_blank">${esc(c.issue)}</a> ${badge(c.lane, 'lane')} ${badge(c.gate, 'gate')}</div>
  <div class="title">${esc(c.title)}</div>
  ${c.decision ? `<div class="decision">${esc(c.decision)}</div>` : ''}
  <div class="refs">${c.pr !== 'null' ? `<a class="ref" href="${esc(c.pr)}" target="_blank">PR</a>` : ''}
  ${c.artifacts.map((a) => `<a class="ref" href="file://${esc(a)}">artifact</a>`).join(' ')}</div>
  <details${c.reply ? ' open' : ''}><summary>reply${c.reply ? ' ●' : ''}</summary>
    <textarea data-file="${esc(c.file)}" placeholder="Decision / instructions — Marsh consumes on next wake">${esc(c.reply)}</textarea>
    <button data-file="${esc(c.file)}">save</button>
  </details>
</div>`;
}

function boardHtml() {
  const all = cards();
  return COLUMNS.map((col) => {
    const items = all.filter((c) => c.column === col);
    return `<div class="col" data-column="${col}"><h2>${col}<span>${items.length}</span></h2><div class="cards">${items.map(cardHtml).join('')}</div></div>`;
  }).join('');
}

function pageHtml() {
  const th = loadTheme();
  return `<!doctype html><meta charset="utf-8"><title>marsh</title>
<style>
  :root{${cssVars(th.dark)}}
  @media (prefers-color-scheme: light){:root{${cssVars(th.light)}}}
  *{box-sizing:border-box}
  body{font:13px/1.45 -apple-system,sans-serif;margin:0;background:var(--bg);color:var(--fg);height:100vh;display:flex;flex-direction:column;overflow:hidden}
  header{padding:8px 16px;border-bottom:1px solid var(--sel);display:flex;gap:12px;align-items:baseline;flex-shrink:0}
  h1{font-size:14px;margin:0}#stamp{color:var(--dim);font-size:11px}
  .hbtns{margin-left:auto;display:flex;gap:6px;align-items:center}
  .view{background:color-mix(in srgb,var(--panel) 80%,var(--fg) 4%);color:var(--dim);border:1px solid var(--sel);border-radius:4px;padding:2px 9px;cursor:pointer;font-size:11px}
  .view.on{color:var(--fg);border-color:var(--dim)}
  #term-pop{color:var(--accent);text-decoration:none;font-size:13px}
  #board{overflow-y:auto;padding:8px 12px;flex-shrink:0}
  .col{display:flex;align-items:flex-start;border-bottom:1px solid color-mix(in srgb,var(--sel) 50%,transparent);padding:6px 0}
  .col:last-child{border-bottom:0}
  .col h2{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);margin:6px 0 0;width:118px;flex-shrink:0}
  .col h2 span{margin-left:6px;color:var(--dim);opacity:.6}
  .col.drop{outline:2px dashed var(--ok);outline-offset:-2px;border-radius:6px}
  .cards{display:flex;flex-wrap:wrap;gap:8px;flex:1;min-height:34px}
  .card{background:color-mix(in srgb,var(--panel) 88%,var(--fg) 5%);border:1px solid var(--sel);border-radius:6px;padding:7px 9px;width:236px;cursor:grab}
  .card .head{display:flex;gap:6px;align-items:center}.card a{color:var(--accent);text-decoration:none;font-weight:600}
  .title{margin:3px 0;color:var(--fg);font-size:12px}
  .badge{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--sel);color:var(--fg)}
  .badge.gate{background:color-mix(in srgb,var(--warn) 25%,var(--panel));color:var(--warn)}
  .decision{border-left:3px solid var(--warn);padding:3px 8px;margin:5px 0;color:color-mix(in srgb,var(--warn) 60%,var(--fg));background:color-mix(in srgb,var(--warn) 8%,transparent);white-space:pre-wrap;font-size:12px}
  .refs{margin-top:2px}.ref{font-size:11px;margin-right:6px;color:var(--accent)}
  details{margin-top:4px}summary{cursor:pointer;color:var(--dim);font-size:11px}
  textarea{width:100%;min-height:52px;background:var(--bg);color:var(--fg);border:1px solid var(--sel);border-radius:4px;margin:5px 0 4px}
  button{background:var(--ok);color:var(--bg);border:0;border-radius:4px;padding:3px 10px;cursor:pointer}
  #splitter{height:5px;background:var(--sel);cursor:row-resize;flex-shrink:0}
  #splitter:hover{background:var(--accent)}
  #console{flex:1;min-height:120px;display:flex;flex-direction:column;position:relative;background:var(--bg)}
  #term{flex:1;border:0;width:100%;background:var(--bg)}
  #msgs{flex:1;overflow-y:auto;padding:4px 14px;display:none}
  .msg{margin:7px 0;padding:7px 9px;border-radius:6px;background:color-mix(in srgb,var(--panel) 88%,var(--fg) 4%);white-space:pre-wrap;word-break:break-word}
  .msg.you{border-left:3px solid var(--accent)}
  .msg.marsh{border-left:3px solid var(--ok)}
  .msg.sys{color:var(--dim);font-size:11px;background:none;padding:1px 8px}
  .msg .who{font-size:10px;text-transform:uppercase;color:var(--dim);margin-bottom:2px}
  #dropzone{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:color-mix(in srgb,var(--bg) 72%,transparent);border:2px dashed var(--accent);border-radius:8px;color:var(--accent);font-size:14px;z-index:5}
  #dropzone.active{display:flex}
  #toast{position:fixed;bottom:14px;right:14px;background:var(--panel);color:var(--fg);border:1px solid var(--sel);border-radius:6px;padding:7px 12px;font-size:12px;opacity:0;transition:opacity .25s;z-index:9}
  #toast.show{opacity:1}
  code{background:var(--sel);padding:0 4px;border-radius:3px}
  .hint{font-size:10px;color:var(--dim);padding:3px 14px}
</style>
<header><h1>marsh</h1><span id="stamp"></span>
  <div class="hbtns"><button id="v-term" class="view on">terminal</button><button id="v-chat" class="view">transcript</button>
  <a id="term-pop" href="${esc(TERM_URL)}" target="_blank" title="open terminal in its own tab">↗</a></div></header>
<div id="board"></div>
<div id="splitter"></div>
<div id="console">
  <iframe id="term" src="${esc(TERM_URL)}"></iframe>
  <div id="msgs"></div>
  <div class="hint" id="termhint" style="display:none">terminal blank? <code>plugins/marsh/scripts/marsh-up.sh</code> brings up tmux+claude+ttyd+serve</div>
  <div id="dropzone">drop to type context into the session</div>
</div>
<div id="toast"></div>
<script>
  const post=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json().catch(()=>({ok:r.ok})));
  const toast=(t)=>{const e=document.getElementById('toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),1800)};
  let dragging=false;
  function wireBoard(){
    document.querySelectorAll('.card').forEach(c=>{
      c.addEventListener('dragstart',e=>{dragging=true;e.dataTransfer.setData('text',c.dataset.file)});
      c.addEventListener('dragend',()=>{dragging=false;document.getElementById('dropzone').classList.remove('active')});
    });
    document.querySelectorAll('.col').forEach(col=>{
      col.addEventListener('dragover',e=>{e.preventDefault();col.classList.add('drop')});
      col.addEventListener('dragleave',()=>col.classList.remove('drop'));
      col.addEventListener('drop',async e=>{e.preventDefault();col.classList.remove('drop');dragging=false;
        await post('/move',{file:e.dataTransfer.getData('text'),column:col.dataset.column});refreshBoard()});
    });
    document.querySelectorAll('button[data-file]').forEach(b=>b.addEventListener('click',async()=>{
      const t=document.querySelector('textarea[data-file="'+b.dataset.file+'"]');
      await post('/reply',{file:b.dataset.file,text:t.value});b.textContent='saved';setTimeout(refreshBoard,400)}));
  }
  async function refreshBoard(){
    const f=document.activeElement;
    if(f&&f.tagName==='TEXTAREA')return;
    const r=await fetch('/board');document.getElementById('board').innerHTML=await r.text();wireBoard();
    const s=await (await fetch('/meta')).json();
    document.getElementById('stamp').textContent=s.stamp+(s.session?' · '+s.session:'');
  }
  function addMsg(m){
    const d=document.createElement('div');d.className='msg '+m.role;
    if(m.role!=='sys'){const w=document.createElement('div');w.className='who';w.textContent=m.role==='you'?'you':'marsh';d.appendChild(w)}
    d.appendChild(document.createTextNode(m.text));
    const box=document.getElementById('msgs');const stick=box.scrollTop+box.clientHeight>=box.scrollHeight-40;
    box.appendChild(d);while(box.children.length>200)box.removeChild(box.firstChild);
    if(stick)box.scrollTop=box.scrollHeight;
  }
  const es=new EventSource('/events');
  es.addEventListener('change',refreshBoard);
  es.addEventListener('chat',e=>addMsg(JSON.parse(e.data)));
  es.addEventListener('chat-history',e=>{JSON.parse(e.data).forEach(addMsg)});
  // views
  function setView(term){
    document.getElementById('term').style.display=term?'':'none';
    document.getElementById('msgs').style.display=term?'none':'block';
    document.getElementById('v-term').classList.toggle('on',term);
    document.getElementById('v-chat').classList.toggle('on',!term);
  }
  document.getElementById('v-term').addEventListener('click',()=>setView(true));
  document.getElementById('v-chat').addEventListener('click',()=>setView(false));
  // drop-to-terminal: any card drag activates the console dropzone
  const zone=document.getElementById('dropzone'), consoleEl=document.getElementById('console');
  document.addEventListener('dragover',e=>{
    if(!dragging)return;
    const r=consoleEl.getBoundingClientRect();
    zone.classList.toggle('active',e.clientY>r.top);
  });
  zone.addEventListener('dragover',e=>e.preventDefault());
  zone.addEventListener('drop',async e=>{
    e.preventDefault();zone.classList.remove('active');dragging=false;
    const f=e.dataTransfer.getData('text');if(!f)return;
    const c=await (await fetch('/card?file='+encodeURIComponent(f))).json();
    const block='[Context '+c.issue+' — "'+c.title+'" | '+c.column+(c.gate&&c.gate!=='null'?'/'+c.gate:'')+(c.pr&&c.pr!=='null'?' | PR '+c.pr:'')+' | '+c.url+'] ';
    const r=await post('/send',{text:block});
    if(r.ok){toast(c.issue+' → typed into session (review, then Enter)')}
    else{await navigator.clipboard.writeText(block);toast('tmux not reachable — copied to clipboard');document.getElementById('termhint').style.display='block'}
  });
  // splitter (vertical drag)
  const board=document.getElementById('board'), split=document.getElementById('splitter');
  const saved=localStorage.getItem('marshSplit');board.style.height=(saved??'38')+'vh';
  split.addEventListener('mousedown',e=>{
    e.preventDefault();document.getElementById('term').style.pointerEvents='none';
    const move=ev=>{const h=Math.min(80,Math.max(10,(ev.clientY-board.offsetTop)/window.innerHeight*100));
      board.style.height=h+'vh';localStorage.setItem('marshSplit',h)};
    const up=()=>{document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);
      document.getElementById('term').style.pointerEvents=''};
    document.addEventListener('mousemove',move);document.addEventListener('mouseup',up);
  });
  refreshBoard();
</script>`;
}

// ---------- server ----------
const clients = new Set();
function sse(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach((r) => r.write(payload));
}
let debounce;
if (existsSync(CARDS_DIR))
  watch(CARDS_DIR, () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => sse('change', {}), 300);
  });

const body = (req) =>
  new Promise((res) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => res(JSON.parse(d || '{}')));
  });

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html' }).end(pageHtml());
    } else if (url.pathname === '/board') {
      res.writeHead(200, { 'content-type': 'text/html' }).end(boardHtml());
    } else if (url.pathname === '/meta') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        stamp: `${new Date().toISOString().slice(0, 16)}Z · ${cards().length} cards`,
        session: sessionPath ? basename(sessionPath).slice(0, 8) : null,
      }));
    } else if (url.pathname === '/card') {
      const c = parseCard(safePath(url.searchParams.get('file')));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(c));
    } else if (url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write(`event: chat-history\ndata: ${JSON.stringify(ring)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
    } else if (url.pathname === '/move' && req.method === 'POST') {
      const { file, column } = await body(req);
      moveCard(file, column);
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    } else if (url.pathname === '/reply' && req.method === 'POST') {
      const { file, text } = await body(req);
      writeReply(file, text ?? '');
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    } else if (url.pathname === '/send' && req.method === 'POST') {
      const { text } = await body(req);
      if (!text?.trim()) throw new Error('empty');
      execFile('tmux', ['send-keys', '-t', TMUX, '-l', text], (err) => {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: !err, err: err ? String(err.message) : null }));
      });
    } else res.writeHead(404).end();
  } catch (e) {
    res.writeHead(400).end(String(e.message ?? e));
  }
}).listen(PORT, '127.0.0.1', () =>
  console.log(`marsh serve → http://127.0.0.1:${PORT}  (cards: ${CARDS_DIR}, tmux: ${TMUX}, session: ${sessionPath ?? 'none'})`)
);
