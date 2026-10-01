// The car's physics: a Rapier rigid body driven by Rapier's raycast vehicle
// controller (a port of Bullet's btRaycastVehicle): each wheel is a
// suspension ray with a spring, a damper and a friction model, so kerbs,
// weight transfer, understeer and handbrake slides come out of the solver
// rather than out of hand-written rules.
//
// No three.js in here, so tools/sim.ts can run it under plain Node.
//
// Car frame: z = forward (Rapier's forward axis index 2), y = up, so x
// points to the driver's left. The body's origin sits at road level under
// the car's centre.

import type RAPIER_NS from '@dimforge/rapier3d-compat';

type Rapier = typeof RAPIER_NS;
type Vec3 = { x: number; y: number; z: number };

export interface DriveInput {
  /** 0..1 */
  throttle: number;
  /** 0..1; reverses once the car has stopped. */
  brake: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  handbrake: boolean;
  /** 0..1: how fast the gas is being tapped (pedal strokes), see Controls. */
  cadence?: number;
  /** 0..1: the same for the brake, which backs the bike up faster. */
  backCadence?: number;
}

export interface WheelSpec {
  /** Wheel centre in the car frame at rest. */
  center: Vec3;
  radius: number;
  front: boolean;
}

type Box = { half: Vec3; at: Vec3 };

/** Tuning, in SI units. */
export interface VehicleTuning {
  mass: number;
  comHeight: number;
  /** Centre of mass ahead of the body origin. */
  comZ: number;
  /** The box the inertia is computed from (full size). */
  size: Vec3;
  /** The body shell's cuboids; the wheels are rays under it. */
  shell: Box[];
  /** The shell as one box, for furniture.ts's sweep. */
  sweep: Box;
  suspensionRest: number;
  suspensionTravel: number;
  stiffness: number;
  compression: number;
  relaxation: number;
  frictionSlipFront: number;
  frictionSlipRear: number;
  frictionSlipHandbrake: number;
  sideStiffness: number;
  engineForce: number;
  /** Extra drive force, as a share of [engineForce], at full tap cadence. */
  pedalBoost: number;
  reverseForce: number;
  topSpeed: number;
  /** Top speed at full tap cadence: pedalling hard pushes past the assist. */
  sprintTopSpeed: number;
  reverseTopSpeed: number;
  /** Reverse top speed at full tap cadence of the brake. */
  sprintReverseTopSpeed: number;
  brake: number;
  handbrake: number;
  coast: number;
  /** Below this speed (m/s), letting go holds the vehicle (a foot down). */
  holdBelow: number;
  /** Traction control: drive per wheel at most this share of what its tyre
   * holds (suspension force x friction slip), so full power cannot spin the
   * rear out and leave it no side grip. 0 = off. */
  tractionShare: number;
  /** Rider balance (1/s): bleeds off sideways sliding unless the handbrake
   * is held, so a kicked-out bike straightens up. 0 = off. */
  gripAssist: number;
  maxSteer: number;
  steerHalfSpeed: number;
  steerRate: number;
  dragCoefficient: number;
}

export const carTuning: VehicleTuning = {
  mass: 1350,
  /** Centre of mass height: low, so hard cornering slides before it rolls. */
  comHeight: 0.42,
  comZ: 0.05,
  size: { x: 1.9, y: 1.2, z: 4.5 },
  // The floor clears a kerb, so only the wheels touch the ground. Two boxes,
  // the cabin narrower than the sills.
  shell: [
    { half: { x: 0.93, y: 0.26, z: 2.2 }, at: { x: 0, y: 0.62, z: 0 } },
    { half: { x: 0.7, y: 0.22, z: 1.1 }, at: { x: 0, y: 1.05, z: -0.15 } },
  ],
  sweep: { half: { x: 0.95, y: 0.7, z: 2.25 }, at: { x: 0, y: 0.65, z: 0 } },
  suspensionRest: 0.3,
  suspensionTravel: 0.22,
  /** Spring rate per unit mass (Bullet scales it by the chassis mass). */
  stiffness: 38,
  compression: 3.6,
  relaxation: 4.6,
  frictionSlipFront: 1.55,
  frictionSlipRear: 1.45,
  /** Rear grip while the handbrake is held. */
  frictionSlipHandbrake: 0.6,
  sideStiffness: 1,
  /** Peak drive force (N) summed over the rear wheels. */
  engineForce: 9500,
  pedalBoost: 0,
  reverseForce: 4200,
  topSpeed: 52,
  sprintTopSpeed: 52,
  reverseTopSpeed: 9,
  sprintReverseTopSpeed: 9,
  /** Brake impulse per wheel per step, at 60 Hz. */
  brake: 70,
  handbrake: 60,
  /** Light brake while coasting: engine braking plus rolling resistance. */
  coast: 2.2,
  holdBelow: 0,
  tractionShare: 0,
  gripAssist: 0,
  maxSteer: 0.62,
  /** Steering lock halves at this speed (m/s). */
  steerHalfSpeed: 22,
  /** Steering rate, radians per second. */
  steerRate: 2.6,
  dragCoefficient: 0.38,
};

/** The Bajs cargo bike (a Dolly long john) with a rider: 130 kg, a
 * (very) e-assist that tops out near 68 km/h, and pedal strokes (tapping the
 * gas) that pull harder than just holding it and push on to ~100 km/h. Four
 * rays close together stand in for the two wheels, so the bike stays up in
 * corners; a hard hit or a kerb at speed can still roll it (R resets).
 * bikeModel.ts leans it into turns for the eye. */
export const bikeTuning: VehicleTuning = {
  mass: 130,
  // At the axles, well under the rider's real one: four rays 0.4 m apart
  // would otherwise roll it over in any hard turn.
  comHeight: 0.1,
  comZ: -0.25,
  size: { x: 0.7, y: 1.6, z: 2.6 },
  shell: [
    // The cargo box, the rider over the rear frame, the front wheel.
    { half: { x: 0.33, y: 0.25, z: 0.58 }, at: { x: 0, y: 0.48, z: 0.36 } },
    { half: { x: 0.24, y: 0.52, z: 0.5 }, at: { x: 0, y: 1.0, z: -0.62 } },
    { half: { x: 0.05, y: 0.14, z: 0.2 }, at: { x: 0, y: 0.38, z: 1.06 } },
  ],
  sweep: { half: { x: 0.36, y: 0.8, z: 1.3 }, at: { x: 0, y: 0.8, z: 0 } },
  // Long and soft enough to keep the wheels down over bumps at 100 km/h.
  suspensionRest: 0.18,
  suspensionTravel: 0.14,
  stiffness: 45,
  compression: 3.9,
  relaxation: 5,
  frictionSlipFront: 1.9,
  frictionSlipRear: 1.8,
  frictionSlipHandbrake: 0.45,
  sideStiffness: 1,
  engineForce: 800,
  pedalBoost: 1.8,
  reverseForce: 400,
  topSpeed: 19,
  sprintTopSpeed: 28.9,
  reverseTopSpeed: 4,
  sprintReverseTopSpeed: 7,
  brake: 7,
  handbrake: 6,
  coast: 0.05,
  holdBelow: 0.5,
  tractionShare: 0.75,
  gripAssist: 4,
  maxSteer: 0.75,
  steerHalfSpeed: 4.5,
  steerRate: 3.2,
  dragCoefficient: 0.2,
};

/** The bike's axles in its frame (z forward, origin on the road under the
 * middle), shared with bikeModel.ts: a 20" wheel under the box, a 26" one
 * behind. */
export const bikeAxles = {
  front: { z: 1.02, radius: 0.26 },
  rear: { z: -1.06, radius: 0.33 },
};

/** Two rays per real wheel, close together, set lower than the axle by the
 * spring's sag under the bike's weight (61% on the rear), so the body rests
 * with its wheels exactly on the road. */
export const bikeWheels: WheelSpec[] = (() => {
  const { front, rear } = bikeAxles;
  const sag = (share: number) => (share / 2) * 9.81 / bikeTuning.stiffness;
  const f = { y: front.radius - sag(0.39), radius: front.radius };
  const r = { y: rear.radius - sag(0.61), radius: rear.radius };
  return [
    { center: { x: 0.22, y: f.y, z: front.z }, radius: f.radius, front: true },
    { center: { x: -0.22, y: f.y, z: front.z }, radius: f.radius, front: true },
    { center: { x: 0.2, y: r.y, z: rear.z }, radius: r.radius, front: false },
    { center: { x: -0.2, y: r.y, z: rear.z }, radius: r.radius, front: false },
  ];
})();

export class Vehicle {
  readonly body: RAPIER_NS.RigidBody;
  readonly controller: RAPIER_NS.DynamicRayCastVehicleController;
  readonly wheels: WheelSpec[];
  readonly tuning: VehicleTuning;
  private readonly R: Rapier;
  private readonly world: RAPIER_NS.World;
  private steerAngle = 0;
  /** Signed forward speed, m/s. */
  speed = 0;
  reversing = false;
  /** Drive force this step (N), for the model (a bike's pedals turn). */
  drive = 0;
  /** Tap cadence this step, 0..1 (bikes only). */
  cadence = 0;

  constructor(R: Rapier, world: RAPIER_NS.World, wheels: WheelSpec[], position: Vec3, heading: number, tuning = carTuning) {
    this.R = R;
    this.world = world;
    this.wheels = wheels;
    this.tuning = tuning;
    const t = tuning;
    const { x: sx, y: sy, z: sz } = t.size;
    const q = headingQuat(heading);
    const bodyDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setRotation(q)
      .setCcdEnabled(true)
      .setCanSleep(false)
      .setAngularDamping(0.4)
      .setAdditionalMassProperties(
        t.mass,
        { x: 0, y: t.comHeight, z: t.comZ },
        { x: (t.mass / 12) * (sy ** 2 + sz ** 2), y: (t.mass / 12) * (sx ** 2 + sz ** 2), z: (t.mass / 12) * (sx ** 2 + sy ** 2) },
        { x: 0, y: 0, z: 0, w: 1 },
      );
    this.body = world.createRigidBody(bodyDesc);
    for (const { half, at } of t.shell) {
      world.createCollider(
        R.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(at.x, at.y, at.z).setDensity(0).setFriction(0.25).setRestitution(0.05),
        this.body,
      );
    }

    this.controller = world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    wheels.forEach((w, i) => {
      this.controller.addWheel(
        { x: w.center.x, y: w.center.y + t.suspensionRest, z: w.center.z },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        t.suspensionRest,
        w.radius,
      );
      this.controller.setWheelSuspensionStiffness(i, t.stiffness);
      this.controller.setWheelSuspensionCompression(i, t.compression);
      this.controller.setWheelSuspensionRelaxation(i, t.relaxation);
      this.controller.setWheelMaxSuspensionTravel(i, t.suspensionTravel);
      this.controller.setWheelMaxSuspensionForce(i, t.mass * 60);
      this.controller.setWheelFrictionSlip(i, w.front ? t.frictionSlipFront : t.frictionSlipRear);
      this.controller.setWheelSideFrictionStiffness(i, t.sideStiffness);
    });
  }

  /** Advances the controls and the wheel forces; call before world.step(). */
  update(dt: number, input: DriveInput) {
    const t = this.tuning;
    const c = this.controller;
    this.speed = c.currentVehicleSpeed();
    const v = this.speed;

    // Steering: the lock narrows with speed, and the wheel moves at a
    // finite rate, so a keyboard tap is not a full-lock flick.
    const lock = t.maxSteer / (1 + Math.abs(v) / t.steerHalfSpeed);
    const target = -input.steer * lock;
    const step = t.steerRate * dt;
    this.steerAngle += Math.max(-step, Math.min(step, target - this.steerAngle));

    // Pedals: brake at speed, reverse once stopped; the throttle cancels a
    // reverse. On a bike, tapping the gas fast adds pedal strokes on top of
    // the assist, and the strokes push between the taps too; tapping the
    // brake does the same backwards.
    const cadence = t.pedalBoost > 0 ? (input.cadence ?? 0) : 0;
    const backCadence = t.pedalBoost > 0 ? (input.backCadence ?? 0) : 0;
    const push = input.throttle + t.pedalBoost * cadence;
    if (push > 0.05) this.reversing = false;
    else if (input.brake > 0.05 && v < 0.8) this.reversing = true;
    this.cadence = this.reversing ? backCadence : cadence;
    let drive = 0;
    let brake = 0;
    if (this.reversing) {
      const back = input.brake + t.pedalBoost * backCadence;
      if (back > 0.05) {
        const top = t.reverseTopSpeed + (t.sprintReverseTopSpeed - t.reverseTopSpeed) * backCadence;
        drive = -back * t.reverseForce * Math.max(0, 1 - -v / top);
      } else {
        brake = Math.abs(v) < t.holdBelow ? t.brake : t.coast;
      }
    } else {
      if (push > 0.05) {
        const top = t.topSpeed + (t.sprintTopSpeed - t.topSpeed) * cadence;
        const f = Math.max(0, 1 - Math.max(0, v) / top);
        drive = push * t.engineForce * Math.sqrt(f);
      }
      if (input.brake > 0.05) {
        drive = 0;
        brake = input.brake * t.brake;
      } else if (drive === 0) {
        brake = Math.abs(v) < t.holdBelow ? t.brake : t.coast;
      }
    }

    const rear = this.wheels.filter((w) => !w.front).length;
    this.drive = 0;
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      c.setWheelSteering(i, w.front ? this.steerAngle : 0);
      // Rear-wheel drive. Rapier applies engine force along the forward
      // axis; brake only acts on a wheel with no engine force.
      let force = w.front ? 0 : drive / rear;
      if (t.tractionShare > 0 && force > 0) {
        force = Math.min(force, t.tractionShare * (c.wheelSuspensionForce(i) ?? 0) * t.frictionSlipRear);
      }
      this.drive += force;
      c.setWheelEngineForce(i, force);
      let wheelBrake = brake;
      if (input.handbrake && !w.front) wheelBrake = t.handbrake;
      c.setWheelBrake(i, (wheelBrake * dt) * 60);
      if (!w.front) {
        c.setWheelFrictionSlip(i, input.handbrake ? t.frictionSlipHandbrake : t.frictionSlipRear);
      }
    }

    // Rider balance: take out part of the sideways velocity while a wheel
    // is down, so a slide straightens up instead of spinning on.
    const lv = this.body.linvel();
    if (t.gripAssist > 0 && !input.handbrake && this.wheels.some((_, i) => c.wheelIsInContact(i))) {
      const q = this.body.rotation();
      // The body's x axis (its left) in the world.
      const rx = 1 - 2 * (q.y * q.y + q.z * q.z), ry = 2 * (q.x * q.y + q.w * q.z), rz = 2 * (q.x * q.z - q.w * q.y);
      const lateral = lv.x * rx + lv.y * ry + lv.z * rz;
      const k = -lateral * Math.min(1, t.gripAssist * dt) * t.mass;
      this.body.applyImpulse({ x: rx * k, y: ry * k, z: rz * k }, true);
    }

    // Air drag, opposite the velocity.
    const s = Math.hypot(lv.x, lv.y, lv.z);
    if (s > 0.1) {
      const k = (t.dragCoefficient * s * dt);
      this.body.applyImpulse({ x: -lv.x * k, y: -lv.y * k, z: -lv.z * k }, true);
    }

    // The wheels feel only static and kinematic ground: loose café chairs
    // (furniture.ts) are shoved by the body, never driven over.
    c.updateVehicle(dt, this.R.QueryFilterFlags.EXCLUDE_DYNAMIC);
  }

  /** Puts the car back on its wheels at [position], facing [heading]. */
  reset(position: Vec3, heading: number) {
    this.body.setTranslation(position, true);
    this.body.setRotation(headingQuat(heading), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerAngle = 0;
    this.reversing = false;
  }

  /** Heading in the web frame: radians, 0 = north (-z), pi/2 = east (+x). */
  heading(): number {
    const q = this.body.rotation();
    // The car's forward (+z local) in world space.
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    return Math.atan2(fx, -fz);
  }

  /** Wheel centre in the car frame now (suspension included). */
  wheelOffset(i: number): number {
    const len = this.controller.wheelSuspensionLength(i) ?? this.tuning.suspensionRest;
    return this.tuning.suspensionRest - len;
  }

  get steering() {
    return this.steerAngle;
  }

  /** Takes the vehicle out of the world. */
  free() {
    this.world.removeVehicleController(this.controller);
    this.world.removeRigidBody(this.body);
  }
}

/** Rotation that turns the car's +z toward compass [heading] (0 = north = -z). */
export function headingQuat(heading: number) {
  // Yaw about +y by (pi - heading): +z rotated by yaw a gives (sin a, 0, cos a);
  // we want (sin h, 0, -cos h), so a = pi - h.
  const a = Math.PI - heading;
  return { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) };
}
