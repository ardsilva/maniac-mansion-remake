// SCUMM v2 costume (actor sprite) decoding and animation.
const u16 = (d, o) => d[o] | (d[o + 1] << 8);
const s16 = (d, o) => (u16(d, o) << 16) >> 16;

export class Costume {
  constructor(data) {
    this.d = data;
    this.numAnim = data[4];
    this.format = data[5] & 0x7f;
    this.mirror = (data[5] & 0x80) !== 0;
    this.transparent = data[6];
    this.animCmds = u16(data, 7);
    this.frameOffsets = 9;
    this.dataOffsets = 41;
    this.pictures = new Map();
  }

  // Sets up limb state for animation `anim` (already combined with direction).
  startAnim(state, anim) {
    const d = this.d;
    if (anim > this.numAnim) return;
    let r = u16(d, this.dataOffsets + anim * 2);
    if (r === 0) return;
    let mask = u16(d, r);
    r += 2;
    for (let i = 0; mask & 0xffff; i++, mask <<= 1) {
      if (!(mask & 0x8000)) continue;
      const j = d[r++];
      if (j === 0xff) {
        state.curpos[i] = 0xffff;
        state.start[i] = 0;
        continue;
      }
      const extra = d[r++];
      const cmd = d[this.animCmds + j];
      if (cmd === 0x7a) state.stopped &= ~(1 << i);
      else if (cmd === 0x79) state.stopped |= 1 << i;
      else {
        state.start[i] = j;
        state.end[i] = j + (extra & 0x7f);
        state.curpos[i] = j | (extra & 0x80 ? 0x8000 : 0);
      }
    }
  }

  // Advance every limb one animation step.
  step(state) {
    const d = this.d;
    for (let i = 0; i < 16; i++) {
      if (state.curpos[i] === 0xffff) continue;
      let p = state.curpos[i] & 0x7fff;
      const high = state.curpos[i] & 0x8000;
      for (let guard = 0; guard < 64; guard++) {
        if (!high) { if (p++ >= state.end[i]) p = state.start[i]; }
        else if (p !== state.end[i]) p++;
        const nc = d[this.animCmds + p];
        if ((nc === 0x7c || nc === 0x78) && state.start[i] !== state.end[i]) continue;
        break;
      }
      state.curpos[i] = p | high;
    }
  }

  // Decoded picture for (limb, code): { w, h, relX, relY, moveX, moveY, pixels }
  picture(limb, code) {
    const key = limb * 256 + code;
    if (this.pictures.has(key)) return this.pictures.get(key);
    const d = this.d;
    const frameptr = u16(d, this.frameOffsets + limb * 2);
    const p = u16(d, frameptr + code * 2);
    let pic = null;
    if (p > 0 && p + 12 <= d.length) {
      const w = u16(d, p), h = u16(d, p + 2);
      if (w > 0 && h > 0 && w <= 320 && h <= 200) {
        const pixels = new Uint8Array(w * h);
        let src = p + 12;
        let x = 0, y = 0;
        outer: while (src < d.length) {
          let len = d[src++];
          const color = len >> 4;
          len &= 0x0f;
          if (!len) len = d[src++];
          do {
            pixels[y * w + x] = color;
            if (++y >= h) { y = 0; if (++x >= w) break outer; }
          } while (--len);
        }
        pic = { w, h, relX: s16(d, p + 4), relY: s16(d, p + 6), moveX: s16(d, p + 8), moveY: s16(d, p + 10), pixels };
      }
    }
    this.pictures.set(key, pic);
    return pic;
  }

  // Returns draw list for the current state: [{pic, dx, dy}] relative to the actor origin.
  // `flip` mirrors horizontally (actor facing left).
  frames(state, flip) {
    const out = [];
    let xmove = -72, ymove = -100; // v2 costumes are authored around this origin
    for (let limb = 0; limb < 16; limb++) {
      if (state.curpos[limb] === 0xffff || state.stopped & (1 << limb)) continue;
      const code = this.d[this.animCmds + (state.curpos[limb] & 0x7fff)] & 0x7f;
      if (code === 0x7b) continue;
      const pic = this.picture(limb, code);
      if (!pic) continue;
      const xc = xmove + pic.relX;
      const yc = ymove + pic.relY;
      xmove += pic.moveX;
      ymove -= pic.moveY;
      out.push({ pic, dx: flip ? -xc - pic.w : xc, dy: yc, flip });
    }
    return out;
  }
}

export function newCostState() {
  return {
    curpos: new Uint16Array(16).fill(0xffff),
    start: new Uint16Array(16),
    end: new Uint16Array(16),
    stopped: 0,
  };
}
