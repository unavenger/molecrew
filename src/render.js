// render.js — draws the world and the moles with Three.js. Reads the sim, never changes it.
//
// Flow:
//   new Renderer(canvas, world, sim)  → builds the scene once
//   renderer.frame(dt)                → each animation frame:
//       if world.version changed → rebuildTiles()     (walls, floor, marks, lanterns)
//       shakeDiggingTiles()                           (tiles being dug wobble and shrink)
//       consumeEvents()                               (dust, sparks, pops from sim.events)
//       syncMoles(dt)                                 (position + animation per mole)
//       updateBurrow(dt)                              (next-mole outline, ore pile)
//       updateParticles(dt), updateLanternLights()
//       three.render(scene, camera)
//   Draft 2, also each frame:
//       if sim.roomsVersion changed → rebuildRooms()  (room props, floor colours, levers)
//       animateLevers(dt), updatePortal(dt), syncVisitors(dt)
//   Draft 4: twinkleTreasureTiles() (hint on blocks hiding a treasure), updateTreasureRing(dt)
//   Draft 8: updateLeverSigns() (icon above each lever), updateFan(dt) (the open lever fan)
//   pickTile() / pickMole() / pickLever() / pickVisitor() → used by input.js to find what's under the hand

import * as THREE from 'three';
import { T, DIRS, TREASURES as TREASURE_KEYS } from './world.js';
import { CONFIG } from './config.js';
import { hash2 } from './rng.js';
import { BLOCK_H, PALETTE, makeMole, makeBurrow, MOLE_BUILD_ORDER, shared } from './assets.js';
import {
  ROOM_FLOOR, buildRoomProps, makeLever, makePortal, makeVisitor, makeTreasure, makePedestal, PEDESTAL_TOP,
  STAGE_SCALE, addFinalForm, makeThoughtBubble, makeFanButton, makeLeverSign,
} from './props.js';
import { ROOM_TYPES } from './rooms.js';

// Draft 5: little particles for what a visitor is doing in a room it needs. DECISION (Claude)
const ACTIVITY_FX = {
  garden: { color: 0x7ac46a, up: 0.8 }, // nibbling greens
  pond: { color: 0x7ac8f0, up: 1.6 }, // splashes
  nap: { color: 0xffffff, up: 0.5 }, // floating z's
  kitchen: { color: 0xc8904a, up: 0.9 }, // crumbs
  grotto: { color: 0x9af0ff, up: 0.7 }, // sparkles
  map: { color: 0xf0e2c0, up: 0.6 }, // page flicks
};
// Group moment particles per kind: frogs sing notes, bats snooze, owls read, others share hearts.
const GROUP_FX = { frog: 0xffe066, bat: 0xffffff, owl: 0xf0e2c0 };
const HEART = 0xff7aa8;

const { G, mat } = shared;
const tmpM = new THREE.Matrix4(); // a 4x4 matrix stores position + rotation + scale in one object
const tmpQ = new THREE.Quaternion(); // a quaternion stores a rotation
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const ZERO_Q = new THREE.Quaternion();
const MARK_TINT = new THREE.Color(0xffd84a);
const tmpE = new THREE.Euler(); // an Euler stores a rotation as three angles (x, y, z)
const PROP_CAP = 5000; // max pieces per prop shape

// Tile categories, each drawn by one InstancedMesh.
const CAT = { NONE: 0, DIRT: 1, HARD: 2, ORE: 3, BORDER: 4, STONE: 5 };

export class Renderer {
  // `three` is a THREE.WebGLRenderer made once in main.js and reused for every new cave.
  constructor(three, world, sim) {
    this.world = world;
    this.sim = sim;
    this.time = 0;
    this.three = three;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x110c12);
    // Fog fades very distant tiles into the background. DECISION (Claude): it starts far beyond
    // the playing view, so it adds depth without ever hiding what the player looks at.
    this.scene.fog = new THREE.Fog(0x110c12, 40, 70);

    // PerspectiveCamera(field of view in degrees, aspect ratio, near clip, far clip)
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.focus = { x: sim.focus.x, y: sim.focus.y };
    this.zoom = 15; // camera distance; DECISION (Claude): ~55° look-down angle like DK2.
    this.raycaster = new THREE.Raycaster(); // finds what a screen point "hits" in 3D

    this.buildLights();
    this.buildStaticGround();
    this.buildTileMeshes();
    this.buildParticles();
    this.buildBurrow();
    this.buildHover();

    this.moleViews = new Map(); // mole id → { root, parts, lastX, lastY, swingCycle, spawnT }
    this.seenVersion = -1;

    // Draft 2
    this.propMats = {
      lit: mat(0xffffff),
      glow: new THREE.MeshBasicMaterial({ color: 0xffffff }), // unlit = looks like it glows by itself
      water: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.65, depthWrite: false }),
    };
    this.propBatches = new Map(); // "shape:material" → { mesh, n }
    this.leverViews = new Map(); // room id → { group, arm, post, pulls, pullT, pos }
    this.visitorViews = new Map();
    this.seenRooms = -1;
    this.buildPortal();
    this.resize();
  }

  // ---------------------------------------------------------------- setup
  buildLights() {
    // HemisphereLight: soft light from above (sky colour) and below (ground colour) — the cave's base mood.
    this.scene.add(new THREE.HemisphereLight(0x8f80b0, 0x2a1a12, 1.1));
    // DirectionalLight: parallel rays like moonlight, gives blocks readable faces.
    const sun = new THREE.DirectionalLight(0xb8c4ff, 0.9);
    sun.position.set(-12, 30, 8);
    this.scene.add(sun);
    // The burrow glows warm: the heart of the cave.
    const b = this.sim.burrow;
    this.burrowLight = new THREE.PointLight(0xffa850, 18, 10, 1.4); // colour, intensity, range, falloff
    this.burrowLight.position.set(b.x + 0.5, 2.2, b.y + 0.8);
    this.scene.add(this.burrowLight);
    // DECISION (Claude): a small pool of real lights follows the lanterns nearest the camera.
    // Every lantern also glows on its own; real lights are expensive, so only 6 cast light.
    this.lanternLights = [];
    for (let k = 0; k < 6; k++) {
      const l = new THREE.PointLight(PALETTE.lantern, 0, 5.5, 1.4);
      this.scene.add(l);
      this.lanternLights.push(l);
    }
  }

  buildStaticGround() {
    const { W, H } = this.world;
    // A dark base under the whole map, so gaps never show the background.
    const base = new THREE.Mesh(new THREE.PlaneGeometry(W + 8, H + 8), mat(PALETTE.base));
    base.rotation.x = -Math.PI / 2; // planes are vertical by default; lay it flat
    base.position.set(W / 2, -0.01, H / 2);
    this.scene.add(base);
  }

  // InstancedMesh draws one shape many times in a single draw call — ideal for ~1500 wall blocks.
  instanced(geom, material, count) {
    const m = new THREE.InstancedMesh(geom, material, count);
    m.frustumCulled = false; // DECISION (Claude): instances span the map; skip culling so none vanish
    m.setColorAt(0, tmpC.set(0xffffff)); // creates the per-instance colour buffer...
    m.instanceColor.array.fill(1); // ...which starts black; make every instance white (= use the material colour)
    m.count = 0;
    this.scene.add(m);
    return m;
  }

  buildTileMeshes() {
    const n = this.world.W * this.world.H;
    this.cat = new Uint8Array(n); // which category mesh holds each tile
    this.inst = new Int32Array(n).fill(-1); // instance index within that mesh
    this.meshes = {
      [CAT.DIRT]: this.instanced(G.box, mat(0xffffff), n),
      [CAT.HARD]: this.instanced(G.box, mat(0xffffff, { roughness: 0.7 }), n),
      [CAT.ORE]: this.instanced(G.box, mat(0xffffff), n),
      [CAT.BORDER]: this.instanced(G.box, mat(0xffffff), n),
      [CAT.STONE]: this.instanced(G.box, mat(0xffffff, { roughness: 0.75 }), n),
    };
    this.floorMesh = this.instanced(G.box, mat(0xffffff), n);
    this.gemMesh = this.instanced(G.gem, mat(PALETTE.oreGem, { emissive: 0xb07000, emissiveIntensity: 0.55, roughness: 0.3 }), n * 3);
    this.trimMesh = this.instanced(G.box, mat(PALETTE.trim), n);
    this.lanternMesh = this.instanced(G.sphere, new THREE.MeshBasicMaterial({ color: PALETTE.lantern }), n);
    this.bracketMesh = this.instanced(G.box, mat(0x2b2220), n);
    // Draft 4: a twinkling star on top of blocks that hide a treasure, so the child can aim for them.
    // DECISION (Claude): treasure is visible from the start (a hunt, not a surprise).
    this.glintMesh = this.instanced(G.gem, new THREE.MeshBasicMaterial({ color: 0xfff6c0 }), 64);
    this.treasureTiles = [];

    // Marks: glowing squares on top of painted tiles. Bright = workable now, dim = waiting for a tunnel.
    const markGeo = new THREE.PlaneGeometry(0.86, 0.86);
    markGeo.rotateX(-Math.PI / 2);
    const markMat = (opacity) =>
      new THREE.MeshBasicMaterial({ color: PALETTE.mark, transparent: true, opacity, depthWrite: false });
    this.markBright = this.instanced(markGeo, markMat(0.62), n);
    // Marks the moles can't reach yet: only a pale frame, no fill, no glow.
    // DECISION (Claude, after Felix's playtest note): the difference must read at a glance,
    // so "dig now" lights up the whole block while "waiting for a tunnel" is just an outline.
    this.markDim = this.instanced(frameGeometry(0.44, 0.34), markMat(0.55), n);
    this.markDim.material.color.set(0xfff0b0);

    // Drag-box preview: shows which tiles a rectangle will mark (yellow) or unmark (red) on release.
    const selMat = (color) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false });
    this.selPaint = this.instanced(markGeo, selMat(0xfff6d0), n);
    this.selErase = this.instanced(markGeo, selMat(0xff6a5a), n);
    this.selection = null;

    // Lantern glow: Points draws a flat sprite per position; additive blending makes overlaps brighten.
    this.glowGeo = new THREE.BufferGeometry();
    this.glowPos = new Float32Array(n * 3);
    // BufferAttribute wraps a typed array as per-vertex data (here: 3 numbers = one position).
    this.glowGeo.setAttribute('position', new THREE.BufferAttribute(this.glowPos, 3));
    this.glowGeo.setDrawRange(0, 0);
    const glow = new THREE.Points(
      this.glowGeo,
      new THREE.PointsMaterial({
        size: 1.4,
        map: radialTexture(),
        color: PALETTE.lantern,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    glow.frustumCulled = false;
    this.scene.add(glow);
    this.lanterns = []; // [{x, y, z}] positions, for the light pool
  }

  buildParticles() {
    // Two pools: lit debris (dirt and stone chunks) and unlit sparks (glowy bits).
    const N = 500;
    this.debris = { mesh: this.instanced(G.box, mat(0xffffff), N), list: [] };
    this.sparks = { mesh: this.instanced(G.gem, new THREE.MeshBasicMaterial({ color: 0xffffff }), N), list: [] };
    this.debris.max = N;
    this.sparks.max = N;
  }

  buildBurrow() {
    const b = this.sim.burrow;
    this.burrowGroup = makeBurrow();
    this.burrowGroup.position.set(b.x + 0.5, 0, b.y + 0.5);
    this.scene.add(this.burrowGroup);

    // Next-mole outline: a wireframe ghost, with a solid mole whose parts appear as ore arrives.
    this.ghost = makeMole({ ghost: true });
    this.nextMole = makeMole();
    for (const m of [this.ghost, this.nextMole]) {
      m.position.set(0, 0.5, -0.05);
      m.rotation.y = 0;
      this.burrowGroup.add(m);
    }
    // Tag each mesh of the solid mole with its build step.
    this.buildParts = [];
    this.nextMole.traverse((o) => {
      // .traverse visits an object and every child, grandchild, ...
      if (!o.isMesh) return;
      let p = o;
      let step = 'body';
      while (p && p !== this.nextMole) {
        if (MOLE_BUILD_ORDER.includes(p.name)) {
          step = p.name;
          break;
        }
        p = p.parent;
      }
      this.buildParts.push({ mesh: o, order: MOLE_BUILD_ORDER.indexOf(step) });
    });
    this.nextMoleBody = this.nextMole.getObjectByName('body'); // finds a child by its name

    // Draft 4: the treasure ring — one pedestal per treasure kind, around the start room's edge.
    this.pedestals = this.sim.treasureSlots.map((s, kind) => {
      const g = makePedestal();
      g.position.set(s.x + 0.5, 0, s.y + 0.5);
      this.scene.add(g);
      return { group: g, kind, model: null, spin: 0, popT: 1, pos: new THREE.Vector3(s.x + 0.5, PEDESTAL_TOP + 0.2, s.y + 0.5) };
    });

    // Spare ore piles up beside the burrow.
    this.pileMesh = this.instanced(G.gem, mat(PALETTE.oreGem, { emissive: 0xb07000, emissiveIntensity: 0.5 }), 40);
  }

  buildHover() {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, BLOCK_H + 0.02, 1.02)); // just the outline
    this.hoverBox = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xfff4c8 }));
    this.hoverBox.visible = false;
    this.scene.add(this.hoverBox);
    const ring = new THREE.RingGeometry(0.34, 0.44, 24);
    ring.rotateX(-Math.PI / 2);
    this.hoverRing = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.9 }));
    this.hoverRing.visible = false;
    this.scene.add(this.hoverRing);
  }

  setHover(h) {
    this.hover = h; // { kind: 'tile', i } | { kind: 'mole', id } | null
  }

  // Drag-box preview. sel = { x0, y0, x1, y1, mark } in tile coordinates, or null to clear.
  setSelection(sel) {
    const same =
      sel && this.selection && ['x0', 'y0', 'x1', 'y1', 'mark'].every((k) => sel[k] === this.selection[k]); // .every = true if all pass
    if (same || (!sel && !this.selection)) return;
    this.selection = sel ? { ...sel } : null; // { ...sel } makes a shallow copy
    let n = 0;
    const target = sel && sel.mark ? this.selPaint : this.selErase;
    if (sel) {
      const w = this.world;
      for (let y = Math.min(sel.y0, sel.y1); y <= Math.max(sel.y0, sel.y1); y++) {
        for (let x = Math.min(sel.x0, sel.x1); x <= Math.max(sel.x0, sel.x1); x++) {
          const i = w.idx(x, y);
          if (!w.isDiggable(i)) continue;
          if (!sel.mark && !w.marked[i]) continue; // erasing only shows tiles that are marked
          tmpP.set(x + 0.5, BLOCK_H + 0.05, y + 0.5);
          tmpM.compose(tmpP, ZERO_Q, tmpS.setScalar(1));
          target.setMatrixAt(n++, tmpM);
        }
      }
    }
    finish(this.selPaint, sel && sel.mark ? n : 0);
    finish(this.selErase, sel && !sel.mark ? n : 0);
  }

  resize() {
    const c = this.three.domElement;
    const w = c.clientWidth;
    const h = c.clientHeight;
    this.three.setSize(w, h, false); // false = don't overwrite the canvas's CSS size
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix(); // must be called after changing camera settings
  }

  updateCamera() {
    const { W, H } = this.world;
    this.focus.x = Math.min(W - 2, Math.max(2, this.focus.x));
    this.focus.y = Math.min(H - 2, Math.max(2, this.focus.y));
    this.zoom = Math.min(30, Math.max(7, this.zoom));
    const d = this.zoom;
    this.camera.position.set(this.focus.x, d * 0.82, this.focus.y + d * 0.57);
    this.camera.lookAt(this.focus.x, 0, this.focus.y); // point the camera at a world position
  }

  // ---------------------------------------------------------------- tiles
  rebuildTiles() {
    const w = this.world;
    const { W, H } = w;
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let nf = 0;
    let ng = 0;
    let nt = 0;
    let nl = 0;
    let nmB = 0;
    let nmD = 0;
    this.lanterns.length = 0;
    this.treasureTiles.length = 0;
    this.cat.fill(0);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = w.idx(x, y);
        const t = w.type[i];
        const r = hash2(x, y);

        if (t === T.FLOOR) {
          // Room floors take their room type's colour. Outside rooms, paved floor (draft 3) is
          // stone slabs with dark gaps between them, roads are lighter cobbles, and bare floor is earth.
          const rid = this.sim.roomOf[i];
          const paved = rid < 0 && w.claim[i];
          const slab = paved ? 0.9 : 0.98; // smaller slabs let the dark base show through as grout
          tmpP.set(x + 0.5, paved ? 0.04 : 0.03, y + 0.5);
          tmpS.set(slab, paved ? 0.08 : 0.06, slab);
          tmpM.compose(tmpP, ZERO_Q, tmpS); // compose = build a matrix from position, rotation, scale
          this.floorMesh.setMatrixAt(nf, tmpM);
          let floorCol = PALETTE.floor;
          if (rid >= 0) floorCol = ROOM_FLOOR[ROOM_TYPES[this.sim.rooms[rid].type].key][(x + y) & 1];
          else if (paved && this.sim.road[i]) floorCol = (x + y) & 1 ? PALETTE.road : PALETTE.road2;
          else if (paved) floorCol = PALETTE.paving;
          tmpC.set(floorCol).offsetHSL(0, 0, (r - 0.5) * 0.05); // offsetHSL nudges hue/saturation/lightness
          this.floorMesh.setColorAt(nf, tmpC);
          nf++;
          continue;
        }

        // Solid tile: pick its look.
        let c;
        let col;
        const stage = w.wall[i];
        if (t === T.ORE) {
          c = CAT.ORE;
          col = PALETTE.ore;
        } else if (stage > 0) {
          c = CAT.STONE;
          col = PALETTE.stone;
        } else if (t === T.HARD) {
          c = CAT.HARD;
          col = PALETTE.hard;
        } else if (t === T.BORDER) {
          c = CAT.BORDER;
          col = PALETTE.border;
        } else {
          c = CAT.DIRT;
          col = PALETTE.dirt;
        }
        const k = counts[c]++;
        this.cat[i] = c;
        this.inst[i] = k;
        this.setBlockMatrix(i, x, y, 0);
        this.meshes[c].setMatrixAt(k, tmpM);
        tmpC.set(col).offsetHSL((r - 0.5) * 0.02, 0, (r - 0.5) * (c === CAT.STONE ? 0.05 : 0.09));
        // A marked block the moles can dig right now is tinted yellow all over.
        if (w.marked[i] && w.isWorkable(i)) tmpC.lerp(MARK_TINT, 0.45); // .lerp blends toward another colour
        this.meshes[c].setColorAt(k, tmpC);

        if (w.treasure[i] >= 0) this.treasureTiles.push(i);
        if (t === T.ORE) {
          // Three gems poking out of each ore block.
          for (let g = 0; g < 3; g++) {
            const a = hash2(x, y, g + 1);
            const b = hash2(x, y, g + 7);
            tmpP.set(x + 0.2 + a * 0.6, BLOCK_H + 0.02 - b * 0.15, y + 0.2 + b * 0.6);
            tmpQ.setFromAxisAngle(new THREE.Vector3(a, 1, b).normalize(), a * 3); // rotate around a tilted axis
            tmpS.setScalar(0.09 + a * 0.06);
            tmpM.compose(tmpP, tmpQ, tmpS);
            this.gemMesh.setMatrixAt(ng++, tmpM);
          }
        }

        // Decorated walls: a pale trim band, and a lantern on some of them.
        if (stage >= 2) {
          tmpP.set(x + 0.5, BLOCK_H - 0.07, y + 0.5);
          tmpS.set(1.04, 0.12, 1.04);
          tmpM.compose(tmpP, ZERO_Q, tmpS);
          this.trimMesh.setMatrixAt(nt, tmpM);
          nt++;
          // DECISION (Claude): about 2 in 5 decorated walls get a lantern, on the side facing open floor.
          if (hash2(x, y, 99) < 0.4) {
            for (const [dx, dy] of DIRS) {
              const nx = x + dx;
              const ny = y + dy;
              if (!w.inside(nx, ny) || w.type[w.idx(nx, ny)] !== T.FLOOR) continue;
              const lx = x + 0.5 + dx * 0.56;
              const lz = y + 0.5 + dy * 0.56;
              const ly = 0.82;
              tmpP.set(lx, ly, lz);
              tmpS.setScalar(0.085);
              tmpM.compose(tmpP, ZERO_Q, tmpS);
              this.lanternMesh.setMatrixAt(nl, tmpM);
              tmpP.set(x + 0.5 + dx * 0.52, ly + 0.11, y + 0.5 + dy * 0.52);
              tmpS.set(dx ? 0.1 : 0.05, 0.04, dy ? 0.1 : 0.05);
              tmpM.compose(tmpP, ZERO_Q, tmpS);
              this.bracketMesh.setMatrixAt(nl, tmpM);
              this.glowPos.set([lx, ly, lz], nl * 3); // typedArray.set(values, offset) copies values in
              this.lanterns.push({ x: lx, y: ly, z: lz });
              nl++;
              break;
            }
          }
        }

        // Marks sit on top of the block.
        if (w.marked[i]) {
          tmpP.set(x + 0.5, BLOCK_H + 0.03, y + 0.5);
          tmpM.compose(tmpP, ZERO_Q, tmpS.setScalar(1));
          if (w.isWorkable(i)) this.markBright.setMatrixAt(nmB++, tmpM);
          else this.markDim.setMatrixAt(nmD++, tmpM);
        }
      }
    }

    for (const c of [1, 2, 3, 4, 5]) finish(this.meshes[c], counts[c]);
    finish(this.floorMesh, nf);
    finish(this.gemMesh, ng);
    finish(this.trimMesh, nt);
    finish(this.lanternMesh, nl);
    finish(this.bracketMesh, nl);
    finish(this.markBright, nmB);
    finish(this.markDim, nmD);
    this.glowGeo.setDrawRange(0, nl);
    this.glowGeo.attributes.position.needsUpdate = true;
  }

  // Matrix for a wall block, shrunk and wobbled by dig progress.
  setBlockMatrix(i, x, y, shake) {
    const r = hash2(x, y, 3);
    const dig = this.world.dig[i];
    const h = BLOCK_H * (0.96 + r * 0.08) * (1 - 0.22 * dig); // DECISION (Claude): uneven heights read as rough rock
    const jx = shake ? (Math.random() - 0.5) * 0.06 * shake : 0;
    const jz = shake ? (Math.random() - 0.5) * 0.06 * shake : 0;
    tmpP.set(x + 0.5 + jx, h / 2, y + 0.5 + jz);
    const s = 1 - dig * 0.12;
    tmpS.set(s, h, s);
    tmpM.compose(tmpP, ZERO_Q, tmpS);
  }

  shakeDiggingTiles() {
    const w = this.world;
    const touched = new Set();
    for (const m of this.sim.moles) {
      if (m.state !== 'dig' || !m.job) continue;
      const i = m.job.i;
      const c = this.cat[i];
      if (!c || touched.has(i)) continue;
      touched.add(i);
      this.setBlockMatrix(i, w.xOf(i), w.yOf(i), 0.4 + w.dig[i]);
      this.meshes[c].setMatrixAt(this.inst[i], tmpM);
      this.meshes[c].instanceMatrix.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- effects
  spawn(pool, x, y, z, color, { n = 8, speed = 2, up = 2.5, size = 0.08, life = 0.8, gravity = 9 } = {}) {
    for (let k = 0; k < n; k++) {
      if (pool.list.length >= pool.max) pool.list.shift();
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      pool.list.push({
        x,
        y,
        z,
        vx: Math.cos(a) * s,
        vy: up * (0.5 + Math.random() * 0.7),
        vz: Math.sin(a) * s,
        life,
        max: life,
        size: size * (0.6 + Math.random() * 0.8),
        gravity,
        color: new THREE.Color(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.1),
        rot: Math.random() * 6,
      });
    }
  }

  tileColor(type) {
    return type === T.HARD ? PALETTE.hard : type === T.ORE ? PALETTE.ore : PALETTE.dirt;
  }

  consumeEvents() {
    const w = this.world;
    for (const e of this.sim.events) {
      if (e.kind === 'dug') {
        const x = w.xOf(e.i) + 0.5;
        const z = w.yOf(e.i) + 0.5;
        this.spawn(this.debris, x, BLOCK_H * 0.6, z, this.tileColor(e.type), { n: 16, speed: 2.4, up: 3, size: 0.13, life: 0.9 });
        if (e.type === T.ORE) this.spawn(this.sparks, x, 0.8, z, PALETTE.oreGem, { n: 10, speed: 1.5, up: 3, size: 0.05, life: 0.8, gravity: 5 });
        if (e.treasure >= 0) this.spawn(this.sparks, x, 0.9, z, 0xfff6c0, { n: 26, speed: 2, up: 3.5, size: 0.06, life: 1.2, gravity: 3 });
      } else if (e.kind === 'wall') {
        const x = w.xOf(e.i) + 0.5;
        const z = w.yOf(e.i) + 0.5;
        this.spawn(this.sparks, x, BLOCK_H * 0.7, z, e.stage >= 2 ? PALETTE.lantern : 0xe8dcc8, { n: 8, speed: 1, up: 1.5, size: 0.04, life: 0.7, gravity: 2 });
      } else if (e.kind === 'spawn') {
        const b = this.sim.burrow;
        this.spawn(this.sparks, b.x + 0.5, 1.1, b.y + 0.5, 0xfff0a0, { n: 24, speed: 2, up: 3.5, size: 0.05, life: 1.0, gravity: 4 });
      } else if (e.kind === 'deliver') {
        const b = this.sim.burrow;
        this.spawn(this.sparks, b.x + 0.5, 0.9, b.y + 0.9, PALETTE.oreGem, { n: 6, speed: 0.8, up: 2, size: 0.04, life: 0.6, gravity: 4 });
        this.burrowPulse = 1;
      } else if (e.kind === 'slap') {
        const v = this.moleViews.get(e.id);
        if (v) this.spawn(this.sparks, v.root.position.x, 0.9, v.root.position.z, 0xfff27a, { n: 10, speed: 1.8, up: 1.5, size: 0.05, life: 0.5, gravity: 2 });
      } else if (e.kind === 'grow') {
        const v = this.sim.visitors.find((q) => q.id === e.id);
        if (v) this.spawn(this.sparks, v.x, 0.5, v.y, e.stage === 2 ? 0xfff07a : 0xffffff, { n: e.stage === 2 ? 30 : 16, speed: 1.6, up: 2.5, size: 0.05, life: 1.0, gravity: 2.5 });
      } else if (e.kind === 'greet') {
        this.spawn(this.sparks, e.x, 0.6, e.y, HEART, { n: 6, speed: 0.4, up: 1.2, size: 0.05, life: 1.2, gravity: -0.3 });
        for (const id of [e.a, e.b]) {
          const view = this.visitorViews.get(id);
          if (view) view.hopT = 1;
        }
      } else if (e.kind === 'chase') {
        const v = this.sim.visitors.find((q) => q.id === e.a);
        if (v) this.spawn(this.debris, v.x, 0.1, v.y, 0xc8b8a0, { n: 6, speed: 1, up: 0.8, size: 0.05, life: 0.5 });
      } else if (e.kind === 'group') {
        const color = GROUP_FX[e.creature] || HEART;
        for (const id of e.ids) {
          const v = this.sim.visitors.find((q) => q.id === id);
          const view = this.visitorViews.get(id);
          if (view) view.hopT = 1; // everyone bounces together
          if (v) this.spawn(this.sparks, v.x, v.kind === 'bat' ? 1.1 : 0.6, v.y, color, { n: 3, speed: 0.3, up: 1.0, size: 0.05, life: 1.4, gravity: -0.2 });
        }
      } else if (e.kind === 'treasure') {
        const p = this.pedestals[e.treasure];
        this.spawn(this.sparks, p.pos.x, p.pos.y, p.pos.z, 0xfff0a0, { n: 30, speed: 1.8, up: 3, size: 0.05, life: 1.1, gravity: 3 });
        this.burrowPulse = 1;
      } else if (e.kind === 'slapTreasure') {
        const p = this.pedestals[e.treasure];
        p.spin = 1;
        this.spawn(this.sparks, p.pos.x, p.pos.y, p.pos.z, 0xfff6c0, { n: 10, speed: 1.4, up: 1.6, size: 0.04, life: 0.6, gravity: 2 });
      } else if (e.kind === 'claim') {
        const isRoad = this.sim.road[e.i];
        this.spawn(this.sparks, w.xOf(e.i) + 0.5, 0.15, w.yOf(e.i) + 0.5, isRoad ? 0xffe0a0 : 0xd8d0c0, { n: isRoad ? 5 : 3, speed: 0.8, up: 1, size: 0.03, life: 0.4, gravity: 2 });
      } else if (e.kind === 'slapVisitor') {
        const v = this.sim.visitors.find((q) => q.id === e.id);
        if (v) this.spawn(this.sparks, v.x, 0.6, v.y, 0xffffff, { n: 8, speed: 1.5, up: 1.5, size: 0.04, life: 0.5, gravity: 2 });
      } else if (e.kind === 'lever' || e.kind === 'room') {
        // A puff of dust across the room as it changes (or appears).
        const room = this.sim.rooms[e.id];
        if (!room) continue;
        const step = Math.max(1, Math.floor(room.tiles.length / 14));
        for (let k = 0; k < room.tiles.length; k += step) {
          const i = room.tiles[k];
          this.spawn(this.debris, w.xOf(i) + 0.5, 0.2, w.yOf(i) + 0.5, 0xc8b8a0, { n: 2, speed: 0.8, up: 1.4, size: 0.07, life: 0.7, gravity: 3 });
        }
        this.spawn(this.sparks, room.cx, 0.8, room.cy, 0xfff0a0, { n: e.kind === 'lever' ? 18 : 10, speed: 1.6, up: 2.5, size: 0.05, life: 0.8, gravity: 3 });
      } else if (e.kind === 'portal') {
        const p = this.sim.portal;
        this.portalFlash = 1;
        this.spawn(this.sparks, p.x + 0.5, 0.9, p.y + 0.5, 0xc8a0ff, { n: 40, speed: 2.5, up: 3, size: 0.06, life: 1.4, gravity: 2 });
      } else if (e.kind === 'arrive' || e.kind === 'leave') {
        const p = this.sim.portal;
        this.portalFlash = Math.max(this.portalFlash || 0, 0.5);
        this.spawn(this.sparks, p.x + 0.5, 0.8, p.y + 0.6, 0xe0c8ff, { n: 14, speed: 1.4, up: 2, size: 0.045, life: 0.8, gravity: 2 });
      }
    }
    this.sim.events.length = 0; // empty the list (setting length to 0 clears an array)
  }

  updateParticles(dt) {
    for (const pool of [this.debris, this.sparks]) {
      let n = 0;
      const keep = [];
      for (const p of pool.list) {
        p.life -= dt;
        if (p.life <= 0) continue;
        p.vy -= p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.y < 0.05) {
          p.y = 0.05;
          p.vy *= -0.3;
          p.vx *= 0.6;
          p.vz *= 0.6;
        }
        p.rot += dt * 5;
        keep.push(p);
        tmpP.set(p.x, p.y, p.z);
        tmpQ.setFromAxisAngle(tmpS.set(1, 1, 0).normalize(), p.rot);
        tmpS.setScalar(p.size * Math.min(1, (p.life / p.max) * 2.5));
        tmpM.compose(tmpP, tmpQ, tmpS);
        pool.mesh.setMatrixAt(n, tmpM);
        pool.mesh.setColorAt(n, p.color);
        n++;
      }
      pool.list = keep;
      finish(pool.mesh, n);
    }
  }

  // ---------------------------------------------------------------- moles
  syncMoles(dt) {
    const alive = new Set();
    for (const m of this.sim.moles) {
      alive.add(m.id);
      let v = this.moleViews.get(m.id);
      if (!v) v = this.addMoleView(m);
      this.animateMole(m, v, dt);
    }
    for (const [id, v] of this.moleViews) {
      if (!alive.has(id)) {
        this.scene.remove(v.root);
        this.moleViews.delete(id);
      }
    }
  }

  addMoleView(m) {
    const root = makeMole();
    const get = (n) => root.getObjectByName(n);
    const v = {
      root,
      bob: get('bob'),
      head: get('head'),
      armL: get('armL'),
      armR: get('armR'),
      body: get('body'),
      cargo: get('cargo'),
      stars: get('stars'),
      lastX: m.x,
      lastY: m.y,
      swingCycle: 0,
      spawnT: 0,
      facing: Math.PI / 2 - m.heading,
      baseScale: root.scale.x,
    };
    root.position.set(m.x, 0, m.y);
    this.scene.add(root);
    this.moleViews.set(m.id, v);
    return v;
  }

  animateMole(m, v, dt) {
    const t = this.time;
    const moved = Math.hypot(m.x - v.lastX, m.y - v.lastY) > 1e-4;
    v.lastX = m.x;
    v.lastY = m.y;
    v.root.position.set(m.x, 0, m.y);

    // Turn smoothly toward the heading. Model faces +z, sim heading is an angle in the x/y plane.
    const want = Math.PI / 2 - m.heading;
    let diff = want - v.facing;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // wrap to −π..π so it turns the short way
    v.facing += diff * Math.min(1, dt * 12);
    v.root.rotation.y = v.facing;

    // Pop in when newly spawned (overshoot, then settle).
    v.spawnT = Math.min(1, v.spawnT + dt * 2.5);
    const pop = v.spawnT < 1 ? 1 + Math.sin(v.spawnT * Math.PI) * 0.3 : 1;
    v.root.scale.setScalar(v.baseScale * Math.min(1, v.spawnT * 1.6) * pop);

    // Defaults, then each state overrides.
    let bobY = 0;
    let armR = -0.15;
    let armL = 0.15;
    let lean = 0;
    let spin = 0;
    let squash = 1;
    v.head.rotation.y = 0;

    if (m.react > 0) {
      // Slapped: hop, spin, see stars.
      const p = 1 - m.react / CONFIG.slapReactTime;
      bobY = Math.sin(p * Math.PI) * 0.45;
      spin = p * Math.PI * 2;
      squash = 1 + Math.sin(p * Math.PI * 2) * 0.15;
      armL = armR = -2.6;
    } else if (m.state === 'dig' || m.state === 'wall' || m.state === 'claim') {
      const rate = m.state === 'dig' ? 1.6 : m.state === 'claim' ? 2.2 : 1.1; // swings per second of work
      const ph = m.workPhase * rate;
      const p = ph - Math.floor(ph);
      // Wind up slowly (0–0.6), strike fast (0.6–1).
      armR = p < 0.6 ? -0.9 - (p / 0.6) * 1.8 : -2.7 + ((p - 0.6) / 0.4) * 2.0;
      if (m.state === 'wall') armR = -1.2 - Math.sin(p * Math.PI) * 0.7; // gentler tapping
      if (m.state === 'claim') {
        armR = -0.5 - Math.sin(p * Math.PI) * 0.9; // tapping slabs into the floor
        lean = 0.25;
      }
      armL = -1.0;
      lean = p >= 0.6 ? 0.15 : -0.05;
      const cycle = Math.floor(ph);
      if (cycle !== v.swingCycle && m.job) {
        v.swingCycle = cycle;
        this.onImpact(m);
      }
    } else if (m.carrying) {
      armL = armR = -2.85; // hold the ore up over the head
      if (moved) bobY = Math.abs(Math.sin(t * 13 + m.id)) * 0.05;
    } else if (moved) {
      bobY = Math.abs(Math.sin(t * 13 + m.id)) * 0.06;
      armR = Math.sin(t * 13 + m.id) * 0.5;
      armL = -armR;
    } else {
      // Idle: breathe and look around.
      bobY = Math.sin(t * 2 + m.id) * 0.01;
      v.head.rotation.y = Math.sin(t * 0.7 + m.id * 1.7) * 0.6;
    }

    v.bob.position.y = bobY;
    v.bob.rotation.x = lean;
    v.bob.rotation.y = spin;
    v.bob.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    v.armR.rotation.x += (armR - v.armR.rotation.x) * Math.min(1, dt * 30);
    v.armL.rotation.x += (armL - v.armL.rotation.x) * Math.min(1, dt * 18);
    // Ore shows as a nugget overhead; a treasure (draft 4) shows as a small copy of itself.
    const carryKind = m.carrying ? m.cargo : -1;
    if (carryKind !== v.carryKind) {
      if (v.carryModel) v.bob.remove(v.carryModel);
      v.carryModel = null;
      if (carryKind >= 0) {
        v.carryModel = makeTreasure(TREASURE_KEYS[carryKind]);
        v.carryModel.scale.setScalar(0.7);
        v.carryModel.position.y = 0.7;
        v.bob.add(v.carryModel);
      }
      v.carryKind = carryKind;
    }
    v.cargo.visible = m.carrying && carryKind < 0;
    if (m.carrying) v.cargo.rotation.y += dt * 2;
    if (v.carryModel) v.carryModel.rotation.y += dt * 1.5;
    v.stars.visible = m.react > 0;
    if (m.react > 0) v.stars.rotation.y += dt * 9;

    // Boosted: a warm glow and a trail of sparkles. DECISION (Claude)
    const glow = m.boost > 0 && m.react === 0 ? 0.25 + 0.15 * Math.sin(t * 12) : 0;
    v.body.material.emissive.setRGB(glow, glow * 0.55, 0);
    if (glow > 0 && Math.random() < dt * 10) {
      this.spawn(this.sparks, m.x, 0.6, m.y, 0xffe066, { n: 1, speed: 0.3, up: 1.2, size: 0.035, life: 0.6, gravity: -0.5 });
    }

    // Hover ring under the mole the hand is over.
    if (this.hover && this.hover.kind === 'mole' && this.hover.id === m.id) {
      this.hoverRing.visible = true;
      this.hoverRing.position.set(m.x, 0.08, m.y);
    }
  }

  // A pickaxe strike: chips fly off the tile (sparks on hard rock).
  onImpact(m) {
    const w = this.world;
    const i = m.job.i;
    const x = w.xOf(i) + 0.5;
    const z = w.yOf(i) + 0.5;
    const fx = (m.x + x) / 2;
    const fz = (m.y + z) / 2;
    const type = w.type[i];
    if (m.state === 'wall') {
      this.spawn(this.debris, fx, 0.6, fz, 0xd8ccb8, { n: 2, speed: 0.8, up: 1.2, size: 0.04, life: 0.4 });
      if (this.sound) this.sound.play('wall', fx, fz, { volume: 0.35 });
      return;
    }
    if (m.state === 'claim') {
      this.spawn(this.debris, m.x, 0.1, m.y, PALETTE.paving, { n: 2, speed: 0.6, up: 0.9, size: 0.035, life: 0.35 });
      return;
    }
    this.spawn(this.debris, fx, 0.55, fz, this.tileColor(type), { n: 3, speed: 1.2, up: 1.8, size: 0.06, life: 0.5 });
    if (this.sound) this.sound.play('pick', fx, fz, { volume: 0.7 });
    if (type === T.HARD) {
      // DECISION (Claude, brief): sparks on hard rock so slow digging reads as "tough", not "broken".
      this.spawn(this.sparks, fx, 0.6, fz, 0xffd36b, { n: 5, speed: 2.2, up: 1.6, size: 0.03, life: 0.35, gravity: 6 });
    }
  }

  // ---------------------------------------------------------------- burrow
  updateBurrow(dt) {
    const sim = this.sim;
    const b = sim.burrow;
    const capped = sim.moles.length >= CONFIG.crewCap;
    const frac = sim.buildFraction;
    const assembling = b.assembling > 0;
    const shown = assembling ? MOLE_BUILD_ORDER.length : Math.floor(frac * MOLE_BUILD_ORDER.length);

    this.ghost.visible = !capped && !assembling;
    this.nextMole.visible = !capped && shown > 0;
    for (const p of this.buildParts) p.mesh.visible = p.order < shown;
    this.ghost.rotation.y += dt * 0.4;
    this.nextMole.rotation.y = this.ghost.rotation.y;
    // While assembling, the new mole wiggles and glows.
    const wig = assembling ? Math.sin(this.time * 30) * 0.06 : 0;
    this.nextMole.position.y = 0.5 + (assembling ? Math.abs(Math.sin(this.time * 10)) * 0.08 : 0);
    this.nextMole.rotation.z = wig;
    const g = assembling ? 0.4 : 0;
    this.nextMoleBody.material.emissive.setRGB(g, g * 0.7, g * 0.2);

    // Burrow light pulses when ore arrives.
    this.burrowPulse = Math.max(0, (this.burrowPulse || 0) - dt * 2);
    this.burrowLight.intensity = 18 + this.burrowPulse * 10 + Math.sin(this.time * 3) * 1.5;

    // Spare ore pile. DECISION (Claude): shows up to 40 pieces, arranged in a spiral beside the burrow.
    const pile = Math.min(40, capped ? b.ore : Math.max(0, b.ore - b.cost));
    for (let k = 0; k < pile; k++) {
      const a = k * 2.4;
      const r = 0.25 + Math.sqrt(k) * 0.09;
      tmpP.set(b.x + 0.5 - 1.0 + Math.cos(a) * r, 0.06 + (k % 3) * 0.03, b.y + 0.5 + 0.6 + Math.sin(a) * r);
      tmpQ.setFromAxisAngle(tmpS.set(0, 1, 0), a);
      tmpS.setScalar(0.08);
      tmpM.compose(tmpP, tmpQ, tmpS);
      this.pileMesh.setMatrixAt(k, tmpM);
    }
    finish(this.pileMesh, pile);
  }

  // Give the few real lights to the lanterns nearest the camera's focus.
  updateLanternLights() {
    const f = this.focus;
    const near = this.lanterns
      .map((l) => ({ l, d: (l.x - f.x) ** 2 + (l.z - f.y) ** 2 })) // .map makes a new array from each item
      .sort((a, b) => a.d - b.d) // .sort orders it; here nearest first
      .slice(0, this.lanternLights.length); // .slice keeps the first N
    this.lanternLights.forEach((light, k) => {
      const n = near[k];
      if (!n) {
        light.intensity = 0;
        return;
      }
      light.position.set(n.l.x, n.l.y + 0.1, n.l.z);
      light.intensity = 7 + Math.sin(this.time * 7 + k * 1.3) * 0.6; // gentle flicker
    });
  }

  // ---------------------------------------------------------------- rooms (draft 2)
  // One InstancedMesh per prop shape+material, shared by every room.
  propBatch(shape, kind) {
    const key = `${shape}:${kind}`;
    let b = this.propBatches.get(key);
    if (!b) {
      b = { mesh: this.instanced(G[shape], this.propMats[kind], PROP_CAP), n: 0 };
      this.propBatches.set(key, b);
    }
    return b;
  }

  rebuildRooms() {
    const w = this.world;
    const sim = this.sim;
    for (const b of this.propBatches.values()) b.n = 0; // .values() iterates a Map's values

    const emit = (shape, kind, x, y, z, sx, sy, sz, color, ry = 0, rx = 0) => {
      const b = this.propBatch(shape, kind);
      if (b.n >= PROP_CAP) return;
      tmpP.set(x, y, z);
      tmpQ.setFromEuler(tmpE.set(rx, ry, 0)); // turn the angles into a quaternion
      tmpS.set(sx, sy, sz);
      tmpM.compose(tmpP, tmpQ, tmpS);
      b.mesh.setMatrixAt(b.n, tmpM);
      b.mesh.setColorAt(b.n, tmpC.set(color));
      b.n++;
    };

    for (const room of sim.rooms) {
      const inRoom = (x, y) => w.inside(x, y) && sim.roomOf[w.idx(x, y)] === room.id;
      const tiles = room.tiles.map((i) => {
        const x = w.xOf(i);
        const y = w.yOf(i);
        const walls = [];
        const edges = [];
        for (const [dx, dy] of DIRS) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inRoom(nx, ny)) edges.push([dx, dy]);
          if (!w.inside(nx, ny) || w.type[w.idx(nx, ny)] !== T.FLOOR) walls.push([dx, dy]);
        }
        return { x, y, walls, edges, interior: edges.length === 0, lever: i === room.lever.i };
      });
      // Centre = the room tile nearest the middle (not the lever's tile).
      let center = tiles[0];
      let best = Infinity;
      for (const t of tiles) {
        const d = Math.hypot(t.x + 0.5 - room.cx, t.y + 0.5 - room.cy);
        if (!t.lever && d < best) {
          best = d;
          center = t;
        }
      }
      // DECISION (Felix): a switched room starts fresh — props come only from its type and tiles.
      buildRoomProps(ROOM_TYPES[room.type].key, { tiles, center }, emit, (x, y, s) => hash2(x, y, s * 31 + room.type * 7 + 5));
      this.syncLever(room);
    }
    // Lamp posts along paved roads, at the road's side. DECISION (Claude)
    const n = w.W * w.H;
    for (let i = 0; i < n; i++) {
      if (!sim.road[i] || !w.claim[i] || sim.roomOf[i] >= 0) continue;
      const x = w.xOf(i);
      const y = w.yOf(i);
      if (hash2(x, y, 211) > CONFIG.roadLampChance) continue;
      // Stand the post on the side that isn't road, so it lines the road instead of blocking it.
      let side = [0.38, 0];
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (w.inside(nx, ny) && !sim.road[w.idx(nx, ny)]) {
          side = [dx * 0.38, dy * 0.38];
          break;
        }
      }
      const px = x + 0.5 + side[0];
      const pz = y + 0.5 + side[1];
      emit('cyl', 'lit', px, 0.35, pz, 0.035, 0.7, 0.035, 0x3a2e2a);
      emit('box', 'lit', px, 0.72, pz, 0.1, 0.04, 0.1, 0x3a2e2a);
      emit('sphere', 'glow', px, 0.8, pz, 0.065, 0.075, 0.065, PALETTE.lantern);
    }
    for (const b of this.propBatches.values()) finish(b.mesh, b.n);
  }

  // Create or update the lever for a room. Wall levers hang on the wall; others stand on a post.
  syncLever(room) {
    const w = this.world;
    const { i, dir } = room.lever;
    const x = w.xOf(i) + 0.5;
    const z = w.yOf(i) + 0.5;
    let onWall = false;
    if (dir) {
      const nx = w.xOf(i) + dir[0];
      const ny = w.yOf(i) + dir[1];
      onWall = w.inside(nx, ny) && w.type[w.idx(nx, ny)] !== T.FLOOR; // the wall may since have been dug away
    }
    let v = this.leverViews.get(room.id);
    if (v && v.post === !onWall) return;
    if (v) {
      this.scene.remove(v.group);
      if (v.sign) this.scene.remove(v.sign);
    }
    const group = makeLever({ post: !onWall });
    if (onWall) {
      group.position.set(x + dir[0] * 0.3, 0, z + dir[1] * 0.3);
      group.rotation.y = Math.atan2(-dir[0], -dir[1]); // face into the room
    } else {
      group.position.set(x, 0, z);
      group.rotation.y = Math.atan2(room.cx - x, room.cy - z);
    }
    this.scene.add(group);
    v = {
      group,
      arm: group.getObjectByName('arm'),
      post: !onWall,
      pulls: room.pulls,
      pullT: 1,
      pos: new THREE.Vector3(group.position.x, onWall ? 0.6 : 0.9, group.position.z),
      sign: null,
      signType: -1,
    };
    this.leverViews.set(room.id, v);
  }

  animateLevers(dt) {
    for (const [id, v] of this.leverViews) {
      const room = this.sim.rooms[id];
      if (room && room.pulls !== v.pulls) {
        v.pulls = room.pulls;
        v.pullT = 0;
      }
      if (v.pullT < 1) {
        v.pullT = Math.min(1, v.pullT + dt / CONFIG.leverPullTime);
        // Swing over (0–0.4), hold, swing back (0.6–1).
        const p = v.pullT;
        const k = p < 0.4 ? p / 0.4 : p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
        v.arm.rotation.x = -0.55 + k * 1.1;
      } else {
        // An idle lever wiggles a tiny bit now and then, inviting a pull. DECISION (Claude)
        v.arm.rotation.x = -0.55 + Math.max(0, Math.sin(this.time * 1.3 + id * 2.1) - 0.97) * 3;
      }
    }
  }

  // ---------------------------------------------------------------- lever signs and fan (draft 8)
  // A small picture of the room's current type floats above each lever, always facing the camera.
  updateLeverSigns() {
    for (const [id, v] of this.leverViews) {
      const room = this.sim.rooms[id];
      if (!room) continue;
      if (v.signType !== room.type) {
        if (v.sign) this.scene.remove(v.sign);
        v.sign = makeLeverSign(ROOM_TYPES[room.type].key);
        this.scene.add(v.sign);
        v.signType = room.type;
      }
      v.sign.position.set(v.group.position.x, v.post ? 1.35 : 1.15, v.group.position.z);
      v.sign.quaternion.copy(this.camera.quaternion); // face the camera
      v.sign.visible = !this.fan || this.fan.roomId !== id; // hidden while its fan is open
    }
  }

  // Open the fan of six room pictures above a lever. Input calls this when a lever is tapped.
  openFan(roomId) {
    this.closeFan();
    const v = this.leverViews.get(roomId);
    if (!v) return;
    const group = new THREE.Group();
    const buttons = ROOM_TYPES.map((t, k) => {
      const b = makeFanButton(t.key);
      // DECISION (Claude): six buttons on a ring, starting at the top, clockwise.
      const a = Math.PI / 2 - (k / ROOM_TYPES.length) * Math.PI * 2;
      b.userData.home = new THREE.Vector3(Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0); // userData = free space for our own notes
      group.add(b);
      return { type: k, obj: b, ring: b.getObjectByName('ring') };
    });
    this.scene.add(group);
    this.fan = { roomId, group, buttons, t: 0, hover: -1 };
  }

  closeFan() {
    if (!this.fan) return;
    this.scene.remove(this.fan.group);
    this.fan = null;
  }

  setFanHover(type) {
    if (this.fan) this.fan.hover = type;
  }

  updateFan(dt) {
    const f = this.fan;
    if (!f) return;
    const v = this.leverViews.get(f.roomId);
    const room = this.sim.rooms[f.roomId];
    if (!v || !room) return this.closeFan();
    f.t = Math.min(1, f.t + dt * 5);
    const ease = 1 - (1 - f.t) ** 3; // fast start, gentle stop
    f.group.position.set(v.group.position.x, (v.post ? 1.35 : 1.15) + 0.2, v.group.position.z);
    f.group.quaternion.copy(this.camera.quaternion);
    for (const b of f.buttons) {
      b.obj.position.copy(b.obj.userData.home).multiplyScalar(ease); // fly out from the centre
      const current = b.type === room.type;
      const hovered = b.type === f.hover;
      b.obj.scale.setScalar(ease * (hovered ? 1.25 : 1));
      b.ring.material.color.set(hovered ? 0xffffff : current ? 0xf4c430 : 0x5a4030);
    }
  }

  pickFanButton(clientX, clientY) {
    if (!this.fan) return null;
    const p = new THREE.Vector3();
    const pts = this.fan.buttons.map((b) => ({ id: b.type, pos: b.obj.getWorldPosition(p).clone() })); // world position of a child
    return this.pickNearest(clientX, clientY, pts, 30);
  }

  // ---------------------------------------------------------------- portal (draft 2)
  buildPortal() {
    const p = this.sim.portal;
    this.portalGroup = makePortal();
    this.portalGroup.position.set(p.x + 0.5, 0, p.y + 0.5);
    // DECISION (Claude): the ring is taller than the rock around it, so its top peeks out of the
    // sealed chamber as a hint that something is in there.
    this.scene.add(this.portalGroup);
    this.portalDisc = this.portalGroup.getObjectByName('disc');
    this.portalSwirl = this.portalGroup.getObjectByName('swirl');
    this.portalLight = new THREE.PointLight(0xa070ff, 0, 7, 1.3);
    this.portalLight.position.set(p.x + 0.5, 1.3, p.y + 1.0);
    this.scene.add(this.portalLight);
  }

  updatePortal(dt) {
    const awake = this.sim.portal.awake;
    this.portalDisc.visible = awake;
    this.portalSwirl.visible = awake;
    if (!awake) return;
    this.portalSwirl.rotation.z -= dt * 2.2;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 2);
    this.portalDisc.material.color.setHSL(0.72 + pulse * 0.06, 0.8, 0.55); // setHSL = set by hue, saturation, lightness
    this.portalLight.intensity = 9 + pulse * 4 + (this.portalFlash || 0) * 30;
    this.portalFlash = Math.max(0, (this.portalFlash || 0) - dt * 1.5);
  }

  // ---------------------------------------------------------------- visitors (draft 2)
  syncVisitors(dt) {
    const alive = new Set();
    for (const v of this.sim.visitors) {
      alive.add(v.id);
      let view = this.visitorViews.get(v.id);
      if (!view) {
        const root = makeVisitor(v.kind);
        view = {
          root,
          bob: root.getObjectByName('bob'),
          head: root.getObjectByName('head'),
          wingL: root.getObjectByName('wingL'),
          wingR: root.getObjectByName('wingR'),
          tail: root.getObjectByName('tail'),
          eyes: root.getObjectByName('eyes'),
          lastX: v.x,
          lastY: v.y,
          facing: Math.PI / 2 - v.heading,
          spawnT: 0,
          baseScale: root.scale.x,
          stageShown: 0, // draft 5: growth stage the model currently shows
          growPop: 0, // 1 right after growing, fades to 0
          hopT: 0, // 1 right after a greeting or group moment, fades to 0
          bubble: null,
          bubbleType: -1,
        };
        this.scene.add(root);
        this.visitorViews.set(v.id, view);
      }
      this.animateVisitor(v, view, dt);
    }
    for (const [id, view] of this.visitorViews) {
      if (!alive.has(id)) {
        this.scene.remove(view.root);
        if (view.bubble) this.scene.remove(view.bubble);
        this.visitorViews.delete(id);
      }
    }
  }

  animateVisitor(v, view, dt) {
    const t = this.time + v.id * 1.7;
    const moved = Math.hypot(v.x - view.lastX, v.y - view.lastY) > 1e-4;
    view.lastX = v.x;
    view.lastY = v.y;
    const flying = v.kind === 'bat';
    view.root.position.set(v.x, flying ? 0.75 + Math.sin(t * 3) * 0.08 : 0, v.y);

    let diff = Math.PI / 2 - v.heading - view.facing;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    view.facing += diff * Math.min(1, dt * 8);
    view.root.rotation.y = view.facing;

    view.spawnT = Math.min(1, view.spawnT + dt * 2);
    const pop = view.spawnT < 1 ? 1 + Math.sin(view.spawnT * Math.PI) * 0.3 : 1;
    // Draft 5: size follows growth stage, with a bounce when it grows.
    if (v.stage === 2 && view.stageShown < 2) addFinalForm(view.root, v.kind);
    if (v.stage !== view.stageShown) {
      view.stageShown = v.stage;
      view.growPop = 1;
    }
    view.growPop = Math.max(0, view.growPop - dt * 1.5);
    view.hopT = Math.max(0, view.hopT - dt * 1.2);
    const growBounce = 1 + Math.sin(view.growPop * Math.PI) * 0.25;
    view.root.scale.setScalar(view.baseScale * STAGE_SCALE[v.stage] * Math.min(1, view.spawnT * 1.6) * pop * growBounce);

    let bobY = 0;
    let spin = 0;
    let roll = 0;
    if (v.react > 0) {
      const p = 1 - v.react / CONFIG.slapReactTime;
      bobY = Math.sin(p * Math.PI) * 0.4;
      spin = p * Math.PI * 2;
    } else if (moved) {
      if (v.kind === 'frog') bobY = Math.abs(Math.sin(t * 7)) * 0.18;
      else if (v.kind !== 'snail' && !flying) bobY = Math.abs(Math.sin(t * 12)) * 0.03;
      if (v.kind === 'hedgehog' || v.kind === 'owl') roll = Math.sin(t * 10) * 0.12; // waddle
    }
    if (v.state === 'greet') bobY = Math.abs(Math.sin(t * 10)) * 0.08; // happy little hops
    bobY += Math.sin(view.hopT * Math.PI) * 0.25;
    view.bob.position.y = bobY;
    view.bob.rotation.y = spin;
    view.bob.rotation.z = roll;

    // Doing something in a room it needs: a few particles show the need being filled.
    const fx = v.activity && ACTIVITY_FX[v.activity];
    if (fx && Math.random() < dt * 1.5) {
      this.spawn(this.sparks, v.x, flying ? 0.9 : 0.35, v.y, fx.color, { n: 1, speed: 0.3, up: fx.up, size: 0.035, life: 0.9, gravity: v.activity === 'nap' ? -0.2 : 1.5 });
    }

    // Thought bubble when a room it needs doesn't exist yet. It always faces the camera.
    const want = v.state === 'leave' ? -1 : v.wants;
    if (want !== view.bubbleType) {
      if (view.bubble) this.scene.remove(view.bubble);
      view.bubble = want >= 0 ? makeThoughtBubble(ROOM_TYPES[want].key) : null;
      if (view.bubble) this.scene.add(view.bubble);
      view.bubbleType = want;
    }
    if (view.bubble) {
      const h = (flying ? 1.25 : 0.75) * STAGE_SCALE[v.stage] + 0.25;
      view.bubble.position.set(v.x + 0.15, h + Math.sin(t * 2) * 0.04, v.y);
      view.bubble.quaternion.copy(this.camera.quaternion); // copy the camera's rotation = face the camera
    }
    // Kind-specific idle life.
    if (v.kind === 'owl' && !moved) view.head.rotation.y = Math.sin(t * 0.7) * 1.3;
    if (view.wingL) {
      const flap = Math.sin(t * 18) * 0.7;
      view.wingL.rotation.z = flap;
      view.wingR.rotation.z = -flap;
    }
    if (view.tail) view.tail.rotation.y = Math.sin(t * (moved ? 10 : 4)) * 0.5;
    if (view.eyes) view.eyes.rotation.z = Math.sin(t * 1.5) * 0.25;
    if (v.kind === 'snail') view.bob.scale.z = 1 + (moved ? Math.sin(t * 3) * 0.08 : 0); // slow stretch
  }

  // ---------------------------------------------------------------- treasure (draft 4)
  twinkleTreasureTiles() {
    const w = this.world;
    let n = 0;
    for (const i of this.treasureTiles) {
      const x = w.xOf(i);
      const y = w.yOf(i);
      // Each block twinkles on its own rhythm: a quick flash, then a pause.
      const phase = this.time * 1.6 + hash2(x, y, 5) * 6.28;
      const s = Math.max(0, Math.sin(phase)) ** 6;
      tmpP.set(x + 0.5, BLOCK_H + 0.12 + s * 0.08, y + 0.5);
      tmpQ.setFromAxisAngle(tmpS.set(0, 1, 0), this.time * 2);
      tmpS.set(0.05 + s * 0.12, 0.08 + s * 0.2, 0.05 + s * 0.12);
      tmpM.compose(tmpP, tmpQ, tmpS);
      this.glintMesh.setMatrixAt(n++, tmpM);
    }
    finish(this.glintMesh, n);
  }

  updateTreasureRing(dt) {
    for (const p of this.pedestals) {
      if (this.sim.trove[p.kind] && !p.model) {
        p.model = makeTreasure(TREASURE_KEYS[p.kind]);
        p.model.position.y = PEDESTAL_TOP;
        p.group.add(p.model);
        p.popT = 0;
      }
      if (!p.model) continue;
      p.popT = Math.min(1, p.popT + dt * 2);
      const pop = p.popT < 1 ? Math.sin(p.popT * Math.PI) * 0.4 : 0;
      p.model.scale.setScalar(Math.min(1, p.popT * 2) + pop);
      // Slow turn on display; a slap gives it a fast twirl that winds down.
      p.spin = Math.max(0, p.spin - dt * 3);
      p.model.rotation.y += dt * (0.5 + p.spin * 12);
      p.model.position.y = PEDESTAL_TOP + p.spin * 0.25;
    }
  }

  pickTreasure(clientX, clientY) {
    const pts = this.pedestals.filter((p) => p.model).map((p) => ({ id: p.kind, pos: p.pos }));
    return this.pickNearest(clientX, clientY, pts, 28);
  }

  // Ring under whatever backdrop thing the hand is over (levers and visitors).
  updateHoverExtras() {
    const h = this.hover;
    if (!h) return;
    if (h.kind === 'lever') {
      const v = this.leverViews.get(h.id);
      if (v) {
        this.hoverRing.visible = true;
        this.hoverRing.position.set(v.group.position.x, 0.08, v.group.position.z);
      }
    } else if (h.kind === 'treasure') {
      const p = this.pedestals[h.id];
      this.hoverRing.visible = true;
      this.hoverRing.position.set(p.group.position.x, 0.08, p.group.position.z);
    } else if (h.kind === 'visitor') {
      const v = this.sim.visitors.find((q) => q.id === h.id);
      if (v) {
        this.hoverRing.visible = true;
        this.hoverRing.position.set(v.x, 0.08, v.y);
      }
    }
  }

  // ---------------------------------------------------------------- picking
  // Shared screen-distance pick: the nearest point within `radius` pixels.
  pickNearest(clientX, clientY, points, radius) {
    const r = this.three.domElement.getBoundingClientRect();
    let best = null;
    let bestD = radius;
    const p = new THREE.Vector3();
    for (const { id, pos } of points) {
      p.copy(pos).project(this.camera);
      const sx = r.left + ((p.x + 1) / 2) * r.width;
      const sy = r.top + ((1 - p.y) / 2) * r.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  pickLever(clientX, clientY) {
    const pts = [...this.leverViews].map(([id, v]) => ({ id, pos: v.pos }));
    return this.pickNearest(clientX, clientY, pts, 34); // DECISION (Claude): generous, levers are the room's button
  }

  pickVisitor(clientX, clientY) {
    const pts = this.sim.visitors.map((v) => ({ id: v.id, pos: new THREE.Vector3(v.x, v.kind === 'bat' ? 0.8 : 0.25, v.y) }));
    return this.pickNearest(clientX, clientY, pts, 30);
  }

  ndc(clientX, clientY) {
    // Convert a screen pixel to "normalized device coordinates" (−1..1), which the raycaster expects.
    const r = this.three.domElement.getBoundingClientRect();
    return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  // Which tile is under this screen point? Checks wall tops first, then the floor.
  pickTile(clientX, clientY) {
    const w = this.world;
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const hit = new THREE.Vector3();
    for (const h of [BLOCK_H, 0]) {
      // A Plane is defined by its normal and its distance from the origin (y = h here).
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -h);
      if (!this.raycaster.ray.intersectPlane(plane, hit)) continue;
      const x = Math.floor(hit.x);
      const y = Math.floor(hit.z);
      if (!w.inside(x, y)) continue;
      const i = w.idx(x, y);
      if (h === BLOCK_H && w.type[i] === T.FLOOR) continue; // looking past a wall top onto floor
      return i;
    }
    return -1;
  }

  // Which mole is under this screen point? DECISION (Claude, brief): a generous 36 px target,
  // because moles are small and moving.
  pickMole(clientX, clientY) {
    const r = this.three.domElement.getBoundingClientRect();
    let best = null;
    let bestD = 36;
    const p = new THREE.Vector3();
    for (const m of this.sim.moles) {
      p.set(m.x, 0.45, m.y).project(this.camera); // .project turns a 3D point into screen space (−1..1)
      const sx = r.left + ((p.x + 1) / 2) * r.width;
      const sy = r.top + ((1 - p.y) / 2) * r.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestD) {
        bestD = d;
        best = m.id;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- frame
  frame(dt) {
    this.time += dt;
    const roomsChanged = this.sim.roomsVersion !== this.seenRooms;
    if (this.world.version !== this.seenVersion || roomsChanged) {
      this.seenVersion = this.world.version;
      this.rebuildTiles();
    }
    // Rooms also redraw after any dig: furniture and levers lean on walls that may have just gone.
    if (roomsChanged || this.world.shapeVersion !== this.seenShape) {
      this.seenRooms = this.sim.roomsVersion;
      this.seenShape = this.world.shapeVersion;
      this.rebuildRooms();
    }
    this.animateLevers(dt);
    this.updatePortal(dt);
    this.syncVisitors(dt);
    this.twinkleTreasureTiles();
    this.updateTreasureRing(dt);
    this.updateLeverSigns();
    this.updateFan(dt);
    this.shakeDiggingTiles();
    this.consumeEvents();
    this.hoverRing.visible = false;
    this.syncMoles(dt);
    this.updateHoverExtras();
    this.updateBurrow(dt);
    this.updateParticles(dt);
    this.updateLanternLights();

    // Marks pulse gently; the hovered tile gets an outline.
    this.markBright.material.opacity = 0.5 + Math.sin(this.time * 4) * 0.12;
    const h = this.hover;
    if (h && h.kind === 'tile' && this.world.type[h.i] !== T.FLOOR) {
      this.hoverBox.visible = true;
      this.hoverBox.position.set(this.world.xOf(h.i) + 0.5, BLOCK_H / 2, this.world.yOf(h.i) + 0.5);
    } else {
      this.hoverBox.visible = false;
    }

    this.updateCamera();
    this.three.render(this.scene, this.camera);
  }
}

// Set how many instances to draw and tell Three.js the data changed.
function finish(mesh, count) {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

// A flat square frame (a square with a square hole), lying on the ground plane.
// Shape describes a 2D outline; ShapeGeometry turns it (and its holes) into a flat mesh.
function frameGeometry(outer, inner) {
  const s = new THREE.Shape();
  s.moveTo(-outer, -outer);
  s.lineTo(outer, -outer);
  s.lineTo(outer, outer);
  s.lineTo(-outer, outer);
  s.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-inner, -inner);
  hole.lineTo(-inner, inner);
  hole.lineTo(inner, inner);
  hole.lineTo(inner, -inner);
  hole.closePath();
  s.holes.push(hole);
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  return g;
}

// A soft round dot drawn on a small canvas, used as the lantern glow sprite.
function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32); // circle fading from centre to edge
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c); // turns the canvas into a texture Three.js can use
}
