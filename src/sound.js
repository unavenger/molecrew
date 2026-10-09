// sound.js — every sound in the game, made in code with the browser's built-in synthesizer
// (the Web Audio API). No sound files needed.
//
// Flow:
//   new Sound()                    → nothing plays yet: browsers only allow audio after a click
//   first click / key              → unlock(): creates the AudioContext, starts the ambience
//   main.js each frame             → sound.setListener(focus, zoom); sound.handleEvents(sim.events)
//   handleEvents()                 → EVENT_SOUNDS maps each sim event to play(name, x, y)
//   render.js / input.js           → play('pick', …), play('markOn') for things the sim doesn't report
//   play(name, x, y)               → voice limits → distance volume + stereo pan → SOUNDS[name](…)
//   M key                          → toggleMute()
//
// Swapping in real recordings later: put a file path in SOUND_FILES under the same name
// (e.g. pick: 'assets/sounds/pick.ogg'). play() then uses the file instead of the generator.
//
// Web Audio in one paragraph: an AudioContext is a little sound studio. You create "nodes"
// (an oscillator that makes a tone, a gain that sets volume, a filter that removes high or low
// sounds) and connect them in a chain that ends at the speakers. Each node's settings can be
// scheduled over time, e.g. "volume falls to zero over 0.2 s", which is how every sound below
// gets its shape.

import { T } from './world.js';

// Optional recorded replacements, name → file path. Empty for now. DECISION (Claude)
export const SOUND_FILES = {};

// DECISION (Claude): limits so twelve digging moles don't become noise.
// gap = minimum seconds between two plays of the same sound, voices = max playing at once.
const LIMITS = {
  pick: { gap: 0.06, voices: 4 },
  crumble: { gap: 0.08, voices: 3 },
  pave: { gap: 0.15, voices: 2 },
  wall: { gap: 0.12, voices: 2 },
  squeak: { gap: 0.2, voices: 3 },
  default: { gap: 0.03, voices: 6 },
};
const MAX_VOICES = 14; // all sounds together

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try {
      this.muted = localStorage.getItem('molecrew-muted') === '1'; // remembered per browser
    } catch (e) {
      /* storage blocked: start unmuted */
    }
    this.listener = { x: 0, y: 0, zoom: 15 };
    this.lastPlay = {}; // name → time
    this.voices = {}; // name → playing count
    this.total = 0;
    this.buffers = {}; // name → decoded AudioBuffer (from SOUND_FILES)
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock); // the browser's "any mouse/touch press" event
    window.addEventListener('keydown', unlock);
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    // Master chain: everything → master gain → compressor (evens out loud moments) → speakers.
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp);
    comp.connect(this.ctx.destination); // destination = the speakers
    this.noiseBuf = makeNoise(this.ctx);
    this.loadFiles();
    this.startAmbience();
  }

  async loadFiles() {
    for (const [name, url] of Object.entries(SOUND_FILES)) {
      try {
        const data = await (await fetch(url)).arrayBuffer();
        this.buffers[name] = await this.ctx.decodeAudioData(data); // turns file bytes into playable audio
      } catch (e) {
        console.warn(`[Mole Crew] sound file for "${name}" failed to load, using the generated one`);
      }
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem('molecrew-muted', this.muted ? '1' : '0');
    } catch (e) {
      /* ignore */
    }
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  // Lower the game sounds while the narrator talks (draft 7). DECISION (Claude): to 40%.
  duck(on) {
    if (!this.master || this.muted) return;
    this.master.gain.setTargetAtTime(on ? 0.28 : 0.7, this.ctx.currentTime, 0.15);
  }

  setListener(focus, zoom) {
    this.listener.x = focus.x;
    this.listener.y = focus.y;
    this.listener.zoom = zoom;
  }

  // Play a sound at map position (x, y) in tiles; leave x undefined for "everywhere" (UI sounds).
  play(name, x, y, opts = {}) {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const lim = LIMITS[name] || LIMITS.default;
    const now = ctx.currentTime;
    if (now - (this.lastPlay[name] || -1) < lim.gap) return;
    if ((this.voices[name] || 0) >= lim.voices || this.total >= MAX_VOICES) return;

    // Quieter with distance from the camera's centre; panned left/right. DECISION (Claude)
    let vol = opts.volume ?? 1;
    let pan = 0;
    if (x !== undefined) {
      const dx = x - this.listener.x;
      const dy = y - this.listener.y;
      const reach = this.listener.zoom * 0.7;
      vol *= 1 / (1 + (Math.hypot(dx, dy) / reach) ** 2);
      pan = Math.max(-0.8, Math.min(0.8, dx / 10));
    }
    if (vol < 0.04) return;

    this.lastPlay[name] = now;
    this.voices[name] = (this.voices[name] || 0) + 1;
    this.total++;
    const out = ctx.createGain();
    out.gain.value = vol;
    const panner = ctx.createStereoPanner(); // moves the sound between left and right speaker
    panner.pan.value = pan;
    out.connect(panner);
    panner.connect(this.master);

    let dur;
    if (this.buffers[name]) {
      const src = ctx.createBufferSource();
      src.buffer = this.buffers[name];
      src.playbackRate.value = 0.92 + Math.random() * 0.16;
      src.connect(out);
      src.start(now);
      dur = src.buffer.duration;
    } else {
      dur = (SOUNDS[name] || SOUNDS.blip)(ctx, out, now, this.noiseBuf, opts);
    }
    setTimeout(() => {
      // setTimeout runs a function once after a delay (ms): here, free the voice and the nodes.
      this.voices[name]--;
      this.total--;
      panner.disconnect();
    }, (dur + 0.1) * 1000);
  }

  handleEvents(events, sim) {
    const w = sim.world;
    for (const e of events) {
      const fn = EVENT_SOUNDS[e.kind];
      if (fn) fn(this, e, sim, w);
    }
  }

  // Quiet cave atmosphere: a soft low hum, random water drips, and a portal hum near the portal.
  startAmbience() {
    const ctx = this.ctx;
    const hum = ctx.createGain();
    hum.gain.value = 0.025; // DECISION (Claude): barely there
    hum.connect(this.master);
    for (const f of [55, 55.7, 82.4]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(hum);
      o.start();
    }
    const drip = () => {
      if (!this.muted) {
        const x = this.listener.x + (Math.random() - 0.5) * 16;
        const y = this.listener.y + (Math.random() - 0.5) * 12;
        this.play('drip', x, y, { volume: 0.5 });
      }
      setTimeout(drip, 2000 + Math.random() * 5000);
    };
    setTimeout(drip, 1500);
  }

  // Called each frame by main.js: portal hum volume follows distance to the portal.
  updatePortalHum(portal) {
    if (!this.ctx) return;
    if (!portal.awake) {
      // A fresh cave (N key) starts with a sealed portal: silence the old hum.
      if (this.portalHum) this.portalHum.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
      return;
    }
    if (!this.portalHum) {
      const ctx = this.ctx;
      this.portalHum = ctx.createGain();
      this.portalHum.gain.value = 0;
      this.portalHum.connect(this.master);
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 110;
      const lfo = ctx.createOscillator(); // a slow wobble that bends the pitch
      lfo.frequency.value = 0.4;
      const depth = ctx.createGain();
      depth.gain.value = 6;
      lfo.connect(depth);
      depth.connect(o.frequency);
      o.connect(this.portalHum);
      o.start();
      lfo.start();
    }
    const d = Math.hypot(portal.x + 0.5 - this.listener.x, portal.y + 0.5 - this.listener.y);
    const v = 0.06 / (1 + (d / 6) ** 2);
    this.portalHum.gain.setTargetAtTime(v, this.ctx.currentTime, 0.3);
  }
}

// ---------------------------------------------------------------------------
// Which sim event plays which sound.
// ---------------------------------------------------------------------------
const tileXY = (w, i) => [w.xOf(i) + 0.5, w.yOf(i) + 0.5];
const visitorAt = (sim, id) => sim.visitors.find((v) => v.id === id);

const EVENT_SOUNDS = {
  dug: (s, e, sim, w) => {
    const [x, y] = tileXY(w, e.i);
    s.play('crumble', x, y);
    if (e.treasure >= 0) s.play('found', x, y);
    else if (e.type === T.ORE) s.play('ore', x, y);
  },
  deliver: (s, e, sim) => s.play('deliver', sim.burrow.x + 0.5, sim.burrow.y + 0.5, { volume: 0.6 }),
  spawn: (s, e, sim) => s.play('newMole', sim.burrow.x + 0.5, sim.burrow.y + 0.5),
  slap: (s, e, sim) => {
    const m = sim.moles.find((q) => q.id === e.id);
    if (m) s.play('slap', m.x, m.y);
  },
  wall: (s, e, sim, w) => s.play('wall', ...tileXY(w, e.i), { volume: 0.6 }),
  claim: (s, e, sim, w) => s.play('pave', ...tileXY(w, e.i), { volume: 0.4 }),
  room: (s, e, sim) => {
    const r = sim.rooms[e.id];
    if (r) s.play('room', r.cx, r.cy);
  },
  lever: (s, e, sim) => {
    const r = sim.rooms[e.id];
    if (r) s.play('lever', r.cx, r.cy);
  },
  portal: (s, e, sim) => s.play('portalOpen', sim.portal.x + 0.5, sim.portal.y + 0.5, { volume: 1.2 }),
  arrive: (s, e, sim) => s.play('portalBlip', sim.portal.x + 0.5, sim.portal.y + 0.5),
  leave: (s, e, sim) => s.play('portalBlip', sim.portal.x + 0.5, sim.portal.y + 0.5, { down: true }),
  slapVisitor: (s, e, sim) => {
    const v = visitorAt(sim, e.id);
    if (v) s.play('squeak', v.x, v.y, { kind: v.kind, stage: v.stage });
  },
  greet: (s, e) => s.play('greet', e.x, e.y),
  chase: (s, e, sim) => {
    const v = visitorAt(sim, e.b);
    if (v) s.play('squeak', v.x, v.y, { kind: v.kind, stage: v.stage });
  },
  group: (s, e, sim) => {
    const r = sim.rooms[e.room];
    if (r) s.play('group', r.cx, r.cy, { kind: e.creature, count: e.ids.length });
  },
  grow: (s, e, sim) => {
    const v = visitorAt(sim, e.id);
    if (v) s.play('grow', v.x, v.y, { final: e.stage === 2 });
  },
  treasure: (s, e, sim) => s.play('fanfare', sim.burrow.x + 0.5, sim.burrow.y + 0.5),
  slapTreasure: (s, e, sim) => {
    const p = sim.treasureSlots[e.treasure];
    s.play('twirl', p.x + 0.5, p.y + 0.5);
  },
};

// ---------------------------------------------------------------------------
// The generators. Each builds its sound starting at time t, into `out`, and returns its length (s).
// DECISION (Claude): every sound below is Claude's invention — toy-like, short, never harsh.
// ---------------------------------------------------------------------------
function makeNoise(ctx) {
  // One second of random values = white noise, the raw material for crunches and whooshes.
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

const rnd = (a, b) => a + Math.random() * (b - a);

// A tone: oscillator → volume envelope. f1 = end pitch (a slide), type = wave shape.
function tone(ctx, out, t, { f, f1 = f, dur = 0.15, type = 'sine', vol = 0.3, attack = 0.005 }) {
  const o = ctx.createOscillator();
  o.type = type; // 'sine' soft, 'triangle' a bit brighter, 'square' buzzy, 'sawtooth' raspy
  o.frequency.setValueAtTime(f, t);
  if (f1 !== f) o.frequency.exponentialRampToValueAtTime(f1, t + dur); // smooth pitch slide
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack); // quick fade in (avoids clicks)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur); // fade out
  o.connect(g);
  g.connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
  return dur;
}

// A burst of filtered noise. filter = 'lowpass' (dull, crumbly) / 'highpass' (hiss) / 'bandpass'.
function noise(ctx, out, t, buf, { dur = 0.2, vol = 0.3, filter = 'lowpass', freq = 800, freq1 = freq, q = 1 }) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const fl = ctx.createBiquadFilter(); // a filter that keeps only part of the sound's range
  fl.type = filter;
  fl.frequency.setValueAtTime(freq, t);
  if (freq1 !== freq) fl.frequency.exponentialRampToValueAtTime(freq1, t + dur);
  fl.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(fl);
  fl.connect(g);
  g.connect(out);
  src.start(t, Math.random() * 0.5); // start somewhere random in the noise so repeats differ
  src.stop(t + dur + 0.02);
  return dur;
}

// A run of notes (semitones above a base pitch), for chimes and fanfares.
function notes(ctx, out, t, base, steps, { gap = 0.08, dur = 0.18, type = 'triangle', vol = 0.18 } = {}) {
  steps.forEach((st, k) => tone(ctx, out, t + k * gap, { f: base * 2 ** (st / 12), dur, type, vol }));
  return gap * steps.length + dur;
}

// Per-kind creature voices. DECISION (Claude)
function creature(ctx, out, t, buf, kind, stage = 1) {
  const p = [1.35, 1, 0.85][stage] || 1; // babies squeak higher, final forms a bit lower
  switch (kind) {
    case 'frog':
      for (let k = 0; k < 2; k++) tone(ctx, out, t + k * 0.12, { f: 150 * p, f1: 110 * p, dur: 0.1, type: 'sawtooth', vol: 0.12 });
      return 0.25;
    case 'owl':
      tone(ctx, out, t, { f: 440 * p, f1: 400 * p, dur: 0.22, vol: 0.2, attack: 0.04 });
      tone(ctx, out, t + 0.3, { f: 400 * p, f1: 360 * p, dur: 0.3, vol: 0.2, attack: 0.04 });
      return 0.62;
    case 'bat':
      return tone(ctx, out, t, { f: 2600 * p, f1: 1800 * p, dur: 0.07, vol: 0.12 });
    case 'hedgehog':
      noise(ctx, out, t, buf, { dur: 0.05, vol: 0.45, filter: 'bandpass', freq: 2500, q: 3 });
      noise(ctx, out, t + 0.09, buf, { dur: 0.05, vol: 0.45, filter: 'bandpass', freq: 2800, q: 3 });
      return 0.15;
    case 'beetle':
      for (let k = 0; k < 3; k++) tone(ctx, out, t + k * 0.05, { f: 3000 * p, dur: 0.02, type: 'square', vol: 0.06 });
      return 0.18;
    case 'foxcub':
      return tone(ctx, out, t, { f: 700 * p, f1: 1150 * p, dur: 0.12, type: 'triangle', vol: 0.18 });
    case 'snail':
    default:
      return tone(ctx, out, t, { f: 1300 * p, f1: 1500 * p, dur: 0.1, vol: 0.12 });
  }
}

const SOUNDS = {
  blip: (c, o, t) => tone(c, o, t, { f: 880, dur: 0.08, vol: 0.1 }),

  // Digging
  pick: (c, o, t, b) => {
    const f = rnd(1900, 2500);
    tone(c, o, t, { f, f1: f * 0.8, dur: 0.05, type: 'triangle', vol: 0.12 });
    noise(c, o, t, b, { dur: 0.03, vol: 0.12, filter: 'highpass', freq: 3000 });
    return 0.06;
  },
  crumble: (c, o, t, b) => {
    noise(c, o, t, b, { dur: rnd(0.25, 0.35), vol: 0.45, filter: 'lowpass', freq: 900, freq1: 200 });
    tone(c, o, t, { f: rnd(110, 140), f1: 55, dur: 0.12, vol: 0.35 });
    return 0.35;
  },
  ore: (c, o, t) => notes(c, o, t + 0.05, 1320, [0, 7], { gap: 0.06, dur: 0.15, type: 'sine', vol: 0.1 }),
  found: (c, o, t) => notes(c, o, t + 0.05, 880, [0, 4, 7, 12], { gap: 0.07, dur: 0.2, vol: 0.14 }),
  wall: (c, o, t, b) => {
    tone(c, o, t, { f: rnd(480, 560), dur: 0.06, type: 'triangle', vol: 0.12 });
    noise(c, o, t, b, { dur: 0.05, vol: 0.08, filter: 'bandpass', freq: 1500 });
    return 0.08;
  },
  pave: (c, o, t, b) => {
    tone(c, o, t, { f: rnd(260, 320), dur: 0.06, vol: 0.12 });
    noise(c, o, t, b, { dur: 0.04, vol: 0.08, filter: 'bandpass', freq: 900 });
    return 0.07;
  },

  // Burrow
  deliver: (c, o, t) => notes(c, o, t, 1046, [0, 7], { gap: 0.05, dur: 0.12, type: 'sine', vol: 0.12 }),
  newMole: (c, o, t) => {
    tone(c, o, t, { f: 300, f1: 900, dur: 0.12, vol: 0.25 });
    notes(c, o, t + 0.12, 784, [0, 4, 7], { gap: 0.07, dur: 0.15, vol: 0.12 });
    return 0.4;
  },

  // The hand
  slap: (c, o, t, b) => {
    noise(c, o, t, b, { dur: 0.04, vol: 0.4, filter: 'bandpass', freq: 1800, q: 0.8 });
    tone(c, o, t + 0.02, { f: 220, f1: 560, dur: 0.12, vol: 0.25 });
    tone(c, o, t + 0.14, { f: 560, f1: 260, dur: 0.18, vol: 0.18 });
    return 0.34;
  },
  markOn: (c, o, t) => tone(c, o, t, { f: 1500, dur: 0.05, vol: 0.06 }),
  markOff: (c, o, t) => tone(c, o, t, { f: 700, dur: 0.06, vol: 0.06 }),

  // Rooms
  room: (c, o, t) => notes(c, o, t, 523, [0, 4, 7, 11], { gap: 0.09, dur: 0.25, type: 'sine', vol: 0.1 }),
  lever: (c, o, t, b) => {
    tone(c, o, t, { f: 90, f1: 60, dur: 0.1, type: 'square', vol: 0.12 });
    noise(c, o, t, b, { dur: 0.08, vol: 0.3, filter: 'lowpass', freq: 400 });
    noise(c, o, t + 0.1, b, { dur: 0.45, vol: 0.18, filter: 'bandpass', freq: 400, freq1: 2400, q: 2 });
    return 0.6;
  },

  // Portal and visitors
  portalOpen: (c, o, t, b) => {
    noise(c, o, t, b, { dur: 1.2, vol: 0.3, filter: 'bandpass', freq: 200, freq1: 1600, q: 3 });
    tone(c, o, t, { f: 55, f1: 110, dur: 1.2, vol: 0.3, attack: 0.2 });
    notes(c, o, t + 0.5, 660, [0, 3, 7, 10, 12, 15], { gap: 0.08, dur: 0.3, type: 'sine', vol: 0.1 });
    return 1.4;
  },
  portalBlip: (c, o, t, b, opts) => {
    const up = !opts.down;
    tone(c, o, t, { f: up ? 500 : 1400, f1: up ? 1400 : 500, dur: 0.25, vol: 0.1 });
    return 0.25;
  },
  squeak: (c, o, t, b, opts) => creature(c, o, t, b, opts.kind, opts.stage),
  greet: (c, o, t) => notes(c, o, t, 1046, [0, 4], { gap: 0.1, dur: 0.18, type: 'sine', vol: 0.12 }),
  group: (c, o, t, b, opts) => {
    // Several voices of the same kind, slightly out of step: a little chorus.
    const n = Math.min(4, opts.count || 2);
    let len = 0;
    for (let k = 0; k < n; k++) len = Math.max(len, k * 0.15 + creature(c, o, t + k * 0.15 + rnd(0, 0.05), b, opts.kind, 1));
    return len;
  },
  grow: (c, o, t, b, opts) =>
    opts.final
      ? notes(c, o, t, 523, [0, 4, 7, 12, 16, 19, 24], { gap: 0.07, dur: 0.25, vol: 0.13 })
      : notes(c, o, t, 659, [0, 4, 7, 12], { gap: 0.07, dur: 0.18, vol: 0.12 }),

  // Treasure
  fanfare: (c, o, t) => {
    notes(c, o, t, 523, [0, 4, 7], { gap: 0.1, dur: 0.15, type: 'square', vol: 0.06 });
    tone(c, o, t + 0.3, { f: 1046, dur: 0.5, type: 'triangle', vol: 0.15 });
    tone(c, o, t + 0.3, { f: 1318, dur: 0.5, type: 'triangle', vol: 0.1 });
    return 0.8;
  },
  twirl: (c, o, t) => tone(c, o, t, { f: 600, f1: 2400, dur: 0.35, vol: 0.1 }),

  // Ambience
  drip: (c, o, t) => {
    const f = rnd(1400, 2200);
    tone(c, o, t, { f, f1: f * 0.45, dur: 0.12, vol: 0.12 });
    return 0.12;
  },
};

// For tests: the list of generator names, and a way to render one offline.
export const SOUND_NAMES = Object.keys(SOUNDS);
export function renderOffline(ctx, name, opts = {}) {
  const buf = makeNoise(ctx);
  return SOUNDS[name](ctx, ctx.destination, 0, buf, opts);
}

// For the sound preview tool only.
export const __debugSounds = SOUNDS;
