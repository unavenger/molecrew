// main.js — starts the game and runs the frame loop.
//
// Flow:
//   startGame(seed) → new World(seed) → new Sim(world) → new Renderer(...) → new Input(...)
//   loop(): each animation frame
//     input.update(dt)        camera keys + hover
//     sim.update(step) × n    game rules, in small fixed-size steps
//     renderer.frame(dt)      draw
//   Keys: N = new cave, F3 = debug numbers (for Felix, not for play), H = hide/show help,
//         M = sound on/off, C = captions on/off.

import { World } from './world.js';
import { Sim } from './sim.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { CONFIG } from './config.js';
import { Sound } from './sound.js';
import { Narrator, BrowserVoice, Caption } from './narration.js';
import * as THREE from 'three';

const canvas = document.getElementById('view');
const hand = document.getElementById('hand');
const debug = document.getElementById('debug');
const help = document.getElementById('help');

// WebGLRenderer draws 3D scenes onto the <canvas> using the graphics card.
// Made once and reused, because browsers limit how many 3D contexts a page may open.
const three = new THREE.WebGLRenderer({ canvas, antialias: true });
three.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // sharp on high-DPI screens, capped for speed

// Draft 6: one sound system for the whole page (audio starts on the first click or key press).
const sound = new Sound();
const muteBadge = document.getElementById('mute');
muteBadge.hidden = !sound.muted;
// Draft 7: the narrator, with captions at the bottom of the screen.
const caption = new Caption(document.getElementById('caption'));
const narrator = new Narrator(new BrowserVoice(sound), caption);

let game = null;

function startGame(seed) {
  const world = new World(seed);
  const sim = new Sim(world);
  const renderer = new Renderer(three, world, sim);
  renderer.sound = sound; // pickaxe strikes are timed by the animation, so the renderer plays them
  const input = game ? game.input : null;
  game = { seed, world, sim, renderer, input };
  if (input) {
    input.r = renderer;
    input.sim = sim;
    input.world = world;
  } else {
    game.input = new Input(canvas, renderer, sim, world, hand);
  }
  game.input.sound = sound;
  narrator.reset();
  // Log the seed so a weird cave can be reproduced: open index.html?seed=<number>.
  console.log(`[Mole Crew] cave seed ${seed}`);
}

// URLSearchParams reads "?seed=123" style values from the page address.
const params = new URLSearchParams(location.search);
const urlSeed = Number(params.get('seed'));
startGame(urlSeed > 0 ? urlSeed : (Math.random() * 1e9) >>> 0);

window.addEventListener('resize', () => game.renderer.resize());
window.addEventListener('keydown', (e) => {
  if (e.key === 'n' || e.key === 'N') startGame((Math.random() * 1e9) >>> 0); // DECISION (Claude): dev key for a fresh cave
  if (e.key === 'F3') {
    e.preventDefault();
    debug.hidden = !debug.hidden;
  }
  if (e.key === 'h' || e.key === 'H') help.hidden = !help.hidden;
  if (e.key === 'm' || e.key === 'M') muteBadge.hidden = !sound.toggleMute();
  if (e.key === 'c' || e.key === 'C') caption.toggle();
});

// performance.now() = milliseconds since the page opened, with sub-millisecond precision.
let last = performance.now();
let fpsT = 0;
let fpsN = 0;
let fps = 0;
const STEP = 1 / 60; // DECISION (Claude): sim runs in fixed 1/60 s steps so it behaves the same on any screen

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); // clamp: a hidden tab shouldn't fast-forward the cave
  last = now;
  const { sim, renderer, input } = game;
  sim.focus.x = renderer.focus.x;
  sim.focus.y = renderer.focus.y;
  input.update(dt);
  let left = dt;
  while (left > 1e-6) {
    const s = Math.min(STEP, left);
    sim.update(s);
    left -= s;
  }
  // Sounds read this frame's events before the renderer uses them up.
  sound.setListener(renderer.focus, renderer.zoom);
  sound.handleEvents(sim.events, sim);
  narrator.handleEvents(sim.events, sim);
  narrator.update(dt, sim);
  sound.updatePortalHum(sim.portal);
  renderer.frame(dt);

  fpsT += dt;
  fpsN++;
  if (fpsT > 0.5) {
    fps = Math.round(fpsN / fpsT);
    fpsT = 0;
    fpsN = 0;
    if (!debug.hidden) {
      const b = sim.burrow;
      debug.textContent =
        `seed ${game.seed}\ncrew ${sim.moles.length}/${CONFIG.crewCap}\nore ${b.ore}/${b.cost}` +
        `\nmarks ${game.world.markedSet.size}\nrooms ${sim.rooms.length}\nvisitors ${sim.visitors.length}${sim.portal.awake ? '' : ' (portal sealed)'}\ntime ${Math.floor(sim.time)} s\n${fps} fps`;
    }
  }
  requestAnimationFrame(loop); // ask the browser to call loop() again before the next screen refresh
}
requestAnimationFrame(loop);

// Handy from the browser console while testing.
window.moleCrew = () => game;
