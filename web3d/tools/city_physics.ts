// Times building the city's colliders and stepping the car on them, without
// a browser: node tools/city_physics.ts
import { readFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle } from '../src/vehicle.ts';
import { ferrariWheels } from './wheels.ts';

await RAPIER.init();
const glb = readFileSync(new URL('../public/city/zagreb.glb', import.meta.url));
const jsonLen = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLen).toString());
const bin = glb.subarray(20 + jsonLen + 8);
function accessor(i: number) {
  const a = gltf.accessors[i];
  const v = gltf.bufferViews[a.bufferView];
  const bytes = bin.subarray(v.byteOffset, v.byteOffset + v.byteLength);
  const copy = new Uint8Array(bytes).buffer;
  if (a.componentType === 5126) return new Float32Array(copy);
  if (a.componentType === 5125) return new Uint32Array(copy);
  return new Uint32Array(new Uint16Array(copy));
}
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = 1 / 60;
let t = performance.now();
for (const mesh of gltf.meshes) {
  const kind = mesh.name.split('/')[1];
  if (kind !== 'facade' && kind !== 'ground') continue;
  const p = mesh.primitives[0];
  const t0 = performance.now();
  world.createCollider(RAPIER.ColliderDesc.trimesh(accessor(p.attributes.POSITION) as Float32Array, accessor(p.indices) as Uint32Array));
  const ms = performance.now() - t0;
  if (ms > 50) console.log(`${mesh.name}: ${ms.toFixed(0)} ms`);
}
console.log(`colliders ${(performance.now() - t).toFixed(0)} ms`);
world.createCollider(RAPIER.ColliderDesc.cuboid(3000, 1, 3000).setTranslation(0, -1.02, 0));
const car = new Vehicle(RAPIER, world, ferrariWheels, { x: -70, y: 0.4, z: -6 }, Math.PI / 2);
t = performance.now();
for (let i = 0; i < 600; i++) {
  car.update(1 / 60, { throttle: i < 300 ? 1 : 0, brake: i >= 300 ? 1 : 0, steer: 0, handbrake: false });
  world.step();
}
const p = car.body.translation();
console.log(`600 steps ${(performance.now() - t).toFixed(0)} ms; car at ${p.x.toFixed(1)} ${p.y.toFixed(2)} ${p.z.toFixed(1)}, ${(car.speed * 3.6).toFixed(0)} km/h`);
