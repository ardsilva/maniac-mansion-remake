// FAT12 reader for raw Atari ST floppy images (.st).
// Returns a Map of UPPERCASE file name -> Uint8Array.
export function readStDisk(image) {
  const d = image instanceof Uint8Array ? image : new Uint8Array(image);
  const u16 = (o) => d[o] | (d[o + 1] << 8);
  const bps = u16(11);
  const spc = d[13];
  const reserved = u16(14);
  const nfat = d[16];
  const ndir = u16(17);
  const spf = u16(22);
  if (bps !== 512 || !spc || !spf) throw new Error('Not a FAT12 floppy image');
  const fatStart = reserved * bps;
  const rootStart = (reserved + nfat * spf) * bps;
  const dataStart = rootStart + ndir * 32;
  const clusterBytes = spc * bps;
  const next = (c) => {
    const o = fatStart + ((c * 3) >> 1);
    const v = d[o] | (d[o + 1] << 8);
    return c & 1 ? v >> 4 : v & 0xfff;
  };
  const files = new Map();
  for (let i = 0; i < ndir; i++) {
    const e = rootStart + i * 32;
    if (d[e] === 0) break;
    if (d[e] === 0xe5 || d[e + 11] & 0x18) continue;
    const txt = (a, n) => String.fromCharCode(...d.subarray(a, a + n)).trim();
    const ext = txt(e + 8, 3);
    const name = (txt(e, 8) + (ext ? '.' + ext : '')).toUpperCase();
    let c = u16(e + 26);
    const size = d[e + 28] | (d[e + 29] << 8) | (d[e + 30] << 16) | (d[e + 31] << 24);
    const out = new Uint8Array(size);
    let pos = 0;
    let guard = 0;
    while (c >= 2 && c < 0xff0 && pos < size && guard++ < 4096) {
      const o = dataStart + (c - 2) * clusterBytes;
      const n = Math.min(clusterBytes, size - pos);
      out.set(d.subarray(o, o + n), pos);
      pos += n;
      c = next(c);
    }
    files.set(name, out);
  }
  return files;
}

// Accept either a .st image or loose files; all LFL data is XOR 0xFF encoded.
export function decodeLfl(bytes) {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ 0xff;
  return out;
}
