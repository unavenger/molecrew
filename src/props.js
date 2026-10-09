// props.js — what the room types, levers, portal and visitors look like (placeholders in code).
// Together with assets.js this is the only place that decides looks; the same Blender-swap
// conventions apply (1 unit = 1 tile, base at y = 0, facing +z, named parts).
//
// Room props are not separate objects: each room calls emit(...) once per piece, and the
// renderer batches every piece of the same shape into one InstancedMesh (fast to draw).
//   emit(shape, material, x, y, z, sx, sy, sz, color, rotY = 0, rotX = 0)
//   shape:    'box' | 'sphere' | 'cyl' | 'cone' | 'gem' | 'disc' | 'hemi'
//   material: 'lit' (normal), 'glow' (unlit, looks self-lit), 'water' (see-through)

import * as THREE from 'three';
import { shared, PALETTE } from './assets.js';

const { G, mat } = shared;

// Floor colour per room type, so a room's identity reads from far away. DECISION (Claude)
export const ROOM_FLOOR = {
  garden: [0x3f4d2a, 0x46552e],
  pond: [0x2c3a40, 0x2c3a40],
  nap: [0x5c3138, 0x5c3138],
  kitchen: [0x6b5a47, 0x4a3c31], // two colours = checkerboard tiles
  grotto: [0x1f3036, 0x243840],
  map: [0x5b4330, 0x553e2c],
};

// ---------------------------------------------------------------------------
// Room props. `info.tiles` = [{ x, y, walls, edges, interior, lever }] — walls = directions to solid
// rock, edges = directions leaving the room, interior = all four neighbours in the room, `info.center` = {x, y}
// (tile coords), `rnd(x, y, salt)` = stable random 0..1 per tile. Bigger rooms get more pieces
// simply because pieces are placed per tile (DECISION Claude, brief: bigger rooms look richer).
// ---------------------------------------------------------------------------
export function buildRoomProps(type, info, emit, rnd) {
  const c = info.center;
  const free = info.tiles.filter((t) => !t.lever);
  switch (type) {
    case 'garden':
      for (const t of free) {
        const n = rnd(t.x, t.y, 1) < 0.6 ? 1 + Math.floor(rnd(t.x, t.y, 2) * 3) : 0;
        for (let k = 0; k < n; k++) {
          const ox = t.x + 0.2 + rnd(t.x, t.y, 10 + k) * 0.6;
          const oz = t.y + 0.2 + rnd(t.x, t.y, 20 + k) * 0.6;
          const h = 0.12 + rnd(t.x, t.y, 30 + k) * 0.35;
          const r = 0.08 + h * 0.45;
          const caps = [0xd8453b, 0xe8893a, 0x9a5ad0, 0xe0c25a];
          const glowing = rnd(t.x, t.y, 40 + k) < 0.15;
          emit('cyl', 'lit', ox, h / 2, oz, r * 0.35, h, r * 0.35, 0xf0e2c8);
          emit('hemi', glowing ? 'glow' : 'lit', ox, h, oz, r, r * 0.7, r, glowing ? 0x7ff0d0 : caps[Math.floor(rnd(t.x, t.y, 50 + k) * 4)]);
          if (!glowing) emit('sphere', 'lit', ox + r * 0.4, h + r * 0.45, oz + r * 0.2, r * 0.18, r * 0.12, r * 0.18, 0xffffff);
        }
      }
      break;

    case 'pond':
      for (const t of free) {
        if (t.interior) {
          emit('box', 'water', t.x + 0.5, 0.075, t.y + 0.5, 1.0, 0.03, 1.0, 0x3aa0d8);
          if (rnd(t.x, t.y, 1) < 0.35) emit('disc', 'lit', t.x + 0.3 + rnd(t.x, t.y, 2) * 0.4, 0.1, t.y + 0.3 + rnd(t.x, t.y, 3) * 0.4, 0.16, 1, 0.16, 0x5fae4a);
          if (rnd(t.x, t.y, 4) < 0.1) emit('sphere', 'lit', t.x + 0.5, 0.14, t.y + 0.5, 0.05, 0.05, 0.05, 0xf4a6c8); // lily flower
        } else {
          // Reeds and pebbles around the edge.
          for (let k = 0; k < 3; k++) {
            if (rnd(t.x, t.y, 10 + k) < 0.45) continue;
            const ox = t.x + 0.15 + rnd(t.x, t.y, 20 + k) * 0.7;
            const oz = t.y + 0.15 + rnd(t.x, t.y, 30 + k) * 0.7;
            const h = 0.35 + rnd(t.x, t.y, 40 + k) * 0.3;
            emit('cyl', 'lit', ox, h / 2, oz, 0.015, h, 0.015, 0x6f9a3c);
            emit('cyl', 'lit', ox, h, oz, 0.03, 0.1, 0.03, 0x6b4428);
          }
          if (rnd(t.x, t.y, 5) < 0.4) emit('sphere', 'lit', t.x + 0.5, 0.05, t.y + 0.5, 0.12, 0.07, 0.1, 0x8a8a8a);
        }
      }
      break;

    case 'nap': {
      // A round rug in the middle, beds against the walls.
      emit('disc', 'lit', c.x + 0.5, 0.07, c.y + 0.5, 1.1, 1, 1.1, 0xb8743a);
      emit('disc', 'lit', c.x + 0.5, 0.075, c.y + 0.5, 0.75, 1, 0.75, 0xd89a52);
      const blankets = [0x6aa2d8, 0xe07a8a, 0x8ac46a, 0xe8c24a];
      for (const t of free) {
        const side = t.walls.length ? t.walls : t.edges; // hall patches have no walls: use the room's edge
        if (!side.length || rnd(t.x, t.y, 1) > 0.55) continue;
        const [dx, dy] = side[0];
        const rot = Math.atan2(dx, dy); // head of the bed against the wall
        const bx = t.x + 0.5 + dx * 0.12;
        const bz = t.y + 0.5 + dy * 0.12;
        emit('box', 'lit', bx, 0.1, bz, 0.55, 0.16, 0.75, 0x7a5232, rot);
        emit('box', 'lit', bx, 0.2, bz, 0.5, 0.06, 0.7, blankets[Math.floor(rnd(t.x, t.y, 2) * 4)], rot);
        emit('box', 'lit', bx + dx * 0.22, 0.25, bz + dy * 0.22, 0.36, 0.08, 0.16, 0xfaf3e6, rot);
      }
      // A candle or two.
      for (const t of free) if (t.walls.length && rnd(t.x, t.y, 9) < 0.15) candle(emit, t.x + 0.5 + t.walls[0][0] * 0.35, t.y + 0.5 + t.walls[0][1] * 0.35);
      break;
    }

    case 'kitchen': {
      // Stew pot over a fire in the middle.
      const kx = c.x + 0.5;
      const kz = c.y + 0.5;
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        emit('cone', 'glow', kx + Math.cos(a) * 0.08, 0.14, kz + Math.sin(a) * 0.08, 0.09, 0.28, 0.09, k === 1 ? 0xffd04a : 0xff7a2a);
      }
      emit('cyl', 'lit', kx, 0.4, kz, 0.28, 0.3, 0.28, 0x2a2426);
      emit('cyl', 'lit', kx, 0.56, kz, 0.24, 0.02, 0.24, 0xa86a3a); // stew
      // Shelves with jars along the walls.
      const jars = [0xd85a4a, 0x5aa0d8, 0xe8c24a, 0x7ac46a, 0xf0f0f0];
      for (const t of free) {
        const side = t.walls.length ? t.walls : t.edges;
        if (!side.length || rnd(t.x, t.y, 1) > 0.5) continue;
        const [dx, dy] = side[0];
        const rot = Math.atan2(dx, dy);
        const sx = t.x + 0.5 + dx * 0.38;
        const sz = t.y + 0.5 + dy * 0.38;
        for (const h of [0.45, 0.8]) {
          emit('box', 'lit', sx, h, sz, 0.8, 0.04, 0.22, 0x8a5a33, rot);
          for (let k = 0; k < 3; k++) {
            const off = (k - 1) * 0.24;
            const jx = sx + (dy !== 0 ? off : 0);
            const jz = sz + (dx !== 0 ? off : 0);
            emit('cyl', 'lit', jx, h + 0.09, jz, 0.06, 0.14, 0.06, jars[Math.floor(rnd(t.x, t.y, k + h * 10) * 5)]);
          }
        }
      }
      // A little table with stools.
      const t0 = free.find((t) => t.interior && (t.x !== c.x || t.y !== c.y));
      if (t0) {
        emit('box', 'lit', t0.x + 0.5, 0.3, t0.y + 0.5, 0.6, 0.06, 0.6, 0x9a6a3c);
        emit('cyl', 'lit', t0.x + 0.5, 0.15, t0.y + 0.5, 0.05, 0.3, 0.05, 0x7a5232);
        for (const [ox, oz] of [[-0.42, 0], [0.42, 0]]) emit('cyl', 'lit', t0.x + 0.5 + ox, 0.1, t0.y + 0.5 + oz, 0.12, 0.2, 0.12, 0x7a5232);
      }
      break;
    }

    case 'grotto':
      for (const t of free) {
        if (rnd(t.x, t.y, 1) < 0.4) {
          // Crystal clusters.
          for (let k = 0; k < 3; k++) {
            const h = 0.15 + rnd(t.x, t.y, 10 + k) * 0.35;
            emit('gem', 'glow', t.x + 0.25 + rnd(t.x, t.y, 20 + k) * 0.5, h * 0.5, t.y + 0.25 + rnd(t.x, t.y, 30 + k) * 0.5, 0.07, h, 0.07, k === 0 ? 0x7fe8ff : 0x9ab8ff, rnd(t.x, t.y, 40 + k) * 3);
          }
        }
        // Glowworm lights clinging to the walls.
        for (const [dx, dy] of t.walls) {
          for (let k = 0; k < 4; k++) {
            if (rnd(t.x, t.y, 60 + k + dx * 7 + dy * 13) < 0.4) continue;
            const along = rnd(t.x, t.y, 70 + k) - 0.5;
            emit('sphere', 'glow', t.x + 0.5 + dx * 0.48 + (dy ? along : 0), 0.4 + rnd(t.x, t.y, 80 + k) * 0.6, t.y + 0.5 + dy * 0.48 + (dx ? along : 0), 0.03, 0.03, 0.03, 0xb8ff8a);
          }
        }
      }
      break;

    case 'map': {
      // Big map table in the middle, bookshelves along the walls, a globe.
      const mx = c.x + 0.5;
      const mz = c.y + 0.5;
      emit('box', 'lit', mx, 0.42, mz, 1.3, 0.08, 0.9, 0x8a5a33);
      for (const [ox, oz] of [[-0.55, -0.35], [0.55, -0.35], [-0.55, 0.35], [0.55, 0.35]]) emit('box', 'lit', mx + ox, 0.2, mz + oz, 0.07, 0.4, 0.07, 0x6a4428);
      emit('box', 'lit', mx, 0.47, mz, 1.1, 0.01, 0.72, 0xe8d9b0);
      for (let k = 0; k < 4; k++) emit('cone', 'lit', mx - 0.4 + rnd(k, 1, 3) * 0.8, 0.52, mz - 0.25 + rnd(k, 2, 3) * 0.5, 0.025, 0.08, 0.025, 0xd83a3a, 0, Math.PI);
      candle(emit, mx + 0.5, mz + 0.3, 0.47);
      const books = [0xb83a3a, 0x3a6ab8, 0x3a9a5a, 0xc89a3a, 0x7a4ab0];
      for (const t of free) {
        const side = t.walls.length ? t.walls : t.edges;
        if (!side.length || rnd(t.x, t.y, 1) > 0.5) continue;
        const [dx, dy] = side[0];
        const rot = Math.atan2(dx, dy);
        const sx = t.x + 0.5 + dx * 0.36;
        const sz = t.y + 0.5 + dy * 0.36;
        emit('box', 'lit', sx, 0.45, sz, 0.85, 0.9, 0.26, 0x6a4428, rot);
        for (const h of [0.25, 0.55]) {
          for (let k = 0; k < 5; k++) {
            const off = (k - 2) * 0.14;
            emit('box', 'lit', sx - dx * 0.04 + (dy ? off : 0), h, sz - dy * 0.04 + (dx ? off : 0), dy ? 0.1 : 0.18, 0.2, dx ? 0.1 : 0.18, books[Math.floor(rnd(t.x, t.y, k + h * 10) * 5)]);
          }
        }
      }
      const g = free.find((t) => !t.walls.length && (Math.abs(t.x - c.x) > 1 || Math.abs(t.y - c.y) > 1));
      if (g) {
        emit('cyl', 'lit', g.x + 0.5, 0.2, g.y + 0.5, 0.04, 0.4, 0.04, 0x6a4428);
        emit('sphere', 'lit', g.x + 0.5, 0.52, g.y + 0.5, 0.17, 0.17, 0.17, 0x4a8ad0);
        emit('sphere', 'lit', g.x + 0.55, 0.56, g.y + 0.55, 0.1, 0.06, 0.08, 0x6ab85a);
      }
      break;
    }
  }
}

function candle(emit, x, z, base = 0.06) {
  emit('cyl', 'lit', x, base + 0.08, z, 0.035, 0.16, 0.035, 0xf4ecd8);
  emit('cone', 'glow', x, base + 0.2, z, 0.03, 0.07, 0.03, 0xffc24a);
}

// ---------------------------------------------------------------------------
// Lever: a striped base and a chunky arm with a red knob. Part 'arm' is the pivot the
// renderer swings on a pull. `post: true` adds a pole, for levers standing in open halls.
// ---------------------------------------------------------------------------
export function makeLever({ post = false } = {}) {
  const g = new THREE.Group();
  g.name = 'lever';
  const yellow = mat(0xf4c430);
  const dark = mat(0x2a2224);
  const metal = mat(0x8c939c, { metalness: 0.4, roughness: 0.5 });
  const lift = post ? 0.5 : 0.2;
  if (post) {
    const pole = new THREE.Mesh(G.cyl, dark);
    pole.scale.set(0.07, 0.5, 0.07);
    pole.position.y = 0.25;
    g.add(pole);
  }
  const base = new THREE.Mesh(G.box, yellow);
  base.scale.set(0.38, 0.22, 0.26);
  base.position.y = lift;
  g.add(base);
  for (let k = 0; k < 2; k++) {
    const stripe = new THREE.Mesh(G.box, dark);
    stripe.scale.set(0.07, 0.225, 0.265);
    stripe.position.set(-0.08 + k * 0.16, lift, 0);
    g.add(stripe);
  }
  const arm = new THREE.Group();
  arm.name = 'arm';
  arm.position.y = lift + 0.08;
  g.add(arm);
  const stick = new THREE.Mesh(G.cyl, metal);
  stick.scale.set(0.035, 0.5, 0.035);
  stick.position.y = 0.25;
  arm.add(stick);
  const knob = new THREE.Mesh(G.sphere, mat(0xe83a3a, { roughness: 0.4 }));
  knob.scale.setScalar(0.1);
  knob.position.y = 0.52;
  knob.name = 'knob';
  arm.add(knob);
  arm.rotation.x = -0.55; // resting tilt
  return g;
}

// ---------------------------------------------------------------------------
// Portal: a standing stone ring with a swirling disc. Parts: 'disc', 'swirl', 'ring'.
// ---------------------------------------------------------------------------
export function makePortal() {
  const g = new THREE.Group();
  g.name = 'portal';
  const stone = mat(0x5a5468);
  // TorusGeometry(ring radius, tube radius, tube segments, ring segments) = a doughnut shape.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.11, 8, 20), stone);
  ring.name = 'ring';
  ring.position.y = 0.8;
  g.add(ring);
  // Rune stones around the ring.
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const r = new THREE.Mesh(G.box, mat(0x6e6880));
    r.scale.set(0.12, 0.14, 0.16);
    r.position.set(Math.cos(a) * 0.68, 0.8 + Math.sin(a) * 0.68, 0);
    r.rotation.z = a;
    g.add(r);
  }
  const plinth = new THREE.Mesh(G.box, stone);
  plinth.scale.set(1.3, 0.16, 0.5);
  plinth.position.y = 0.08;
  g.add(plinth);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 32), // a flat filled circle
    new THREE.MeshBasicMaterial({ color: 0x8a5af0, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  );
  disc.name = 'disc';
  disc.position.y = 0.8;
  g.add(disc);
  // RingGeometry(inner, outer, segments, rings, startAngle, length) — a partial ring makes a swirl arm.
  const swirl = new THREE.Group();
  swirl.name = 'swirl';
  swirl.position.y = 0.8;
  for (let k = 0; k < 3; k++) {
    const arm = new THREE.Mesh(
      new THREE.RingGeometry(0.12 + k * 0.13, 0.19 + k * 0.13, 24, 1, k * 2, Math.PI * 1.1),
      new THREE.MeshBasicMaterial({ color: k === 1 ? 0x7ff0ff : 0xe8b8ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
    );
    arm.position.z = 0.01 + k * 0.005;
    swirl.add(arm);
  }
  g.add(swirl);
  return g;
}

// ---------------------------------------------------------------------------
// Visitors. Every one has parts named 'bob' (moves the whole body) and 'head';
// some have extras the renderer animates: 'wingL'/'wingR' (bat), 'tail' (fox cub), 'eyes' (snail).
// ---------------------------------------------------------------------------
export function makeVisitor(kind) {
  const root = new THREE.Group();
  root.name = kind;
  const bob = new THREE.Group();
  bob.name = 'bob';
  root.add(bob);
  const head = new THREE.Group();
  head.name = 'head';
  bob.add(head);
  const add = (parent, shape, color, sx, sy, sz, x, y, z, extra) => {
    const m = new THREE.Mesh(G[shape], extra && extra.basic ? new THREE.MeshBasicMaterial({ color }) : mat(color, extra));
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const eye = (parent, x, y, z, s = 0.03) => {
    add(parent, 'sphere', 0xffffff, s, s, s, x, y, z, { basic: true });
    add(parent, 'sphere', 0x111111, s * 0.55, s * 0.55, s * 0.4, x, y, z + s * 0.7, { basic: true });
  };

  switch (kind) {
    case 'hedgehog': {
      add(bob, 'sphere', 0x8a6a4a, 0.2, 0.15, 0.24, 0, 0.15, 0);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const sp = add(bob, 'cone', 0x4a3424, 0.04, 0.14, 0.04, Math.cos(a) * 0.12, 0.24, Math.sin(a) * 0.14 - 0.04);
        sp.rotation.set(Math.sin(a) * -0.8, 0, Math.cos(a) * 0.8);
      }
      head.position.set(0, 0.13, 0.2);
      const snout = add(head, 'cone', 0xd8b890, 0.08, 0.16, 0.08, 0, 0, 0.06);
      snout.rotation.x = Math.PI / 2;
      add(head, 'sphere', 0x111111, 0.025, 0.025, 0.025, 0, 0, 0.15, { basic: true });
      eye(head, -0.05, 0.04, 0.02, 0.022);
      eye(head, 0.05, 0.04, 0.02, 0.022);
      break;
    }
    case 'frog': {
      add(bob, 'sphere', 0x5aae3a, 0.2, 0.12, 0.22, 0, 0.12, 0);
      add(bob, 'sphere', 0xd8e88a, 0.15, 0.06, 0.16, 0, 0.08, 0.06);
      head.position.set(0, 0.2, 0.08);
      for (const x of [-0.09, 0.09]) {
        add(head, 'sphere', 0x5aae3a, 0.06, 0.06, 0.06, x, 0.02, 0);
        eye(head, x, 0.04, 0.03, 0.035);
      }
      for (const x of [-0.17, 0.17]) add(bob, 'sphere', 0x4a9a2e, 0.07, 0.05, 0.12, x, 0.05, -0.06);
      break;
    }
    case 'snail': {
      add(bob, 'sphere', 0xe8d8b0, 0.09, 0.06, 0.28, 0, 0.06, 0);
      add(bob, 'sphere', 0xc8742e, 0.15, 0.16, 0.15, 0, 0.2, -0.05);
      add(bob, 'sphere', 0xe8a04a, 0.09, 0.1, 0.152, 0, 0.21, -0.05);
      head.position.set(0, 0.08, 0.22);
      const eyes = new THREE.Group();
      eyes.name = 'eyes';
      head.add(eyes);
      for (const x of [-0.04, 0.04]) {
        add(eyes, 'cyl', 0xe8d8b0, 0.012, 0.14, 0.012, x, 0.07, 0);
        eye(eyes, x, 0.15, 0, 0.025);
      }
      break;
    }
    case 'beetle': {
      add(bob, 'sphere', 0x2a7ab0, 0.15, 0.1, 0.2, 0, 0.12, 0, { metalness: 0.5, roughness: 0.3 });
      add(bob, 'box', 0x1a4a70, 0.01, 0.1, 0.38, 0, 0.17, 0);
      head.position.set(0, 0.1, 0.19);
      add(head, 'sphere', 0x1a1a22, 0.08, 0.06, 0.07, 0, 0, 0);
      for (const x of [-0.04, 0.04]) {
        const ant = add(head, 'cyl', 0x1a1a22, 0.008, 0.12, 0.008, x, 0.06, 0.04);
        ant.rotation.x = 0.6;
      }
      for (let k = 0; k < 3; k++) for (const s of [-1, 1]) {
        const leg = add(bob, 'cyl', 0x1a1a22, 0.012, 0.14, 0.012, s * 0.15, 0.05, -0.08 + k * 0.08);
        leg.rotation.z = s * 1.0;
      }
      break;
    }
    case 'bat': {
      add(bob, 'sphere', 0x4a3a5a, 0.1, 0.12, 0.1, 0, 0, 0);
      head.position.set(0, 0.13, 0.02);
      add(head, 'sphere', 0x5a4a6a, 0.08, 0.075, 0.08, 0, 0, 0);
      for (const x of [-0.05, 0.05]) {
        const ear = add(head, 'cone', 0x5a4a6a, 0.03, 0.08, 0.03, x, 0.08, 0);
        ear.rotation.z = -x * 4;
        eye(head, x * 0.8, 0.01, 0.06, 0.02);
      }
      for (const s of [-1, 1]) {
        const wing = new THREE.Group();
        wing.name = s < 0 ? 'wingL' : 'wingR';
        wing.position.x = s * 0.08;
        bob.add(wing);
        add(wing, 'box', 0x3a2a4a, 0.3, 0.01, 0.18, s * 0.15, 0, 0);
      }
      break;
    }
    case 'owl': {
      add(bob, 'sphere', 0x8a6a48, 0.17, 0.22, 0.16, 0, 0.22, 0);
      add(bob, 'sphere', 0xe8d8b8, 0.11, 0.14, 0.06, 0, 0.18, 0.12);
      head.position.set(0, 0.44, 0);
      add(head, 'sphere', 0x8a6a48, 0.15, 0.12, 0.14, 0, 0, 0);
      add(head, 'disc', 0xf0e4c8, 0.11, 1, 0.08, 0, 0, 0.13).rotation.x = Math.PI / 2;
      for (const x of [-0.055, 0.055]) {
        eye(head, x, 0.01, 0.13, 0.045);
        const tuft = add(head, 'cone', 0x6a4a30, 0.03, 0.08, 0.03, x * 1.6, 0.11, 0);
        tuft.rotation.z = -x * 6;
      }
      const beak = add(head, 'cone', 0xe8a83a, 0.02, 0.05, 0.02, 0, -0.035, 0.15);
      beak.rotation.x = Math.PI;
      break;
    }
    case 'foxcub': {
      add(bob, 'sphere', 0xe8782e, 0.15, 0.14, 0.24, 0, 0.18, 0);
      add(bob, 'sphere', 0xfaf0e0, 0.1, 0.1, 0.1, 0, 0.16, 0.16);
      for (const [x, z] of [[-0.08, 0.12], [0.08, 0.12], [-0.08, -0.12], [0.08, -0.12]]) add(bob, 'cyl', 0x3a2a22, 0.03, 0.1, 0.03, x, 0.05, z);
      head.position.set(0, 0.32, 0.18);
      add(head, 'sphere', 0xe8782e, 0.12, 0.11, 0.11, 0, 0, 0);
      const snout = add(head, 'cone', 0xfaf0e0, 0.05, 0.1, 0.05, 0, -0.03, 0.12);
      snout.rotation.x = Math.PI / 2;
      add(head, 'sphere', 0x111111, 0.02, 0.02, 0.02, 0, -0.03, 0.17, { basic: true });
      for (const x of [-0.07, 0.07]) {
        add(head, 'cone', 0xe8782e, 0.04, 0.1, 0.03, x, 0.12, 0);
        eye(head, x * 0.7, 0.02, 0.09, 0.022);
      }
      const tail = new THREE.Group();
      tail.name = 'tail';
      tail.position.set(0, 0.2, -0.22);
      bob.add(tail);
      add(tail, 'sphere', 0xe8782e, 0.08, 0.08, 0.16, 0, 0.04, -0.1);
      add(tail, 'sphere', 0xfaf0e0, 0.05, 0.05, 0.06, 0, 0.05, -0.24);
      break;
    }
  }
  root.scale.setScalar(1.3); // DECISION (Claude): same readability boost as the moles
  return root;
}

export { PALETTE };

// ---------------------------------------------------------------------------
// Treasures (draft 4). One small model per kind in world.js TREASURES, about 0.35 tall,
// base at y = 0. DECISION (Claude): whimsical finds a child would love to collect.
// ---------------------------------------------------------------------------
const GOLD = { metalness: 0.6, roughness: 0.3, emissive: 0x5a3a00, emissiveIntensity: 0.4 };

export function makeTreasure(kind) {
  const g = new THREE.Group();
  g.name = 'treasure-' + kind;
  const add = (shape, color, sx, sy, sz, x, y, z, extra) => {
    const m = new THREE.Mesh(G[shape], mat(color, extra));
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  switch (kind) {
    case 'crown':
      add('cyl', 0xf4c430, 0.15, 0.1, 0.15, 0, 0.05, 0, GOLD);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        add('cone', 0xf4c430, 0.035, 0.12, 0.035, Math.cos(a) * 0.13, 0.15, Math.sin(a) * 0.13, GOLD);
        add('sphere', k % 2 ? 0xe83a3a : 0x3a8ae8, 0.025, 0.025, 0.025, Math.cos(a) * 0.15, 0.06, Math.sin(a) * 0.15);
      }
      break;
    case 'goblet':
      add('cyl', 0xf4c430, 0.08, 0.02, 0.08, 0, 0.01, 0, GOLD);
      add('cyl', 0xf4c430, 0.02, 0.14, 0.02, 0, 0.09, 0, GOLD);
      add('hemi', 0xf4c430, 0.1, 0.14, 0.1, 0, 0.3, 0, GOLD).rotation.x = Math.PI; // dome flipped = cup
      add('sphere', 0xe83a3a, 0.025, 0.025, 0.025, 0, 0.24, 0.09);
      break;
    case 'teapot':
      add('sphere', 0x5ab8c8, 0.13, 0.11, 0.13, 0, 0.11, 0);
      add('sphere', 0x5ab8c8, 0.04, 0.03, 0.04, 0, 0.23, 0);
      add('cone', 0x5ab8c8, 0.03, 0.12, 0.03, 0.15, 0.15, 0).rotation.z = -0.9;
      add('cyl', 0x5ab8c8, 0.02, 0.1, 0.02, -0.14, 0.12, 0);
      break;
    case 'boot':
      add('box', 0x6a3a22, 0.1, 0.22, 0.1, 0, 0.11, 0);
      add('box', 0x6a3a22, 0.1, 0.07, 0.2, 0, 0.035, 0.06);
      add('box', 0x3a2214, 0.11, 0.02, 0.21, 0, 0.005, 0.06);
      break;
    case 'bone':
      add('cyl', 0xf4ecd8, 0.035, 0.32, 0.035, 0, 0.06, 0).rotation.z = Math.PI / 2;
      for (const s of [-1, 1]) {
        add('sphere', 0xf4ecd8, 0.05, 0.05, 0.05, s * 0.16, 0.08, 0.03);
        add('sphere', 0xf4ecd8, 0.05, 0.05, 0.05, s * 0.16, 0.05, -0.03);
      }
      break;
    case 'egg':
      add('sphere', 0x9ae8d8, 0.1, 0.14, 0.1, 0, 0.14, 0, { emissive: 0x2a6a5a, emissiveIntensity: 0.4 });
      add('sphere', 0xf4c430, 0.102, 0.03, 0.102, 0, 0.13, 0, GOLD);
      break;
    case 'key':
      add('cyl', 0xf4c430, 0.025, 0.24, 0.025, 0, 0.18, 0, GOLD);
      add('cyl', 0xf4c430, 0.07, 0.02, 0.07, 0, 0.33, 0, GOLD).rotation.x = Math.PI / 2;
      add('box', 0xf4c430, 0.06, 0.03, 0.02, 0.04, 0.08, 0, GOLD);
      add('box', 0xf4c430, 0.04, 0.03, 0.02, 0.03, 0.12, 0, GOLD);
      break;
    case 'rocket':
      add('cyl', 0xf0f0f0, 0.06, 0.24, 0.06, 0, 0.17, 0);
      add('cone', 0xe83a3a, 0.06, 0.1, 0.06, 0, 0.34, 0);
      add('sphere', 0x3a8ae8, 0.025, 0.025, 0.01, 0, 0.2, 0.06);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        add('box', 0xe83a3a, 0.02, 0.08, 0.06, Math.cos(a) * 0.07, 0.06, Math.sin(a) * 0.07).rotation.y = -a;
      }
      break;
    case 'pearl':
      add('hemi', 0xe8b8c8, 0.16, 0.06, 0.13, 0, 0.0, 0);
      add('hemi', 0xe8b8c8, 0.16, 0.06, 0.13, 0, 0.16, -0.08).rotation.x = -2.2;
      add('sphere', 0xfaf6f0, 0.07, 0.07, 0.07, 0, 0.08, 0.02, { roughness: 0.2, emissive: 0x4a4a4a, emissiveIntensity: 0.3 });
      break;
    case 'duck':
      add('sphere', 0xf4d43a, 0.12, 0.09, 0.15, 0, 0.09, 0);
      add('sphere', 0xf4d43a, 0.07, 0.07, 0.07, 0, 0.2, 0.07);
      add('cone', 0xf08a2a, 0.025, 0.06, 0.02, 0, 0.19, 0.15).rotation.x = Math.PI / 2;
      break;
    case 'teddy':
      add('sphere', 0xa8743a, 0.1, 0.12, 0.09, 0, 0.11, 0);
      add('sphere', 0xa8743a, 0.08, 0.08, 0.08, 0, 0.28, 0);
      for (const s of [-1, 1]) {
        add('sphere', 0xa8743a, 0.03, 0.03, 0.02, s * 0.06, 0.35, 0);
        add('sphere', 0xa8743a, 0.035, 0.05, 0.035, s * 0.1, 0.14, 0.03);
      }
      add('sphere', 0xe8c890, 0.035, 0.025, 0.025, 0, 0.26, 0.07);
      break;
    case 'bell':
      add('hemi', 0xf4c430, 0.12, 0.2, 0.12, 0, 0.04, 0, GOLD);
      add('sphere', 0xc89a2a, 0.03, 0.03, 0.03, 0, 0.03, 0);
      add('cyl', 0xf4c430, 0.012, 0.06, 0.012, 0, 0.27, 0, GOLD);
      break;
    case 'star':
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        const arm = add('cone', 0xfff07a, 0.05, 0.14, 0.03, Math.sin(a) * 0.07, 0.2 + Math.cos(a) * 0.07, 0, { emissive: 0x8a7a00, emissiveIntensity: 0.6 });
        arm.rotation.z = -a;
      }
      add('sphere', 0xfff07a, 0.06, 0.06, 0.03, 0, 0.2, 0, { emissive: 0x8a7a00, emissiveIntensity: 0.6 });
      add('cyl', 0x6a6a7a, 0.012, 0.1, 0.012, 0, 0.05, 0);
      break;
    case 'horn':
      add('cyl', 0xf4c430, 0.02, 0.26, 0.02, 0, 0.1, 0, GOLD).rotation.z = Math.PI / 2;
      add('cone', 0xf4c430, 0.08, 0.12, 0.08, 0.17, 0.1, 0, GOLD).rotation.z = Math.PI / 2;
      add('cyl', 0xf4c430, 0.04, 0.02, 0.04, -0.13, 0.1, 0, GOLD).rotation.z = Math.PI / 2;
      break;
    case 'bottle': {
      const glass = new THREE.MeshStandardMaterial({ color: 0x9ad8c8, transparent: true, opacity: 0.45, roughness: 0.1 });
      const b = new THREE.Mesh(G.sphere, glass);
      b.scale.set(0.16, 0.08, 0.08);
      b.position.y = 0.08;
      g.add(b);
      add('cyl', 0x9a6a3a, 0.025, 0.06, 0.025, 0.19, 0.08, 0).rotation.z = Math.PI / 2;
      add('box', 0x8a5a33, 0.12, 0.03, 0.04, 0, 0.05, 0);
      add('box', 0xf4ecd8, 0.005, 0.07, 0.05, 0, 0.09, 0);
      break;
    }
    case 'robot':
      add('box', 0x9aa3ad, 0.14, 0.14, 0.1, 0, 0.1, 0, { metalness: 0.4, roughness: 0.4 });
      add('box', 0x9aa3ad, 0.1, 0.08, 0.08, 0, 0.22, 0, { metalness: 0.4, roughness: 0.4 });
      add('sphere', 0x7ff0ff, 0.018, 0.018, 0.01, -0.025, 0.23, 0.04, { emissive: 0x3a9aaa, emissiveIntensity: 0.8 });
      add('sphere', 0x7ff0ff, 0.018, 0.018, 0.01, 0.025, 0.23, 0.04, { emissive: 0x3a9aaa, emissiveIntensity: 0.8 });
      add('cyl', 0x6a6a7a, 0.008, 0.06, 0.008, 0, 0.29, 0);
      add('sphere', 0xe83a3a, 0.02, 0.02, 0.02, 0, 0.33, 0);
      break;
  }
  return g;
}

// A stone pedestal for the treasure ring. The treasure sits on top at y = PEDESTAL_TOP.
export const PEDESTAL_TOP = 0.42;
export function makePedestal() {
  const g = new THREE.Group();
  g.name = 'pedestal';
  const stone = mat(0x8a8274);
  const base = new THREE.Mesh(G.box, stone);
  base.scale.set(0.34, 0.06, 0.34);
  base.position.y = 0.03;
  g.add(base);
  const col = new THREE.Mesh(G.cyl, stone);
  col.scale.set(0.1, 0.3, 0.1);
  col.position.y = 0.21;
  g.add(col);
  const top = new THREE.Mesh(G.box, mat(0xa89c88));
  top.scale.set(0.3, 0.05, 0.3);
  top.position.y = PEDESTAL_TOP - 0.025;
  g.add(top);
  return g;
}

// ---------------------------------------------------------------------------
// Draft 5: final forms and thought bubbles.
// ---------------------------------------------------------------------------
// Size per growth stage (baby, grown-up, final). DECISION (Claude)
export const STAGE_SCALE = [0.65, 1.0, 1.15];

// Dress a visitor model up in its final form. DECISION (Claude, proposed to Felix): a crowned frog,
// flowery snail, apple-carrying hedgehog, owl with spectacles and a book, fluffy-tailed fox,
// golden beetle, glowing bat.
export function addFinalForm(root, kind) {
  const bob = root.getObjectByName('bob');
  const head = root.getObjectByName('head');
  const add = (parent, shape, color, sx, sy, sz, x, y, z, extra) => {
    const m = new THREE.Mesh(G[shape], mat(color, extra));
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  switch (kind) {
    case 'frog':
      add(head, 'cyl', 0xf4c430, 0.07, 0.04, 0.07, 0, 0.08, 0, GOLD);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        add(head, 'cone', 0xf4c430, 0.018, 0.05, 0.018, Math.cos(a) * 0.055, 0.12, Math.sin(a) * 0.055, GOLD);
      }
      break;
    case 'snail':
      for (let k = 0; k < 3; k++) {
        const x = (k - 1) * 0.07;
        add(bob, 'cyl', 0x5aae3a, 0.008, 0.08, 0.008, x, 0.39, -0.05 + (k % 2) * 0.04);
        add(bob, 'sphere', [0xf4a6c8, 0xfff07a, 0xd8a0ff][k], 0.035, 0.025, 0.035, x, 0.44, -0.05 + (k % 2) * 0.04);
      }
      break;
    case 'hedgehog':
      for (const [x, z] of [[-0.08, -0.05], [0.07, 0.02], [0, -0.14]]) {
        add(bob, 'sphere', 0xd8302a, 0.05, 0.05, 0.05, x, 0.31, z);
        add(bob, 'cyl', 0x5a3a1a, 0.006, 0.03, 0.006, x, 0.37, z);
      }
      break;
    case 'owl': {
      for (const x of [-0.055, 0.055]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.008, 6, 16), mat(0x3a2a20));
        ring.position.set(x, 0.01, 0.16);
        head.add(ring);
      }
      add(bob, 'box', 0x8a2a2a, 0.16, 0.12, 0.03, 0, 0.16, 0.17).rotation.x = -0.4; // a book held in front
      add(bob, 'box', 0xf4ecd8, 0.14, 0.1, 0.02, 0, 0.165, 0.175).rotation.x = -0.4;
      break;
    }
    case 'foxcub': {
      const tail = root.getObjectByName('tail');
      if (tail) tail.scale.setScalar(1.8);
      break;
    }
    case 'beetle':
      bob.traverse((o) => {
        if (!o.isMesh) return;
        const hex = o.material.color.getHex(); // the colour as one number, e.g. 0x2a7ab0
        if (hex === 0x2a7ab0) o.material.color.set(0xf4c430);
        if (hex === 0x1a4a70) o.material.color.set(0xc89a2a);
        if (o.material.emissive) o.material.emissive.set(0x5a3a00);
      });
      break;
    case 'bat':
      bob.traverse((o) => {
        if (o.isMesh && o.material.emissive) {
          o.material.emissive.set(0x7a4ad0);
          o.material.emissiveIntensity = 0.9;
        }
      });
      break;
  }
}

// A thought bubble showing the room type a visitor needs but can't find. Unlit, so it reads clearly.
// DECISION (Claude): a picture, not words, so a five-year-old can tell what the creature wants.
export function makeThoughtBubble(typeKey) {
  const g = new THREE.Group();
  g.name = 'bubble';
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
  const blob = (s, x, y) => {
    const m = new THREE.Mesh(G.sphere, white);
    m.scale.set(s, s * 0.85, s * 0.5);
    m.position.set(x, y, 0);
    g.add(m);
  };
  blob(0.2, 0, 0.2);
  blob(0.05, -0.12, 0.0);
  blob(0.03, -0.17, -0.07);
  const icon = makeRoomIcon(typeKey);
  icon.position.set(0, 0.17, 0.11);
  g.add(icon);
  return g;
}

// The picture for a room type, facing +z, about 0.18 across. Used by thought bubbles, the lever
// fan and lever signs, so the same picture always means the same room (draft 8).
export function makeRoomIcon(typeKey) {
  const icon = new THREE.Group();
  icon.name = 'icon-' + typeKey;
  const add = (shape, color, sx, sy, sz, x, y, z) => {
    const m = new THREE.Mesh(G[shape], new THREE.MeshBasicMaterial({ color }));
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    icon.add(m);
    return m;
  };
  switch (typeKey) {
    case 'garden':
      add('cyl', 0xf0e2c8, 0.025, 0.08, 0.025, 0, -0.02, 0);
      add('hemi', 0xd8453b, 0.08, 0.06, 0.03, 0, 0.02, 0);
      break;
    case 'pond':
      add('sphere', 0x3aa0d8, 0.06, 0.07, 0.03, 0, -0.01, 0);
      add('cone', 0x3aa0d8, 0.04, 0.07, 0.02, 0, 0.07, 0);
      break;
    case 'nap':
      add('box', 0xfaf3e6, 0.12, 0.05, 0.03, 0, 0.03, 0);
      add('box', 0x6aa2d8, 0.14, 0.06, 0.03, 0, -0.03, 0.005);
      break;
    case 'kitchen':
      add('cyl', 0x2a2426, 0.07, 0.08, 0.03, 0, 0, 0).rotation.x = Math.PI / 2;
      add('cone', 0xff7a2a, 0.03, 0.06, 0.02, 0, -0.08, 0);
      break;
    case 'grotto':
      add('gem', 0x7fe8ff, 0.04, 0.09, 0.03, 0, 0, 0);
      break;
    case 'map':
      add('box', 0xe8d9b0, 0.14, 0.1, 0.01, 0, 0, 0);
      add('sphere', 0xd83a3a, 0.015, 0.015, 0.01, 0.03, 0.01, 0.01);
      break;
  }
  return icon;
}

// One button of the lever fan: a round white plate with the room's picture. Part 'ring' lights up
// for the room's current type and on hover. DECISION (Claude): plate size and colours.
export function makeFanButton(typeKey) {
  const g = new THREE.Group();
  g.name = 'fan-' + typeKey;
  const ring = new THREE.Mesh(new THREE.CircleGeometry(0.25, 28), new THREE.MeshBasicMaterial({ color: 0xf4c430 }));
  ring.name = 'ring';
  g.add(ring);
  const plate = new THREE.Mesh(new THREE.CircleGeometry(0.21, 28), new THREE.MeshBasicMaterial({ color: 0xfffaf0 }));
  plate.position.z = 0.005;
  g.add(plate);
  const icon = makeRoomIcon(typeKey);
  icon.scale.setScalar(1.5);
  icon.position.z = 0.03;
  g.add(icon);
  return g;
}

// A small round sign above a lever showing the room's current type. Rebuilt when the type changes.
export function makeLeverSign(typeKey) {
  const g = new THREE.Group();
  g.name = 'sign';
  const plate = new THREE.Mesh(new THREE.CircleGeometry(0.16, 24), new THREE.MeshBasicMaterial({ color: 0xfffaf0 }));
  g.add(plate);
  const rim = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.19, 24), new THREE.MeshBasicMaterial({ color: 0x5a4030 }));
  g.add(rim);
  const icon = makeRoomIcon(typeKey);
  icon.position.z = 0.02;
  g.add(icon);
  return g;
}
