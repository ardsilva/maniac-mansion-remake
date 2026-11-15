// Usage: node tools/costume-sheet.mjs <disk.st> <out.png> <costumeId>
// Renders stand/walk frames of a costume in all four directions for verification.
import fs from 'node:fs';
import { readStDisk } from '../src/disk.js';
import { Resources } from '../src/scumm/resources.js';
import { Costume, newCostState } from '../src/scumm/costume.js';
import { EGA } from '../src/scumm/gfx.js';
import { encodePng } from './png.mjs';

const [disk, out, id] = process.argv.slice(2);
const res = new Resources(readStDisk(fs.readFileSync(disk)));
const cost = new Costume(res.costume(+id));
console.log('numAnim', cost.numAnim, 'format', cost.format.toString(16), 'mirror', cost.mirror, 'transparent', cost.transparent);
const CW = 48, CH = 72, COLS = 8, ROWS = 6;
const W = CW * COLS, H = CH * ROWS;
const img = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) { img[i * 4] = 40; img[i * 4 + 1] = 60; img[i * 4 + 2] = 90; img[i * 4 + 3] = 255; }
for (let frame = 0; frame < ROWS; frame++) {
  for (let dir = 0; dir < 4; dir++) {
    for (let stepN = 0; stepN < 2; stepN++) {
      const st = newCostState();
      cost.startAnim(st, frame * 4 + dir);
      for (let k = 0; k < stepN * 2; k++) cost.step(st);
      const ox = (dir * 2 + stepN) * CW + CW / 2, oy = frame * CH + CH - 4;
      for (const f of cost.frames(st, dir === 0)) {
        for (let y = 0; y < f.pic.h; y++) for (let x = 0; x < f.pic.w; x++) {
          const c = f.pic.pixels[y * f.pic.w + (f.flip ? f.pic.w - 1 - x : x)];
          if (!c) continue;
          const px = ox + f.dx + x, py = oy + f.dy + y;
          if (px < 0 || py < 0 || px >= W || py >= H) continue;
          const o = (py * W + px) * 4;
          img[o] = EGA[c][0]; img[o + 1] = EGA[c][1]; img[o + 2] = EGA[c][2];
        }
      }
    }
  }
}
fs.writeFileSync(out, encodePng(img, W, H));
