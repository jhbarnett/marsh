#!/usr/bin/env node
// marsh serve — local kanban + live session console over workbench/cards/.
// Zero dependencies. Writes are string-scoped edits only:
//   POST /move  rewrites the `column:` frontmatter line, nothing else
//   POST /reply rewrites the "## Your reply" zone, nothing else
// The conversation pane is READ-ONLY: it tails the newest Claude Code session
// transcript for this hub (or --session <path>) and streams human/assistant
// text. Drag a card onto the pane to compose a context block for pasting
// into the session terminal.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, readdirSync, watch, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const CARDS_DIR = flag('dir', 'workbench/cards');
const PORT = Number(flag('port', 4643));
const SESSION = flag('session', null);
const COLUMNS = ['inbox', 'ready', 'in-progress', 'awaiting-decision', 'in-review', 'done'];

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  // preload: last ~200KB for recent history
  const size = statSync(sessionPath).size;
  const start = Math.max(0, size - 200_000);
  const fd = openSync(sessionPath, 'r');
  const buf = Buffer.alloc(size - start);
  readSync(fd, buf, 0, buf.length, start);
  closeSync(fd);
  const lines = buf.toString('utf8').split('\n').slice(start > 0 ? 1 : 0);
  for (const l of lines) {
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
  // follow the newest session if it changes
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
  ${c.pr !== 'null' ? `<a class="ref" href="${esc(c.pr)}" target="_blank">PR</a>` : ''}
  ${c.artifacts.map((a) => `<a class="ref" href="file://${esc(a)}">artifact</a>`).join(' ')}
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
    return `<div class="col" data-column="${col}"><h2>${col} <span>${items.length}</span></h2>${items.map(cardHtml).join('')}</div>`;
  }).join('');
}

function pageHtml() {
  return `<!doctype html><meta charset="utf-8"><title>marsh</title>
<style>
  body{font:13px/1.45 -apple-system,sans-serif;margin:0;background:#111;color:#ddd;height:100vh;display:flex;flex-direction:column}
  header{padding:10px 16px;border-bottom:1px solid #333;display:flex;gap:12px;align-items:baseline;flex-shrink:0}
  h1{font-size:15px;margin:0}#stamp{color:#777;font-size:11px}#toggle{margin-left:auto;background:#333;color:#ddd;border:0;border-radius:4px;padding:3px 10px;cursor:pointer}
  main{display:flex;flex:1;min-height:0}
  .board{display:flex;gap:10px;padding:12px;overflow-x:auto;align-items:flex-start;flex:3;min-width:0}
  .col{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;min-width:220px;max-width:280px;flex:1;padding:8px;min-height:120px}
  .col h2{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#999;margin:2px 4px 8px}.col h2 span{color:#555}
  .col.drop{outline:2px dashed #4a6}
  .card{background:#222;border:1px solid #333;border-radius:6px;padding:8px;margin-bottom:8px;cursor:grab}
  .card .head{display:flex;gap:6px;align-items:center}.card a{color:#8ab4f8;text-decoration:none;font-weight:600}
  .title{margin:4px 0;color:#ccc}
  .badge{font-size:10px;padding:1px 6px;border-radius:8px;background:#333}.badge.gate{background:#5c3b00;color:#fc6}
  .decision{border-left:3px solid #fc6;padding:4px 8px;margin:6px 0;color:#eda;background:#1c1712;white-space:pre-wrap}
  .ref{font-size:11px;margin-right:6px}
  details{margin-top:6px}summary{cursor:pointer;color:#888;font-size:11px}
  textarea{width:100%;min-height:56px;background:#181818;color:#ddd;border:1px solid #333;border-radius:4px;margin:6px 0 4px;box-sizing:border-box}
  button{background:#2d4;border:0;border-radius:4px;padding:3px 10px;cursor:pointer}
  .console{flex:1;min-width:340px;max-width:520px;border-left:1px solid #333;display:flex;flex-direction:column;background:#151515}
  .console.hidden{display:none}
  .console h2{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#999;margin:10px 12px 6px;flex-shrink:0}
  .console h2 small{color:#555;text-transform:none;letter-spacing:0}
  #msgs{flex:1;overflow-y:auto;padding:0 12px;min-height:0}
  .msg{margin:8px 0;padding:8px;border-radius:6px;background:#1c1c1c;white-space:pre-wrap;word-break:break-word}
  .msg.you{background:#1a2230;border-left:3px solid #8ab4f8}
  .msg.marsh{border-left:3px solid #4a6}
  .msg.sys{color:#777;font-size:11px;background:none;padding:2px 8px}
  .msg .who{font-size:10px;text-transform:uppercase;color:#888;margin-bottom:3px}
  .compose{border-top:1px solid #333;padding:10px 12px;flex-shrink:0}
  .compose.drop{outline:2px dashed #8ab4f8}
  .compose textarea{min-height:72px;margin:0 0 6px}
  .compose .hint{font-size:10px;color:#666;margin-bottom:4px}
  .compose .row{display:flex;gap:8px}
  .compose button.alt{background:#333;color:#ddd}
</style>
<header><h1>marsh workbench</h1><span id="stamp"></span><button id="toggle">console</button></header>
<main>
  <div class="board" id="board"></div>
  <div class="console" id="console">
    <h2>session <small id="sess"></small></h2>
    <div id="msgs"></div>
    <div class="compose" id="compose">
      <div class="hint">drop cards here for context · compose, then copy → paste into your Marsh terminal</div>
      <textarea id="draft" placeholder="Ask Marsh… (drag cards in for context)"></textarea>
      <div class="row"><button id="copy">copy</button><button id="clear" class="alt">clear</button></div>
    </div>
  </div>
</main>
<script>
  const post=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});
  function wireBoard(){
    document.querySelectorAll('.card').forEach(c=>c.addEventListener('dragstart',e=>e.dataTransfer.setData('text',c.dataset.file)));
    document.querySelectorAll('.col').forEach(col=>{
      col.addEventListener('dragover',e=>{e.preventDefault();col.classList.add('drop')});
      col.addEventListener('dragleave',()=>col.classList.remove('drop'));
      col.addEventListener('drop',async e=>{e.preventDefault();col.classList.remove('drop');
        await post('/move',{file:e.dataTransfer.getData('text'),column:col.dataset.column});refreshBoard()});
    });
    document.querySelectorAll('button[data-file]').forEach(b=>b.addEventListener('click',async()=>{
      const t=document.querySelector('textarea[data-file="'+b.dataset.file+'"]');
      await post('/reply',{file:b.dataset.file,text:t.value});b.textContent='saved';setTimeout(refreshBoard,400)}));
  }
  async function refreshBoard(){
    const focused=document.activeElement;
    if(focused&&focused.tagName==='TEXTAREA'&&focused.id!=='draft')return;
    const r=await fetch('/board');document.getElementById('board').innerHTML=await r.text();wireBoard();
    const s=await (await fetch('/meta')).json();
    document.getElementById('stamp').textContent=s.stamp;document.getElementById('sess').textContent=s.session||'(no session found)';
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
  const compose=document.getElementById('compose'),draft=document.getElementById('draft');
  compose.addEventListener('dragover',e=>{e.preventDefault();compose.classList.add('drop')});
  compose.addEventListener('dragleave',()=>compose.classList.remove('drop'));
  compose.addEventListener('drop',async e=>{e.preventDefault();compose.classList.remove('drop');
    const f=e.dataTransfer.getData('text');if(!f)return;
    const c=await (await fetch('/card?file='+encodeURIComponent(f))).json();
    const block='[Context '+c.issue+' — "'+c.title+'" | '+c.column+(c.gate&&c.gate!=='null'?'/'+c.gate:'')+(c.pr&&c.pr!=='null'?' | PR '+c.pr:'')+' | '+c.url+']\\n';
    draft.value=block+draft.value;draft.focus();
  });
  document.getElementById('copy').addEventListener('click',async()=>{
    await navigator.clipboard.writeText(draft.value);
    const b=document.getElementById('copy');b.textContent='copied';setTimeout(()=>b.textContent='copy',900);
  });
  document.getElementById('clear').addEventListener('click',()=>{draft.value=''});
  document.getElementById('toggle').addEventListener('click',()=>document.getElementById('console').classList.toggle('hidden'));
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
        stamp: `${new Date().toISOString()} · ${cards().length} cards · ${CARDS_DIR}`,
        session: sessionPath ? basename(sessionPath) : null,
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
      res.writeHead(200).end('ok');
    } else if (url.pathname === '/reply' && req.method === 'POST') {
      const { file, text } = await body(req);
      writeReply(file, text ?? '');
      res.writeHead(200).end('ok');
    } else res.writeHead(404).end();
  } catch (e) {
    res.writeHead(400).end(String(e.message ?? e));
  }
}).listen(PORT, '127.0.0.1', () =>
  console.log(`marsh serve → http://127.0.0.1:${PORT}  (cards: ${CARDS_DIR}, session: ${sessionPath ?? 'none found'})`)
);
