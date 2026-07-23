#!/usr/bin/env node
// marsh serve — local kanban over workbench/cards/.
// Zero dependencies. Writes are string-scoped edits only:
//   POST /move  rewrites the `column:` frontmatter line, nothing else
//   POST /reply rewrites the "## Your reply" zone body, nothing else
// The UI is therefore physically incapable of touching Marsh-owned state.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, readdirSync, watch, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const CARDS_DIR = flag('dir', 'workbench/cards');
const PORT = Number(flag('port', 4643));
const COLUMNS = ['inbox', 'ready', 'in-progress', 'awaiting-decision', 'in-review', 'done'];

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  const raw = readFileSync(p, 'utf8');
  writeFileSync(p, raw.replace(/^column: .*$/m, `column: ${column}`));
}

function writeReply(file, text) {
  const p = safePath(file);
  const raw = readFileSync(p, 'utf8');
  writeFileSync(p, raw.replace(/(^## Your reply\n)[\s\S]*?(?=^## )/m, `$1${text.trim()}\n\n`));
}

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
  const cols = COLUMNS.map((col) => {
    const items = all.filter((c) => c.column === col);
    return `<div class="col" data-column="${col}"><h2>${col} <span>${items.length}</span></h2>${items.map(cardHtml).join('')}</div>`;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><title>marsh</title>
<style>
  body{font:13px/1.45 -apple-system,sans-serif;margin:0;background:#111;color:#ddd}
  header{padding:10px 16px;border-bottom:1px solid #333;display:flex;gap:12px;align-items:baseline}
  h1{font-size:15px;margin:0}#stamp{color:#777;font-size:11px}
  .board{display:flex;gap:10px;padding:12px;overflow-x:auto;align-items:flex-start}
  .col{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;min-width:230px;max-width:280px;flex:1;padding:8px;min-height:120px}
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
</style>
<header><h1>marsh workbench</h1><span id="stamp">${new Date().toISOString()} · ${all.length} cards · ${esc(CARDS_DIR)}</span></header>
<div class="board">${cols}</div>
<script>
  const post=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});
  document.querySelectorAll('.card').forEach(c=>c.addEventListener('dragstart',e=>e.dataTransfer.setData('text',c.dataset.file)));
  document.querySelectorAll('.col').forEach(col=>{
    col.addEventListener('dragover',e=>{e.preventDefault();col.classList.add('drop')});
    col.addEventListener('dragleave',()=>col.classList.remove('drop'));
    col.addEventListener('drop',async e=>{e.preventDefault();col.classList.remove('drop');
      await post('/move',{file:e.dataTransfer.getData('text'),column:col.dataset.column});location.reload()});
  });
  document.querySelectorAll('button[data-file]').forEach(b=>b.addEventListener('click',async()=>{
    const t=document.querySelector('textarea[data-file="'+b.dataset.file+'"]');
    await post('/reply',{file:b.dataset.file,text:t.value});b.textContent='saved';setTimeout(()=>location.reload(),400)}));
  new EventSource('/events').addEventListener('change',()=>{
    if(!document.activeElement||document.activeElement.tagName!=='TEXTAREA')location.reload()});
</script>`;
}

const clients = new Set();
let debounce;
if (existsSync(CARDS_DIR))
  watch(CARDS_DIR, () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => clients.forEach((r) => r.write('event: change\ndata: {}\n\n')), 300);
  });

const body = (req) =>
  new Promise((res) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => res(JSON.parse(d || '{}')));
  });

createServer(async (req, res) => {
  try {
    if (req.url === '/' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html' }).end(boardHtml());
    } else if (req.url === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write('\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
    } else if (req.url === '/move' && req.method === 'POST') {
      const { file, column } = await body(req);
      moveCard(file, column);
      res.writeHead(200).end('ok');
    } else if (req.url === '/reply' && req.method === 'POST') {
      const { file, text } = await body(req);
      writeReply(file, text ?? '');
      res.writeHead(200).end('ok');
    } else res.writeHead(404).end();
  } catch (e) {
    res.writeHead(400).end(String(e.message ?? e));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`marsh serve → http://127.0.0.1:${PORT}  (cards: ${CARDS_DIR})`));
