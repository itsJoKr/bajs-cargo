// Headless checks of the car physics, on flat ground with a kerb and a wall.
//
//   node tools/sim.ts
//
// Prints the numbers a driver feels: 0-100 km/h, top speed, braking
// distance, steering sense, cornering at speed, a kerb climb, a wall hit.
// Exits non-zero when one is out of range.

import RAPIER from '@dimforge/rapier3d-compat';
import { Vehicle, bikeTuning, bikeWheels, type DriveInput } from '../src/vehicle.ts';
import { ferrariWheels } from './wheels.ts';
import { Furniture, type TerraceTable } from '../src/furniture.ts';

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

// The Bajs cargo bike: holding the gas vs tapping it fast (the cadence
// Controls computes: each press adds a stroke, strokes fade over 0.35 s).
{
  const bike = (world: RAPIER.World, heading = 0) => new Vehicle(RAPIER, world, bikeWheels, { x: 0, y: 0.05, z: 0 }, heading, bikeTuning);
  const tapping = (hz: number) => {
    let strokes = 0, last = -1;
    return (t: number): DriveInput => {
      const k = Math.floor(t * hz);
      if (k !== last) strokes += 1;
      last = k;
      strokes *= Math.exp(-dt / 0.35);
      return { ...idle, throttle: (t * hz) % 1 < 0.5 ? 1 : 0, cadence: Math.min(1, strokes / 2.6) };
    };
  };
  const to25 = (input: (t: number) => DriveInput) => {
    const world = makeWorld();
    const b = bike(world);
    run(world, b, 1, idle);
    let t = 0;
    for (; t < 20 && b.speed < 25 / 3.6; t += dt) {
      b.update(dt, input(t));
      world.step();
    }
    for (let i = 0; i < 20 / dt; i++) {
      b.update(dt, input(t + i * dt));
      world.step();
    }
    return { t, top: b.speed * 3.6 };
  };
  const hold = to25(() => gas), tap = to25(tapping(7));
  check('bike: 0-25 km/h holding', hold.t > 0.8 && hold.t < 2.5, `${hold.t.toFixed(2)} s, top ${hold.top.toFixed(1)} km/h`);
  check('bike: tapping gets there faster', tap.t < hold.t * 0.8, `${tap.t.toFixed(2)} s at 7 taps/s`);
  check('bike: tapping pushes past the held top speed', hold.top > 64 && hold.top < 72 && tap.top > 95 && tap.top < 110,
    `${hold.top.toFixed(1)} km/h holding, ${tap.top.toFixed(1)} km/h tapping`);

  // Backing up: S at a standstill, faster when tapped (the same strokes).
  const backUp = (hz: number) => {
    const world = makeWorld();
    const b = bike(world);
    run(world, b, 1, idle);
    const tap = tapping(hz);
    for (let t = 0; t < 4; t += dt) {
      const i = tap(t);
      b.update(dt, hz ? { ...idle, brake: i.throttle, backCadence: i.cadence } : { ...idle, brake: 1 });
      world.step();
    }
    return -b.speed * 3.6;
  };
  const backHold = backUp(0), backTap = backUp(7);
  check('bike: backs up holding S', backHold > 11 && backHold < 16, `${backHold.toFixed(1)} km/h after 4 s`);
  check('bike: tapping S backs up faster', backTap > backHold * 1.4 && backTap < 28, `${backTap.toFixed(1)} km/h at 7 taps/s`);

  // Full lock while sprinting at ~90 km/h.
  const world = makeWorld();
  const b = bike(world);
  run(world, b, 1, idle);
  const sprint = tapping(7);
  let st = 0;
  for (; st < 20 && b.speed < 90 / 3.6; st += dt) {
    b.update(dt, sprint(st));
    world.step();
  }
  let maxRoll = 0;
  for (let i = 0; i < 3 / dt; i++) {
    b.update(dt, { ...sprint(st + i * dt), steer: 1 });
    world.step();
    const q = b.body.rotation();
    maxRoll = Math.max(maxRoll, Math.acos(Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z))));
  }
  check('bike: full lock at 90 km/h stays up', maxRoll < 0.15, `max tilt ${(maxRoll * 57.3).toFixed(1)} deg, now ${(b.speed * 3.6).toFixed(0)} km/h`);
  // A kick at ~90 km/h (a kerb, a landing): 2.5 rad/s of yaw while tapping
  // on. The slide must die out, not grow into a spin.
  {
    const w = makeWorld();
    const c = bike(w);
    run(w, c, 1, idle);
    const tap = tapping(7);
    let kt = 0;
    for (; kt < 20 && c.speed < 90 / 3.6; kt += dt) {
      c.update(dt, tap(kt));
      w.step();
    }
    c.body.setAngvel({ x: 0, y: 2.5, z: 0 }, true);
    const slip = () => {
      const lv = c.body.linvel();
      const d = Math.atan2(lv.x, -lv.z) - c.heading();
      return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
    };
    let peak = 0;
    for (let i = 0; i < 1.5 / dt; i++) {
      c.update(dt, tap(kt + i * dt));
      w.step();
      peak = Math.max(peak, slip());
    }
    check('bike: a slide at 90 km/h straightens up', slip() < 0.1 && peak < 0.6 && c.speed > 60 / 3.6,
      `peak ${(peak * 57.3).toFixed(0)} deg, ${(slip() * 57.3).toFixed(0)} deg after 1.5 s, ${(c.speed * 3.6).toFixed(0)} km/h`);
  }
  const turnWith = (handbrake: boolean) => {
    const w = makeWorld();
    const c = bike(w);
    run(w, c, 1, idle);
    run(w, c, 30, gas, () => c.speed >= 22 / 3.6);
    const start = c.heading();
    run(w, c, 1, { ...idle, steer: 1, handbrake });
    return c.heading() - start;
  };
  const plain = turnWith(false), skid = turnWith(true);
  check('bike: rear-brake skid rotates it', skid > plain * 1.2, `${(plain * 57.3).toFixed(0)} deg plain, ${(skid * 57.3).toFixed(0)} deg skidding`);

  // Onto a 12 cm kerb at 12 km/h, then stopped on a 12% ramp, let go: the
  // rider's foot holds it.
  const kw = makeWorld();
  kw.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.06, 20).setTranslation(0, 0.06, -30));
  const kb = bike(kw);
  run(kw, kb, 1, idle);
  run(kw, kb, 10, gas, () => kb.speed > 12 / 3.6);
  run(kw, kb, 3, gas);
  const kp = kb.body.translation();
  check('bike: climbs a kerb', kp.z < -12 && kp.y > 0.08, `z=${kp.z.toFixed(1)} y=${kp.y.toFixed(2)}`);
  const rw = makeWorld();
  const slope = Math.atan(0.12);
  rw.createCollider(
    RAPIER.ColliderDesc.cuboid(10, 0.5, 30)
      .setRotation({ x: Math.sin(slope / 2), y: 0, z: 0, w: Math.cos(slope / 2) })
      .setTranslation(0, 30 * Math.sin(slope) - 0.5 * Math.cos(slope), -5 - 30 * Math.cos(slope)),
  );
  const rb = bike(rw);
  run(rw, rb, 1, idle);
  run(rw, rb, 15, gas, () => rb.body.translation().z < -25);
  const climbed = rb.body.translation();
  run(rw, rb, 3, { ...idle, brake: 1 }, () => rb.speed < 0.3);
  const z0 = rb.body.translation().z;
  run(rw, rb, 3, idle);
  const drift = Math.abs(rb.body.translation().z - z0);
  check('bike: climbs a 12% ramp, held by a foot', climbed.z < -25 && drift < 0.3, `y=${climbed.y.toFixed(2)}, rolled ${drift.toFixed(2)} m in 3 s`);
}

// Café furniture: stands still when woken, and flies when the car hits it
// without slowing or lifting the car. Built as main.ts builds it: settled
// once, then asleep.
function terrace(world: RAPIER.World) {
  const tables: TerraceTable[] = [[0, -40, 0, Math.PI / 2, '#ffffff'], [6, -40, 0, 0, '#ffffff']];
  const furniture = new Furniture(RAPIER, world, tables);
  furniture.settle();
  const bodies: RAPIER.RigidBody[] = [];
  world.forEachRigidBody((b) => void (b.isDynamic() && bodies.push(b)));
  const home = bodies.map((b) => ({ ...b.translation() }));
  const moved = (b: RAPIER.RigidBody) => {
    const t = b.translation(), h = home[bodies.indexOf(b)];
    return Math.hypot(t.x - h.x, t.y - h.y, t.z - h.z);
  };
  return { furniture, bodies, home, moved };
}
{
  const world = makeWorld();
  const { furniture, bodies, moved } = terrace(world);
  for (const b of bodies) b.wakeUp();
  for (let i = 0; i < 180; i++) {
    furniture.step();
    world.step();
  }
  const settle = Math.max(...bodies.map(moved));
  check('furniture stands still', settle < 0.02, `${bodies.length} pieces, max drift ${(settle * 100).toFixed(1)} cm in 3 s`);
}
{
  // The car, 40 m south of the first table, drives north through it at
  // about 70 km/h; the second table is 6 m to the side.
  const world = makeWorld();
  const { furniture, bodies, home, moved } = terrace(world);
  const car = new Vehicle(RAPIER, world, ferrariWheels, { x: 0, y: 0.1, z: 0 }, 0);
  run(world, car, 1, idle);
  const near = bodies.filter((_, i) => home[i].x < 3);
  const peak = new Map<RAPIER.RigidBody, number>();
  let before = 0, after = 0, carPeak = 0;
  run(world, car, 8, gas, () => {
    furniture.step(dt, car.body);
    const z = car.body.translation().z;
    if (z > -36) before = car.speed;
    else if (z < -44 && !after) after = car.speed;
    carPeak = Math.max(carPeak, car.body.translation().y);
    for (const b of near) peak.set(b, Math.max(peak.get(b) ?? 0, b.translation().y));
    return z < -60;
  });
  run(world, car, 4, idle, () => void furniture.step(dt, car.body));
  const flew = near.filter((b) => (peak.get(b) ?? 0) > 0.8).length;
  const far = Math.min(...near.map(moved));
  check('car scatters a café table', flew >= 3 && far > 3, `${flew} of ${near.length} pieces rose past 0.8 m, all moved >= ${far.toFixed(1)} m`);
  check('furniture does not stop the car', after >= before && carPeak < 0.35, `${(before * 3.6).toFixed(0)} -> ${(after * 3.6).toFixed(0)} km/h through it, car peak y ${carPeak.toFixed(2)}`);
  const side = Math.max(...bodies.filter((_, i) => home[i].x >= 3).map(moved));
  check('the table beside the road stays put', side < 0.02, `moved ${(side * 100).toFixed(1)} cm`);
}

{
  // Down a row of ten terraces at speed: past a few pieces in the air, hit
  // pieces start to vanish, so the flying crowd stays small.
  const world = makeWorld();
  const tables: TerraceTable[] = Array.from({ length: 10 }, (_, i) => [0, -30 - 3 * i, 0, Math.PI / 2, '#ffffff']);
  const furniture = new Furniture(RAPIER, world, tables);
  furniture.settle();
  const car = new Vehicle(RAPIER, world, ferrariWheels, { x: 0, y: 0.1, z: 0 }, 0);
  run(world, car, 1, idle);
  let peak = 0, before = 0, after = 0;
  run(world, car, 8, gas, () => {
    furniture.step(dt, car.body);
    peak = Math.max(peak, furniture.stats().flying);
    const z = car.body.translation().z;
    if (z > -26) before = car.speed;
    else if (z < -62 && !after) after = car.speed;
    return z < -70;
  });
  const { gone } = furniture.stats();
  check('a row of terraces thins out', gone > 0 && peak <= 24 && after >= before * 0.95,
    `${gone} of ${furniture.count} pieces vanished, at most ${peak} flying, ${(before * 3.6).toFixed(0)} -> ${(after * 3.6).toFixed(0)} km/h`);
  furniture.reset();
  world.step();
  check('reset brings them back', furniture.stats().gone === 0 && furniture.awake() === furniture.count, `${furniture.awake()} of ${furniture.count} back and awake`);
}

process.exit(failures ? 1 : 0);
