// world.js — the tile grid and the seeded cave generator.
// No drawing code lives here: the renderer only reads this data.
//
// Flow: new World(seed) → generate() fills the grid
//       → Sim reads and changes tiles (digOut, setMark, reinforce)
//       → every change bumps world.version so the renderer knows to redraw.

import { CONFIG } from './config.js';
import { mulberry32 } from './rng.js';

export const T = { BORDER: 0, FLOOR: 1, DIRT: 2, ORE: 3, HARD: 4 };

// Draft 4: treasures hidden in the rock, one of each per cave, displayed in a ring around the burrow.
// DECISION (Claude): 16 kinds — one per tile of the start room's outer ring, so every treasure has
// its own pedestal. Looks live in props.js (makeTreasure).
export const TREASURES = [
  'crown', 'goblet', 'teapot', 'boot', 'bone', 'egg', 'key', 'rocket',
  'pearl', 'duck', 'teddy', 'bell', 'star', 'horn', 'bottle', 'robot',
];
export const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export class World {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.W = CONFIG.mapW;
    this.H = CONFIG.mapH;
    const n = this.W * this.H;

    // Typed arrays (Uint8Array, Int32Array, Float32Array) are fixed-size arrays of
    // plain numbers. They are faster and smaller than normal arrays for big grids.
    this.type = new Uint8Array(n); // T.* per tile
    this.marked = new Uint8Array(n); // 1 = painted for digging
    this.wall = new Uint8Array(n); // 0 rough, 1 dressed stone, 2 decorated
    this.dig = new Float32Array(n); // dig progress 0..1
    this.reservedBy = new Int32Array(n).fill(-1); // mole id digging this tile, or -1
    this.wallReservedBy = new Int32Array(n).fill(-1); // mole id reinforcing this tile, or -1
    this.markedSet = new Set(); // quick list of marked tiles, so moles don't scan the whole map

    this.version = 0; // bumps on any shape/mark/wall change → renderer rebuilds
    this.markVersion = 0; // bumps when NEW marks are painted → busy-but-low-priority moles re-check
    this.shapeVersion = 0; // bumps only when a tile is dug out → rooms are re-checked
    this.reach = new Uint8Array(n); // 1 = floor the crew can walk to from the burrow
    this.claim = new Uint8Array(n); // 1 = floor the moles have paved (draft 3)
    this.treasure = new Int8Array(n).fill(-1); // treasure kind hidden in this tile, or -1 (draft 4)

    this.burrow = { x: Math.floor(this.W / 2), y: Math.floor(this.H / 2) };
    this.portal = null; // { x, y, i } — centre of the sealed portal chamber
    generate(this);
    this.computeReach();
  }

  // Flood out from the burrow over floor and remember every tile reached.
  // Needed since draft 2: the portal chamber is floor that isn't connected until a tunnel reaches it.
  computeReach() {
    const { W, H } = this;
    this.reach.fill(0);
    const start = this.idx(this.burrow.x, this.burrow.y);
    const queue = [start];
    this.reach[start] = 1;
    while (queue.length) {
      const c = queue.pop(); // .pop() takes the last item (order doesn't matter for a flood fill)
      const cx = c % W;
      const cy = (c / W) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (this.reach[ni] || this.type[ni] !== T.FLOOR) continue;
        this.reach[ni] = 1;
        queue.push(ni);
      }
    }
  }

  idx(x, y) {
    return y * this.W + x;
  }
  xOf(i) {
    return i % this.W;
  }
  yOf(i) {
    return (i / this.W) | 0; // "| 0" chops off the decimals (fast whole-number division).
  }
  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.W && y < this.H;
  }
  isFloor(i) {
    return this.type[i] === T.FLOOR;
  }
  isDiggable(i) {
    const t = this.type[i];
    return t === T.DIRT || t === T.ORE || t === T.HARD;
  }

  hasFloorNeighbour(i) {
    const x = this.xOf(i);
    const y = this.yOf(i);
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (this.inside(nx, ny) && this.type[this.idx(nx, ny)] === T.FLOOR) return true;
    }
    return false;
  }

  // A marked tile can be worked on only once a tunnel the crew can reach touches it.
  isWorkable(i) {
    if (!this.isDiggable(i)) return false;
    const x = this.xOf(i);
    const y = this.yOf(i);
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (this.inside(nx, ny) && this.reach[this.idx(nx, ny)]) return true;
    }
    return false;
  }

  // Paint or erase a dig mark. Returns true if anything changed.
  // DECISION (Felix): the map border is the only thing that can't be marked.
  setMark(i, on) {
    if (!this.isDiggable(i)) return false;
    const want = on ? 1 : 0;
    if (this.marked[i] === want) return false;
    this.marked[i] = want;
    if (on) {
      this.markedSet.add(i);
      this.markVersion++;
    } else {
      this.markedSet.delete(i);
    }
    this.version++;
    return true;
  }

  // A tile has been dug through: it becomes floor.
  digOut(i) {
    this.type[i] = T.FLOOR;
    this.marked[i] = 0;
    this.markedSet.delete(i);
    this.wall[i] = 0;
    this.claim[i] = 0; // fresh floor starts as bare earth
    this.treasure[i] = -1; // the sim has already picked up whatever was inside
    this.dig[i] = 0;
    this.reservedBy[i] = -1;
    this.wallReservedBy[i] = -1;
    this.version++;
    this.shapeVersion++;
    this.computeReach();
  }
}

// ---------------------------------------------------------------------------
// Generation: dirt everywhere, blobs of hard rock, wandering ore veins,
// a 5x5 start room around the burrow, and one guaranteed ore vein touching it.
// ---------------------------------------------------------------------------
function generate(w) {
  const rng = mulberry32(w.seed);
  const { W, H } = w;
  const interior = (x, y) => x > 0 && y > 0 && x < W - 1 && y < H - 1;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      w.type[w.idx(x, y)] = interior(x, y) ? T.DIRT : T.BORDER;
    }
  }

  // Hard rock blobs. DECISION (Claude): about one blob per 90 tiles, radius 1.2–3.5.
  // Switched off by CONFIG.hardRock for now (Felix); the blobs are still rolled so caves keep their layout.
  const blobs = Math.round((W * H) / 90);
  for (let k = 0; k < blobs; k++) {
    const cx = 1 + rng() * (W - 2);
    const cy = 1 + rng() * (H - 2);
    const r = 1.2 + rng() * 2.3;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (!interior(x, y)) continue;
        // Math.hypot(a, b) = straight-line distance sqrt(a² + b²).
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r && rng() > 0.2 && CONFIG.hardRock) {
          w.type[w.idx(x, y)] = T.HARD;
        }
      }
    }
  }

  // Ore veins: short random walks. DECISION (Claude): one vein per 160 tiles, 5–11 tiles long.
  // Ore only feeds growth, so it comes in veins (DECISION Felix) rather than everywhere.
  const veins = Math.round((W * H) / 160);
  for (let k = 0; k < veins; k++) {
    const sx = 1 + Math.floor(rng() * (W - 2));
    const sy = 1 + Math.floor(rng() * (H - 2));
    oreWalk(w, rng, sx, sy, 5 + Math.floor(rng() * 7), null);
  }

  // Start room.
  const { x: bx, y: by } = w.burrow;
  const R = CONFIG.startRoomRadius;
  for (let y = by - R; y <= by + R; y++) {
    for (let x = bx - R; x <= bx + R; x++) w.type[w.idx(x, y)] = T.FLOOR;
  }

  // Guaranteed starter vein touching the room, so the first new mole comes quickly.
  // DECISION (Claude, brief suggestion).
  const side = Math.floor(rng() * 4);
  const [dx, dy] = DIRS[side];
  const sx = bx + dx * (R + 1);
  const sy = by + dy * (R + 1);
  oreWalk(w, rng, sx, sy, 7, [dx, dy]);

  // Portal: a sealed 3x3 chamber somewhere far from the burrow. It wakes up when a tunnel reaches it.
  // DECISION (Claude, brief suggestion): found by digging, at least CONFIG.portalMinDist away.
  let px = -1;
  let py = -1;
  for (let tries = 0; tries < 500; tries++) {
    const x = 4 + Math.floor(rng() * (W - 8));
    const y = 4 + Math.floor(rng() * (H - 8));
    if (Math.hypot(x - bx, y - by) >= CONFIG.portalMinDist) {
      px = x;
      py = y;
      break;
    }
  }
  if (px < 0) {
    px = 4;
    py = 4;
  }
  for (let y = py - 2; y <= py + 2; y++) {
    for (let x = px - 2; x <= px + 2; x++) {
      const inner = Math.abs(x - px) <= 1 && Math.abs(y - py) <= 1;
      const i = w.idx(x, y);
      if (inner) w.type[i] = T.FLOOR;
      // DECISION (Claude): the chamber's own walls are plain dirt, so breaking in is quick.
      else if (w.type[i] === T.HARD) w.type[i] = T.DIRT;
    }
  }
  w.portal = { x: px, y: py, i: w.idx(px, py) };

  // Treasures: one of each kind, hidden in dirt or hard rock (never ore), spread across the cave.
  // DECISION (Claude): at least 5 tiles from the burrow and 4 tiles from each other, away from the portal.
  const candidates = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const t = w.type[w.idx(x, y)];
      if (t !== T.DIRT && t !== T.HARD) continue;
      if (Math.hypot(x - bx, y - by) < 5) continue;
      if (Math.abs(x - px) <= 2 && Math.abs(y - py) <= 2) continue;
      candidates.push([x, y]);
    }
  }
  // Shuffle (Fisher–Yates): swap each item with a random earlier one, so every order is equally likely.
  for (let k = candidates.length - 1; k > 0; k--) {
    const j = Math.floor(rng() * (k + 1));
    [candidates[k], candidates[j]] = [candidates[j], candidates[k]];
  }
  const placed = [];
  for (const [x, y] of candidates) {
    if (placed.length >= TREASURES.length) break;
    if (placed.some(([qx, qy]) => Math.hypot(qx - x, qy - y) < 4)) continue; // .some = true if any match
    w.treasure[w.idx(x, y)] = placed.length;
    placed.push([x, y]);
  }
}

// Random walk that lays ORE. `bias` = preferred direction (or null).
function oreWalk(w, rng, x, y, len, bias) {
  const interior = (px, py) => px > 0 && py > 0 && px < w.W - 1 && py < w.H - 1;
  let dir = bias || DIRS[Math.floor(rng() * 4)];
  for (let i = 0; i < len; i++) {
    if (interior(x, y) && w.type[w.idx(x, y)] !== T.FLOOR) w.type[w.idx(x, y)] = T.ORE;
    // DECISION (Claude): 60% keep going the same way, so veins look like streaks, not blobs.
    if (rng() > 0.6) dir = bias && rng() < 0.5 ? bias : DIRS[Math.floor(rng() * 4)];
    const nx = x + dir[0];
    const ny = y + dir[1];
    if (interior(nx, ny)) {
      x = nx;
      y = ny;
    }
  }
}
