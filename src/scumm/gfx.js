// SCUMM v2 bitmap decoding: column-major RLE with "repeat previous column" dithering,
// followed by a column-major RLE z-plane (1 bit per pixel, MSB first).

export const EGA = [
  [0x00, 0x00, 0x00], [0x00, 0x00, 0xaa], [0x00, 0xaa, 0x00], [0x00, 0xaa, 0xaa],
  [0xaa, 0x00, 0x00], [0xaa, 0x00, 0xaa], [0xaa, 0x55, 0x00], [0xaa, 0xaa, 0xaa],
  [0x55, 0x55, 0x55], [0x55, 0x55, 0xff], [0x55, 0xff, 0x55], [0x55, 0xff, 0xff],
  [0xff, 0x55, 0x55], [0xff, 0x55, 0xff], [0xff, 0xff, 0x55], [0xff, 0xff, 0xff],
];

// Returns { pixels: Uint8Array(w*h) palette indices, mask: Uint8Array(w*h) 0/1, end }
export function decodeImage(d, offs, width, height, maskOffs = -1) {
  const pixels = new Uint8Array(width * height);
  const dither = new Uint8Array(height);
  let src = offs;
  let run = 1;
  let color = 0;
  let isDither = false;
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (--run === 0) {
        const data = d[src++];
        if (data & 0x80) {
          run = data & 0x7f;
          isDither = true;
        } else {
          run = data >> 4;
          isDither = false;
        }
        color = data & 0x0f;
        if (run === 0) run = d[src++];
      }
      if (!isDither) dither[y] = color;
      pixels[y * width + x] = dither[y];
    }
  }
  const imageEnd = src;
  if (maskOffs >= 0) src = maskOffs;
  const mask = new Uint8Array(width * height);
  const cols = width >> 3;
  let cx = 0;
  let cy = 0;
  const put = (v) => {
    if (cx < cols) {
      const base = cy * width + cx * 8;
      for (let b = 0; b < 8; b++) mask[base + b] = (v >> (7 - b)) & 1;
    }
    if (++cy >= height) { cy = 0; cx++; }
  };
  while (cx < cols && src < d.length) {
    let r = d[src++];
    if (r & 0x80) {
      r &= 0x7f;
      const v = d[src++];
      do put(v); while (--r > 0);
    } else {
      do put(d[src++]); while (--r > 0);
    }
  }
  return { pixels, mask, width, height, imageEnd, end: src };
}

export function toRGBA(img, palette = EGA, transparent = -1) {
  const out = new Uint8ClampedArray(img.width * img.height * 4);
  for (let i = 0; i < img.pixels.length; i++) {
    const c = img.pixels[i];
    const p = palette[c];
    out[i * 4] = p[0];
    out[i * 4 + 1] = p[1];
    out[i * 4 + 2] = p[2];
    out[i * 4 + 3] = c === transparent ? 0 : 255;
  }
  return out;
}
