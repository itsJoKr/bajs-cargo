// The ground under and around the city, from the grids
// tool/prepare_terrain.py derives from Copernicus GLO-30 (heights relative
// to the ground at the statue; stored x east, z NORTH, so z is mirrored
// here), and the far horizon: Medvednica to the north, the Sava plain south.

import * as THREE from 'three';

export interface Grid {
  x0: number;
  z0: number;
  cell: number;
  columns: number;
  rows: number;
  heights: number[];
}

/** Bilinear height at web (x, z), clamped at the grid's edges. */
export function sampleGrid(g: Grid, x: number, zWeb: number): number {
  const fx = (x - g.x0) / g.cell, fz = (-zWeb - g.z0) / g.cell;
  const c = Math.floor(fx), r = Math.floor(fz);
  const tx = Math.min(1, Math.max(0, fx - c)), tz = Math.min(1, Math.max(0, fz - r));
  const at = (cc: number, rr: number) =>
    g.heights[Math.min(g.rows - 1, Math.max(0, rr)) * g.columns + Math.min(g.columns - 1, Math.max(0, cc))];
  return (
    at(c, r) * (1 - tx) * (1 - tz) + at(c + 1, r) * tx * (1 - tz) + at(c, r + 1) * (1 - tx) * tz + at(c + 1, r + 1) * tx * tz
  );
}

/** A grid as a mesh in the web frame; [height] maps (x, zWeb, h) to y. */
export function gridGeometry(g: Grid, height: (x: number, z: number, h: number) => number, step = 1) {
  const cols = Math.floor((g.columns - 1) / step) + 1;
  const rows = Math.floor((g.rows - 1) / step) + 1;
  const pos = new Float32Array(cols * rows * 3);
  let o = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = g.x0 + c * step * g.cell;
      const z = -(g.z0 + r * step * g.cell);
      pos[o++] = x;
      pos[o++] = height(x, z, g.heights[r * step * g.columns + c * step]);
      pos[o++] = z;
    }
  }
  const index: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      // Rows run north (-z), columns east: this winding faces up.
      index.push(a, b, d, b, e, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** The far horizon: its own scene, drawn before the city with a far camera. */
export function farTerrain(far: Grid, ground: Grid, hazeColor: THREE.Color) {
  const geo = gridGeometry(far, (x, z, h) => {
    const inGround =
      x > ground.x0 && x < ground.x0 + (ground.columns - 1) * ground.cell &&
      -z > ground.z0 && -z < ground.z0 + (ground.rows - 1) * ground.cell;
    // Under the city the detailed ground takes over; keep the horizon below it.
    return inGround ? Math.min(h, sampleGrid(ground, x, z)) - 6 : h - 2;
  });
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const low = new THREE.Color(0x8f9870), forest = new THREE.Color(0x56733f), rock = new THREE.Color(0x7c8270);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const d = Math.hypot(pos.getX(i), pos.getZ(i));
    // Low plain, forested slopes above ~80 m, a greyer summit.
    c.copy(low).lerp(forest, THREE.MathUtils.smoothstep(y, 40, 160)).lerp(rock, THREE.MathUtils.smoothstep(y, 700, 880));
    // Aerial perspective: distance fades toward the haze.
    c.lerp(hazeColor, 1 - Math.exp(-d / 7000));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }));
  mesh.name = 'far terrain';
  return mesh;
}
