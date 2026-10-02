// A chase camera: behind and above the car along its direction of travel,
// lagging on turns, pulled in when a wall or roof would come between it and
// the car.

import * as THREE from 'three';

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  distance = 7.2;
  height = 2.3;
  private yaw = 0;
  private pulled = 1;
  /** Mouse look: offsets from the behind-the-vehicle view, radians. */
  private lookYaw = 0;
  private lookPitch = 0;
  /** Seconds the player has been riding without a break. */
  private riding = 0;
  /** Distance along a ray to the first wall or roof, or null. */
  private readonly cast: (from: THREE.Vector3, dir: THREE.Vector3, far: number) => number | null;
  private readonly eye = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private initialized = false;

  constructor(
    camera: THREE.PerspectiveCamera,
    cast: (from: THREE.Vector3, dir: THREE.Vector3, far: number) => number | null,
  ) {
    this.camera = camera;
    this.cast = cast;
  }

  /** [heading]: compass radians (0 = north = -z). [speed] in m/s, signed. */
  /** Mouse movement in pixels. */
  orbit(dx: number, dy: number) {
    this.lookYaw += dx * 0.005;
    this.lookYaw = Math.atan2(Math.sin(this.lookYaw), Math.cos(this.lookYaw));
    this.lookPitch = Math.max(-0.2, Math.min(0.9, this.lookPitch + dy * 0.004));
  }

  /** [recenter]: the player is riding; after a second of it, swing the view back behind. */
  update(dt: number, target: THREE.Vector3, heading: number, speed: number, recenter = false) {
    this.riding = recenter ? this.riding + dt : 0;
    if (this.riding > 1) {
      // Eased in over half a second, so the swing does not start with a jerk.
      const k = Math.min(1, dt * 2.5 * Math.min(1, (this.riding - 1) / 0.5));
      this.lookYaw -= this.lookYaw * k;
      this.lookPitch -= this.lookPitch * k;
    }
    // Follow the heading, not the velocity: in a handbrake slide the camera
    // swings with the nose, a little behind it.
    let d = heading - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (!this.initialized) {
      this.yaw = heading;
      d = 0;
    }
    this.yaw += d * Math.min(1, dt * (speed < -1 ? 1.5 : 4.5));

    const fast = Math.min(1, Math.abs(speed) / 40);
    const dist = this.distance + fast * 2.2;
    const ay = this.yaw + this.lookYaw;
    const back = new THREE.Vector3(-Math.sin(ay), 0, Math.cos(ay));
    const focus = this.look.set(target.x, target.y + 1.25, target.z);
    const wanted = new THREE.Vector3().copy(focus).addScaledVector(back, dist);
    wanted.y = target.y + this.height + fast * 0.4 + this.lookPitch * dist * 0.8;

    // Pull in at once when blocked; ease back out.
    const toEye = wanted.clone().sub(focus);
    const len = toEye.length();
    const hit = this.cast(focus, toEye.normalize(), len);
    const allowed = hit !== null ? Math.max(0.2, (hit - 0.4) / len) : 1;
    this.pulled = allowed < this.pulled ? allowed : Math.min(allowed, this.pulled + dt * 0.8);
    wanted.lerpVectors(focus, wanted, this.pulled);

    if (!this.initialized) {
      this.eye.copy(wanted);
      this.initialized = true;
    } else {
      this.eye.lerp(wanted, Math.min(1, dt * 10));
    }
    this.camera.position.copy(this.eye);
    this.camera.lookAt(focus);
    // A touch more field of view at speed.
    const fov = 62 + fast * 10;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  snap() {
    this.initialized = false;
  }
}
