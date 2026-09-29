// Headless checks of the car physics, on flat ground with a kerb and a wall.
//
//   node tools/sim.ts
//
// Prints the numbers a driver feels: 0-100 km/h, top speed, braking
// distance, steering sense, cornering at speed, a kerb climb, a wall hit.
// Exits non-zero when one is out of range.

import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle, type DriveInput } from '../src/vehicle.ts';
import { ferrariWheels } from './wheels.ts';

await RAPIER.init();

const dt = 1 / 60;
let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failures++;
}

function makeWorld() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = dt;
  world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 1, 2000).setTranslation(0, -1, 0).setFriction(1));
  return world;
}

function run(world: RAPIER.World, car: Vehicle, seconds: number, input: DriveInput, each?: (t: number) => boolean | void) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    car.update(dt, input);
    world.step();
    if (each?.(i * dt)) return i * dt;
  }
  return seconds;
}

const idle: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const gas: DriveInput = { ...idle, throttle: 1 };

// Settle: rest height and no drift.
{
  const world = makeWorld();
  const car = new Vehicle(RAPIER, world, ferrariWheels, { x: 0, y: 0.3, z: 0 }, 0);
  run(world, car, 3, idle);
  const p = car.body.translation();
  check('settles', Math.abs(p.y) < 0.12 && Math.hypot(p.x, p.z) < 0.05, `rest y=${p.y.toFixed(3)} drift=${Math.hypot(p.x, p.z).toFixed(3)}`);
  check('faces north', Math.abs(car.heading()) < 0.01, `heading=${car.heading().toFixed(3)}`);
}

// Acceleration, top speed, braking, direction of travel.
{
  const world = makeWorld();
  const car = new Vehicle(RAPIER, world, ferrariWheels, { x: 0, y: 0.1, z: 0 }, 0);
  run(world, car, 1, idle);
  const t100 = run(world, car, 30, gas, () => car.speed >= 100 / 3.6);
  check('0-100 km/h', t100 > 3.5 && t100 < 9, `${t100.toFixed(2)} s`);
  run(world, car, 30, gas);
  check('top speed', car.speed * 3.6 > 140 && car.speed * 3.6 < 210, `${(car.speed * 3.6).toFixed(0)} km/h`);
  const p = car.body.translation();
  check('drives north (-z)', p.z < -100 && Math.abs(p.x) < 5, `x=${p.x.toFixed(1)} z=${p.z.toFixed(1)}`);
  // Brake from 100 km/h.
  const world2 = makeWorld();
  const car2 = new Vehicle(RAPIER, world2, ferrariWheels, { x: 0, y: 0.1, z: 0 }, Math.PI / 2);
  run(world2, car2, 1, idle);
  run(world2, car2, 30, gas, () => car2.speed >= 100 / 3.6);
  const x0 = car2.body.translation().x;
  const tStop = run(world2, car2, 10, { ...idle, brake: 1 }, () => car2.speed < 0.5);
  const dist = car2.body.translation().x - x0;
  check('east is +x', dist > 0, `moved ${dist.toFixed(1)} m in x while braking`);
  check('100-0 braking', dist > 28 && dist < 60, `${dist.toFixed(1)} m in ${tStop.toFixed(2)} s`);
  const tRev = run(world2, car2, 3, { ...idle, brake: 1 });
  check('reverses', car2.speed < -2, `${(car2.speed * 3.6).toFixed(0)} km/h after ${tRev} s`);
  // Coasting slows the car.
  run(world2, car2, 3, gas);
  const vc = car2.speed;
  run(world2, car2, 5, idle);
  check('coasts down', car2.speed < vc - 1 && car2.speed > 0, `${(vc * 3.6).toFixed(0)} -> ${(car2.speed * 3.6).toFixed(0)} km/h in 5 s`);
}

// Steering: right turns clockwise (heading grows); tight at low speed,
// stays upright at speed.
{
  const world = makeWorld();
  const car = new Vehicle(RAPIER, world, ferrariWheels, { x: 0, y: 0.1, z: 0 }, 0);
  run(world, car, 1, idle);
  run(world, car, 2.5, gas);
  const h0 = car.heading();
  run(world, car, 1.5, { ...gas, throttle: 0.3, steer: 1 });
  const dh = car.heading() - h0;
  check('steer right turns right', dh > 0.3, `heading +${dh.toFixed(2)} rad`);

  const world2 = makeWorld();
  const car2 = new Vehicle(RAPIER, world2, ferrariWheels, { x: 0, y: 0.1, z: 0 }, 0);
  run(world2, car2, 1, idle);
  run(world2, car2, 30, gas, () => car2.speed >= 90 / 3.6);
  let maxRoll = 0;
  let lastH = car2.heading();
  let turned = 0;
  run(world2, car2, 4, { ...gas, throttle: 0.6, steer: -1 }, () => {
    const q = car2.body.rotation();
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    maxRoll = Math.max(maxRoll, Math.acos(Math.min(1, upY)));
    const h = car2.heading();
    let d = h - lastH;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    turned += d;
    lastH = h;
  });
  check('full lock at 90 km/h stays upright', maxRoll < 0.35, `max tilt ${(maxRoll * 57.3).toFixed(1)} deg, turned ${(turned * 57.3).toFixed(0)} deg, now ${(car2.speed * 3.6).toFixed(0)} km/h`);

  // Handbrake turn at 60 km/h rotates the car more than steering alone.
  const turnWith = (handbrake: boolean) => {
    const w = makeWorld();
    const c = new Vehicle(RAPIER, w, ferrariWheels, { x: 0, y: 0.1, z: 0 }, 0);
    run(w, c, 1, idle);
    run(w, c, 30, gas, () => c.speed >= 60 / 3.6);
    const start = c.heading();
    run(w, c, 1.2, { ...idle, steer: 1, handbrake });
    let d = c.heading() - start;
    if (d < -Math.PI) d += 2 * Math.PI;
    return d;
  };
  const plain = turnWith(false), hb = turnWith(true);
  check('handbrake rotates the car', hb > plain * 1.2, `${(plain * 57.3).toFixed(0)} deg plain, ${(hb * 57.3).toFixed(0)} deg with handbrake`);
}

// A 15 cm kerb, driven onto square at 20 km/h.
{
  const world = makeWorld();
  world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.075, 20).setTranslation(0, 0.075, -30));
  const car = new Vehicle(RAPIER, world, ferrariWheels, { x: 0, y: 0.1, z: 0 }, 0);
  run(world, car, 1, idle);
  run(world, car, 10, { ...gas, throttle: 0.5 }, () => car.speed > 20 / 3.6);
  run(world, car, 3, { ...idle, throttle: 0.25 });
  const p = car.body.translation();
  check('climbs a kerb', p.z < -12 && p.y > 0.08, `z=${p.z.toFixed(1)} y=${p.y.toFixed(2)}`);
}

// A wall hit at 50 km/h stops the car without passing through or launching.
{
  const world = makeWorld();
  world.createCollider(RAPIER.ColliderDesc.cuboid(20, 5, 0.2).setTranslation(0, 5, -60));
  const car = new Vehicle(RAPIER, world, ferrariWheels, { x: 0, y: 0.1, z: 0 }, 0);
  run(world, car, 1, idle);
  run(world, car, 10, gas, () => car.speed > 50 / 3.6);
  let maxY = 0;
  run(world, car, 4, idle, () => {
    maxY = Math.max(maxY, car.body.translation().y);
  });
  const p = car.body.translation();
  check('stops at a wall', p.z > -60 && maxY < 1.5, `z=${p.z.toFixed(1)} peak y=${maxY.toFixed(2)}`);
}

// A 12% ramp (steeper than any street in the core): the car climbs it from
// a standstill and holds on it with the brake.
{
  const world = makeWorld();
  const slope = Math.atan(0.12);
  const len = 60;
  // A thin box tilted about x, rising toward -z (north), its low end at z = -5.
  const q = { x: Math.sin(slope / 2), y: 0, z: 0, w: Math.cos(slope / 2) };
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(10, 0.5, len / 2)
      .setRotation(q)
      .setTranslation(0, (len / 2) * Math.sin(slope) - 0.5 * Math.cos(slope), -5 - (len / 2) * Math.cos(slope)),
  );
  const car = new Vehicle(RAPIER, world, ferrariWheels, { x: 0, y: 0.1, z: 0 }, 0);
  run(world, car, 1, idle);
  run(world, car, 6, gas, () => car.body.translation().z < -30);
  const p = car.body.translation();
  check('climbs a 12% ramp', p.z < -25 && p.y > 2, `z=${p.z.toFixed(1)} y=${p.y.toFixed(2)} at ${(car.speed * 3.6).toFixed(0)} km/h`);
  // The foot brake stops it; at a standstill S means reverse, so the
  // handbrake is what holds it there.
  run(world, car, 3, { ...idle, brake: 1 }, () => car.speed < 0.3);
  const z0 = car.body.translation().z;
  run(world, car, 3, { ...idle, handbrake: true });
  const drift = Math.abs(car.body.translation().z - z0);
  check('handbrake holds on the ramp', drift < 0.5, `rolled ${drift.toFixed(2)} m in 3 s`);
}

process.exit(failures ? 1 : 0);
