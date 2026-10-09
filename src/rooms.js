// rooms.js — finds rooms in the dug-out cave, and the data for room types and visitors.
//
// Flow (called by Sim.update whenever a tile has been dug out):
//   updateRooms(sim)
//     → markOpenTiles()   floor tiles inside a fully dug 3x3 square count as "room floor"
//     → for each connected patch of room floor:
//         small (≤ roomMaxEnclosed)  → a walled room: create it, or grow the one room already in it
//         big                        → a hall: claim 4x4 patches in any space no room owns yet
//     → placeLever()      walled rooms: on a tile against a wall; hall patches: on a post at a corner
//     → connectToNetwork()  draft 3: lay a road from each new room to the nearest room, road,
//                           the burrow, or the open portal
//   Rooms never move or shrink once made (DECISION Felix: rooms lock in place). Roads lock too.
//   Draft 8: rooms only form inside the village (CONFIG.villageRadius around the burrow).

import { CONFIG } from './config.js';
import { T, DIRS } from './world.js';

// DECISION (Claude, brief suggestion): six room types in a fixed cycle.
export const ROOM_TYPES = [
  { key: 'garden', name: 'Mushroom garden' },
  { key: 'pond', name: 'Underground pond' },
  { key: 'nap', name: 'Nap room' },
  { key: 'kitchen', name: 'Kitchen' },
  { key: 'grotto', name: 'Glowworm grotto' },
  { key: 'map', name: 'Map room' },
];

// DECISION (Claude, brief suggestion): seven friendly visitor kinds. speed = tiles per second.
// needs (draft 5): the two room types each kind must visit to grow up. DECISION (Claude, proposed
// to Felix and kept): two rooms per kind, so lever choices decide which creatures can grow.
export const VISITOR_KINDS = {
  hedgehog: { speed: 1.0, needs: ['garden', 'kitchen'] },
  frog: { speed: 1.4, needs: ['pond', 'nap'] },
  snail: { speed: 0.35, needs: ['garden', 'pond'] },
  beetle: { speed: 1.2, needs: ['grotto', 'kitchen'] },
  bat: { speed: 1.8, needs: ['nap', 'grotto'] },
  owl: { speed: 0.8, needs: ['map', 'grotto'] },
  foxcub: { speed: 1.7, needs: ['nap', 'map'] },
};

// Which kinds each room type attracts = every kind that needs it (DECISION Felix: rooms attract creatures).
for (const t of ROOM_TYPES) {
  t.attracts = Object.keys(VISITOR_KINDS).filter((k) => VISITOR_KINDS[k].needs.includes(t.key));
}
export const ROOM_INDEX = Object.fromEntries(ROOM_TYPES.map((t, i) => [t.key, i])); // key → type number

export function updateRooms(sim) {
  const w = sim.world;
  if (sim.roomShapeVersion === w.shapeVersion) return;
  sim.roomShapeVersion = w.shapeVersion;

  const { W, H } = w;
  const n = W * H;
  const open = markOpenTiles(sim);
  const seen = new Uint8Array(n);
  let changed = false;

  for (let s = 0; s < n; s++) {
    if (!open[s] || seen[s]) continue;
    // Collect one connected patch of room floor.
    const comp = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const c = stack.pop();
      comp.push(c);
      const cx = c % W;
      const cy = (c / W) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!w.inside(nx, ny)) continue;
        const ni = w.idx(nx, ny);
        if (open[ni] && !seen[ni]) {
          seen[ni] = 1;
          stack.push(ni);
        }
      }
    }

    const owners = new Set();
    for (const c of comp) if (sim.roomOf[c] >= 0) owners.add(sim.roomOf[c]);

    if (comp.length <= CONFIG.roomMaxEnclosed) {
      if (owners.size === 0) {
        createRoom(sim, comp, true);
        changed = true;
      } else if (owners.size === 1) {
        const room = sim.rooms[[...owners][0]];
        // A walled room grows to fill its space as it gets dug wider (it never shrinks).
        if (room.enclosed && room.tiles.length < comp.length) {
          room.tiles = comp;
          for (const c of comp) sim.roomOf[c] = room.id;
          finishRoom(sim, room);
          changed = true;
        }
      }
      // Two or more rooms in one small space: leave them as they are (rooms are locked).
    } else if (claimPatches(sim, comp)) {
      changed = true;
    }
  }
  if (changed) sim.roomsVersion++;
}

// Room floor = reachable floor inside some fully dug 3x3 square, outside the burrow's start room
// and the portal chamber. DECISION (Claude): the burrow room and the portal stay room-free.
function markOpenTiles(sim) {
  const w = sim.world;
  const { W, H } = w;
  const open = new Uint8Array(W * H);
  const k = CONFIG.roomMinOpen;
  const R = CONFIG.startRoomRadius;
  const excluded = (x, y) =>
    // Draft 8: outside the village (too far from the burrow) is wild cave: no rooms there.
    Math.hypot(x - w.burrow.x, y - w.burrow.y) > CONFIG.villageRadius ||
    (Math.abs(x - w.burrow.x) <= R && Math.abs(y - w.burrow.y) <= R) ||
    (w.portal && Math.abs(x - w.portal.x) <= 1 && Math.abs(y - w.portal.y) <= 1);
  for (let y0 = 0; y0 <= H - k; y0++) {
    for (let x0 = 0; x0 <= W - k; x0++) {
      let ok = true;
      for (let y = y0; y < y0 + k && ok; y++) {
        for (let x = x0; x < x0 + k; x++) {
          const i = w.idx(x, y);
          if (w.type[i] !== T.FLOOR || !w.reach[i] || excluded(x, y)) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) continue;
      for (let y = y0; y < y0 + k; y++) for (let x = x0; x < x0 + k; x++) open[w.idx(x, y)] = 1;
    }
  }
  return open;
}

// Big hall: claim 4x4 patches in space no room owns yet, scanning row by row.
function claimPatches(sim, comp) {
  const w = sim.world;
  const P = CONFIG.hallPatch;
  const inComp = new Set(comp);
  let any = false;
  // Scan in tile order so patches line up neatly and the result doesn't depend on flood order.
  const sorted = [...comp].sort((a, b) => a - b);
  for (const c of sorted) {
    const x0 = w.xOf(c);
    const y0 = w.yOf(c);
    let fits = true;
    const tiles = [];
    for (let y = y0; y < y0 + P && fits; y++) {
      for (let x = x0; x < x0 + P; x++) {
        const i = w.inside(x, y) ? w.idx(x, y) : -1;
        if (i < 0 || !inComp.has(i) || sim.roomOf[i] >= 0) {
          fits = false;
          break;
        }
        tiles.push(i);
      }
    }
    if (!fits) continue;
    createRoom(sim, tiles, false);
    any = true;
  }
  return any;
}

function createRoom(sim, tiles, enclosed) {
  const id = sim.rooms.length;
  const room = {
    id,
    tiles,
    enclosed,
    // DECISION (Claude): new rooms start on different types (id order), so neighbours differ.
    type: id % ROOM_TYPES.length,
    lever: null, // { i, dir } — dir = [dx, dy] toward the wall it hangs on, or null for a post
    pulls: 0, // bumps on every lever pull (renderer animates)
    cx: 0,
    cy: 0,
  };
  for (const c of tiles) sim.roomOf[c] = id;
  sim.rooms.push(room);
  finishRoom(sim, room);
  connectToNetwork(sim, tiles, id);
  sim.events.push({ kind: 'room', id });
  return room;
}

// ---------------------------------------------------------------------------
// Roads (draft 3). DECISION (Felix): roads connect the rooms, as a stand-in for corridors once
// the walls come down. DECISION (Claude): each new room (and the portal, when it wakes) gets ONE
// road to the nearest part of the existing network — the burrow's start room, another room, or a
// road — along the shortest dug path. Roads are never moved or removed (same locking as rooms).
// Road tiles only look like road once the moles have paved them (world.claim).
// ---------------------------------------------------------------------------
export function inStartRoom(sim, i) {
  const w = sim.world;
  const R = CONFIG.startRoomRadius;
  return Math.abs(w.xOf(i) - w.burrow.x) <= R && Math.abs(w.yOf(i) - w.burrow.y) <= R;
}

export function inPortalChamber(sim, i) {
  const w = sim.world;
  const p = w.portal;
  return !!p && Math.abs(w.xOf(i) - p.x) <= 1 && Math.abs(w.yOf(i) - p.y) <= 1;
}

function isNetwork(sim, i, selfRoom, sources) {
  if (sources.has(i)) return false;
  if (sim.road[i]) return true;
  const r = sim.roomOf[i];
  if (r >= 0 && r !== selfRoom) return true;
  if (inStartRoom(sim, i)) return true;
  if (sim.portal && sim.portal.awake && inPortalChamber(sim, i)) return true;
  return false;
}

export function connectToNetwork(sim, sourceTiles, selfRoom) {
  const w = sim.world;
  const { W } = w;
  const n = W * w.H;
  const sources = new Set(sourceTiles);
  const prev = new Int32Array(n).fill(-2); // -2 = not visited, -1 = a source tile
  const queue = [];
  for (const s of sourceTiles) {
    prev[s] = -1;
    queue.push(s);
  }
  // Breadth-first from every source tile at once: the first network tile found is the nearest.
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    if (isNetwork(sim, c, selfRoom, sources)) {
      let changed = false;
      for (let t = prev[c]; t >= 0 && !sources.has(t); t = prev[t]) {
        if (sim.roomOf[t] >= 0 || inStartRoom(sim, t) || inPortalChamber(sim, t) || sim.road[t]) continue;
        sim.road[t] = 1;
        changed = true;
      }
      if (changed) sim.roomsVersion++;
      return;
    }
    const cx = c % W;
    const cy = (c / W) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!w.inside(nx, ny)) continue;
      const ni = w.idx(nx, ny);
      if (prev[ni] !== -2 || w.type[ni] !== T.FLOOR || !w.reach[ni]) continue;
      prev[ni] = c;
      queue.push(ni);
    }
  }
}

function finishRoom(sim, room) {
  const w = sim.world;
  let sx = 0;
  let sy = 0;
  for (const c of room.tiles) {
    sx += w.xOf(c) + 0.5;
    sy += w.yOf(c) + 0.5;
  }
  room.cx = sx / room.tiles.length;
  room.cy = sy / room.tiles.length;
  // Keep an existing lever where it is: things the player knows shouldn't jump around.
  if (!room.lever) room.lever = placeLever(sim, room);
}

function placeLever(sim, room) {
  const w = sim.world;
  if (room.enclosed) {
    // DECISION (Claude): on the wall-side tile nearest the room's middle, so it's easy to spot.
    let best = null;
    let bestD = Infinity;
    for (const c of room.tiles) {
      const x = w.xOf(c);
      const y = w.yOf(c);
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!w.inside(nx, ny) || w.type[w.idx(nx, ny)] === T.FLOOR) continue;
        const d = Math.hypot(x + 0.5 - room.cx, y + 0.5 - room.cy);
        if (d < bestD) {
          bestD = d;
          best = { i: c, dir: [dx, dy] };
        }
      }
    }
    if (best) return best;
  }
  // Hall patches (or a walled room with no wall-side tile): a lever on a post in the top-left corner.
  // DECISION (Claude)
  const first = Math.min(...room.tiles); // Math.min(...list) = smallest number in the list
  return { i: first, dir: null };
}
