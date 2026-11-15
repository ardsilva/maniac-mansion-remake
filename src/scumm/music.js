// Sequencer for SCUMM v2 sound resources (4 channels: 3 tone + 1 noise).
// Pure logic, no audio: call tick() 236 times per second and read `channels`.
//
// The note/parameter stream format is decoded exactly. Envelope ("hull") and vibrato
// ("freqmod") curves are approximations of the original tables.
export const TICK_HZ = 236;
const NOTE_FREQ = [65472, 61760, 58304, 55040, 52032, 49024, 46272, 43648, 41216, 38912, 36736, 34624];
const NOTE_LEN = [0, 2, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 3, 9, 18, 36, 72, 144, 1, 5, 10, 20, 40, 80, 160, 0, 0, 0, 0, 0, 0];
const CH_SIZE = 50; // bytes per channel record in the original engine (used by "clear other channel")
// parameter slots (index = opcode / 2)
const P = {
  TIME_LEFT: 0, NEXT_CMD: 1, BASE_FREQ: 2, FREQ_DELTA: 3, FREQ: 4, VOLUME: 5, VOLUME_DELTA: 6, TEMPO: 7,
  PAUSE: 8, TRANSPOSE: 9, NOTE_LENGTH: 10, HULL: 11, HULL_OFFSET: 12, HULL_COUNTER: 13,
  FM_TABLE: 14, FM_OFFSET: 15, FM_INCR: 16, FM_MULT: 17, FM_MODULO: 18,
};
// release time in ticks per hull-curve id (approximation: short = staccato)
const HULL_RELEASE = [2, 2, 14, 1, 3, 6, 30, 30, 20, 20, 10, 10, 10, 10, 10, 10];

function newChannel() {
  return { p: new Int32Array(25), gate: 0, level: 0, release: 6, noise: false };
}

export class MusicPlayer {
  constructor() {
    this.channels = [newChannel(), newChannel(), newChannel(), newChannel()];
    this.channels[3].noise = true;
    this.data = null;
    this.current = 0;
    this.priority = 0;
    this.musicTimer = 0;
    this.timerCtr = 0;
    this.ticksPerTimer = 65;
    this.retaddr = 0;
    this.trace = null;
  }

  // data: sound resource bytes (including the 4-byte header)
  start(nr, data) {
    if (!data || data.length < 22) return false;
    const prio = data[4];
    if (this.current && prio < this.priority && this.isPlaying()) return false;
    this.data = data;
    this.current = nr;
    this.priority = prio;
    this.musicTimer = 0;
    this.timerCtr = 0;
    this.ticksPerTimer = 65;
    for (let i = 0; i < 4; i++) {
      const c = this.channels[i];
      c.p.fill(0);
      c.gate = 0; c.level = 0;
      const off = data[14 + i * 2] | (data[15 + i * 2] << 8);
      c.p[P.NEXT_CMD] = off;
      if (off) c.p[P.TIME_LEFT] = 1;
    }
    return true;
  }
  stop(nr) {
    if (nr !== undefined && nr !== this.current) return;
    this.current = 0;
    this.data = null;
    for (const c of this.channels) { c.p.fill(0); c.gate = 0; }
  }
  isPlaying(nr) {
    if (!this.current || (nr !== undefined && nr !== this.current)) return false;
    return this.channels.some((c) => c.p[P.NEXT_CMD] !== 0 || c.p[P.TIME_LEFT] > 0 || c.gate > 0);
  }

  clearChannel(c) {
    const keepTempo = c.p[P.TEMPO];
    c.p.fill(0);
    c.p[P.TEMPO] = keepTempo;
    c.gate = 0;
  }

  exec(ci) {
    const d = this.data;
    let channel = this.channels[ci];
    if (!d || channel.p[P.NEXT_CMD] === 0) { this.checkStopped(); return; }
    let ptr = channel.p[P.NEXT_CMD];
    const u16 = () => { const v = d[ptr] | (d[ptr + 1] << 8); ptr += 2; return v; };
    let guard = 0;
    outer: for (;;) {
      if (++guard > 4000 || ptr >= d.length) { channel.p[P.NEXT_CMD] = 0; break; }
      let opcode = d[ptr++];
      if (opcode >= 0xf8) {
        switch (opcode) {
          case 0xf8: channel.p[P.HULL] = d[ptr++] >> 1; break;
          case 0xf9: channel.p[P.FM_TABLE] = d[ptr++] >> 2; channel.p[P.FM_MODULO] = 0x1000; break;
          case 0xfd: { const idx = Math.floor(u16() / CH_SIZE) & 3; this.clearChannel(this.channels[idx]); break; }
          case 0xfa: this.clearChannel(channel); break;
          case 0xfb: ptr = this.retaddr; break;
          case 0xfc: { const off = u16(); this.retaddr = ptr; ptr = off; break; }
          case 0xfe: {
            const slot = d[ptr++] >> 1;
            const off = (u16() << 16) >> 16;
            if (!channel.p[slot] || --channel.p[slot]) ptr += off;
            break;
          }
          case 0xff: {
            const op = d[ptr++];
            const value = u16();
            if ((op >> 1) < 25) channel.p[op >> 1] = value;
            if (op === 14) this.ticksPerTimer = 125;
            if (op === 0) break outer;
            break;
          }
        }
        continue;
      }
      // note(s): one per destination channel, chained until "last note"
      for (;;) {
        const dest = this.channels[(opcode >> 5) & 3];
        let note, last;
        if (!(opcode & 0x80)) {
          const tempo = channel.p[P.TEMPO] || 1;
          channel.p[P.TIME_LEFT] = tempo * NOTE_LEN[opcode & 0x1f];
          note = d[ptr++];
          last = note & 0x80;
          note &= 0x7f;
          if (note === 0x7f) break outer;
        } else {
          channel.p[P.TIME_LEFT] = ((opcode & 7) << 8) | d[ptr++];
          if (opcode & 0x10) break outer;
          last = 0;
          note = d[ptr++] & 0x7f;
        }
        if (this.trace) this.trace.push({ ch: this.channels.indexOf(dest), note, len: channel.p[P.TIME_LEFT] });
        if (note === 0) {
          dest.gate = 0;
        } else {
          let n = note - 1 + ((dest.p[P.TRANSPOSE] << 16) >> 16);
          while (n < 0) n += 12;
          const octave = Math.floor(n / 12);
          n %= 12;
          const f = dest.noise ? Math.max(32, 384 - 64 * octave) << 6 : NOTE_FREQ[n] >> octave;
          dest.p[P.BASE_FREQ] = dest.p[P.FREQ] = f;
          dest.p[P.FREQ_DELTA] = 0;
          dest.p[P.NOTE_LENGTH] = Math.max(1, channel.p[P.TIME_LEFT] - dest.p[P.PAUSE]);
          dest.gate = 1;
          dest.level = 1;
          dest.release = HULL_RELEASE[dest.p[P.HULL] & 15];
        }
        if (last) break outer;
        opcode = d[ptr++];
        if (opcode >= 0xf8) { ptr--; continue outer; }
      }
    }
    channel = this.channels[ci];
    if (channel.p[P.NEXT_CMD] !== 0 || ptr < (d ? d.length : 0)) channel.p[P.NEXT_CMD] = channel.p[P.NEXT_CMD] === 0 && guard > 4000 ? 0 : ptr;
    this.checkStopped();
  }
  checkStopped() {
    if (!this.current) return;
    if (this.channels.every((c) => c.p[P.NEXT_CMD] === 0 || c.p[P.TIME_LEFT] <= 0 && c.p[P.NEXT_CMD] >= this.data.length)) {
      if (this.channels.every((c) => c.p[P.TIME_LEFT] <= 0)) { this.current = 0; }
    }
  }

  tick() {
    if (!this.current) return;
    for (let i = 0; i < 4; i++) {
      const c = this.channels[i];
      // parameter-driven motion (sound effects)
      c.p[P.VOLUME] = (c.p[P.VOLUME] + c.p[P.VOLUME_DELTA]) & 0xffff;
      c.p[P.BASE_FREQ] = (c.p[P.BASE_FREQ] + ((c.p[P.FREQ_DELTA] << 16) >> 16)) & 0xffff;
      if (c.p[P.FM_INCR]) {
        c.p[P.FM_OFFSET] = (c.p[P.FM_OFFSET] + c.p[P.FM_INCR]) & 0xffff;
        const mod = c.p[P.FM_MODULO] || 0x1000;
        const phase = (c.p[P.FM_OFFSET] % mod) / mod;
        const shape = [Math.sin(phase * 2 * Math.PI), phase * 2 - 1, phase < 0.5 ? 1 : -1, Math.sin(phase * 2 * Math.PI)][c.p[P.FM_TABLE] & 3];
        c.p[P.FREQ] = Math.max(0, c.p[P.BASE_FREQ] + Math.round((shape * 128 * c.p[P.FM_MULT]) / 256));
      } else c.p[P.FREQ] = c.p[P.BASE_FREQ];
      if (c.p[P.NOTE_LENGTH] > 0 && --c.p[P.NOTE_LENGTH] === 0) c.gate = 0;
      if (!c.gate && c.level > 0) c.level = Math.max(0, c.level - 1 / c.release);
      if (c.p[P.TIME_LEFT] > 0 && --c.p[P.TIME_LEFT] === 0) this.exec(i);
    }
    if (this.timerCtr++ >= this.ticksPerTimer) { this.timerCtr = 0; this.musicTimer++; }
    if (this.channels.every((c) => c.p[P.NEXT_CMD] === 0 || c.p[P.TIME_LEFT] === 0) && this.channels.every((c) => c.p[P.TIME_LEFT] === 0)) this.current = 0;
  }

  // Frequency in Hz for a channel (0 = silent)
  hz(i) {
    const f = this.channels[i].p[P.FREQ] >> 6;
    return f > 0 ? 111860.78 / f : 0;
  }
}
