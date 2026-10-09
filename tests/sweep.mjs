// tests/sweep.mjs — runs the simulation headless (no graphics) across many seeds
// and checks the rules the design depends on. Run with:  node tests/sweep.mjs
//
// Invariants checked:
//   1. Start: the burrow has ore touching the start room (first new mole comes quickly).
//   2. Every marked tile is eventually dug (no-fail promise: nothing gets stuck).
//   3. The crew never exceeds the cap.
//   4. No tile is reserved by two moles, and every reservation belongs to a mole working on it.
//   5. No mole is frozen: a mole with a job always makes progress within 20 s.
//   6. Slap spam on one mole never stops the level from finishing.
//   7. With nothing marked, the crew eventually decorates every wall it can reach.
//   8. Rooms never shrink or move once made, and no tile belongs to two rooms.
//   9. The portal wakes once reached; visitors stay under the cap and never freeze.
//  10. Every room is joined to the burrow by roads and other rooms (draft 3).
//  11. With nothing marked, the crew paves every bare floor tile outside rooms (draft 3).
//  12. Every hidden treasure is found and ends up on its pedestal after a full clear (draft 4).
//  14. The narrator (draft 7) only says real lines, keeps 7 s of quiet between them, never repeats
//      a line within two minutes, celebrates final forms, and nudges about missing rooms.
//  13. With every room type present, visitors grow up (some reach their final form), greet each
//      other and gather in groups; with no rooms at all, they leave instead of growing (draft 5).

import { World, T } from '../src/world.js';
import { Sim } from '../src/sim.js';
import { CONFIG } from '../src/config.js';
import { inStartRoom, inPortalChamber } from '../src/rooms.js';
import { Narrator, LINES } from '../src/narration.js';

// A pretend voice: "speaks" instantly. The narrator's own pacing rules still apply.
const fakeVoice = { say: (id, text, done) => done(), stop: () => {} };

function checkNarration(narr, seed) {
  let prev = null;
  const last = {};
  for (const s of narr.spoken) {
    if (!LINES[s.id]) fail(seed, `narrator said unknown line ${s.id}`);
    if (prev && s.t - prev.t < 7 - 1e-6) fail(seed, `narrator lines only ${(s.t - prev.t).toFixed(1)} s apart`);
    if (last[s.id] !== undefined && s.t - last[s.id] < 120) fail(seed, `line ${s.id} repeated too soon`);
    last[s.id] = s.t;
    prev = s;
  }
}

// Walk from the start room over road, room and (open) portal tiles; every room must be reached.
function checkRoads(sim, seed) {
  const w = sim.world;
  const n = w.W * w.H;
  const ok = (i) =>
    w.type[i] === T.FLOOR &&
    (sim.road[i] || sim.roomOf[i] >= 0 || inStartRoom(sim, i) || (sim.portal.awake && inPortalChamber(sim, i)));
  const seen = new Uint8Array(n);
  const start = w.idx(w.burrow.x, w.burrow.y);
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const c = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = w.xOf(c) + dx;
      const y = w.yOf(c) + dy;
      if (!w.inside(x, y)) continue;
      const i = w.idx(x, y);
      if (!seen[i] && ok(i)) {
        seen[i] = 1;
        stack.push(i);
      }
    }
  }
  for (const r of sim.rooms) if (!r.tiles.some((i) => seen[i])) fail(seed, `room ${r.id} not connected by road`);
  if (sim.portal.awake && !seen[sim.portal.i]) fail(seed, 'portal not connected by road');
}

const DT = 1 / 30;
let failures = 0;
const fail = (seed, msg) => {
  failures++;
  console.log(`  FAIL seed ${seed}: ${msg}`);
};

const roomMemo = new Map(); // room id -> tile count last seen
function checkRooms(sim, seed) {
  const w = sim.world;
  for (const r of sim.rooms) {
    // Draft 8: rooms only inside the village around the burrow.
    for (const i of r.tiles)
      if (Math.hypot(w.xOf(i) - w.burrow.x, w.yOf(i) - w.burrow.y) > CONFIG.villageRadius + 1e-9) {
        fail(seed, `room ${r.id} has a tile outside the village`);
        break;
      }
    const prev = roomMemo.get(r.id) || 0;
    if (r.tiles.length < prev) fail(seed, `room ${r.id} shrank`);
    roomMemo.set(r.id, r.tiles.length);
    for (const i of r.tiles) if (sim.roomOf[i] !== r.id) fail(seed, `tile ${i} owner mismatch in room ${r.id}`);
  }
  if (sim.visitors.length > CONFIG.visitorCap) fail(seed, 'too many visitors');
  for (const v of sim.visitors) {
    if (sim.time - v.lastProgress > 20) {
      fail(seed, `visitor ${v.id} (${v.kind}) frozen in ${v.state}`);
      v.lastProgress = sim.time;
    }
  }
}

function checkFrame(sim, seed) {
  checkRooms(sim, seed);
  const w = sim.world;
  if (sim.moles.length > CONFIG.crewCap) fail(seed, `crew ${sim.moles.length} > cap`);
  const owners = new Map();
  for (const m of sim.moles) {
    if (m.job) {
      const key = `${m.job.kind}:${m.job.i}`;
      if (owners.has(key)) fail(seed, `tile ${key} held by two moles`);
      owners.set(key, m.id);
    }
    if (sim.time - m.lastProgress > 20) {
      fail(seed, `mole ${m.id} frozen in state ${m.state}`);
      m.lastProgress = sim.time; // report once
    }
  }
  for (let i = 0; i < w.W * w.H; i++) {
    const r = w.reservedBy[i];
    if (r !== -1 && owners.get(`dig:${i}`) !== r) {
      // A dig reservation must belong to a mole whose job is that tile.
      fail(seed, `stale dig reservation on ${i} by ${r}`);
      w.reservedBy[i] = -1;
    }
  }
}

function markAll(w) {
  for (let i = 0; i < w.W * w.H; i++) w.setMark(i, true);
}

function oreTouchingRoom(w) {
  for (let i = 0; i < w.W * w.H; i++) if (w.type[i] === T.ORE && w.hasFloorNeighbour(i)) return true;
  return false;
}

function run(seed, { slapSpam = false, eraseAt = -1 } = {}) {
  roomMemo.clear();
  const w = new World(seed);
  const sim = new Sim(w);
  if (!oreTouchingRoom(w)) fail(seed, 'no ore touching the start room');
  markAll(w);
  const limit = 60 * 60; // one simulated hour
  let erased = false;
  while (w.markedSet.size > 0 && sim.time < limit) {
    if (slapSpam) sim.slap(0);
    if (!erased && eraseAt > 0 && sim.time > eraseAt) {
      // Erase half the marks mid-run, then repaint them: moles must cope.
      let k = 0;
      for (const i of [...w.markedSet]) if (k++ % 2 === 0) w.setMark(i, false);
      for (let i = 0; i < w.W * w.H; i++) w.setMark(i, true);
      erased = true;
    }
    sim.update(DT);
    sim.events.length = 0;
    checkFrame(sim, seed);
  }
  if (w.markedSet.size > 0) fail(seed, `${w.markedSet.size} marks never dug`);
  if (!sim.portal.awake) fail(seed, 'portal never woke');
  // Let visitors arrive and live a while, pulling levers now and then.
  const narr = new Narrator(fakeVoice, null);
  const t1 = sim.time;
  const seen = {};
  let topStage = 0;
  while (sim.time < t1 + 600) {
    if (sim.rooms.length && Math.random() < 0.002) sim.setRoomType(Math.floor(Math.random() * sim.rooms.length), Math.floor(Math.random() * 6));
    sim.update(DT);
    narr.handleEvents(sim.events, sim);
    narr.update(DT, sim);
    for (const e of sim.events) seen[e.kind] = (seen[e.kind] || 0) + 1;
    for (const v of sim.visitors) topStage = Math.max(topStage, v.stage);
    sim.events.length = 0;
    checkFrame(sim, seed);
  }
  if (topStage < 2) fail(seed, `no visitor reached its final form (best stage ${topStage})`);
  if (!seen.greet) fail(seed, 'visitors never greeted each other');
  if (!seen.group) fail(seed, 'no group moments happened');
  if (!seen.leave) fail(seed, 'no visitor ever left');
  checkNarration(narr, seed);
  if (!narr.spoken.some((s) => s.id.startsWith('final_'))) fail(seed, 'narrator never celebrated a final form');
  if (seed === 1) console.log('  narrator sample:', narr.spoken.slice(0, 8).map((s) => s.id).join(', '));
  if (sim.visitors.length === 0) fail(seed, 'no visitors after 10 min with the portal open');
  checkRoads(sim, seed);
  const shown = sim.trove.filter(Boolean).length; // filter(Boolean) keeps only true entries
  if (shown !== sim.trove.length) fail(seed, `only ${shown}/${sim.trove.length} treasures displayed`);
  if (sim.moles.some((m) => m.carrying)) fail(seed, 'a mole is still carrying something after 10 idle minutes');
  roomMemo.clear();
  return { time: t1, crew: sim.moles.length, ore: sim.burrow.ore, rooms: sim.rooms.length, visitors: sim.visitors.length };
}

function runDecorate(seed) {
  roomMemo.clear();
  const w = new World(seed);
  const sim = new Sim(w);
  // Dig a ring of rooms first so there are walls, then stop marking.
  const { x: bx, y: by } = w.burrow;
  for (let y = by - 6; y <= by + 6; y++)
    for (let x = bx - 8; x <= bx + 8; x++) if (w.inside(x, y)) w.setMark(w.idx(x, y), true);
  while (w.markedSet.size > 0 && sim.time < 3600) {
    sim.update(DT);
    sim.events.length = 0;
  }
  const t0 = sim.time;
  while (sim.time < t0 + 1800) {
    sim.update(DT);
    sim.events.length = 0;
    checkFrame(sim, seed);
  }
  let undone = 0;
  for (let i = 0; i < w.W * w.H; i++) {
    const t = w.type[i];
    // Only walls touching floor the crew can reach (the sealed portal chamber doesn't count).
    const reachable = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const x = w.xOf(i) + dx;
      const y = w.yOf(i) + dy;
      return w.inside(x, y) && w.reach[w.idx(x, y)];
    });
    if (t !== T.FLOOR && t !== T.ORE && reachable && w.wall[i] < 2) undone++;
  }
  if (undone) fail(seed, `${undone} walls not decorated after 30 min idle`);
  let bare = 0;
  for (let i = 0; i < w.W * w.H; i++) if (w.reach[i] && !w.claim[i] && sim.roomOf[i] < 0) bare++;
  if (bare) fail(seed, `${bare} floor tiles never paved after 30 min idle`);
  checkRoads(sim, seed);
}

const t0 = Date.now();
console.log('Full clear (everything marked):');
for (let seed = 1; seed <= 8; seed++) {
  const r = run(seed);
  console.log(`  seed ${seed}: cleared in ${(r.time / 60).toFixed(1)} min, crew ${r.crew}, leftover ore ${r.ore}, ${r.rooms} rooms, ${r.visitors} visitors`);
}
console.log('Slap spam on one mole:');
for (let seed = 11; seed <= 12; seed++) {
  const r = run(seed, { slapSpam: true });
  console.log(`  seed ${seed}: cleared in ${(r.time / 60).toFixed(1)} min`);
}
console.log('Erase and repaint mid-run:');
for (let seed = 21; seed <= 22; seed++) {
  const r = run(seed, { eraseAt: 120 });
  console.log(`  seed ${seed}: cleared in ${(r.time / 60).toFixed(1)} min`);
}
console.log('Scattered rooms get roads:');
for (let seed = 41; seed <= 44; seed++) {
  roomMemo.clear();
  const w = new World(seed);
  const sim = new Sim(w);
  const { x: bx, y: by } = w.burrow;
  // Corridors with chambers off them, all inside the village, so rooms sit apart and need roads.
  const box = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (w.inside(x, y) && x > 0 && y > 0 && x < w.W - 1 && y < w.H - 1) w.setMark(w.idx(x, y), true);
  };
  box(bx + 3, by, bx + 8, by); // corridor east
  box(bx + 5, by - 4, bx + 8, by - 1); // chamber north of it
  box(bx - 8, by, bx - 3, by); // corridor west
  box(bx - 8, by + 1, bx - 5, by + 4); // chamber south of it
  box(bx, by - 8, bx, by - 3); // corridor north
  box(bx - 4, by - 8, bx - 1, by - 5); // chamber west of it
  while (w.markedSet.size > 0 && sim.time < 3600) {
    sim.update(DT);
    sim.events.length = 0;
    checkFrame(sim, seed);
  }
  let roads = 0;
  for (let i = 0; i < w.W * w.H; i++) roads += sim.road[i];
  checkRoads(sim, seed);
  if (sim.rooms.length < 3) fail(seed, `expected at least 3 rooms, got ${sim.rooms.length}`);
  if (roads === 0) fail(seed, 'no road tiles laid between scattered rooms');
  console.log(`  seed ${seed}: ${sim.rooms.length} rooms, ${roads} road tiles`);
}
console.log('No rooms: visitors leave instead of growing:');
for (let seed = 51; seed <= 52; seed++) {
  roomMemo.clear();
  const w = new World(seed);
  const sim = new Sim(w);
  // A one-tile-wide tunnel from the burrow to the portal: too narrow for any room.
  let { x, y } = w.burrow;
  const p = w.portal;
  while (x !== p.x) {
    x += Math.sign(p.x - x);
    w.setMark(w.idx(x, y), true);
  }
  while (y !== p.y) {
    y += Math.sign(p.y - y);
    w.setMark(w.idx(x, y), true);
  }
  let leaves = 0;
  let arrives = 0;
  let grew = 0;
  const narr = new Narrator(fakeVoice, null);
  while (sim.time < 1200) {
    sim.update(DT);
    narr.handleEvents(sim.events, sim);
    narr.update(DT, sim);
    for (const e of sim.events) {
      if (e.kind === 'leave') leaves++;
      if (e.kind === 'arrive') arrives++;
      if (e.kind === 'grow') grew++;
    }
    sim.events.length = 0;
    checkFrame(sim, seed);
  }
  if (sim.rooms.length) fail(seed, `expected no rooms, got ${sim.rooms.length}`);
  if (!arrives) fail(seed, 'no visitors arrived');
  if (!leaves) fail(seed, 'roomless visitors never left');
  if (grew) fail(seed, 'a visitor grew without its rooms');
  checkNarration(narr, seed);
  const nudges = narr.spoken.filter((s) => /^(want|want2|missed)_/.test(s.id)).length;
  if (!nudges) fail(seed, 'narrator never nudged about missing rooms');
  if (seed === 51) console.log('  narrator sample:', narr.spoken.slice(0, 6).map((s) => LINES[s.id]).join(' | '));
  console.log(`  seed ${seed}: ${arrives} arrived, ${leaves} left, ${grew} grew`);
}
console.log('Idle crew decorates walls:');
for (let seed = 31; seed <= 32; seed++) runDecorate(seed);

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILURES'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failures ? 1 : 0);
