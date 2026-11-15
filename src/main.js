import { readStDisk } from './disk.js';
import { Resources } from './scumm/resources.js';
import { Engine, VAR, SCREEN } from './scumm/engine.js';
import { RoomRenderer, PALETTES } from './render.js';
import { Audio } from './audio.js';
import { codeBook } from './codebook.js';

const S = 4; // output scale: 320x200 -> 1280x800
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const loader = document.getElementById('loader');
const statusEl = document.getElementById('status');
const bar = document.getElementById('bar');
const $ = (id) => document.getElementById(id);

let engine = null;
let renderer = null;
let diskFiles = null;
const audio = new Audio();
const roomCanvas = document.createElement('canvas');
roomCanvas.width = SCREEN.W * S;
roomCanvas.height = SCREEN.ROOM_H * S;
const roomCtx = roomCanvas.getContext('2d');
const roomImage = roomCtx.createImageData(roomCanvas.width, roomCanvas.height);
const mouse = { x: 160, y: 100, inside: false };
const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';

// ------------------------------------------------------------ disk storage
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('mansion-remake', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function kv(mode, fn) {
  try {
    const db = await idb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  } catch { return undefined; }
}
const storeGet = (k) => kv('readonly', (s) => s.get(k));
const storeSet = (k, v) => kv('readwrite', (s) => s.put(v, k));
const storeDel = (k) => kv('readwrite', (s) => s.delete(k));

function parseDisk(bytes) {
  const files = readStDisk(bytes);
  if (!files.has('00.LFL')) throw new Error('This disk image has no 00.LFL - is it the right game?');
  return files;
}

async function loadBytes(bytes, remember) {
  try {
    diskFiles = parseDisk(new Uint8Array(bytes));
    if (remember) await storeSet('disk', bytes);
    start();
  } catch (e) {
    statusEl.textContent = e.message;
  }
}

// ------------------------------------------------------------ game start
function start() {
  const res = new Resources(diskFiles);
  engine = new Engine(res, {
    log: (m) => console.log('[engine]', m),
    sound: (id, data) => audio.play(id, data),
    stopSound: (id) => audio.stop(id),
    stopMusic: () => audio.stopAll(),
    soundRunning: (id) => audio.isRunning(id),
    musicTimer: () => audio.musicTimer(),
    roomChanged: () => { dirty = true; setTimeout(() => saveGame('save-auto', true), 600); },
  });
  renderer = new RoomRenderer(engine);
  audio.stopAll();
  window.__game = { engine, renderer, audio, codeBook: () => codeBook(engine) };
  loader.hidden = true;
  bar.hidden = false;
  canvas.classList.remove('idle');
  canvas.focus();
  engine.boot();
  last = performance.now();
  acc = 0;
  dirty = true;
}

// ------------------------------------------------------------ main loop
let last = 0;
let acc = 0;
let dirty = true;
function frame(now) {
  requestAnimationFrame(frame);
  if (!engine) return;
  if (engine.restartRequested) { start(); return; }
  acc += Math.min(250, now - last);
  last = now;
  const step = (Math.max(1, engine.vars[VAR.TIMER_NEXT]) * 1000) / 60;
  let n = 0;
  while (acc >= step && n < 4) {
    engine.mouse.x = mouse.x;
    engine.mouse.y = mouse.y;
    engine.tick();
    acc -= step;
    n++;
    dirty = true;
  }
  if (acc > step * 4) acc = 0;
  if (dirty || renderer.inMotion()) {
    renderer.render(roomImage, Math.min(1, acc / step));
    roomCtx.putImageData(roomImage, 0, 0);
    dirty = false;
  }
  drawScreen();
}

function css(i) { const p = PALETTES[renderer.palette][i & 15]; return `rgb(${p[0]},${p[1]},${p[2]})`; }

function drawText(text, x, y, color, { align = 'left', size = 28, weight = 600 } = {}) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawScreen() {
  const e = engine;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(roomCanvas, 0, SCREEN.ROOM_TOP * S);

  // dialogue / system text (top two rows)
  if (e.text) {
    const lines = e.text.pages[e.text.page].split('\n');
    lines.forEach((line, i) => {
      const centered = /^\s{3,}/.test(line);
      const t = line.trim();
      if (!t) return;
      if (centered) drawText(t, canvas.width / 2, 4 + i * 30, css(e.text.color), { align: 'center' });
      else drawText(t, 12, 4 + i * 30, css(e.text.color));
    });
  }

  const hoverVerb = mouse.inside ? e.verbAt(mouse.x, mouse.y) : null;
  // sentence line
  if (e.userState & 0x20 && e.sentenceLine) {
    let line = e.sentenceLine;
    const hover = hoverName();
    if (hover) line = line.trimEnd() + ' ' + hover;
    drawText(line, canvas.width / 2, SCREEN.VERB_TOP * S + 2, css(hover ? 15 : 13), { align: 'center', size: 27 });
  }
  // verbs
  if (e.userState & 0x80) {
    for (const v of e.verbs) {
      if (!v.on || !v.name) continue;
      drawText(v.name, v.x * S + 4, v.y * S + 2, css(v === hoverVerb ? 14 : 10), { size: 27 });
    }
  }
  // inventory
  if (e.userState & 0x40) {
    const inv = e.inventoryLayout();
    for (const it of inv.items) {
      const hot = mouse.inside && mouse.x >= it.x && mouse.x < it.x + it.w && mouse.y >= it.y && mouse.y < it.y + it.h;
      drawText(it.name, it.x * S + 4, it.y * S, css(hot ? 14 : 13), { size: 25 });
    }
    if (inv.up) drawText('▲', 160 * S, SCREEN.INV_TOP * S, css(11), { align: 'center', size: 24 });
    if (inv.down) drawText('▼', 160 * S, (SCREEN.INV_TOP + 8) * S, css(11), { align: 'center', size: 24 });
  }
  drawCodeBook();
  if (notice.until > performance.now()) drawText(notice.text, canvas.width / 2, canvas.height - 44, css(14), { align: 'center', size: 26 });
  // cursor
  if (mouse.inside && e.cursorOn) {
    const x = mouse.x * S, y = mouse.y * S;
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.8)';
    for (const pass of [0, 1]) {
      if (pass) { ctx.lineWidth = 2.5; ctx.strokeStyle = css(15); }
      ctx.beginPath();
      ctx.moveTo(x - 22, y); ctx.lineTo(x - 7, y); ctx.moveTo(x + 7, y); ctx.lineTo(x + 22, y);
      ctx.moveTo(x, y - 22); ctx.lineTo(x, y - 7); ctx.moveTo(x, y + 7); ctx.lineTo(x, y + 22);
      ctx.stroke();
    }
  }
}

// Name of whatever is under the pointer, shown as a preview of the sentence.
function hoverName() {
  const e = engine;
  if (!mouse.inside || !e.userPut || !e.room || e.vars[VAR.CURSORSTATE] === 3) return '';
  const o1 = e.vars[VAR.SENTENCE_OBJECT1], o2 = e.vars[VAR.SENTENCE_OBJECT2], prep = e.vars[VAR.SENTENCE_PREPOSITION];
  if (o2 || (o1 && !prep)) return '';
  let id = 0;
  if (mouse.y >= SCREEN.ROOM_TOP && mouse.y < SCREEN.VERB_TOP) {
    const rx = mouse.x + e.camera.x - 160, ry = mouse.y - SCREEN.ROOM_TOP;
    id = e.findObject(rx, ry);
  } else if (mouse.y >= SCREEN.INV_TOP) {
    const it = e.inventoryLayout().items.find((i) => mouse.x >= i.x && mouse.x < i.x + i.w && mouse.y >= i.y && mouse.y < i.y + i.h);
    if (it) id = it.id;
  }
  if (!id || id === o1) return '';
  return e.objName(id);
}

let showCodeBook = true;
function drawCodeBook() {
  const cb = showCodeBook ? codeBook(engine) : null;
  if (!cb) return;
  const top = SCREEN.ROOM_TOP * S;
  const tile = 76, gap = 14, pw = 4 * tile + 5 * gap, ph = 190;
  const px = canvas.width - pw - 36, py = top + 40;
  ctx.fillStyle = 'rgba(8,8,16,.88)';
  ctx.strokeStyle = css(14);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, 14);
  ctx.fill();
  ctx.stroke();
  drawText('Code book', px + gap, py + 10, css(14), { size: 26 });
  drawText(`Section ${cb.section}  \u00b7  ${cb.column} ${cb.row}`, px + pw - gap, py + 12, css(15), { size: 22, align: 'right', weight: 500 });
  cb.buttons.forEach((b, i) => {
    const dx = px + gap + i * (tile + gap), dy = py + 56;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(roomCanvas, b.x * S, b.y * S, b.w * S, 12 * S, dx, dy + 8, tile, tile * 0.75);
    drawText(String(i + 1), dx + tile / 2, dy + tile + 22, css(7), { size: 20, align: 'center', weight: 500 });
  });
  ctx.imageSmoothingEnabled = false;
}

// ------------------------------------------------------------ input
function toGame(ev) {
  const r = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(SCREEN.W - 1, Math.floor(((ev.clientX - r.left) / r.width) * SCREEN.W))),
    y: Math.max(0, Math.min(SCREEN.H - 1, Math.floor(((ev.clientY - r.top) / r.height) * SCREEN.H))),
  };
}
let barTimer = 0;
function pokeBar() {
  bar.classList.add('show');
  clearTimeout(barTimer);
  barTimer = setTimeout(() => bar.classList.remove('show'), 2500);
}
canvas.addEventListener('pointermove', (ev) => { Object.assign(mouse, toGame(ev), { inside: true }); if (ev.clientY < 70) pokeBar(); });
canvas.addEventListener('pointerleave', () => { mouse.inside = false; });
canvas.addEventListener('pointerdown', (ev) => {
  if (!engine) return;
  audio.unlock();
  canvas.focus();
  Object.assign(mouse, toGame(ev), { inside: true });
  if (engine.text && !engine.userPut) { engine.skipText(); return; }
  engine.clicks.push({ x: mouse.x, y: mouse.y, button: ev.button });
  ev.preventDefault();
});
canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
const KEYMAP = { F1: 1, F2: 2, F3: 3, F8: 8, Enter: 13, Escape: 27, '.': 46, ' ': 32 };
window.addEventListener('keydown', (ev) => {
  if (!engine || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ev.key === 'f' || ev.key === 'F') { toggleFullscreen(); return; }
  if (ev.key === 'F5') { saveGame(); ev.preventDefault(); return; }
  if (ev.key === 'F7') { loadGame(); ev.preventDefault(); return; }
  const code = KEYMAP[ev.key];
  if (code === undefined) return;
  audio.unlock();
  engine.keys.push(code);
  ev.preventDefault();
});

function toggleFullscreen() {
  const el = document.getElementById('stage');
  if (document.fullscreenElement) document.exitFullscreen();
  else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
}
$('btn-full').onclick = toggleFullscreen;
$('btn-skip').onclick = () => { if (engine) engine.keys.push(27); canvas.focus(); };
const MODES = ['remaster', 'smooth', 'pixel'];
$('btn-smooth').onclick = (ev) => { renderer.mode = MODES[(MODES.indexOf(renderer.mode) + 1) % MODES.length]; ev.target.textContent = 'Graphics: ' + renderer.mode; dirty = true; canvas.focus(); };
$('btn-pal').onclick = (ev) => { renderer.palette = renderer.palette === 'remaster' ? 'classic' : 'remaster'; ev.target.textContent = 'Palette: ' + renderer.palette; dirty = true; canvas.focus(); };
$('btn-sound').onclick = (ev) => { audio.setEnabled(!audio.enabled); ev.target.textContent = 'Sound: ' + (audio.enabled ? 'on' : 'off'); canvas.focus(); };
// ---- save / load (one manual slot + an autosave on every room change)
let notice = { text: '', until: 0 };
function say(text) { notice = { text, until: performance.now() + 2200 }; }
function saveGame(key = 'save-manual', quiet = false) {
  if (!engine || !engine.userPut) { if (!quiet) say('You can only save while you have control.'); return; }
  try {
    localStorage.setItem('mansion-' + key, JSON.stringify(engine.snapshot()));
    if (!quiet) say('Game saved.');
  } catch (e) { if (!quiet) say('Could not save: ' + e.message); }
}
function loadGame(key = 'save-manual') {
  let raw = null;
  try { raw = localStorage.getItem('mansion-' + key); } catch { /* storage unavailable */ }
  if (!raw && key === 'save-manual') { try { raw = localStorage.getItem('mansion-save-auto'); } catch { /* ignore */ } }
  if (!raw) { say('No saved game yet.'); return; }
  if (engine.restore(JSON.parse(raw))) { dirty = true; say('Game loaded.'); }
}
$('btn-save').onclick = () => { saveGame(); canvas.focus(); };
$('btn-load').onclick = () => { loadGame(); canvas.focus(); };
$('btn-code').onclick = (ev) => { showCodeBook = !showCodeBook; ev.target.textContent = 'Code book: ' + (showCodeBook ? 'on' : 'off'); canvas.focus(); };
$('btn-eject').onclick = async () => { await storeDel('disk'); location.reload(); };

// ------------------------------------------------------------ loader UI
const drop = $('drop');
$('file').addEventListener('change', async (ev) => {
  const f = ev.target.files[0];
  if (f) loadBytes(await f.arrayBuffer(), true);
});
for (const t of ['dragenter', 'dragover']) window.addEventListener(t, (ev) => { ev.preventDefault(); drop.classList.add('over'); });
for (const t of ['dragleave', 'drop']) window.addEventListener(t, (ev) => { ev.preventDefault(); drop.classList.remove('over'); });
window.addEventListener('drop', async (ev) => {
  const f = ev.dataTransfer && ev.dataTransfer.files[0];
  if (f) loadBytes(await f.arrayBuffer(), true);
});

(async function init() {
  canvas.classList.add('idle');
  requestAnimationFrame(frame);
  const dev = new URLSearchParams(location.search).get('disk');
  if (dev) {
    try {
      const r = await fetch(dev);
      if (!r.ok) throw new Error('Could not fetch ' + dev);
      return loadBytes(await r.arrayBuffer(), false);
    } catch (e) { statusEl.textContent = e.message; }
  }
  const saved = await storeGet('disk');
  if (saved) loadBytes(saved, false);
})();
