#!/usr/bin/env node
// marsh serve — cockpit: horizontal kanban rows over an embedded live session.
// Zero dependencies. Writes are string-scoped edits only:
//   POST /move  rewrites the `column:` frontmatter line, nothing else
//   POST /reply rewrites the "## Your reply" zone, nothing else
//   POST /send  types literal keystrokes into the tmux session (never Enter)
// Theme comes from workbench/theme.json (theme_sync.py extracts it from the
// operator's terminal config); dark/light variants follow system appearance.
import { createServer, request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { readFileSync, writeFileSync, readdirSync, watch, existsSync, mkdirSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const CARDS_DIR = flag('dir', 'workbench/cards');
const PORT = Number(flag('port', 4643));
const TERM_URL = flag('term', 'http://127.0.0.1:4644');
const TERM_HOST = new URL(TERM_URL).hostname;
const TERM_PORT = Number(new URL(TERM_URL).port || 80);
const TMUX = flag('tmux', 'marsh');
const WORK_TOKEN = randomBytes(16).toString('hex'); // per-boot CSRF token for /work dispatch

// Key shim injected into the proxied ttyd page (same-origin via /term/).
// - Shift+Enter → bracketed-paste "\n": Claude Code inserts a newline
//   instead of submitting (raw terminals cannot distinguish Shift+Enter).
// - Cmd+Left/Right → Home/End sequences, with the browser default (history
//   navigation!) suppressed.
const KEY_SHIM = `<script>(function(){var tries=0,iv=setInterval(function(){var t=window.term;tries++;
if(!t||!t.attachCustomKeyEventHandler){if(tries>60)clearInterval(iv);return;}
clearInterval(iv);
t.attachCustomKeyEventHandler(function(e){
 if(e.type!=='keydown'||e.marshSynthetic)return true;
 if(e.key==='Enter'&&e.shiftKey&&!e.metaKey&&!e.ctrlKey){t.paste('\\n');return false;}
 var map={ArrowLeft:['Home',36],ArrowRight:['End',35]};
 if(e.metaKey&&!e.altKey&&map[e.key]){e.preventDefault();
  var m=map[e.key],ev=new KeyboardEvent('keydown',{key:m[0],code:m[0],keyCode:m[1],which:m[1],bubbles:true,cancelable:true});
  ev.marshSynthetic=true;(t.textarea||document.activeElement).dispatchEvent(ev);return false;}
 return true;});
console.log('[marsh] key shim active');},250);})()</script>`;

function proxyTerm(req, res, url) {
  const path = url.pathname.replace(/^\/term\/?/, '/') + (url.search || '');
  const headers = { ...req.headers, host: `${TERM_HOST}:${TERM_PORT}` };
  delete headers['accept-encoding']; // force identity: we splice HTML, so upstream must not compress
  const up = httpRequest({ host: TERM_HOST, port: TERM_PORT, path, method: req.method, headers }, (ur) => {
    const isHtml = (ur.headers['content-type'] || '').includes('text/html');
    if (!isHtml) {
      res.writeHead(ur.statusCode, ur.headers);
      ur.pipe(res);
      return;
    }
    const chunks = [];
    ur.on('data', (c) => chunks.push(c));
    ur.on('end', () => {
      let body = Buffer.concat(chunks).toString('utf8');
      body = body.includes('</body>') ? body.replace('</body>', KEY_SHIM + '</body>') : body + KEY_SHIM;
      const h = { ...ur.headers, 'content-length': Buffer.byteLength(body) };
      delete h['content-encoding'];
      res.writeHead(ur.statusCode, h);
      res.end(body);
    });
  });
  up.on('error', () => { res.writeHead(502).end('terminal upstream not running — marsh-up.sh starts it'); });
  req.pipe(up);
}
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
  // Surfaces derive ONLY from bg/fg mixes — palette hues are accents. Using
  // palette[0] (ANSI black) for panels broke light themes: ANSI black stays
  // dark in a light theme, giving dark cards with dark text on a light page.
  const p = t.palette ?? FALLBACK.palette;
  return `--bg:${t.background};--fg:${t.foreground};` +
         `--panel:color-mix(in srgb,${t.background} 93%,${t.foreground} 7%);` +
         `--border:color-mix(in srgb,${t.background} 76%,${t.foreground} 24%);` +
         `--dim:color-mix(in srgb,${t.foreground} 55%,${t.background});` +
         `--accent:${p[4]};--ok:${p[2]};--warn:${p[3]};--err:${p[1]};`;
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
    updated: fm.updated, gateSince: fm.gateSince, shape: fm.shape,
    teamIcon: fm.teamIcon, priority: fm.priority,
    branch: ref('branch'), pr: ref('pr'), artifacts,
    summary: zone('Summary'),
    decision: zone('Decision needed').replace(/<!--[\s\S]*?-->/g, '').trim(),
    // Reply zone ends at "## Log" specifically (not any "## ") so replies may
    // contain their own markdown headings without being truncated.
    reply: (body.match(/^## Your reply\n([\s\S]*?)(?=^## Log$)/m)?.[1] ?? zone('Your reply'))
      .replace(/<!--[\s\S]*?-->/g, '').trim(),
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
  const src = readFileSync(p, 'utf8');
  // Replacement is a FUNCTION so "$" sequences in the reply text ($1, $&, …)
  // are written literally instead of being expanded as group references, and
  // the zone terminator is "## Log" so replies may contain markdown headings.
  const re = /(^## Your reply\n)[\s\S]*?(?=^## Log$)/m;
  if (!re.test(src)) throw new Error(`no reply zone in ${basename(p)}`);
  writeFileSync(p, src.replace(re, (_m, g1) => `${g1}${text.trim()}\n\n`));
}

// ---------- html ----------
const SHAPE_GLYPHS = { bug: '🐛', feature: '✨', debt: '🔧', spike: '🔬', epic: '🏔', docs: '📚', gap: '🧭', security: '🔒', layup: '🏀' };
const PR_SVG = '<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/></svg>';
const CLIP_SVG = '<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M12.212 3.02a1.753 1.753 0 0 0-2.478.003l-5.83 5.83a3.007 3.007 0 0 0-.88 2.127c0 .795.315 1.551.88 2.116.567.567 1.333.89 2.126.89.79 0 1.548-.321 2.116-.89l5.48-5.48a.75.75 0 0 1 1.061 1.06l-5.48 5.48a4.492 4.492 0 0 1-3.177 1.33c-1.2 0-2.345-.487-3.187-1.33a4.483 4.483 0 0 1-1.32-3.177c0-1.195.475-2.341 1.32-3.186l5.83-5.83a3.253 3.253 0 0 1 5.599 2.248 3.25 3.25 0 0 1-.962 2.25l-5.84 5.84a2.004 2.004 0 0 1-2.828 0 1.998 1.998 0 0 1 0-2.828l5.49-5.48a.751.751 0 0 1 1.06 1.06l-5.49 5.48a.5.5 0 0 0 .708.708l5.84-5.84a1.753 1.753 0 0 0 0-2.481Z"/></svg>';

function gateAge(c) {
  const since = c.gateSince && c.gateSince !== 'null' ? c.gateSince : c.updated;
  const h = (Date.now() - Date.parse(since)) / 3.6e6;
  if (!isFinite(h) || h < 0) return { text: '', cls: '' };
  const text = h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
  return { text, cls: h >= 48 ? 'age-err' : h >= 24 ? 'age-warn' : '' };
}
const webArtifact = (a) => {
  const i = a.indexOf('artifacts/');
  return i >= 0 ? '/' + a.slice(i) : null;
};

function cardHtml(c) {
  const glyph = SHAPE_GLYPHS[c.shape] ? `<span class="glyph" title="${esc(c.shape)}">${SHAPE_GLYPHS[c.shape]}</span>` : '';
  const team = c.teamIcon && c.teamIcon !== 'null' ? `<span class="glyph" title="team">${esc(c.teamIcon)}</span>` : '';
  let gate = '';
  if (c.gate && c.gate !== 'null') {
    const a = gateAge(c);
    gate = `<span class="badge gate ${a.cls}">${esc(c.gate)}${a.text ? ' · ' + a.text : ''}</span>`;
  }
  const prNum = c.pr !== 'null' ? (c.pr.match(/\/pull\/(\d+)/)?.[1] ?? '') : null;
  const prChip = c.pr !== 'null' ? `<a class="chip" href="${esc(c.pr)}" target="_blank">${PR_SVG}${prNum ? ' #' + prNum : ' PR'}</a>` : '';
  const artChips = c.artifacts.map((a) => {
    const w = webArtifact(a);
    return w
      ? `<a class="chip" href="${esc(w)}" target="_blank" data-preview="${esc(w)}">${CLIP_SVG} ${esc(basename(a))}</a>`
      : '';
  }).join(' ');
  const prio = c.priority && c.priority !== 'null' ? ` prio-${esc(c.priority)}` : '';
  return `<div class="card${prio}" draggable="true" data-file="${esc(c.file)}">
  <div class="head"><a href="${esc(c.url)}" target="_blank">${esc(c.issue)}</a> ${glyph}${team}<span class="badge">${esc(c.lane)}</span> ${gate}</div>
  <div class="title">${esc(c.title)}</div>
  ${c.decision ? `<div class="decision">${esc(c.decision)}</div>` : ''}
  <div class="refs">${prChip} ${artChips}</div>
  <details${c.reply ? ' open' : ''}><summary>reply${c.reply ? ' ●' : ''}</summary>
    <textarea data-file="${esc(c.file)}" placeholder="Decision / instructions — Marsh consumes on next wake">${esc(c.reply)}</textarea>
    <button data-file="${esc(c.file)}">save</button>
  </details>
</div>`;
}

// Done column: collapsed cards (issue # + title only); cards done >48h ago
// are hidden entirely (their canonical state lives in Linear; projection
// pruning removes the files later — this is just the view-side cutoff).
const DONE_HIDE_MS = 48 * 3.6e6;
const doneAge = (c) => Date.now() - Date.parse(c.updated);
function doneCardHtml(c) {
  return `<div class="card done-mini" draggable="true" data-file="${esc(c.file)}">
  <a href="${esc(c.url)}" target="_blank">${esc(c.issue)}</a><span class="mini-title" title="${esc(c.title)}">${esc(c.title)}</span>
</div>`;
}
function boardHtml() {
  const all = cards();
  return COLUMNS.map((col) => {
    let items = all.filter((c) => c.column === col);
    let older = 0;
    if (col === 'done') {
      const vis = items.filter((c) => !(isFinite(doneAge(c)) && doneAge(c) > DONE_HIDE_MS));
      older = items.length - vis.length;
      items = vis;
    }
    const render = col === 'done' ? doneCardHtml : cardHtml;
    const count = `${items.length}${older ? ` · ${older} older hidden` : ''}`;
    return `<div class="col" data-column="${col}"><h2>${col}<span>${count}</span></h2><div class="cards">${items.map(render).join('')}</div></div>`;
  }).join('');
}

function pageHtml() {
  const th = loadTheme();
  return `<!doctype html><meta charset="utf-8"><title>marsh</title><link rel="icon" type="image/svg+xml" href="/avatar.svg?v=3"><link rel="manifest" href="/manifest.json"><link rel="apple-touch-icon" href="/icon-512.png"><meta name="theme-color" content="${esc(th.dark.background)}"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root{${cssVars(th.dark)}}
  @media (prefers-color-scheme: light){:root{${cssVars(th.light)}}}
  *{box-sizing:border-box}
  body{font:13px/1.45 -apple-system,sans-serif;margin:0;background:var(--bg);color:var(--fg);height:100vh;display:flex;flex-direction:column;overflow:hidden}
  header{padding:8px 16px;border-bottom:1px solid var(--border);display:flex;gap:12px;align-items:baseline;flex-shrink:0}
  h1{font-size:14px;margin:0}#stamp{color:var(--dim);font-size:11px}
  .hbtns{margin-left:auto;display:flex;gap:6px;align-items:center}
  .view{background:var(--panel);color:var(--dim);border:1px solid var(--border);border-radius:4px;padding:2px 9px;cursor:pointer;font-size:11px}
  .view.on{color:var(--fg);border-color:var(--dim)}
  #term-pop{color:var(--accent);text-decoration:none;font-size:13px}
  #main{display:flex;flex:1;min-height:0}
  #board{overflow-y:auto;padding:8px 12px;width:60vw;min-width:280px;flex-shrink:0}
  .col{display:flex;align-items:flex-start;border-bottom:1px solid var(--panel);padding:6px 0}
  .col:last-child{border-bottom:0}
  .col h2{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);margin:6px 0 0;width:112px;flex-shrink:0}
  .col h2 span{margin-left:6px;opacity:.6}
  .col.drop{outline:2px dashed var(--ok);outline-offset:-2px;border-radius:6px}
  .cards{display:flex;flex-wrap:wrap;gap:8px;flex:1;min-height:34px}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:7px 9px;width:236px;cursor:grab}
  .card .head{display:flex;gap:6px;align-items:center}.card a{color:var(--accent);text-decoration:none;font-weight:600}
  .title{margin:3px 0;color:var(--fg);font-size:12px}
  .badge{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--bg);border:1px solid var(--border);color:var(--dim)}
  .badge.gate{border-color:var(--warn);color:color-mix(in srgb,var(--warn) 70%,var(--fg))}
  .badge.gate.age-warn{background:color-mix(in srgb,var(--warn) 18%,var(--bg))}
  .badge.gate.age-err{border-color:var(--err);color:var(--err);background:color-mix(in srgb,var(--err) 12%,var(--bg))}
  .glyph{font-size:12px}
  .chip{display:inline-flex;align-items:center;gap:3px;font-size:10px;padding:1px 7px;border-radius:8px;border:1px solid var(--border);color:var(--accent);text-decoration:none;max-width:150px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .chip:hover{border-color:var(--accent)}
  .card.done-mini{width:auto;max-width:236px;display:flex;gap:6px;align-items:baseline;padding:4px 9px}
  .done-mini .mini-title{font-size:11px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .card.prio-urgent{border-left:3px solid var(--err)}
  .card.prio-high{border-left:3px solid var(--warn)}
  .card.prio-medium{border-left:3px solid var(--accent)}
  #preview{position:fixed;width:420px;height:300px;background:var(--bg);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.35);display:none;z-index:8;overflow:hidden}
  #preview iframe{width:100%;height:100%;border:0;background:#fff}
  .decision{border-left:3px solid var(--warn);padding:3px 8px;margin:5px 0;color:var(--fg);background:color-mix(in srgb,var(--warn) 12%,var(--bg));white-space:pre-wrap;font-size:12px}
  .refs{margin-top:2px}.ref{font-size:11px;margin-right:6px;color:var(--accent)}
  details{margin-top:4px}summary{cursor:pointer;color:var(--dim);font-size:11px}
  textarea{width:100%;min-height:52px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;margin:5px 0 4px}
  button{background:var(--ok);color:var(--bg);border:0;border-radius:4px;padding:3px 10px;cursor:pointer}
  #splitter{width:5px;background:var(--border);cursor:col-resize;flex-shrink:0}
  #splitter:hover{background:var(--accent)}
  #console{flex:1;min-width:300px;display:flex;flex-direction:column;position:relative;background:var(--bg)}
  #term{flex:1;border:0;width:100%;background:var(--bg)}
  #dropzone{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:color-mix(in srgb,var(--bg) 72%,transparent);border:2px dashed var(--accent);border-radius:8px;color:var(--accent);font-size:14px;z-index:5}
  #dropzone.active{display:flex}
  #toast{position:fixed;bottom:14px;right:14px;background:var(--panel);color:var(--fg);border:1px solid var(--border);border-radius:6px;padding:7px 12px;font-size:12px;opacity:0;transition:opacity .25s;z-index:9}
  #toast.show{opacity:1}
  code{background:var(--panel);border:1px solid var(--border);padding:0 4px;border-radius:3px}
  .hint{font-size:10px;color:var(--dim);padding:3px 14px}
</style>
<header><img src="/avatar.svg?v=3" alt="" style="width:22px;height:22px;border-radius:50%"><h1>marsh</h1><span id="stamp"></span>
  <div class="hbtns"><button id="up" class="view" title="bring up tmux/claude/ttyd (idempotent)">▲ up</button><a id="term-pop" href="${esc(TERM_URL)}" target="_blank" title="open terminal in its own tab">↗</a></div></header>
<div id="main">
<div id="board"></div>
<div id="splitter"></div>
<div id="console">
  <iframe id="term" src="/term/"></iframe>
  <div class="hint" id="termhint" style="display:none">terminal blank? <code>plugins/marsh/scripts/marsh-up.sh</code> brings up tmux+claude+ttyd+serve</div>
  <div id="dropzone">drop card → type context · drop file/photo → upload + type its path</div>
</div>
</div>
<div id="toast"></div>
<div id="preview"><iframe></iframe></div>
<script>
  const post=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json().catch(()=>({ok:r.ok})));
  const toast=(t)=>{const e=document.getElementById('toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),1800)};
  let dragging=false;
  function wireBoard(){
    document.querySelectorAll('.card').forEach(c=>{
      c.addEventListener('dragstart',e=>{dragging=true;e.dataTransfer.setData('text',c.dataset.file);
        document.getElementById('dropzone').classList.add('active')});
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
    const pv=document.getElementById('preview'), pvf=pv.querySelector('iframe');
    document.querySelectorAll('[data-preview]').forEach(ch=>{
      ch.addEventListener('mouseenter',()=>{
        const r=ch.getBoundingClientRect();
        pv.style.left=Math.min(r.left,window.innerWidth-440)+'px';
        pv.style.top=Math.min(r.bottom+6,window.innerHeight-320)+'px';
        if(pvf.src!==location.origin+ch.dataset.preview)pvf.src=ch.dataset.preview;
        pv.style.display='block';
      });
      ch.addEventListener('mouseleave',()=>{pv.style.display='none'});
    });
  }
  async function refreshBoard(){
    const f=document.activeElement;
    if(f&&f.tagName==='TEXTAREA')return;
    const r=await fetch('/board');document.getElementById('board').innerHTML=await r.text();wireBoard();
    const s=await (await fetch('/meta')).json();
    document.getElementById('stamp').textContent=s.stamp;
  }
  const es=new EventSource('/events');
  es.addEventListener('change',refreshBoard);
  document.getElementById('up').addEventListener('click',async()=>{
    const r=await post('/up',{});toast(r.ok?'stack up — reloading terminal':'bring-up failed');
    if(r.ok)setTimeout(()=>{document.getElementById('term').src='/term/'},1500);
  });
  // drop-to-terminal: card drags AND OS file drags (photos etc.) activate the
  // console dropzone. Files upload to var/uploads/ and their absolute path is
  // typed into the session — Claude Code reads images from paths.
  const zone=document.getElementById('dropzone');
  const hasFiles=e=>!!e.dataTransfer&&Array.from(e.dataTransfer.types||[]).includes('Files');
  // Arm the overlay as soon as a drag EXISTS — never on pointer position: drag
  // events over the ttyd iframe go to the iframe's document, so the parent
  // cannot see the pointer there. The armed overlay covers the iframe and
  // catches the drop itself. OS file drags have no in-page dragend, so a
  // heartbeat timeout disarms when their dragover events stop.
  let fileTimer=null;
  document.addEventListener('dragover',e=>{
    if(!hasFiles(e))return;
    e.preventDefault();                          // stop the browser opening a dropped file
    zone.classList.add('active');
    clearTimeout(fileTimer);
    fileTimer=setTimeout(()=>{if(!dragging)zone.classList.remove('active')},400);
  });
  document.addEventListener('drop',e=>{if(hasFiles(e))e.preventDefault();zone.classList.remove('active')});
  document.addEventListener('dragleave',e=>{if(!e.relatedTarget)zone.classList.remove('active')});
  zone.addEventListener('dragover',e=>e.preventDefault());
  zone.addEventListener('drop',async e=>{
    e.preventDefault();zone.classList.remove('active');dragging=false;
    if(e.dataTransfer.files&&e.dataTransfer.files.length){
      for(const file of e.dataTransfer.files){
        if(file.size>25e6){toast(file.name+' too large (25MB max)');continue}
        const r=await fetch('/upload?name='+encodeURIComponent(file.name),{method:'POST',body:file});
        const j=await r.json().catch(()=>null);
        if(j&&j.ok){const s=await post('/send',{text:j.path+' '});
          if(s.ok)toast(file.name+' → path typed into session (add prompt, then Enter)');
          else{await navigator.clipboard.writeText(j.path);toast('saved '+j.path+' — tmux not reachable, path copied')}}
        else toast('upload failed: '+file.name);
      }
      return;
    }
    const f=e.dataTransfer.getData('text');if(!f)return;
    const c=await (await fetch('/card?file='+encodeURIComponent(f))).json();
    const block='[Context '+c.issue+' — "'+c.title+'" | '+c.column+(c.gate&&c.gate!=='null'?'/'+c.gate:'')+(c.pr&&c.pr!=='null'?' | PR '+c.pr:'')+' | '+c.url+'] ';
    const r=await post('/send',{text:block});
    if(r.ok){toast(c.issue+' → typed into session (review, then Enter)')}
    else{await navigator.clipboard.writeText(block);toast('tmux not reachable — copied to clipboard');document.getElementById('termhint').style.display='block'}
  });
  // splitter: board left / session right, dragged horizontally
  const board=document.getElementById('board'), split=document.getElementById('splitter');
  const saved=localStorage.getItem('marshSplitX');board.style.width=(saved??'60')+'vw';
  split.addEventListener('mousedown',e=>{
    e.preventDefault();document.getElementById('term').style.pointerEvents='none';
    const move=ev=>{const w=Math.min(82,Math.max(18,ev.clientX/window.innerWidth*100));
      board.style.width=w+'vw';localStorage.setItem('marshSplitX',w)};
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
// Self-updating service: when running under launchd (KeepAlive), exit on our
// own code changing — launchd revives us on the new code. Manual runs are
// left alone (no supervisor to revive them).
if ((process.env.XPC_SERVICE_NAME ?? '').includes('com.marsh.serve')) {
  let selfDebounce;
  watch(import.meta.filename, () => {
    clearTimeout(selfDebounce);
    selfDebounce = setTimeout(() => { console.log('serve.mjs changed — exiting for launchd to revive on new code'); process.exit(0); }, 1500);
  });
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html' }).end(pageHtml());
    } else if (url.pathname === '/manifest.json') {
      const th = loadTheme();
      res.writeHead(200, { 'content-type': 'application/manifest+json' }).end(JSON.stringify({
        name: 'Marsh', short_name: 'Marsh', start_url: '/', display: 'standalone',
        background_color: th.dark.background, theme_color: th.dark.background,
        icons: [
          { src: '/avatar.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      }));
    } else if (url.pathname === '/icon-512.png') {
      const p = join(import.meta.dirname, '..', 'assets', 'marsh-avatar-512.png');
      if (!existsSync(p)) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-cache' }).end(readFileSync(p));
    } else if (url.pathname === '/board') {
      res.writeHead(200, { 'content-type': 'text/html' }).end(boardHtml());
    } else if (url.pathname === '/meta') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        stamp: `${new Date().toISOString().slice(0, 16)}Z · ${cards().length} cards`,
      }));
    } else if (url.pathname === '/card') {
      const c = parseCard(safePath(url.searchParams.get('file')));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(c));
    } else if (url.pathname === '/term' || url.pathname.startsWith('/term/')) {
      proxyTerm(req, res, url);
    } else if (url.pathname === '/avatar.svg') {
      const p = join(import.meta.dirname, '..', 'assets', 'marsh-avatar.svg');
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-cache' }).end(existsSync(p) ? readFileSync(p) : '');
    } else if (url.pathname.startsWith('/artifacts/') && req.method === 'GET') {
      const rel = decodeURIComponent(url.pathname.slice('/artifacts/'.length));
      const p = join(process.cwd(), 'artifacts', rel);
      if (rel.includes('..') || !p.startsWith(join(process.cwd(), 'artifacts'))) throw new Error('bad path');
      if (!existsSync(p)) { res.writeHead(404).end('no such artifact'); return; }
      const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase();
      const mime = { html: 'text/html', htm: 'text/html', svg: 'image/svg+xml', png: 'image/png',
                     jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', json: 'application/json',
                     css: 'text/css', js: 'text/javascript' }[ext] ?? 'text/plain';
      res.writeHead(200, { 'content-type': mime }).end(readFileSync(p));
    } else if (url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write('\n');
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
    } else if (url.pathname === '/work' && req.method === 'GET') {
      const prompt = url.searchParams.get('prompt') ?? '';
      const id = prompt.match(/[A-Z]+-\d+/)?.[0] ?? 'issue';
      res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><meta charset="utf-8"><title>marsh dispatch</title>
<style>:root{${cssVars(loadTheme().dark)}}@media (prefers-color-scheme: light){:root{${cssVars(loadTheme().light)}}}
body{font:14px/1.5 -apple-system,sans-serif;background:var(--bg);color:var(--fg);max-width:640px;margin:8vh auto;padding:0 20px}
pre{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:14px;white-space:pre-wrap;max-height:40vh;overflow-y:auto}
button{background:var(--ok);color:var(--bg);border:0;border-radius:6px;padding:10px 22px;font-size:14px;cursor:pointer}</style>
<h2>Dispatch ${esc(id)} to Marsh</h2>
<pre>${esc(prompt.slice(0, 2000))}</pre>
<form method="POST" action="/work"><input type="hidden" name="token" value="${WORK_TOKEN}"><input type="hidden" name="prompt" value="${esc(prompt)}"><button>Dispatch station session</button></form>`);
    } else if (url.pathname === '/work' && req.method === 'POST') {
      let d = '';
      req.on('data', (c) => (d += c));
      req.on('end', () => {
        const form = new URLSearchParams(d);
        if (form.get('token') !== WORK_TOKEN) { res.writeHead(403).end('bad token'); return; }
        const prompt = form.get('prompt') ?? '';
        const id = prompt.match(/[A-Z]+-\d+/)?.[0] ?? 'issue';
        const routed = `Route Linear issue ${id} to the correct Marsh station and run it: an approved plan on a committed (Todo) issue means the /marsh:build contract; otherwise /marsh:plan. Honor every gate — this click is dispatch, not approval. Linear issue prompt follows.\n\n${prompt}`;
        const claudeBin = existsSync(join(process.env.HOME ?? '', '.local/bin/claude')) ? join(process.env.HOME, '.local/bin/claude') : 'claude';
        execFile(claudeBin, ['--bg', '--name', `marsh-${id}`, routed], { cwd: process.cwd() }, () => {});
        res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="2;url=/"><body style="font:14px -apple-system,sans-serif;background:#1A2420;color:#E8DFD0;display:grid;place-items:center;height:100vh"><div>dispatched <b>marsh-${esc(id)}</b> — returning to the board…</div>`);
      });
    } else if (url.pathname === '/up' && req.method === 'POST') {
      // Self-heal from the PWA window: bring up tmux/claude/ttyd (idempotent).
      execFile('sh', [join(import.meta.dirname, 'marsh-up.sh')], { env: { ...process.env, MARSH_NO_OPEN: '1' } }, (err, stdout) => {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: !err, log: String(stdout).slice(-400) }));
      });
    } else if (url.pathname === '/upload' && req.method === 'POST') {
      // Raw file body → var/uploads/<ts>-<name>; responds with the absolute
      // path (the UI then types it into the tmux session for Claude to read).
      // No spaces in the saved name: the path is typed into the terminal
      // unquoted, so it must be shell/prompt-safe as a single token.
      const name = basename(url.searchParams.get('name') || 'file').replace(/[^\w.@-]/g, '_') || 'file';
      const chunks = [];
      let size = 0;
      req.on('data', (c) => { size += c.length; if (size <= 25e6) chunks.push(c); });
      req.on('end', () => {
        if (size > 25e6) { res.writeHead(413).end('file too large (25MB max)'); return; }
        if (!size) { res.writeHead(400).end('empty upload'); return; }
        const dir = resolve('var/uploads');
        mkdirSync(dir, { recursive: true });
        const p = join(dir, `${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}-${name}`);
        writeFileSync(p, Buffer.concat(chunks));
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, path: p }));
      });
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
});

// WebSocket relay for the proxied terminal (/term/ws → ttyd)
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/term')) { socket.destroy(); return; }
  const path = req.url.replace(/^\/term\/?/, '/');
  const up = netConnect(TERM_PORT, TERM_HOST, () => {
    let raw = `GET ${path} HTTP/1.1\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i];
      raw += `${k}: ${k.toLowerCase() === 'host' ? `${TERM_HOST}:${TERM_PORT}` : req.rawHeaders[i + 1]}\r\n`;
    }
    up.write(raw + '\r\n');
    if (head?.length) up.write(head);
    socket.pipe(up);
    up.pipe(socket);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

server.listen(PORT, '127.0.0.1', () =>
  console.log(`marsh serve → http://127.0.0.1:${PORT}  (cards: ${CARDS_DIR}, tmux: ${TMUX}, term proxy: /term/ → ${TERM_HOST}:${TERM_PORT})`)
);
