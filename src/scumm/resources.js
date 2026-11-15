// SCUMM v2 (Maniac Mansion enhanced / Atari ST) resource loading.
import { decodeLfl } from '../disk.js';

const u16 = (d, o) => d[o] | (d[o + 1] << 8);

export class Resources {
  // files: Map of UPPERCASE name -> raw (still XOR-encoded) bytes
  constructor(files) {
    this.files = files;
    this.cache = new Map();
    const idx = this.file(0);
    if (!idx) throw new Error('00.LFL not found on disk');
    if (u16(idx, 0) !== 0x0100) throw new Error('Not a SCUMM v2 index (magic ' + u16(idx, 0).toString(16) + ')');
    let p = 2;
    const nObj = u16(idx, p);
    p += 2;
    this.objectOwner = new Uint8Array(nObj);
    this.objectState = new Uint8Array(nObj);
    for (let i = 0; i < nObj; i++) {
      this.objectOwner[i] = idx[p + i] & 0x0f;
      this.objectState[i] = idx[p + i] >> 4;
    }
    p += nObj;
    const list = () => {
      const n = idx[p++];
      const room = Array.from(idx.subarray(p, p + n));
      p += n;
      const offs = [];
      for (let i = 0; i < n; i++, p += 2) offs.push(u16(idx, p));
      return { n, room, offs };
    };
    this.rooms = list();
    this.costumes = list();
    this.scripts = list();
    this.sounds = list();
    this.roomCache = new Map();
  }

  file(n) {
    if (this.cache.has(n)) return this.cache.get(n);
    const name = String(n).padStart(2, '0') + '.LFL';
    const raw = this.files.get(name);
    const dec = raw ? decodeLfl(raw) : null;
    this.cache.set(n, dec);
    return dec;
  }

  hasRoom(n) {
    return !!this.file(n) && n > 0;
  }

  // Generic "resource inside a room file": first word is the size.
  _res(list, id) {
    if (id >= list.n) return null;
    const off = list.offs[id];
    const room = list.room[id];
    if (off === 0xffff) return null;
    const f = this.file(room);
    if (!f) return null;
    const size = u16(f, off);
    return f.subarray(off, off + size);
  }
  costume(id) { return this._res(this.costumes, id); }
  script(id) { return this._res(this.scripts, id); }
  sound(id) { return this._res(this.sounds, id); }

  room(n) {
    if (this.roomCache.has(n)) return this.roomCache.get(n);
    const f = this.file(n);
    if (!f) return null;
    const size = u16(f, 0);
    const d = f.subarray(0, size);
    const r = {
      id: n,
      data: d,
      width: u16(d, 4),
      height: u16(d, 6),
      imOffs: u16(d, 10),
      maskOffs: u16(d, 12),
      numObjects: d[20],
      boxOffs: d[21],
      numSounds: d[22],
      numScripts: d[23],
      excdOffs: u16(d, 24),
      encdOffs: u16(d, 26),
      objects: [],
    };
    let p = 28;
    const imgOffs = [];
    const codeOffs = [];
    for (let i = 0; i < r.numObjects; i++, p += 2) imgOffs.push(u16(d, p));
    for (let i = 0; i < r.numObjects; i++, p += 2) codeOffs.push(u16(d, p));
    r.sounds = Array.from(d.subarray(p, p + r.numSounds));
    p += r.numSounds;
    r.scripts = Array.from(d.subarray(p, p + r.numScripts));
    for (let i = 0; i < r.numObjects; i++) {
      const o = codeOffs[i];
      const size2 = u16(d, o);
      const nameOff = d[o + 14];
      const verbs = new Map();
      for (let v = o + 15; d[v] !== 0; v += 2) verbs.set(d[v], o + d[v + 1]);
      r.objects.push({
        id: u16(d, o + 4),
        x: d[o + 7] * 8,
        y: (d[o + 8] & 0x7f) * 8,
        parentState: d[o + 8] & 0x80 ? 1 : 0,
        width: d[o + 9] * 8,
        parent: d[o + 10],
        walkX: d[o + 11],
        walkY: d[o + 12] & 0x1f,
        walkBits: d[o + 12] >> 5,
        height: d[o + 13] & 0xf8,
        actorDir: d[o + 13] & 7,
        name: readString(d, o + nameOff),
        verbs,
        codeOffs: o,
        codeEnd: o + size2,
        imgOffs: imgOffs[i],
        room: n,
      });
    }
    // boxes: count, then 8 bytes each (uy, ly, ulx, urx, llx, lrx, mask, flags), then matrix
    const boxes = [];
    let b = r.boxOffs;
    const nb = d[b++];
    for (let i = 0; i < nb; i++, b += 8) {
      boxes.push({
        uy: d[b], ly: d[b + 1], ulx: d[b + 2], urx: d[b + 3],
        llx: d[b + 4], lrx: d[b + 5], mask: d[b + 6], flags: d[b + 7],
      });
    }
    r.boxes = boxes;
    r.boxMatrixOffs = b;
    this.roomCache.set(n, r);
    return r;
  }
}

// v2 strings: 7-bit chars, bit 7 set means "followed by a space".
export function readString(d, o) {
  let s = '';
  for (let c = d[o]; c !== 0 && o < d.length; c = d[++o]) {
    s += String.fromCharCode(c & 0x7f);
    if (c & 0x80) s += ' ';
  }
  return s;
}
