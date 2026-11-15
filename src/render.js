// Composes the room view (background + objects + actors) and upscales it.
import { decodeImage } from './scumm/gfx.js';
import { VAR, SCREEN } from './scumm/engine.js';

// Remastered 16-colour palette (index-compatible with the game's EGA colours).
export const PALETTES = {
  remaster: [
    [0x0b, 0x0b, 0x14], [0x1f, 0x2f, 0x8f], [0x2f, 0x8f, 0x3f], [0x1f, 0x95, 0x9f],
    [0xa8, 0x2a, 0x2a], [0x8f, 0x3a, 0x96], [0x9a, 0x5a, 0x24], [0xb4, 0xb4, 0xb8],
    [0x4a, 0x4c, 0x5c], [0x5a, 0x7c, 0xf0], [0x6c, 0xdc, 0x6a], [0x66, 0xe0, 0xe6],
    [0xf2, 0x6a, 0x5c], [0xea, 0x74, 0xe0], [0xf6, 0xe2, 0x6a], [0xf7, 0xf5, 0xee],
  ],
  classic: [
    [0, 0, 0], [0, 0, 0xaa], [0, 0xaa, 0], [0, 0xaa, 0xaa], [0xaa, 0, 0], [0xaa, 0, 0xaa], [0xaa, 0x55, 0], [0xaa, 0xaa, 0xaa],
    [0x55, 0x55, 0x55], [0x55, 0x55, 0xff], [0x55, 0xff, 0x55], [0x55, 0xff, 0xff], [0xff, 0x55, 0x55], [0xff, 0x55, 0xff], [0xff, 0xff, 0x55], [0xff, 0xff, 0xff],
  ],
};

const VW = SCREEN.W, VH = SCREEN.ROOM_H;

export class RoomRenderer {
  constructor(engine) {
    this.e = engine;
    this.roomImg = null;
    this.roomKey = null;
    this.objCache = new Map();
    this.idx = new Uint8Array(VW * VH);
    this.mask = new Uint8Array(VW * VH);
    this.scale = 4;
    this.mode = 'remaster';
    this.palette = 'remaster';
    this.spritePack = null; // optional overrides, see sprites/README.md
  }

  _room() {
    const r = this.e.room;
    if (this.roomKey !== r) {
      this.roomKey = r;
      this.objCache.clear();
      this.roomImg = r ? decodeImage(r.data, r.imOffs, r.width, r.height, r.maskOffs) : null;
    }
    return this.roomImg;
  }
  _obj(o) {
    if (!this.objCache.has(o.id)) {
      let img = null;
      if (o.imgOffs && o.width && o.height) {
        try { img = decodeImage(this.e.room.data, o.imgOffs, o.width, o.height); } catch { img = null; }
      }
      this.objCache.set(o.id, img);
    }
    return this.objCache.get(o.id);
  }

  // Fills this.idx with palette indices for the visible 320x128 window.
  compose(alpha = 1) {
    const e = this.e;
    const { idx, mask } = this;
    const img = this._room();
    if (!img) { idx.fill(0); return; }
    const lerp = (a, b) => (Math.abs(b - a) > 16 ? b : a + (b - a) * alpha);
    const camX = Math.round(lerp(e.camera.prevX === undefined ? e.camera.x : e.camera.prevX, e.camera.x));
    const camLeft = Math.max(0, Math.min(img.width - VW, camX - 160));
    const lights = e.vars[VAR.CURRENT_LIGHTS];
    const dark = !(lights & 2);
    const pal = e.roomPalette;
    for (let y = 0; y < VH; y++) {
      const src = y * img.width + camLeft, dst = y * VW;
      for (let x = 0; x < VW; x++) {
        idx[dst + x] = pal[img.pixels[src + x]];
        mask[dst + x] = img.mask[src + x];
      }
    }
    for (const o of e.visibleObjects()) {
      const oi = this._obj(o);
      if (!oi) continue;
      const p = e.objPos(o);
      for (let y = 0; y < oi.height; y++) {
        const sy = p.y + y;
        if (sy < 0 || sy >= VH) continue;
        for (let x = 0; x < oi.width; x++) {
          const sx = p.x + x - camLeft;
          if (sx < 0 || sx >= VW) continue;
          idx[sy * VW + sx] = pal[oi.pixels[y * oi.width + x]];
          mask[sy * VW + sx] = oi.mask[y * oi.width + x];
        }
      }
    }
    if (dark) {
      const fl = lights & 4;
      const mx = e.mouse.x, my = e.mouse.y - SCREEN.ROOM_TOP;
      const hw = (e.flashlight.w || 6) * 4, hh = (e.flashlight.h || 4) * 4;
      for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++) {
        if (fl && Math.abs(x - mx) < hw && Math.abs(y - my) < hh) continue;
        idx[y * VW + x] = 0;
      }
    }
    for (const a of e.visibleActors()) {
      const flip = a.facing === 0;
      const ax = Math.round(lerp(a.prevX, a.x)) - camLeft + (flip ? 16 : 8);
      const ay = Math.round(lerp(a.prevY, a.y)) - a.elevation;
      const useMask = a.walkbox >= 0 && e.room.boxes[a.walkbox] && e.room.boxes[a.walkbox].mask !== 0;
      const trans = a.cost.transparent;
      for (const f of a.cost.frames(a.cs, flip)) {
        const { pic } = f;
        for (let y = 0; y < pic.h; y++) {
          const sy = ay + f.dy + y;
          if (sy < 0 || sy >= VH) continue;
          for (let x = 0; x < pic.w; x++) {
            let c = pic.pixels[y * pic.w + (flip ? pic.w - 1 - x : x)];
            if (!c) continue;
            const sx = ax + f.dx + x;
            if (sx < 0 || sx >= VW) continue;
            const o = sy * VW + sx;
            if (useMask && mask[o]) continue;
            if (dark) c = c === 12 ? 0 : 8;
            else if (c === trans) c = 0;
            else if (a.palette[c] !== undefined) c = a.palette[c];
            idx[o] = c;
          }
        }
      }
    }
  }

  // Scale2x on 32-bit colours.
  static scale2x(src, w, h, out) {
    const W2 = w * 2;
    for (let y = 0; y < h; y++) {
      const yu = y > 0 ? y - 1 : y, yd = y < h - 1 ? y + 1 : y;
      for (let x = 0; x < w; x++) {
        const E = src[y * w + x];
        const B = src[yu * w + x], H = src[yd * w + x];
        const D = src[y * w + (x > 0 ? x - 1 : x)], F = src[y * w + (x < w - 1 ? x + 1 : x)];
        const o = y * 2 * W2 + x * 2;
        if (B !== H && D !== F) {
          out[o] = D === B ? D : E;
          out[o + 1] = B === F ? F : E;
          out[o + W2] = D === H ? D : E;
          out[o + W2 + 1] = H === F ? F : E;
        } else {
          out[o] = out[o + 1] = out[o + W2] = out[o + W2 + 1] = E;
        }
      }
    }
    return out;
  }

  // Renders the composed frame into `target` (ImageData of VW*4 x VH*4).
  // mode: 'remaster' (dither blending + smoothing + anti-aliasing), 'smooth', 'pixel'
  render(target, alpha = 1) {
    this.compose(alpha);
    const pal = PALETTES[this.palette];
    const lut = new Uint32Array(16);
    for (let i = 0; i < 16; i++) lut[i] = 0xff000000 | (pal[i][2] << 16) | (pal[i][1] << 8) | pal[i][0];
    const out = new Uint32Array(target.data.buffer);
    const mode = this.mode;
    if (!this.b1) {
      this.b1 = new Uint32Array(VW * VH);
      this.b2 = new Uint32Array(VW * VH * 4);
      this.b4 = new Uint32Array(VW * VH * 16);
    }
    const { b1, b2, b4, idx } = this;
    if (mode === 'pixel') {
      const S = 4, W = VW * S;
      for (let y = 0; y < VH; y++) {
        for (let x = 0; x < VW; x++) {
          const c = lut[idx[y * VW + x]];
          const o = y * S * W + x * S;
          out[o] = out[o + 1] = out[o + 2] = out[o + 3] = c;
        }
        const row = y * S * W;
        for (let k = 1; k < S; k++) out.copyWithin(row + k * W, row, row + W);
      }
      return;
    }
    // 1. palette lookup, blending 1-pixel checkerboard dither into a solid mixed colour
    const mix = (a, b) => (((a & 0xfefefe) + (b & 0xfefefe)) >>> 1) | 0xff000000;
    for (let y = 0; y < VH; y++) {
      for (let x = 0; x < VW; x++) {
        const i = y * VW + x;
        const c = idx[i];
        let v = lut[c];
        if (mode === 'remaster' && x > 0 && x < VW - 1 && y > 0 && y < VH - 1) {
          const l = idx[i - 1];
          if (l !== c && l === idx[i + 1] && l === idx[i - VW] && l === idx[i + VW]) {
            // require the diagonal to continue the pattern so lone pixels survive
            if (idx[i - VW - 1] === c || idx[i + VW + 1] === c || idx[i - VW + 1] === c || idx[i + VW - 1] === c) v = mix(v, lut[l]);
          }
        }
        b1[i] = v;
      }
    }
    // 2. edge-directed upscale x4
    RoomRenderer.scale2x(b1, VW, VH, b2);
    const dst = mode === 'remaster' ? b4 : out;
    RoomRenderer.scale2x(b2, VW * 2, VH * 2, dst);
    if (mode !== 'remaster') return;
    // 3. anti-alias: soften only pixels that sit on a colour edge
    const W = VW * 4, H = VH * 4;
    for (let y = 0; y < H; y++) {
      const yu = y > 0 ? y - 1 : y, yd = y < H - 1 ? y + 1 : y;
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const c = b4[i];
        const l = b4[x > 0 ? i - 1 : i], r = b4[x < W - 1 ? i + 1 : i];
        const u = b4[yu * W + x], d = b4[yd * W + x];
        if (l === c && r === c && u === c && d === c) { out[i] = c; continue; }
        const rr = ((c & 0xff) * 4 + (l & 0xff) + (r & 0xff) + (u & 0xff) + (d & 0xff)) >> 3;
        const gg = (((c >> 8) & 0xff) * 4 + ((l >> 8) & 0xff) + ((r >> 8) & 0xff) + ((u >> 8) & 0xff) + ((d >> 8) & 0xff)) >> 3;
        const bb = (((c >> 16) & 0xff) * 4 + ((l >> 16) & 0xff) + ((r >> 16) & 0xff) + ((u >> 16) & 0xff) + ((d >> 16) & 0xff)) >> 3;
        out[i] = 0xff000000 | (bb << 16) | (gg << 8) | rr;
      }
    }
  }

  // true while something on screen is between two positions (needs per-frame redraw)
  inMotion() {
    const e = this.e;
    if (e.camera.prevX !== undefined && e.camera.prevX !== e.camera.x) return true;
    for (const a of e.visibleActors()) if (a.prevX !== a.x || a.prevY !== a.y) return true;
    return false;
  }
}
