// Headless check of the tram traffic: runs the trams on the real tracks (no
// car) and fails when one stands still for a minute, stays off the map for
// two, or two trams overlap (at a merge or a crossing).
//
//   node tools/tram_sim.ts [minutes] [metres of route per tram]

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { Trams } from '../src/trams.ts';

await RAPIER.init();
THREE.TextureLoader.prototype.load = () => new THREE.Texture(); // no DOM here

const city = JSON.parse(readFileSync(new URL('../public/city/city.json', import.meta.url), 'utf8'));
const [ex0, ez0, ex1, ez1] = city.extent;
const minutes = Number(process.argv[2] ?? 20);
const spacing = Number(process.argv[3] ?? 400);
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const trams = new Trams(RAPIER, world, city.trams, (x, z) => x > ex0 + 6 && x < ex1 - 6 && z > ez0 + 6 && z < ez1 - 6, () => 0, spacing);

interface T { s: number; speed: number; hidden: boolean; wait: number; route: { length: number; gates: { enter: number; exit: number }[] } }
const view = trams as unknown as { trams: T[]; bodyPts: THREE.Vector3[][] };
const list = view.trams;
const routes = [...new Set(list.map((t) => t.route))];
routes.forEach((r, i) => console.log(`route ${i}: ${r.length} m, ${list.filter((t) => t.route === r).length} trams, gates ${r.gates.map((g) => `${g.enter}..${g.exit}`).join(' ') || '-'}`));

const dt = 1 / 60;
const far = new THREE.Vector3(1e9, 0, 1e9);
const still = list.map(() => 0), off = list.map(() => 0);
let fail = '', waits = 0, trips = 0;
const where = (k: number) => `#${k} at (${view.bodyPts[k][0].x.toFixed(0)}, ${view.bodyPts[k][0].z.toFixed(0)})`;
for (let i = 0; i < minutes * 3600 && !fail; i++) {
  const was = list.map((t) => [t.wait > 0, t.hidden]);
  trams.step(dt, far);
  world.step();
  list.forEach((t, k) => {
    still[k] = !t.hidden && t.speed < 0.05 ? still[k] + dt : 0;
    off[k] = t.hidden ? off[k] + dt : 0;
    if (t.wait > 0 && !was[k][0]) waits++;
    if (t.hidden && !was[k][1]) trips++;
    if (still[k] > 60) fail ||= `${where(k)} has not moved for a minute`;
    if (off[k] > 120) fail ||= `#${k} has been off the map for two minutes`;
  });
  // Bodies of two trams closer than a tram is wide (as of the step's start; 1e9 = off the map).
  const pts = view.bodyPts;
  for (let a = 0; a < list.length && !fail; a++)
    for (let b = a + 1; b < list.length && !fail; b++)
      if (pts[a][0].x < 1e8 && pts[b][0].x < 1e8 && pts[a].some((p) => pts[b].some((q) => Math.hypot(p.x - q.x, p.z - q.z) < 1.8)))
        fail = `${where(a)} and ${where(b)} overlap`;
  if (fail) {
    console.log(`t=${(i * dt).toFixed(0)} s: ${fail}`);
    if (process.env.DUMP)
      list.forEach((t, k) => {
        const holds = t.route.gates.filter((g) => (g as unknown as { junction: { holders: Set<T> } }).junction.holders.has(t)).length;
        console.log(`  #${k} r${routes.indexOf(t.route)} s=${t.s.toFixed(1)} v=${t.speed.toFixed(2)} ${t.hidden ? 'hidden' : `(${view.bodyPts[k][0].x.toFixed(0)}, ${view.bodyPts[k][0].z.toFixed(0)})`} wait=${t.wait.toFixed(0)} holds=${holds}`);
      });
  }
}
console.log(`${list.length} trams, ${minutes} min: ${trips} trips done, ${waits} waits at junctions, ${fail ? 'FAIL' : 'ok'}`);
process.exit(fail ? 1 : 0);
