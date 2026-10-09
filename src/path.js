// path.js — breadth-first search (BFS) over open floor.
//
// bfs() floods out from one tile and records, for every reachable floor tile,
// how many steps away it is (dist) and which tile it was reached from (prev).
// One flood answers "how far is everything?" for a mole, which is exactly what
// job choice needs. pathTo() then walks prev[] backwards to build a route.

import { T, DIRS } from './world.js';

export function bfs(world, start) {
  const { W, H } = world;
  const n = W * H;
  const dist = new Int32Array(n).fill(-1); // .fill(v) sets every slot to v.
  const prev = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n); // tiles waiting to be expanded, oldest first
  let head = 0;
  let tail = 0;

  dist[start] = 0;
  queue[tail++] = start;
  while (head < tail) {
    const c = queue[head++];
    const cx = c % W;
    const cy = (c / W) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (dist[ni] >= 0 || world.type[ni] !== T.FLOOR) continue;
      dist[ni] = dist[c] + 1;
      prev[ni] = c;
      queue[tail++] = ni;
    }
  }
  return { dist, prev, start };
}

// Route from the BFS start to `goal`, excluding the start tile, including the goal.
export function pathTo(res, goal) {
  const path = [];
  let c = goal;
  while (c !== res.start && c !== -1) {
    path.push(c);
    c = res.prev[c];
  }
  return path.reverse(); // .reverse() flips the array in place (we built it goal-first).
}
