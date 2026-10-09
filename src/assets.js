// assets.js — what things look like (with props.js, which holds rooms, levers, portal and visitors).
//
// Right now every model is a placeholder built from simple shapes in code.
// To swap in Blender art later, replace a builder below with a loaded glTF model
// that follows the same conventions — nothing else in the game needs to change:
//
//   • 1 world unit = 1 tile. Tiles are 1 × 1, walls are BLOCK_H tall.
//   • Every model is centred on its tile, with its base at y = 0.
//   • Models face +z ("forward").
//   • The mole has parts with exactly these names, because the animation code
//     moves them by name: body, head, hat, snout, armL, armR, pickaxe, cargo, stars.
//     (armL/armR are pivot groups at the shoulder; pickaxe hangs off armR.)

import * as THREE from 'three';

export const BLOCK_H = 1.15; // DECISION (Claude): walls a little taller than wide, for the DK look.

// DECISION (Claude): toy-like palette — warm earth, cool hard rock, yellow mining hats.
export const PALETTE = {
  dirt: 0x7a5236,
  hard: 0x56607a,
  ore: 0x4a3d52,
  oreGem: 0xffc94a,
  border: 0x2a2128,
  stone: 0x9a8f80, // dressed walls
  trim: 0xc9bca6, // decorated wall trim
  floor: 0x3e2c25,
  paving: 0x6a5e58, // paved floor outside rooms (draft 3). DECISION (Claude)
  road: 0x9a8670, // road cobbles, two tones in a checker
  road2: 0x8a7662,
  base: 0x140e12,
  moleFur: 0x6c5a6e,
  molePink: 0xf0a3ad,
  hat: 0xf4c430,
  lamp: 0xfff2b0,
  pick: 0x9aa3ad,
  handle: 0x8a5a33,
  burrow: 0x5e3f2b,
  lantern: 0xffb04d,
  mark: 0xffd84a,
};

// One shared geometry per shape: Three.js can draw thousands of meshes from the same
// geometry object, which saves memory. (A "geometry" is the shape; a "material" is how
// its surface looks; a Mesh pairs the two.)
const G = {
  sphere: new THREE.SphereGeometry(1, 14, 10), // radius, width segments, height segments
  hemi: new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), // top half only
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10), // top radius, bottom radius, height, segments
  cone: new THREE.ConeGeometry(1, 1, 10),
  box: new THREE.BoxGeometry(1, 1, 1),
  gem: new THREE.OctahedronGeometry(1, 0),
  disc: new THREE.CylinderGeometry(1, 1, 0.02, 20), // a thin flat round (rugs, lily pads)
};

// MeshStandardMaterial reacts to lights realistically (roughness/metalness).
// flatShading: true gives the faceted, low-poly look we want.
function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, flatShading: true, ...extra });
}

function part(geom, material, name, sx, sy, sz, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geom, material);
  m.name = name;
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = false;
  return m;
}

// ---------------------------------------------------------------------------
// Mole: built from rigid parts, animated in code (DECISION Claude, brief: no skeletal rig).
// `ghost: true` makes a see-through version for the burrow's "next mole" outline.
// ---------------------------------------------------------------------------
export function makeMole({ ghost = false } = {}) {
  const mk = (color, extra) =>
    ghost
      ? new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.18, wireframe: true })
      : mat(color, extra);

  const fur = mk(PALETTE.moleFur);
  const pink = mk(PALETTE.molePink);
  const hatM = mk(PALETTE.hat, { roughness: 0.5 });
  const lampM = ghost ? mk() : new THREE.MeshBasicMaterial({ color: PALETTE.lamp });
  const pickM = mk(PALETTE.pick, { metalness: 0.3, roughness: 0.5 });
  const handleM = mk(PALETTE.handle);
  const eyeM = ghost ? mk() : new THREE.MeshBasicMaterial({ color: 0x1a1018 });

  const root = new THREE.Group(); // a Group is an invisible container; moving it moves its children.
  root.name = 'mole';

  // The "rig": everything above the feet hangs off `bob`, so a single value makes the mole hop.
  const bob = new THREE.Group();
  bob.name = 'bob';
  root.add(bob);

  const body = part(G.sphere, fur, 'body', 0.2, 0.22, 0.21, 0, 0.22, 0);
  bob.add(body);
  bob.add(part(G.sphere, pink, 'belly', 0.13, 0.15, 0.06, 0, 0.2, 0.17));
  bob.add(part(G.sphere, pink, 'footL', 0.07, 0.04, 0.09, -0.1, 0.03, 0.06));
  bob.add(part(G.sphere, pink, 'footR', 0.07, 0.04, 0.09, 0.1, 0.03, 0.06));

  const head = new THREE.Group();
  head.name = 'head';
  head.position.set(0, 0.46, 0.04);
  bob.add(head);
  head.add(part(G.sphere, fur, 'skull', 0.16, 0.15, 0.16));
  const snout = part(G.cone, fur, 'snout', 0.07, 0.14, 0.07, 0, -0.02, 0.18);
  snout.rotation.x = Math.PI / 2; // cones point up by default; tip it forward
  head.add(snout);
  head.add(part(G.sphere, pink, 'nose', 0.045, 0.04, 0.04, 0, -0.02, 0.26));
  head.add(part(G.sphere, eyeM, 'eyeL', 0.022, 0.022, 0.015, -0.065, 0.03, 0.135));
  head.add(part(G.sphere, eyeM, 'eyeR', 0.022, 0.022, 0.015, 0.065, 0.03, 0.135));

  const hat = new THREE.Group();
  hat.name = 'hat';
  hat.position.set(0, 0.05, 0);
  head.add(hat);
  hat.add(part(G.hemi, hatM, 'dome', 0.165, 0.15, 0.165));
  hat.add(part(G.cyl, hatM, 'brim', 0.2, 0.02, 0.2, 0, 0.005, 0.02));
  hat.add(part(G.sphere, lampM, 'lamp', 0.04, 0.04, 0.03, 0, 0.07, 0.15));

  // Arms: pivot at the shoulder so rotation.x swings the whole arm.
  const armL = new THREE.Group();
  armL.name = 'armL';
  armL.position.set(-0.19, 0.3, 0.02);
  bob.add(armL);
  armL.add(part(G.cyl, fur, 'upperL', 0.045, 0.16, 0.045, 0, -0.07, 0.03));
  armL.add(part(G.sphere, pink, 'pawL', 0.055, 0.04, 0.06, 0, -0.15, 0.05));

  const armR = new THREE.Group();
  armR.name = 'armR';
  armR.position.set(0.19, 0.3, 0.02);
  bob.add(armR);
  armR.add(part(G.cyl, fur, 'upperR', 0.045, 0.16, 0.045, 0, -0.07, 0.03));
  armR.add(part(G.sphere, pink, 'pawR', 0.055, 0.04, 0.06, 0, -0.15, 0.05));

  const pickaxe = new THREE.Group();
  pickaxe.name = 'pickaxe';
  pickaxe.position.set(0, -0.15, 0.06);
  armR.add(pickaxe);
  const handle = part(G.cyl, handleM, 'handle', 0.018, 0.36, 0.018, 0, 0, 0.12);
  handle.rotation.x = Math.PI / 2; // cylinders stand upright by default; lay the handle forward
  pickaxe.add(handle);
  const blade = part(G.box, pickM, 'blade', 0.03, 0.26, 0.05, 0, 0, 0.29);
  pickaxe.add(blade);

  // Ore nugget carried on the head (hidden until carrying).
  const cargo = part(G.gem, mat(PALETTE.oreGem, { emissive: 0x8a5a00, emissiveIntensity: 0.6 }), 'cargo', 0.09, 0.11, 0.09, 0, 0.82, 0);
  cargo.visible = false;
  if (!ghost) bob.add(cargo);

  // "Seeing stars" after a slap (hidden until slapped).
  const stars = new THREE.Group();
  stars.name = 'stars';
  stars.position.set(0, 0.78, 0);
  stars.visible = false;
  const starM = new THREE.MeshBasicMaterial({ color: 0xfff27a });
  for (let k = 0; k < 3; k++) {
    const s = part(G.gem, starM, 'star' + k, 0.045, 0.045, 0.045);
    const a = (k / 3) * Math.PI * 2;
    s.position.set(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2);
    stars.add(s);
  }
  if (!ghost) bob.add(stars);

  // DECISION (Claude): moles are drawn at 1.25× so they read clearly from the camera height.
  root.scale.setScalar(1.25);
  return root;
}

// Order in which the burrow's "next mole" outline fills in.
export const MOLE_BUILD_ORDER = ['body', 'head', 'armL', 'armR', 'hat', 'pickaxe'];

// ---------------------------------------------------------------------------
// Burrow: an earth mound with a dark entrance.
// ---------------------------------------------------------------------------
export function makeBurrow() {
  const g = new THREE.Group();
  g.name = 'burrow';
  const earth = mat(PALETTE.burrow);
  const mound = part(G.hemi, earth, 'mound', 0.95, 0.55, 0.95);
  g.add(mound);
  const rim = part(G.cyl, mat(0x4a3022), 'rim', 0.42, 0.06, 0.32, 0, 0.12, 0.72);
  rim.rotation.x = Math.PI / 2.4;
  g.add(rim);
  const hole = part(G.cyl, new THREE.MeshBasicMaterial({ color: 0x0a0608 }), 'hole', 0.32, 0.03, 0.24, 0, 0.13, 0.76);
  hole.rotation.x = Math.PI / 2.4;
  g.add(hole);
  // A little sign post with a lamp, so the burrow is the warm heart of the cave.
  g.add(part(G.cyl, mat(PALETTE.handle), 'post', 0.03, 0.9, 0.03, 0.75, 0.45, 0.5));
  g.add(part(G.sphere, new THREE.MeshBasicMaterial({ color: PALETTE.lantern }), 'lamp', 0.08, 0.1, 0.08, 0.75, 0.95, 0.5));
  return g;
}

export const shared = { G, mat };
