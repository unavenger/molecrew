// sim.js — the moles and the burrow. Pure game rules, no drawing.
//
// Flow of one frame:
//   Sim.update(dt)
//     → updateBurrow(dt)          builds a new mole when enough ore has arrived
//     → updateMole(m, dt) per mole
//         idle   → chooseJob(m)   dig a mark > reinforce a wall > wander
//         walk   → followPath()   → arrive(): starts 'dig' or 'wall'
//         dig    → digOut()       ore? → 'haul' to the burrow : back to idle
//         haul   → deliver()      → ore: burrow.ore++ → updateBurrow may start a new mole
//                                    treasure (draft 4): set on its pedestal in the ring
//         claim  → floor paved    → idle   (draft 3: bare floor outside rooms)
//         wall   → wall stage++   → idle
//         wander → idle (pause)
//   Draft 2 adds, after the moles:
//     → updateRooms(this)        rooms.js: find new rooms after digging, place their levers
//     → updatePortal(this, dt)   visitors.js: wake the portal, send visitors through it
//     → updateVisitors(this, dt) visitors.js: visitors wander their home rooms, then leave
//   Anything the renderer should show as an effect goes into sim.events.

import { CONFIG } from './config.js';
import { T, DIRS, TREASURES } from './world.js';
import { bfs, pathTo } from './path.js';
import { mulberry32 } from './rng.js';
import { updateRooms, ROOM_TYPES } from './rooms.js';
import { updatePortal, updateVisitors, slapVisitor, onRoomChanged } from './visitors.js';

export class Sim {
  constructor(world) {
    this.world = world;
    this.moles = [];
    this.nextId = 0;
    this.events = []; // effects for the renderer: { kind, ... }. The renderer empties it each frame.
    this.time = 0;
    this.rng = mulberry32(world.seed ^ 0x9e3779b9);
    const { x, y } = world.burrow;
    this.focus = { x: x + 0.5, y: y + 0.5 }; // camera centre in tile units, set by main.js
    this.burrow = {
      x,
      y,
      tile: world.idx(x, y),
      ore: 0, // loads delivered and not yet spent
      cost: CONFIG.moleCostBase, // loads needed for the next mole
      built: 0,
      assembling: 0, // seconds left on the mole being assembled (0 = not assembling)
    };
    for (let k = 0; k < CONFIG.startCrew; k++) {
      this.spawnMole(x + 0.5 + (k - 1) * 0.6, y + 0.9);
    }

    // Draft 2: rooms, portal, visitors.
    this.rooms = []; // see rooms.js
    this.roomOf = new Int32Array(world.W * world.H).fill(-1); // room id per tile, or -1
    this.roomsVersion = 0; // bumps when rooms appear, grow or change type → renderer redraws
    this.road = new Uint8Array(world.W * world.H); // 1 = tile is part of a road (draft 3)
    this.roomShapeVersion = -1;
    const p = world.portal;
    this.portal = { x: p.x, y: p.y, i: p.i, awake: false, timer: 0 };
    this.visitors = [];
    this.nextVisitorId = 0;

    // Draft 4: the treasure ring. trove[kind] = true once that treasure is on its pedestal.
    // Pedestals sit on the start room's outer ring of tiles, clockwise from the top-left corner.
    this.trove = TREASURES.map(() => false);
    this.treasureSlots = [];
    const R = CONFIG.startRoomRadius;
    for (let k = -R; k < R; k++) this.treasureSlots.push({ x: x + k, y: y - R }); // top edge
    for (let k = -R; k < R; k++) this.treasureSlots.push({ x: x + R, y: y + k }); // right edge
    for (let k = R; k > -R; k--) this.treasureSlots.push({ x: x + k, y: y + R }); // bottom edge
    for (let k = R; k > -R; k--) this.treasureSlots.push({ x: x - R, y: y + k }); // left edge
  }

  // Cosmetic, like the rest of the backdrop: the renderer gives the treasure a twirl.
  slapTreasure(kind) {
    if (this.trove[kind]) this.events.push({ kind: 'slapTreasure', treasure: kind });
  }

  // DECISION (Felix): slapping a room's lever swaps it to the next type; the room starts fresh.
  pullLever(roomId) {
    const room = this.rooms[roomId];
    if (!room) return;
    room.type = (room.type + 1) % ROOM_TYPES.length;
    room.pulls++;
    this.roomsVersion++;
    this.events.push({ kind: 'lever', id: roomId });
    onRoomChanged(this, roomId);
  }

  // Draft 8: the lever fan picks a room type directly (DECISION Felix: the fan, not cycling).
  setRoomType(roomId, type) {
    const room = this.rooms[roomId];
    if (!room || room.type === type) return;
    room.type = type;
    room.pulls++;
    this.roomsVersion++;
    this.events.push({ kind: 'lever', id: roomId });
    onRoomChanged(this, roomId);
  }

  slapVisitor(id) {
    slapVisitor(this, id);
  }

  spawnMole(x, y) {
    const m = {
      id: this.nextId++,
      x,
      y,
      state: 'idle',
      think: 0.2 + this.rng() * 0.3, // seconds until the next job search
      path: [],
      job: null, // { kind: 'dig' | 'wall', i } — the tile being worked
      carrying: false,
      cargo: -1, // what's being carried: -1 = ore, 0+ = a treasure kind (draft 4)
      boost: 0, // seconds of slap speed-up left
      react: 0, // seconds of slap reaction left (mole does nothing meanwhile)
      heading: Math.PI / 2, // facing angle in the x/y plane (for the renderer)
      workPhase: 0, // advances while digging/building; renderer syncs swings to it
      seenMarkVersion: -1,
      lastProgress: 0, // sim time of the last real progress (used by tests to catch freezes)
    };
    this.moles.push(m);
    return m;
  }

  // DECISION (Felix): true to Dungeon Keeper 2 — a slap interrupts the mole (react) and
  // then speeds it up (boost). Slaps don't stack: a second slap only refreshes the timers.
  slap(id) {
    const m = this.moles.find((q) => q.id === id); // .find returns the first match, or undefined.
    if (!m) return;
    m.react = CONFIG.slapReactTime;
    m.boost = CONFIG.slapBoostTime;
    this.events.push({ kind: 'slap', id });
  }

  update(dt) {
    this.time += dt;
    this.updateBurrow(dt);
    for (const m of this.moles) this.updateMole(m, dt);
    updateRooms(this);
    updatePortal(this, dt);
    updateVisitors(this, dt);
  }

  // ------------------------------------------------------------------ burrow
  updateBurrow(dt) {
    const b = this.burrow;
    if (b.assembling > 0) {
      b.assembling -= dt;
      if (b.assembling <= 0) {
        b.assembling = 0;
        b.ore -= b.cost;
        b.built++;
        b.cost = CONFIG.moleCostBase + CONFIG.moleCostStep * b.built;
        const m = this.spawnMole(b.x + 0.5, b.y + 0.5);
        m.lastProgress = this.time;
        this.events.push({ kind: 'spawn', id: m.id });
      }
    }
    // DECISION (Claude): ore keeps piling up once the crew is capped; it will feed
    // machines/decorations later (brief). Nothing is ever lost.
    if (b.assembling === 0 && b.ore >= b.cost && this.moles.length < CONFIG.crewCap) {
      b.assembling = CONFIG.assembleTime;
    }
  }

  // Fraction (0..1) of the next mole's outline that is filled in, for the renderer.
  get buildFraction() {
    const b = this.burrow;
    if (this.moles.length >= CONFIG.crewCap) return 0;
    return Math.min(1, b.ore / b.cost);
  }

  // ------------------------------------------------------------------ moles
  tileOf(m) {
    return this.world.idx(Math.floor(m.x), Math.floor(m.y));
  }

  updateMole(m, dt) {
    if (m.boost > 0) m.boost = Math.max(0, m.boost - dt);
    if (m.react > 0) {
      // The cost of a slap: nothing happens while the mole reacts.
      m.react = Math.max(0, m.react - dt);
      m.lastProgress = this.time;
      return;
    }
    const mult = m.boost > 0 ? CONFIG.slapBoostMult : 1; // DECISION (Claude): boost speeds walking too, not only digging.

    // Painting must get an instant response (brief): moles doing low-priority things
    // (wandering, reinforcing) drop them as soon as new dig work appears.
    if (m.seenMarkVersion !== this.world.markVersion) {
      m.seenMarkVersion = this.world.markVersion;
      const lowPriority = m.state === 'wander' || m.state === 'idle' || (m.job && m.job.kind !== 'dig');
      if (lowPriority && this.hasOpenDigWork()) {
        this.dropJob(m);
        m.think = 0;
      }
    }

    switch (m.state) {
      case 'idle':
        m.think -= dt;
        m.lastProgress = this.time; // waiting is fine; tests only care about frozen *working* moles
        if (m.think <= 0) this.chooseJob(m);
        break;

      case 'walk':
        if (!this.jobStillValid(m)) {
          this.dropJob(m);
          break;
        }
        if (this.followPath(m, dt * mult)) this.arrive(m);
        break;

      case 'dig':
        this.updateDig(m, dt * mult);
        break;

      case 'wall':
        if (!this.jobStillValid(m)) {
          this.dropJob(m);
          break;
        }
        m.workPhase += dt * mult;
        m.timer -= dt * mult;
        m.lastProgress = this.time;
        if (m.timer <= 0) {
          const i = m.job.i;
          this.world.wall[i]++;
          this.world.version++;
          this.events.push({ kind: 'wall', i, stage: this.world.wall[i] });
          this.dropJob(m);
          m.think = 0;
        }
        break;

      case 'claim':
        if (!this.jobStillValid(m)) {
          this.dropJob(m);
          break;
        }
        m.workPhase += dt * mult;
        m.timer -= dt * mult;
        m.lastProgress = this.time;
        if (m.timer <= 0) {
          const i = m.job.i;
          this.world.claim[i] = 1;
          this.world.version++;
          if (this.road[i]) this.roomsVersion++; // a paved road tile may get a lamp post: redraw road props
          this.events.push({ kind: 'claim', i });
          this.dropJob(m);
          m.think = 0;
        }
        break;

      case 'haul':
        if (this.followPath(m, dt * mult * CONFIG.carrySpeedFactor)) this.deliver(m);
        break;

      case 'wander':
        if (this.followPath(m, dt * 0.6)) {
          // DECISION (Claude): idle moles stroll slowly and pause 1–3 s, so the cave looks alive.
          m.state = 'idle';
          m.think = 1 + this.rng() * 2;
        }
        break;
    }
  }

  // Move any walker (mole or visitor) along its path. Returns true when the path is finished.
  followPath(m, dt, speed = CONFIG.moleSpeed) {
    let remaining = dt * speed;
    const W = this.world.W;
    while (remaining > 0 && m.path.length) {
      const i = m.path[0];
      const tx = (i % W) + 0.5;
      const ty = ((i / W) | 0) + 0.5;
      const dx = tx - m.x;
      const dy = ty - m.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-6) m.heading = Math.atan2(dy, dx); // atan2 gives the angle of a direction vector.
      if (d <= remaining) {
        m.x = tx;
        m.y = ty;
        remaining -= d;
        m.path.shift(); // .shift() removes the first item of the array.
      } else {
        m.x += (dx / d) * remaining;
        m.y += (dy / d) * remaining;
        remaining = 0;
      }
      m.lastProgress = this.time;
    }
    return m.path.length === 0;
  }

  arrive(m) {
    const i = m.job.i;
    const W = this.world.W;
    m.heading = Math.atan2((i / W | 0) + 0.5 - m.y, (i % W) + 0.5 - m.x); // face the tile
    if (m.job.kind === 'dig') {
      m.state = 'dig';
    } else if (m.job.kind === 'floor') {
      m.state = 'claim';
      m.timer = CONFIG.claimTime;
    } else {
      m.state = 'wall';
      m.timer = CONFIG.reinforceTime[this.world.wall[i]];
    }
  }

  updateDig(m, dt) {
    const w = this.world;
    if (!this.jobStillValid(m)) {
      this.dropJob(m);
      return;
    }
    const i = m.job.i;
    const t = w.type[i];
    const base = t === T.HARD ? CONFIG.digTime.hard : t === T.ORE ? CONFIG.digTime.ore : CONFIG.digTime.dirt;
    const time = base * (w.wall[i] > 0 ? CONFIG.reinforcedDigFactor : 1);
    w.dig[i] += dt / time;
    m.workPhase += dt;
    m.lastProgress = this.time;
    if (w.dig[i] >= 1) {
      const treasure = w.treasure[i]; // read before digOut clears it
      w.digOut(i);
      this.events.push({ kind: 'dug', i, type: t, treasure });
      m.job = null;
      if (t === T.ORE || treasure >= 0) {
        m.carrying = true;
        m.cargo = treasure; // -1 for ore
        const res = bfs(w, this.tileOf(m));
        m.path = pathTo(res, this.burrow.tile);
        m.state = 'haul';
      } else {
        m.state = 'idle';
        m.think = 0;
      }
    }
  }

  deliver(m) {
    m.carrying = false;
    if (m.cargo >= 0) {
      // DECISION (Felix): treasure is for display, not a resource. It goes on its own pedestal.
      this.trove[m.cargo] = true;
      this.events.push({ kind: 'treasure', treasure: m.cargo });
      m.cargo = -1;
    } else {
      this.burrow.ore += 1;
      this.events.push({ kind: 'deliver', id: m.id });
    }
    m.state = 'idle';
    m.think = 0;
  }

  jobStillValid(m) {
    const j = m.job;
    if (!j) return false;
    const w = this.world;
    if (j.kind === 'dig') return w.marked[j.i] === 1 && w.isDiggable(j.i) && w.reservedBy[j.i] === m.id;
    if (j.kind === 'floor')
      return w.type[j.i] === T.FLOOR && !w.claim[j.i] && this.roomOf[j.i] < 0 && w.wallReservedBy[j.i] === m.id;
    // A wall job ends if the wall got marked for digging (digging wins) or is already finished.
    return w.type[j.i] !== T.FLOOR && !w.marked[j.i] && w.wall[j.i] < 2 && w.wallReservedBy[j.i] === m.id;
  }

  dropJob(m) {
    const w = this.world;
    if (m.job) {
      const i = m.job.i;
      if (w.reservedBy[i] === m.id) w.reservedBy[i] = -1;
      if (w.wallReservedBy[i] === m.id) w.wallReservedBy[i] = -1;
    }
    m.job = null;
    m.path = [];
    if (m.carrying) {
      // Never drop ore: a carrying mole always finishes the trip home.
      const res = bfs(w, this.tileOf(m));
      m.path = pathTo(res, this.burrow.tile);
      m.state = 'haul';
    } else {
      m.state = 'idle';
      m.think = Math.min(m.think, CONFIG.idleThink);
    }
  }

  hasOpenDigWork() {
    const w = this.world;
    for (const i of w.markedSet) {
      if (w.reservedBy[i] === -1 && w.isWorkable(i)) return true;
    }
    return false;
  }

  // ------------------------------------------------------------- job choice
  chooseJob(m) {
    const w = this.world;
    m.seenMarkVersion = w.markVersion;
    const res = bfs(w, this.tileOf(m));
    // DECISION (Claude): dig marks first, then pave floors (DK2 imps claim floor before walls), then walls.
    const job = this.findDigJob(m, res) || this.findFloorJob(m, res) || this.findWallJob(m, res);
    if (job) {
      m.job = { kind: job.kind, i: job.i };
      if (job.kind === 'dig') w.reservedBy[job.i] = m.id;
      else w.wallReservedBy[job.i] = m.id; // floor and wall jobs share one reservation array (a tile is never both)
      m.path = pathTo(res, job.stand);
      m.state = 'walk';
      if (m.path.length === 0) this.arrive(m);
      return;
    }
    this.startWander(m, res);
  }

  // Nearest reachable floor tile next to tile i, as { stand, d }, or null.
  standFor(res, i) {
    const w = this.world;
    const x = w.xOf(i);
    const y = w.yOf(i);
    let best = null;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!w.inside(nx, ny)) continue;
      const n = w.idx(nx, ny);
      const d = res.dist[n];
      if (d >= 0 && (!best || d < best.d)) best = { stand: n, d };
    }
    return best;
  }

  focusDist(i) {
    const w = this.world;
    return Math.hypot(w.xOf(i) + 0.5 - this.focus.x, w.yOf(i) + 0.5 - this.focus.y);
  }

  findDigJob(m, res) {
    const w = this.world;
    let best = null;
    let bestScore = Infinity;
    for (const i of w.markedSet) {
      const r = w.reservedBy[i];
      if (r !== -1 && r !== m.id) continue; // DECISION (Claude): one mole per tile, so they spread out.
      const s = this.standFor(res, i);
      if (!s) continue; // not touching the tunnels yet
      const score =
        s.d + (w.type[i] === T.HARD ? CONFIG.hardPenalty : 0) + CONFIG.focusWeight * this.focusDist(i);
      if (score < bestScore) {
        bestScore = score;
        best = { kind: 'dig', i, stand: s.stand };
      }
    }
    return best;
  }

  // DECISION (Felix): moles reinforce and decorate walls bordering dug space, as DK2 imps do.
  // DECISION (Claude): this is what moles do when nothing is marked (instead of idling),
  // it costs no ore, and ore tiles are left rough so ore stays easy to spot.
  findWallJob(m, res) {
    const w = this.world;
    let best = null;
    let bestScore = Infinity;
    const n = w.W * w.H;
    for (let i = 0; i < n; i++) {
      const t = w.type[i];
      if (t === T.FLOOR || t === T.ORE || w.wall[i] >= 2 || w.marked[i]) continue;
      if (w.wallReservedBy[i] !== -1) continue;
      const s = this.standFor(res, i);
      if (!s) continue;
      const score = s.d + CONFIG.reinforceStagePenalty * w.wall[i] + CONFIG.focusWeight * this.focusDist(i);
      if (score < bestScore) {
        bestScore = score;
        best = { kind: 'wall', i, stand: s.stand };
      }
    }
    return best;
  }

  // DECISION (Felix): moles decorate bare floor outside rooms. Room floors already have their own look.
  findFloorJob(m, res) {
    const w = this.world;
    let best = null;
    let bestScore = Infinity;
    const n = w.W * w.H;
    for (let i = 0; i < n; i++) {
      const d = res.dist[i];
      if (d < 0 || w.claim[i] || this.roomOf[i] >= 0 || w.wallReservedBy[i] !== -1) continue;
      const score = d + CONFIG.focusWeight * this.focusDist(i);
      if (score < bestScore) {
        bestScore = score;
        best = { kind: 'floor', i, stand: i }; // the mole stands on the tile it paves
      }
    }
    return best;
  }

  startWander(m, res) {
    const w = this.world;
    const b = this.burrow;
    const R = CONFIG.wanderRadius;
    const options = [];
    for (let y = b.y - R; y <= b.y + R; y++) {
      for (let x = b.x - R; x <= b.x + R; x++) {
        if (!w.inside(x, y)) continue;
        const i = w.idx(x, y);
        if (res.dist[i] > 0) options.push(i);
      }
    }
    m.state = 'wander';
    m.path = options.length ? pathTo(res, options[Math.floor(this.rng() * options.length)]) : [];
    m.think = CONFIG.idleThink;
  }
}
