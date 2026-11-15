// WebAudio output for the game's own sound resources (see scumm/music.js).
// Two sequencers run side by side so effects can play over music.
// A file at sounds/<id>.ogg|mp3|wav replaces the synthesized version of that sound.
import { MusicPlayer, TICK_HZ } from './scumm/music.js';

const LOOKAHEAD = 0.12; // seconds scheduled ahead
const LONG_SOUND = 2500; // resource size above which a sound is treated as music

class Voice {
  constructor(ctx, out, noise) {
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.noise = noise;
    if (noise) {
      const len = ctx.sampleRate;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
      this.src = ctx.createBufferSource();
      this.src.buffer = buf;
      this.src.loop = true;
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'bandpass';
      this.filter.Q.value = 0.8;
      this.src.connect(this.filter).connect(this.gain);
      this.src.start();
    } else {
      // square body with a triangle underneath: rounder than a raw chip square
      this.sq = ctx.createOscillator();
      this.sq.type = 'square';
      this.tri = ctx.createOscillator();
      this.tri.type = 'triangle';
      const sg = ctx.createGain(); sg.gain.value = 0.45;
      const tg = ctx.createGain(); tg.gain.value = 0.9;
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 3200;
      this.sq.connect(sg).connect(this.filter);
      this.tri.connect(tg).connect(this.filter);
      this.filter.connect(this.gain);
      this.sq.start();
      this.tri.start();
    }
    this.gain.connect(out);
    this.lastHz = 0;
    this.lastLevel = 0;
  }
  set(hz, level, t) {
    if (hz > 0 && hz !== this.lastHz) {
      const f = Math.min(12000, hz);
      if (this.noise) this.filter.frequency.setValueAtTime(Math.min(9000, Math.max(200, f * 3)), t);
      else { this.sq.frequency.setValueAtTime(f, t); this.tri.frequency.setValueAtTime(f, t); }
      this.lastHz = hz;
    }
    const target = hz > 0 ? level : 0;
    if (target !== this.lastLevel) {
      this.gain.gain.setTargetAtTime(target * (this.noise ? 0.5 : 0.22), t, 0.006);
      this.lastLevel = target;
    }
  }
}

class Deck {
  constructor() {
    this.player = new MusicPlayer();
    this.voices = null;
  }
  attach(ctx, out) {
    this.voices = [0, 1, 2, 3].map((i) => new Voice(ctx, out, i === 3));
  }
  tick(t) {
    const p = this.player;
    p.tick();
    if (!this.voices) return;
    for (let i = 0; i < 4; i++) {
      const c = p.channels[i];
      const sounding = p.current ? c.level : 0;
      this.voices[i].set(p.hz(i), sounding, t);
    }
  }
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.music = new Deck();
    this.sfx = new Deck();
    this.files = new Map(); // id -> AudioBuffer | null
    this.fileNodes = new Map();
    this.nextTick = performance.now() / 1000;
    setInterval(() => this.pump(), 25);
  }
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.6 : 0;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
      this.music.attach(this.ctx, this.master);
      this.sfx.attach(this.ctx, this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.6 : 0, this.ctx.currentTime, 0.02);
  }
  // Advances both sequencers in real time (also when audio is locked, so the game's
  // music-synchronised cutscenes keep their timing).
  pump() {
    const now = performance.now() / 1000;
    if (now - this.nextTick > 0.5) this.nextTick = now; // tab was asleep
    const running = this.ctx && this.ctx.state === 'running';
    const horizon = now + (running ? LOOKAHEAD : 0);
    while (this.nextTick < horizon) {
      const at = running ? this.ctx.currentTime + Math.max(0, this.nextTick - now) : 0;
      this.music.tick(at);
      this.sfx.tick(at);
      this.nextTick += 1 / TICK_HZ;
    }
  }
  async probe(id) {
    if (this.files.has(id) || !this.ctx) return;
    this.files.set(id, null);
    for (const ext of ['ogg', 'mp3', 'wav']) {
      try {
        const r = await fetch(`sounds/${id}.${ext}`);
        if (!r.ok) continue;
        this.files.set(id, await this.ctx.decodeAudioData(await r.arrayBuffer()));
        return;
      } catch { /* try next */ }
    }
  }
  play(id, data) {
    const buf = this.files.get(id);
    if (buf && this.ctx) {
      this.stop(id);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.master);
      src.start();
      src.onended = () => this.fileNodes.delete(id);
      this.fileNodes.set(id, src);
      return;
    }
    if (!this.files.has(id)) this.probe(id);
    if (!data) return;
    const deck = data.length >= LONG_SOUND ? this.music : this.sfx;
    deck.player.stop();
    deck.player.priority = 0;
    deck.player.start(id, data);
  }
  stop(id) {
    const n = this.fileNodes.get(id);
    if (n) { try { n.stop(); } catch { /* ended */ } this.fileNodes.delete(id); }
    this.music.player.stop(id);
    this.sfx.player.stop(id);
  }
  stopAll() {
    for (const id of [...this.fileNodes.keys()]) this.stop(id);
    this.music.player.stop();
    this.sfx.player.stop();
  }
  isRunning(id) {
    return this.fileNodes.has(id) || this.music.player.isPlaying(id) || this.sfx.player.isPlaying(id);
  }
  musicTimer() { return this.music.player.current ? this.music.player.musicTimer : this.sfx.player.musicTimer; }
}
