// narration.js — a friendly narrator who talks about the creatures, and nudges about their needs.
// DECISION (Felix): narration about the creatures, with extra nudging about what they need.
//
// Flow:
//   LINES                      every line the narrator can say, id → text (built from the tables below,
//                              so each line can be pre-recorded as assets/voice/<id>.wav later)
//   main.js each frame         → narrator.update(dt, sim) → narrator.handleEvents(sim.events, sim)
//   handleEvents()             → events become requests: arrive (first of a kind), grow, leave, group, …
//   update()                   → watches for visitors wanting a missing room for a while → 'want' nudge
//   request(id, prio)          → cooldowns + queue (highest priority first, stale lines dropped)
//   when the voice is free     → voice.say(id, text, onDone) and the caption shows the text
//
// The voice is swappable: BrowserVoice (below) plays assets/voice/<id>.wav if it was generated
// (tools/make_voices.py, Kokoro), otherwise the browser's own English text-to-speech.

import { VISITOR_KINDS, ROOM_INDEX } from './rooms.js';

// --------------------------------------------------------------- the lines
// DECISION (Claude): all wording below. DECISION (Felix): player-facing text says "tap", not "slap".
// (The code still calls the interaction slap, after Dungeon Keeper.) Short, warm sentences a five-year-old can follow.
const NAME = { hedgehog: 'hedgehog', frog: 'frog', snail: 'snail', beetle: 'beetle', bat: 'bat', owl: 'owl', foxcub: 'fox cub' };
const FINAL = {
  hedgehog: 'apple hedgehog',
  frog: 'frog king',
  snail: 'flower snail',
  beetle: 'golden beetle',
  bat: 'glowing bat',
  owl: 'wise owl',
  foxcub: 'fluffy fox',
};
const ROOM = {
  garden: 'a mushroom garden',
  pond: 'a pond',
  nap: 'a nap room',
  kitchen: 'a kitchen',
  grotto: 'a glowworm grotto',
  map: 'a map room',
};
const GROUP = {
  frog: 'The frogs are singing together!',
  bat: 'The bats are having a nap together.',
  owl: 'The owls are reading together.',
  hedgehog: 'The hedgehogs are having a picnic.',
  snail: 'The snails are having a very slow race.',
  beetle: 'The beetles are dancing.',
  foxcub: 'The fox cubs are playing together.',
};

export const LINES = {
  portal: 'You found a magic portal! Little visitors will come through it.',
  firstRoom: 'A new room! Tap the lever to change what kind of room it is.',
  firstTreasure: 'Treasure! The moles are carrying it home.',
  allTreasure: 'You found every single treasure!',
  chase: 'The fox cub is chasing a beetle. It is just a game!',
};
for (const [k, kind] of Object.entries(VISITOR_KINDS)) {
  const [a, b] = kind.needs;
  const n = NAME[k];
  LINES[`arrive_${k}`] = `A baby ${n} came through the portal! It needs ${ROOM[a]} and ${ROOM[b]}.`;
  LINES[`grown_${k}`] = `The ${n} has grown up!`;
  LINES[`final_${k}`] = `Wow! The ${n} became a ${FINAL[k]}!`;
  LINES[`bye_${k}`] = `The ${FINAL[k]} waves goodbye. Thank you for looking after it!`;
  LINES[`group_${k}`] = GROUP[k];
  for (const r of kind.needs) {
    LINES[`want_${k}_${r}`] = `The little ${n} wishes there was ${ROOM[r]}.`;
    LINES[`want2_${k}_${r}`] = `Can you make ${ROOM[r]} for the ${n}? Tap a lever!`;
    LINES[`missed_${k}_${r}`] = `The ${n} went home. It could not find ${ROOM[r]}.`;
  }
}

// --------------------------------------------------------------- the narrator
// DECISION (Claude): pacing rules, so the narrator nudges without chattering.
const MIN_GAP = 7; // seconds of quiet between lines
const LINE_COOLDOWN = 120; // the same line won't repeat within this many seconds
const WANT_AFTER = 15; // a visitor must want a missing room this long before the nudge
const WANT_COOLDOWN = 45; // per creature kind, between want nudges
const STALE = 12; // queued lines older than this are dropped (the moment has passed)
const QUEUE_MAX = 3;
const PRIO = { high: 3, normal: 2, low: 1 };

export class Narrator {
  // voice = { say(id, text, onDone), stop() }; caption = { show(text), hide() } (both optional)
  constructor(voice, caption) {
    this.voice = voice;
    this.caption = caption;
    this.reset();
  }

  // A fresh cave (N key) starts the narrator's memory over.
  reset() {
    this.clock = 0;
    this.busy = false;
    this.quietUntil = 0;
    this.queue = [];
    this.lastSaid = {}; // id → time
    this.kindCool = {}; // "want_<kind>" → time it may nudge again
    this.metKinds = new Set(); // creature kinds already introduced
    this.wantSince = new Map(); // visitor id → { type, since }
    this.flags = {};
    this.spoken = []; // log for tests: [{ id, t }]
    if (this.voice && this.voice.stop) this.voice.stop();
    if (this.caption) this.caption.hide();
  }

  request(id, prio = PRIO.normal) {
    if (!LINES[id]) return;
    if (this.clock - (this.lastSaid[id] ?? -1e9) < LINE_COOLDOWN) return;
    if (this.queue.some((q) => q.id === id)) return;
    this.queue.push({ id, prio, at: this.clock });
    this.queue.sort((a, b) => b.prio - a.prio || a.at - b.at); // highest priority, then oldest, first
    if (this.queue.length > QUEUE_MAX) this.queue.length = QUEUE_MAX;
  }

  handleEvents(events, sim) {
    for (const e of events) {
      switch (e.kind) {
        case 'portal':
          this.request('portal', PRIO.high);
          break;
        case 'room':
          if (!this.flags.firstRoom) {
            this.flags.firstRoom = true;
            this.request('firstRoom', PRIO.high);
          }
          break;
        case 'arrive':
          // DECISION (Claude): introduce each kind only the first time it comes, then stay quiet.
          if (!this.metKinds.has(e.creature)) {
            this.metKinds.add(e.creature);
            this.request(`arrive_${e.creature}`, PRIO.normal);
          }
          break;
        case 'grow':
          this.request(e.stage === 2 ? `final_${e.creature}` : `grown_${e.creature}`, e.stage === 2 ? PRIO.high : PRIO.normal);
          break;
        case 'leave':
          if (e.reason === 'unmet' && e.need) this.request(`missed_${e.creature}_${e.need}`, PRIO.normal);
          else if (e.reason === 'happy') this.request(`bye_${e.creature}`, PRIO.low);
          break;
        case 'group':
          this.request(`group_${e.creature}`, PRIO.low);
          break;
        case 'chase':
          this.request('chase', PRIO.low);
          break;
        case 'treasure': {
          const count = sim.trove.filter(Boolean).length;
          if (count === sim.trove.length) this.request('allTreasure', PRIO.high);
          else if (!this.flags.firstTreasure) {
            this.flags.firstTreasure = true;
            this.request('firstTreasure', PRIO.normal);
          }
          break;
        }
      }
    }
  }

  update(dt, sim) {
    this.clock += dt;

    // Need nudges: a visitor that has wanted a missing room type for a while.
    const alive = new Set();
    for (const v of sim.visitors) {
      alive.add(v.id);
      if (v.wants < 0 || v.state === 'leave') {
        this.wantSince.delete(v.id);
        continue;
      }
      const w = this.wantSince.get(v.id);
      if (!w || w.type !== v.wants) {
        this.wantSince.set(v.id, { type: v.wants, since: this.clock });
        continue;
      }
      const key = `want_${v.kind}`;
      if (this.clock - w.since >= WANT_AFTER && this.clock >= (this.kindCool[key] || 0)) {
        const room = VISITOR_KINDS[v.kind].needs.find((r) => ROOM_INDEX[r] === v.wants);
        if (room) {
          // Alternate between "wishes there was…" and "can you make…".
          const alt = (this.flags[key] = !this.flags[key]);
          this.request(`${alt ? 'want' : 'want2'}_${v.kind}_${room}`, PRIO.normal);
          this.kindCool[key] = this.clock + WANT_COOLDOWN;
        }
      }
    }
    for (const id of this.wantSince.keys()) if (!alive.has(id)) this.wantSince.delete(id);

    // Drop lines whose moment has passed, then speak the next one if the voice is free.
    this.queue = this.queue.filter((q) => this.clock - q.at <= STALE);
    if (this.busy || this.clock < this.quietUntil || !this.queue.length) return;
    const next = this.queue.shift();
    this.busy = true;
    this.lastSaid[next.id] = this.clock;
    this.spoken.push({ id: next.id, t: this.clock });
    if (this.caption) this.caption.show(LINES[next.id]);
    const done = () => {
      this.busy = false;
      this.quietUntil = this.clock + MIN_GAP;
      if (this.caption) this.caption.hide();
    };
    if (this.voice) this.voice.say(next.id, LINES[next.id], done);
    else done();
  }
}

// --------------------------------------------------------------- the browser voice
// Plays a pre-generated file if tools/make_voices.py made one, otherwise uses the browser's own
// text-to-speech (speechSynthesis). Ducks the game sounds while talking.
export class BrowserVoice {
  constructor(sound) {
    this.sound = sound;
    this.files = new Set();
    this.current = null;
    // manifest.json lists the line ids that have a recorded file (written by make_voices.py).
    fetch('assets/voice/manifest.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((ids) => (this.files = new Set(ids)))
      .catch(() => {}); // no recordings yet: fall back to browser speech
  }

  say(id, text, onDone) {
    let finished = false;
    const end = () => {
      if (finished) return;
      finished = true;
      this.sound.duck(false);
      onDone();
    };
    // Muted: no voice, but the caption still shows for a moment.
    if (this.sound.muted) {
      setTimeout(end, 1500 + text.length * 45);
      return;
    }
    this.sound.duck(true);
    setTimeout(end, 4000 + text.length * 120); // safety net in case the end event never comes

    if (this.files.has(id)) {
      // new Audio(url) loads a sound file; .play() starts it; 'ended' fires when it finishes.
      const a = new Audio(`assets/voice/${id}.wav`);
      this.current = a;
      a.addEventListener('ended', end);
      a.addEventListener('error', end);
      a.play().catch(end);
      return;
    }
    const synth = window.speechSynthesis; // the browser's built-in text-to-speech
    if (!synth) {
      setTimeout(end, 1500 + text.length * 45);
      return;
    }
    const u = new SpeechSynthesisUtterance(text); // one thing to say
    const voices = synth.getVoices(); // the voices installed on this computer
    // DECISION (Claude): prefer an English voice; quality depends on what the computer has installed.
    u.voice = voices.find((v) => v.lang === 'en-US') || voices.find((v) => v.lang.startsWith('en')) || null;
    u.lang = 'en-US';
    u.rate = 0.95;
    u.pitch = 1.05;
    u.onend = end;
    u.onerror = end;
    synth.speak(u);
  }

  stop() {
    if (this.current) this.current.pause();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }
}

// The caption strip at the bottom of the screen (reading practice, too). C toggles it.
export class Caption {
  constructor(el) {
    this.el = el;
    this.enabled = true; // DECISION (Claude): on by default
    try {
      this.enabled = localStorage.getItem('molecrew-captions') !== '0';
    } catch (e) {
      /* storage blocked */
    }
  }
  show(text) {
    this.el.textContent = text;
    this.el.classList.toggle('on', this.enabled); // the CSS fades it in when the class "on" is set
  }
  hide() {
    this.el.classList.remove('on');
  }
  toggle() {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem('molecrew-captions', this.enabled ? '1' : '0');
    } catch (e) {
      /* ignore */
    }
    if (!this.enabled) this.hide();
    return this.enabled;
  }
}
