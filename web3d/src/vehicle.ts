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
}

export interface WheelSpec {
  /** Wheel centre in the car frame at rest. */
  center: Vec3;
  radius: number;
  front: boolean;
}

/** Tuning, in SI units. */
export const carTuning = {
  mass: 1350,
  /** Centre of mass height: low, so hard cornering slides before it rolls. */
  comHeight: 0.42,
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
  reverseForce: 4200,
  topSpeed: 52,
  reverseTopSpeed: 9,
  /** Brake impulse per wheel per step, at 60 Hz. */
  brake: 70,
  handbrake: 60,
  /** Light brake while coasting: engine braking plus rolling resistance. */
  coast: 2.2,
  maxSteer: 0.62,
  /** Steering lock halves at this speed (m/s). */
  steerHalfSpeed: 22,
  /** Steering rate, radians per second. */
  steerRate: 2.6,
  dragCoefficient: 0.38,
};

export class Vehicle {
  readonly body: RAPIER_NS.RigidBody;
  readonly controller: RAPIER_NS.DynamicRayCastVehicleController;
  readonly wheels: WheelSpec[];
  private readonly R: Rapier;
  private readonly world: RAPIER_NS.World;
  private steerAngle = 0;
  /** Signed forward speed, m/s. */
  speed = 0;
  reversing = false;

  constructor(R: Rapier, world: RAPIER_NS.World, wheels: WheelSpec[], position: Vec3, heading: number) {
    this.R = R;
    this.world = world;
    this.wheels = wheels;
    const t = carTuning;
    const q = headingQuat(heading);
    const bodyDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setRotation(q)
      .setCcdEnabled(true)
      .setCanSleep(false)
      .setAngularDamping(0.4)
      .setAdditionalMassProperties(
        t.mass,
        { x: 0, y: t.comHeight, z: 0.05 },
        // A 1.9 x 1.2 x 4.5 m box.
        { x: (t.mass / 12) * (1.2 ** 2 + 4.5 ** 2), y: (t.mass / 12) * (1.9 ** 2 + 4.5 ** 2), z: (t.mass / 12) * (1.9 ** 2 + 1.2 ** 2) },
        { x: 0, y: 0, z: 0, w: 1 },
      );
    this.body = world.createRigidBody(bodyDesc);
    // The body shell: its floor clears a kerb, so only the wheels touch the
    // ground. Two boxes, the cabin narrower than the sills.
    world.createCollider(
      R.ColliderDesc.cuboid(0.93, 0.26, 2.2).setTranslation(0, 0.62, 0).setDensity(0).setFriction(0.25).setRestitution(0.05),
      this.body,
    );
    world.createCollider(
      R.ColliderDesc.cuboid(0.7, 0.22, 1.1).setTranslation(0, 1.05, -0.15).setDensity(0).setFriction(0.25),
      this.body,
    );

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
    const t = carTuning;
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
    // reverse.
    if (input.throttle > 0.05) this.reversing = false;
    else if (input.brake > 0.05 && v < 0.8) this.reversing = true;
    let drive = 0;
    let brake = 0;
    if (this.reversing) {
      if (input.brake > 0.05) {
        drive = -input.brake * t.reverseForce * Math.max(0, 1 - -v / t.reverseTopSpeed);
      } else {
        brake = t.coast;
      }
    } else {
      if (input.throttle > 0.05) {
        const f = Math.max(0, 1 - Math.max(0, v) / t.topSpeed);
        drive = input.throttle * t.engineForce * Math.sqrt(f);
      }
      if (input.brake > 0.05) {
        drive = 0;
        brake = input.brake * t.brake;
      } else if (drive === 0) {
        brake = t.coast;
      }
    }

    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      c.setWheelSteering(i, w.front ? this.steerAngle : 0);
      // Rear-wheel drive. Rapier applies engine force along the forward
      // axis; brake only acts on a wheel with no engine force.
      c.setWheelEngineForce(i, w.front ? 0 : drive / 2);
      let wheelBrake = brake;
      if (input.handbrake && !w.front) wheelBrake = t.handbrake;
      c.setWheelBrake(i, (wheelBrake * dt) * 60);
      if (!w.front) {
        c.setWheelFrictionSlip(i, input.handbrake ? t.frictionSlipHandbrake : t.frictionSlipRear);
      }
    }

    // Air drag, opposite the velocity.
    const lv = this.body.linvel();
    const s = Math.hypot(lv.x, lv.y, lv.z);
    if (s > 0.1) {
      const k = (t.dragCoefficient * s * dt);
      this.body.applyImpulse({ x: -lv.x * k, y: -lv.y * k, z: -lv.z * k }, true);
    }

    c.updateVehicle(dt);
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
    const len = this.controller.wheelSuspensionLength(i) ?? carTuning.suspensionRest;
    return carTuning.suspensionRest - len;
  }

  get steering() {
    return this.steerAngle;
  }

  free() {
    this.world.removeVehicleController(this.controller);
    void this.R;
  }
}

/** Rotation that turns the car's +z toward compass [heading] (0 = north = -z). */
export function headingQuat(heading: number) {
  // Yaw about +y by (pi - heading): +z rotated by yaw a gives (sin a, 0, cos a);
  // we want (sin h, 0, -cos h), so a = pi - h.
  const a = Math.PI - heading;
  return { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) };
}
