// visitors.js — the portal, and the friendly creatures that come through it.
// They are part of the living backdrop: slappable, harmless, never in the crew's way.
//
// Flow (called from Sim.update every step):
//   updatePortal(sim, dt)
//     portal not awake yet? → wakes when a tunnel reaches it → event 'portal' (+ a road to it)
//     awake → every visitorInterval seconds, below the cap → spawnVisitor()  (arrives as a baby)
//   updateVisitors(sim, dt)
//     → updateVisitor(v) for each visitor:
//         updateNeeds()   needs drain over time; resting in a room of a needed type fills that need
//                         both needs met → growth builds → grow(): baby → grown-up → final form
//                         needs unmet too long (baby, grown-up) or final stay over → startLeaving()
//         state machine:  'rest' → pickSpot() → 'walk' → 'rest' …   ('greet' and 'leave' too)
//         pickSpot()      follow a friend / flee / go to a room of the most-wanted need type
//     → updateInteractions()  friends who meet say hello ('greet'); a fox cub chases a beetle;
//                             a greeting can turn into tagging along ('follow')
//     → updateGroups()        two or more of a kind resting in one room → a group moment event
//
// Draft 5 replaced "stay a fixed time" with needs and growing up (DECISION Felix).

import { CONFIG } from './config.js';
import { ROOM_TYPES, ROOM_INDEX, VISITOR_KINDS, connectToNetwork } from './rooms.js';
import { bfs, pathTo } from './path.js';

// DECISION (Claude): who is friends with whom (any two of the same kind are friends too),
// and which pair plays chase instead of saying hello.
const FRIENDS = [
  ['hedgehog', 'foxcub'],
  ['frog', 'snail'],
  ['owl', 'bat'],
  ['beetle', 'hedgehog'],
  ['snail', 'beetle'],
  ['owl', 'foxcub'],
  ['frog', 'bat'],
];
const CHASERS = [['foxcub', 'beetle']]; // [chaser, runner]

const isFriend = (a, b) => a === b || FRIENDS.some(([p, q]) => (p === a && q === b) || (p === b && q === a));
const chasePair = (a, b) => CHASERS.find(([c, r]) => (c === a && r === b) || (c === b && r === a));

export function updatePortal(sim, dt) {
  const w = sim.world;
  const p = sim.portal;
  if (!p.awake) {
    if (w.reach[p.i]) {
      p.awake = true;
      p.timer = CONFIG.visitorFirstDelay;
      sim.events.push({ kind: 'portal' });
      // Draft 3: a road from the portal chamber to the nearest room, road or the burrow.
      const chamber = [];
      for (let y = p.y - 1; y <= p.y + 1; y++) for (let x = p.x - 1; x <= p.x + 1; x++) chamber.push(w.idx(x, y));
      p.awake = false; // so the chamber doesn't count as part of the network it is connecting to
      connectToNetwork(sim, chamber, -1);
      p.awake = true;
    }
    return;
  }
  p.timer -= dt;
  if (p.timer <= 0) {
    p.timer = CONFIG.visitorInterval;
    if (sim.visitors.length < CONFIG.visitorCap) spawnVisitor(sim);
  }
}

// Kinds whose needed rooms exist are more likely to come (DECISION Felix: rooms attract creatures).
function pickKind(sim) {
  const kinds = Object.keys(VISITOR_KINDS); // Object.keys lists an object's property names
  const weight = {};
  for (const k of kinds) weight[k] = 1;
  for (const room of sim.rooms) {
    for (const k of ROOM_TYPES[room.type].attracts) weight[k] += CONFIG.roomAttractBonus;
  }
  let total = 0;
  for (const k of kinds) total += weight[k];
  let r = sim.rng() * total;
  for (const k of kinds) {
    r -= weight[k];
    if (r <= 0) return k;
  }
  return kinds[0];
}

function spawnVisitor(sim) {
  const p = sim.portal;
  const kind = pickKind(sim);
  const v = {
    id: sim.nextVisitorId++,
    kind,
    x: p.x + 0.5,
    y: p.y + 0.5,
    state: 'rest',
    think: 0.8, // a moment to look around after stepping out
    path: [],
    home: -1, // the room it is heading to / resting in
    react: 0,
    heading: Math.PI / 2,
    lastProgress: sim.time,
    // Draft 5
    stage: 0, // 0 baby, 1 grown-up, 2 final form
    need: [CONFIG.needStart, CONFIG.needStart], // fullness of its two needs, same order as VISITOR_KINDS[kind].needs
    growth: 0, // seconds with both needs met, toward the next stage
    unmetT: 0, // seconds in a row with needs not met
    finalAt: -1, // sim time it reached its final form
    wants: -1, // room type it needs but that doesn't exist yet (renderer: thought bubble), or -1
    greetCool: 3,
    follow: null, // { id, until } — tagging along after a friend
    chase: null, // { id, until, runner: bool }
    greetT: 0,
  };
  sim.visitors.push(v);
  sim.events.push({ kind: 'arrive', id: v.id, creature: kind });
}

// Called when a lever changes a room: visitors heading for it pick again (the room starts fresh).
export function onRoomChanged(sim, roomId) {
  for (const v of sim.visitors) {
    if (v.home !== roomId || v.state === 'leave') continue;
    v.state = 'rest';
    v.path = [];
    v.think = 0.5 + sim.rng(); // a short puzzled pause, then off to a room it needs
  }
}

export function slapVisitor(sim, id) {
  const v = sim.visitors.find((q) => q.id === id);
  if (!v) return;
  // Harmless: a hop and a squeak, then back to what it was doing (DECISION Felix: backdrop is cosmetic).
  v.react = CONFIG.slapReactTime;
  sim.events.push({ kind: 'slapVisitor', id });
}

export function updateVisitors(sim, dt) {
  const present = new Set(sim.rooms.map((r) => r.type)); // room types that exist right now
  for (const v of sim.visitors) updateVisitor(sim, v, dt, present);
  updateInteractions(sim, dt);
  updateGroups(sim, dt);
  // Remove visitors who walked back through the portal.
  const before = sim.visitors.length;
  sim.visitors = sim.visitors.filter((v) => !v.gone);
  if (sim.visitors.length !== before) sim.events.push({ kind: 'depart' });
}

function updateVisitor(sim, v, dt, present) {
  v.greetCool = Math.max(0, v.greetCool - dt);
  if (v.react > 0) {
    v.react = Math.max(0, v.react - dt);
    v.lastProgress = sim.time;
    return;
  }
  updateNeeds(sim, v, dt, present);
  const kind = VISITOR_KINDS[v.kind];
  let speed = kind.speed;
  if (v.chase && v.chase.runner) speed *= 1.4; // DECISION (Claude): the beetle scurries off fast
  else if (v.chase) speed *= 1.3;
  if (v.follow && sim.time > v.follow.until) v.follow = null;
  if (v.chase && sim.time > v.chase.until) endChase(sim, v);

  switch (v.state) {
    case 'rest':
      v.think -= dt;
      v.lastProgress = sim.time;
      if (v.think <= 0) pickSpot(sim, v, present);
      break;
    case 'walk':
      if (sim.followPath(v, dt, speed)) {
        v.state = 'rest';
        // DECISION (Claude): visitors pause 3–7 s at each spot (in a needed room, that fills the need).
        v.think = v.follow || v.chase ? 0.4 : 3 + sim.rng() * 4;
      }
      break;
    case 'greet':
      v.greetT -= dt;
      v.lastProgress = sim.time;
      if (v.greetT <= 0) {
        v.state = 'rest';
        v.think = 0.5;
      }
      break;
    case 'leave':
      if (sim.followPath(v, dt, speed)) {
        v.gone = true;
        // Draft 7: the narrator says why it left (happy, or missing a room).
        sim.events.push({ kind: 'leave', id: v.id, x: v.x, y: v.y, creature: v.kind, stage: v.stage, reason: v.leaveReason, need: v.leaveNeed });
      }
      break;
  }
}

// --------------------------------------------------------------- needs & growth
function updateNeeds(sim, v, dt, present) {
  const needs = VISITOR_KINDS[v.kind].needs;
  // Which needed room type is missing from the cave? (Shown as a thought bubble.)
  v.wants = -1;
  for (const key of needs) if (!present.has(ROOM_INDEX[key])) v.wants = ROOM_INDEX[key];
  if (v.state === 'leave') return;

  const here = sim.roomOf[sim.world.idx(Math.floor(v.x), Math.floor(v.y))];
  const hereType = here >= 0 ? ROOM_TYPES[sim.rooms[here].type].key : null;
  v.activity = null; // what it's doing, for the renderer: the room type key while filling a need
  for (let k = 0; k < 2; k++) {
    v.need[k] = Math.max(0, v.need[k] - CONFIG.needDrain * dt);
    if (v.state === 'rest' && hereType === needs[k]) {
      v.need[k] = Math.min(1, v.need[k] + CONFIG.needFill * dt);
      v.activity = hereType;
    }
  }

  const met = v.need[0] >= CONFIG.needMet && v.need[1] >= CONFIG.needMet;
  if (v.stage < 2) {
    if (met) {
      v.unmetT = 0;
      v.growth += dt;
      const need = CONFIG.growTime[v.stage];
      if (v.growth >= need) grow(sim, v);
    } else {
      v.unmetT += dt;
      if (v.unmetT > CONFIG.unmetLeave) {
        // Remember which need was emptiest, so the narrator can say what it missed.
        v.leaveReason = 'unmet';
        v.leaveNeed = needs[v.need[0] <= v.need[1] ? 0 : 1];
        startLeaving(sim, v); // DECISION (Felix)
      }
    }
  } else if (sim.time - v.finalAt > CONFIG.finalStay) {
    v.leaveReason = 'happy';
    startLeaving(sim, v); // DECISION (Felix): grown all the way, stays a while, then goes home happy
  }
}

function grow(sim, v) {
  v.stage++;
  v.growth = 0;
  if (v.stage === 2) v.finalAt = sim.time;
  sim.events.push({ kind: 'grow', id: v.id, stage: v.stage, creature: v.kind });
}

function startLeaving(sim, v) {
  v.state = 'leave';
  v.follow = null;
  if (v.chase) endChase(sim, v);
  v.path = pathTo(bfs(sim.world, tileOf(sim, v)), sim.portal.i);
}

// --------------------------------------------------------------- where to go next
function pickSpot(sim, v, present) {
  const w = sim.world;
  const res = bfs(w, tileOf(sim, v));
  let target = -1;

  // 1. Tagging along after a friend, or in a chase.
  const leaderId = v.chase && !v.chase.runner ? v.chase.id : v.follow ? v.follow.id : -1;
  const leader = leaderId >= 0 ? sim.visitors.find((q) => q.id === leaderId && q.state !== 'leave') : null;
  if (leaderId >= 0 && !leader) {
    v.follow = null;
    if (v.chase) endChase(sim, v);
  }
  if (leader) {
    const lt = tileOf(sim, leader);
    if (lt !== tileOf(sim, v) && res.dist[lt] >= 0) target = lt;
    else {
      v.think = 0.5;
      return;
    }
  } else if (v.chase && v.chase.runner) {
    // 2. Running from a fox cub: dash to a random spot a few tiles away.
    const opts = nearby(sim, v, res, 3);
    if (opts.length) target = opts[Math.floor(sim.rng() * opts.length)];
  } else {
    // 3. Go to a room of whichever needed type is emptier (DECISION Claude), if one exists.
    const needs = VISITOR_KINDS[v.kind].needs;
    const order = v.need[0] <= v.need[1] ? [0, 1] : [1, 0];
    for (const k of order) {
      const rooms = sim.rooms.filter((r) => ROOM_TYPES[r.type].key === needs[k] && r.tiles.some((i) => res.dist[i] >= 0));
      if (!rooms.length) continue;
      // Stay in the current room if it's the right type. Otherwise prefer one where others of the
      // same kind already are (DECISION Claude: creatures like company, which makes group moments),
      // else the nearest one.
      const kin = new Set(sim.visitors.filter((q) => q !== v && q.kind === v.kind && q.state !== 'leave').map((q) => q.home));
      const near = (r) => Math.min(...r.tiles.map((i) => (res.dist[i] >= 0 ? res.dist[i] : 1e9)));
      const room =
        rooms.find((r) => r.id === v.home) ||
        rooms.find((r) => kin.has(r.id)) ||
        rooms.reduce((a, b) => (near(b) < near(a) ? b : a)); // .reduce keeps the nearest as it walks the list
      v.home = room.id;
      const tiles = room.tiles.filter((i) => res.dist[i] >= 0);
      target = tiles[Math.floor(sim.rng() * tiles.length)];
      break;
    }
    if (target < 0) {
      // No needed room yet: potter about near the portal.
      v.home = -1;
      const p = sim.portal;
      const opts = [];
      for (let y = p.y - 4; y <= p.y + 4; y++)
        for (let x = p.x - 4; x <= p.x + 4; x++) if (w.inside(x, y) && res.dist[w.idx(x, y)] >= 0) opts.push(w.idx(x, y));
      if (opts.length) target = opts[Math.floor(sim.rng() * opts.length)];
    }
  }
  if (target < 0) {
    v.think = 2;
    return;
  }
  v.path = pathTo(res, target);
  v.state = 'walk';
}

function nearby(sim, v, res, r) {
  const w = sim.world;
  const x0 = Math.floor(v.x);
  const y0 = Math.floor(v.y);
  const out = [];
  for (let y = y0 - r; y <= y0 + r; y++)
    for (let x = x0 - r; x <= x0 + r; x++) if (w.inside(x, y) && res.dist[w.idx(x, y)] > 0) out.push(w.idx(x, y));
  return out;
}

// --------------------------------------------------------------- interactions
function updateInteractions(sim, dt) {
  sim.interactT = (sim.interactT || 0) - dt;
  if (sim.interactT > 0) return;
  sim.interactT = 0.4; // DECISION (Claude): look for meetings a few times a second, not every step

  const free = (v) => (v.state === 'rest' || v.state === 'walk') && !v.chase && v.greetCool <= 0 && v.react === 0;
  let active = sim.visitors.filter((v) => v.state === 'greet' || v.chase).length;
  const list = sim.visitors;
  for (let a = 0; a < list.length && active < CONFIG.maxInteractions; a++) {
    const A = list[a];
    if (!free(A)) continue;
    for (let b = a + 1; b < list.length; b++) {
      const B = list[b];
      if (!free(B)) continue;
      if (Math.hypot(A.x - B.x, A.y - B.y) > CONFIG.greetRadius) continue;
      const pair = chasePair(A.kind, B.kind);
      if (pair && A.kind !== B.kind) {
        startChase(sim, A.kind === pair[0] ? A : B, A.kind === pair[0] ? B : A);
        active++;
        break;
      }
      if (!isFriend(A.kind, B.kind)) continue;
      greet(sim, A, B);
      // DECISION (Claude): after hello, sometimes one tags along after the other for a while.
      if (sim.rng() < 0.4) A.follow = { id: B.id, until: sim.time + CONFIG.followTime };
      active++;
      break;
    }
  }
}

function greet(sim, A, B) {
  for (const [v, o] of [
    [A, B],
    [B, A],
  ]) {
    v.state = 'greet';
    v.greetT = CONFIG.greetTime;
    v.greetCool = CONFIG.greetCooldown;
    v.path = [];
    v.heading = Math.atan2(o.y - v.y, o.x - v.x); // face each other
  }
  sim.events.push({ kind: 'greet', a: A.id, b: B.id, x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 });
}

function startChase(sim, chaser, runner) {
  const until = sim.time + CONFIG.chaseTime;
  chaser.chase = { id: runner.id, until, runner: false };
  runner.chase = { id: chaser.id, until, runner: true };
  for (const v of [chaser, runner]) {
    v.state = 'rest';
    v.think = 0;
    v.path = [];
    v.follow = null;
  }
  sim.events.push({ kind: 'chase', a: chaser.id, b: runner.id });
}

// When the chase time is up, both stop and say hello (it was a game, not a fight).
function endChase(sim, v) {
  const other = sim.visitors.find((q) => q.id === v.chase.id);
  v.chase = null;
  if (other && other.chase && other.chase.id === v.id) {
    other.chase = null;
    if (v.state !== 'leave' && other.state !== 'leave') greet(sim, v, other);
  }
}

// Two or more of one kind resting in the same room → a group moment (frog chorus, bat nap, …).
function updateGroups(sim, dt) {
  sim.groupT = (sim.groupT || 0) - dt;
  if (sim.groupT > 0) return;
  sim.groupT = CONFIG.groupEvery;
  const groups = new Map(); // "room:kind" → [ids]
  for (const v of sim.visitors) {
    if (v.state !== 'rest' || v.home < 0) continue;
    const here = sim.roomOf[sim.world.idx(Math.floor(v.x), Math.floor(v.y))];
    if (here !== v.home) continue;
    const key = `${here}:${v.kind}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v.id);
  }
  for (const [key, ids] of groups) {
    if (ids.length < 2) continue;
    const [room, kind] = key.split(':');
    sim.events.push({ kind: 'group', room: Number(room), creature: kind, ids });
  }
}

function tileOf(sim, v) {
  return sim.world.idx(Math.floor(v.x), Math.floor(v.y));
}
