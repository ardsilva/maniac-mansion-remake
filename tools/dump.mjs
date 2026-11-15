// Usage: node tools/dump.mjs <disk.st> <outDir> [room ...]
// Renders room backgrounds (and z-planes) to PNG for verification. Output stays local.
import fs from 'node:fs';
import path from 'node:path';
import { readStDisk } from '../src/disk.js';
import { Resources } from '../src/scumm/resources.js';
import { decodeImage, toRGBA } from '../src/scumm/gfx.js';
import { encodePng } from './png.mjs';

const [disk, outDir, ...only] = process.argv.slice(2);
const res = new Resources(readStDisk(fs.readFileSync(disk)));
fs.mkdirSync(outDir, { recursive: true });
for (let n = 1; n < 60; n++) {
  if (only.length && !only.includes(String(n))) continue;
  const r = res.room(n);
  if (!r) continue;
  const img = decodeImage(r.data, r.imOffs, r.width, r.height, r.maskOffs);
  console.log(
    `room ${n}: ${r.width}x${r.height} imgEnd=${img.imageEnd} maskOffs=${r.maskOffs} maskEnd=${img.end}` +
    ` objs=${r.numObjects} boxes=${r.boxes.length} scripts=[${r.scripts}] sounds=[${r.sounds}]`,
  );
  if (only.length) {
    for (const o of r.objects) {
      console.log(`  obj ${o.id} "${o.name}" x=${o.x} y=${o.y} w=${o.width} h=${o.height} walk=${o.walkX},${o.walkY} img=${o.imgOffs} verbs=[${[...o.verbs.keys()]}]`);
    }
    console.log('  boxes', JSON.stringify(r.boxes));
  }
  fs.writeFileSync(path.join(outDir, `room${n}.png`), encodePng(toRGBA(img), r.width, r.height));
  const m = new Uint8ClampedArray(r.width * r.height * 4);
  for (let i = 0; i < img.mask.length; i++) { const v = img.mask[i] ? 255 : 0; m[i * 4] = m[i * 4 + 1] = m[i * 4 + 2] = v; m[i * 4 + 3] = 255; }
  fs.writeFileSync(path.join(outDir, `room${n}_mask.png`), encodePng(m, r.width, r.height));
}
