// Usage: node tools/headless.mjs <disk.st> [ticks] [--esc N] [--click T:X:Y ...] [--key T:CODE ...]
// Runs the game without graphics and logs what happens. For engine verification.
import fs from 'node:fs';
import { readStDisk } from '../src/disk.js';
import { Resources } from '../src/scumm/resources.js';
import { Engine, VAR } from '../src/scumm/engine.js';

const argv = process.argv.slice(2);
const res = new Resources(readStDisk(fs.readFileSync(argv[0])));
const ticks = +(argv[1] || 300);
const events = [];
for (let i = 2; i < argv.length; i++) {
  if (argv[i] === '--click') { const [t, x, y] = argv[++i].split(':').map(Number); events.push({ t, click: { x, y, button: 0 } }); }
  if (argv[i] === '--sent') { const [t, verb, objA, objB] = argv[++i].split(':').map(Number); events.push({ t, sent: { verb, objA, objB: objB || 0 } }); }
  if (argv[i] === '--eval') { const a = argv[++i]; const k = a.indexOf(':'); events.push({ t: +a.slice(0, k), js: a.slice(k + 1) }); }
  if (argv[i] === '--key') { const [t, k] = argv[++i].split(':').map(Number); events.push({ t, key: k }); }
}
let seed = 12345;
const e = new Engine(res, {
  log: (m) => console.log(`[${e.ticks}] ${m}`),
  sound: (id) => { console.log(`[${e.ticks}] sound ${id}`); },
  roomChanged: (r) => console.log(`[${e.ticks}] room -> ${r}`),
});
e.rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };
e.boot();
let lastText = null, lastSentence = '';
for (let t = 0; t < ticks; t++) {
  for (const ev of events) if (ev.t === t) {
    if (ev.click) { e.mouse.x = ev.click.x; e.mouse.y = ev.click.y; e.clicks.push(ev.click); console.log(`[${t}] click ${ev.click.x},${ev.click.y}`); }
    if (ev.sent) { e.sentence.push(ev.sent); console.log(`[${t}] sentence ${JSON.stringify(ev.sent)}`); }
    if (ev.js) { console.log(`[${t}] eval ${ev.js} =>`, JSON.stringify(new Function('e', 'return ' + ev.js)(e))); }
    if (ev.key) { e.keys.push(ev.key); console.log(`[${t}] key ${ev.key}`); }
  }
  e.tick();
  const txt = e.text ? e.text.pages[e.text.page] : null;
  if (txt !== lastText) { if (txt) console.log(`[${e.ticks}] TEXT(${e.text.actor}): ${JSON.stringify(txt)}`); lastText = txt; }
  if (e.sentenceLine !== lastSentence) { lastSentence = e.sentenceLine; console.log(`[${e.ticks}] SENTENCE: ${lastSentence}`); }
}
const ego = e.actors[e.vars[VAR.EGO]];
console.log('--- final');
console.log('room', e.roomId, 'camera', e.camera.x, 'userPut', e.userPut, 'userState', e.userState.toString(16), 'cursorstate', e.vars[VAR.CURSORSTATE]);
console.log('ego', ego.id, ego.name, 'room', ego.room, 'pos', ego.x, ego.y, 'box', ego.walkbox);
console.log('slots', e.slots.map((s) => `${s.kind}${s.number}:${s.status}${s.frozen ? 'F' : ''}`).join(' '));
console.log('verbs', e.verbs.map((v) => `${v.id}:${v.name}@${v.x},${v.y}${v.on ? '' : '(off)'}`).join(' | '));
console.log('actors here', e.visibleActors().map((a) => `${a.id}:${a.name}@${a.x},${a.y}`).join(' '));
console.log('inventory', e.inventory().map((i) => e.objName(i)).join(', '));
console.log('visible objs', e.visibleObjects().map((o) => `${o.id}:${o.name}`).join(', '));
