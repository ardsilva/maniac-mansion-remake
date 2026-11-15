// Usage: node tools/disasm.mjs <disk.st> [--check] [script N | room N | obj ROOM ID]
// Disassembles SCUMM v2 scripts. --check validates every script on the disk.
import fs from 'node:fs';
import { readStDisk } from '../src/disk.js';
import { Resources } from '../src/scumm/resources.js';
import { decode, decodeText, textToString, SPEC } from '../src/scumm/ops.js';

const argv = process.argv.slice(2);
const res = new Resources(readStDisk(fs.readFileSync(argv[0])));

const fmt = (a) => {
  if (a instanceof Uint8Array) return JSON.stringify(textToString(decodeText(a)));
  if (Array.isArray(a)) return '[' + a.join(',') + ']';
  if (a && typeof a === 'object') return 'V' + a.v;
  return String(a);
};

// Follows control flow from `start`; returns { ins: Map(pc->ins), errors }
export function trace(d, start, end) {
  const ins = new Map();
  const errors = [];
  const todo = [start];
  while (todo.length) {
    let pc = todo.pop();
    while (pc < end && !ins.has(pc)) {
      let i;
      try { i = decode(d, pc); } catch (e) { errors.push(`${pc}: ${e.message}`); break; }
      if (i.next > end) { errors.push(`${pc}: ${i.name} runs past end`); break; }
      ins.set(pc, i);
      const j = SPEC[i.name].endsWith('j') ? i.args[i.args.length - 1] : undefined;
      if (j !== undefined) {
        if (j < start || j >= end) errors.push(`${pc}: ${i.name} jumps out of range to ${j}`);
        else todo.push(j);
      }
      if (i.name === 'beginOverride') todo.push(i.args[0]);
      if ((i.name === 'stopScript' && i.args[0] === 0) || i.name === 'stopObjectCode' || i.name === 'jumpRelative' || i.name === 'restart' || i.name === 'chainScript') break;
      pc = i.next;
    }
    if (pc >= end && !ins.has(pc) && pc !== end) errors.push(`fell off end at ${pc}`);
  }
  // overlapping-instruction check
  const pcs = [...ins.keys()].sort((a, b) => a - b);
  for (let k = 1; k < pcs.length; k++) {
    if (ins.get(pcs[k - 1]).name !== 'beginOverride' && ins.get(pcs[k - 1]).next > pcs[k]) errors.push(`overlap at ${pcs[k - 1]}/${pcs[k]}`);
  }
  return { ins, errors, pcs };
}

function print(d, start, end, label) {
  const { ins, errors, pcs } = trace(d, start, end);
  console.log(`--- ${label} [${start}..${end})`);
  for (const pc of pcs) {
    const i = ins.get(pc);
    console.log(`${String(pc - start).padStart(5)}  ${i.name}(${i.args.map(fmt).join(', ')})`.replace(/\((\d+)\)$/, (m) => m));
  }
  for (const e of errors) console.log('  !! ' + e);
}

function entries() {
  const list = [];
  for (let s = 1; s < res.scripts.n; s++) {
    const d = res.script(s);
    if (d) list.push({ label: `script ${s}`, d, start: 4, end: d.length });
  }
  for (let n = 1; n < 60; n++) {
    const r = res.room(n);
    if (!r) continue;
    const firstObj = Math.min(...r.objects.map((o) => o.codeOffs), r.data.length);
    if (r.excdOffs) list.push({ label: `room ${n} exit`, d: r.data, start: r.excdOffs, end: r.encdOffs > r.excdOffs ? r.encdOffs : r.data.length });
    if (r.encdOffs) list.push({ label: `room ${n} entry`, d: r.data, start: r.encdOffs, end: r.data.length });
    for (const o of r.objects) {
      for (const [verb, off] of o.verbs) list.push({ label: `room ${n} obj ${o.id} "${o.name}" verb ${verb}`, d: r.data, start: off, end: o.codeEnd });
    }
  }
  return list;
}

if (argv.includes('--check')) {
  let bad = 0, total = 0;
  const usage = new Map();
  for (const e of entries()) {
    total++;
    const t = trace(e.d, e.start, e.end);
    for (const i of t.ins.values()) usage.set(i.name, (usage.get(i.name) || 0) + 1);
    if (t.errors.length) { bad++; if (bad <= 25) console.log(e.label, t.errors.slice(0, 3)); }
  }
  console.log(`checked ${total} code entries, ${bad} with errors`);
  console.log([...usage].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
} else {
  const [, kind, a, b] = argv;
  for (const e of entries()) {
    if (kind === 'script' && e.label === `script ${a}`) print(e.d, e.start, e.end, e.label);
    if (kind === 'room' && e.label.startsWith(`room ${a} `) && !e.label.includes(' obj ')) print(e.d, e.start, e.end, e.label);
    if (kind === 'obj' && e.label.startsWith(`room ${a} obj ${b} `)) print(e.d, e.start, e.end, e.label);
  }
}
