// The Bajs cargo bike you see: Zagreb's public e-cargo bike (nextbike's
// "Bajs", a Dolly long john), built from primitives after the city's press
// photos: the black tub with its white "zBajsom na špicu" panel, a 20" front
// wheel under the box, a 26" rear wheel, a mid motor. A man in a suit rides
// it: legs on the pedals and hands on the grips by two-bone IK, a foot down
// when stopped. Posed each frame from the Rapier vehicle; the whole bike
// leans into turns about its tyre line (the physics body stays upright).
//
// Bike frame as vehicle.ts: z forward, y up, x to the rider's LEFT, origin on
// the road under the middle of the bike.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bikeAxles, bikeWheels, type Vehicle } from './vehicle.ts';
import { snapshot, type BodyState, type CarModel } from './carModel.ts';
import { createRider } from './rider.ts';
import { mergeStatic } from './merge.ts';

const { front: FRONT, rear: REAR } = bikeAxles;
const BLUE = '#3a8ee0';

/** The box's side profile (z, y), front top first, round to the rear top. */
const boxProfile: [number, number][] = [
  [0.95, 0.72], [0.8, 0.34], [0.75, 0.265], [0.66, 0.22], [-0.1, 0.22], [-0.18, 0.26], [-0.21, 0.36], [-0.22, 0.72],
];
const BOX_W = 0.31; // half width
const BOX_Z0 = -0.24, BOX_Z1 = 0.97, BOX_Y0 = 0.2, BOX_Y1 = 0.74;

const BB = new THREE.Vector3(0, 0.27, -0.57); // crank axle
const CRANK = 0.17;
const STEM_TOP = new THREE.Vector3(0, 1.1, -0.29);
const GRIP = new THREE.Vector3(0.27, 0.03, -0.15); // left grip, handlebar frame

export function buildBikeModel(): CarModel {
  const root = new THREE.Group();
  root.name = 'bike';
  // Leans about the tyre line; everything else hangs off it.
  const lean = new THREE.Group();
  root.add(lean);

  const mat = (color: THREE.ColorRepresentation, roughness = 0.6, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });
  // Surface textures from gen-image (tool/prepare_bike.py), tiled; the same
  // picture doubles as a bump map for the grain.
  const loader = new THREE.TextureLoader();
  // Each use is a clone (its own repeat) sharing the image; a clone keeps
  // the version it was cloned at, so each is flagged once the image is in.
  const images = new Map<string, { base: THREE.Texture; uses: THREE.Texture[] }>();
  const tex = (name: string, repeatX: number, repeatY = repeatX, color = true) => {
    let img = images.get(name);
    if (!img) {
      const entry: { base: THREE.Texture; uses: THREE.Texture[] } = { base: null!, uses: [] };
      entry.base = loader.load(`models/bike_${name}.jpg`, () => entry.uses.forEach((u) => (u.needsUpdate = true)));
      images.set(name, (img = entry));
    }
    const t = img.base.clone();
    img.uses.push(t);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    t.anisotropy = 8;
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const textured = (name: string, repeat: number, tint: number, roughness: number, metalness = 0, bump = 0.6) =>
    new THREE.MeshStandardMaterial({ color: tint, map: tex(name, repeat), bumpMap: tex(name, repeat, repeat, false), bumpScale: bump, roughness, metalness });
  const frameBlack = textured('frame', 1, 0x7a7a7a, 0.45, 0.3, 0.3);
  const plastic = textured('plastic', 1.5, 0x5e5e5e, 0.72);
  const rubber = textured('tyre', 1, 0xb0b0b0, 0.9, 0, 1.2);
  rubber.map!.repeat.set(36, 1);
  rubber.bumpMap!.repeat.set(36, 1);
  const steel = mat(0x8e9195, 0.42, 0.85);
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, pos?: THREE.Vector3Like) => {
    const mesh = new THREE.Mesh(geo, m);
    if (pos) mesh.position.copy(pos);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  /** A round tube from [a] to [b]. */
  const tube = (parent: THREE.Object3D, a: THREE.Vector3Like, b: THREE.Vector3Like, r: number, m = frameBlack) => {
    const va = new THREE.Vector3().copy(a), vb = new THREE.Vector3().copy(b);
    const len = va.distanceTo(vb);
    const g = new THREE.CylinderGeometry(r, r, len, 10, 1);
    const mesh = add(parent, g, m, va.clone().add(vb).multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.sub(va).normalize());
    return mesh;
  };
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // --- Wheels: tyre, rim, 32 spokes, hub, disc on the left. -------------------
  function wheel(radius: number) {
    const g = new THREE.Group();
    const tyreR = radius < 0.3 ? 0.028 : 0.03;
    add(g, new THREE.TorusGeometry(radius - tyreR, tyreR, 10, 40).rotateY(Math.PI / 2), rubber);
    add(g, new THREE.TorusGeometry(radius - tyreR * 2 - 0.006, 0.011, 6, 40).rotateY(Math.PI / 2), mat(0x222325, 0.4, 0.6));
    const spokes: THREE.BufferGeometry[] = [];
    const rimR = radius - tyreR * 2 - 0.01;
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const side = i % 2 ? 1 : -1;
      const hub = v(0.03 * side, 0, 0);
      const rim = v(0.004 * side, Math.sin(a) * rimR, Math.cos(a) * rimR);
      const s = new THREE.CylinderGeometry(0.0018, 0.0018, hub.distanceTo(rim), 3, 1);
      s.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), rim.clone().sub(hub).normalize()));
      s.translate((hub.x + rim.x) / 2, rim.y / 2, rim.z / 2);
      spokes.push(s);
    }
    add(g, mergeGeometries(spokes), steel);
    add(g, new THREE.CylinderGeometry(0.025, 0.025, 0.08, 12).rotateZ(Math.PI / 2), frameBlack);
    const disc = add(g, new THREE.CylinderGeometry(radius < 0.3 ? 0.08 : 0.09, 0.08, 0.004, 28).rotateZ(Math.PI / 2), steel);
    disc.position.x = 0.05;
    return g;
  }
  /** A mudguard arc over a wheel, from [a0] to [a1] radians (0 = front, pi/2 = top). */
  function fender(parent: THREE.Object3D, radius: number, a0: number, a1: number) {
    // CylinderGeometry's theta runs from +z toward +x about y; turned onto
    // the x axis, theta 0 stays forward and pi/2 points up.
    const g = new THREE.CylinderGeometry(radius, radius, 0.065, 24, 1, true, a0, a1 - a0).rotateZ(Math.PI / 2);
    const m = add(parent, g, new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.5, side: THREE.DoubleSide }));
    return m;
  }

  // Front: the wheel steers about a near-vertical axis through its axle.
  const steerPivot = new THREE.Group();
  steerPivot.position.set(0, FRONT.radius, FRONT.z);
  lean.add(steerPivot);
  const frontWheel = wheel(FRONT.radius);
  steerPivot.add(frontWheel);
  for (const x of [0.05, -0.05]) tube(steerPivot, v(x, 0, 0), v(x * 0.6, 0.3, -0.11), 0.014);
  tube(steerPivot, v(0.03, 0.3, -0.11), v(-0.03, 0.3, -0.11), 0.02);
  fender(steerPivot, FRONT.radius + 0.025, 0.45, 2.6);
  const lamp = add(steerPivot, new THREE.CylinderGeometry(0.03, 0.022, 0.06, 12).rotateX(Math.PI / 2), frameBlack, v(0, 0.33, 0.0));
  add(lamp, new THREE.CircleGeometry(0.026, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d8, emissiveIntensity: 2 }), v(0, 0, 0.031));

  // Rear wheel, guard and light.
  const rearWheel = wheel(REAR.radius);
  rearWheel.position.set(0, REAR.radius, REAR.z);
  lean.add(rearWheel);
  const rearGuard = fender(lean, REAR.radius + 0.03, 0.9, Math.PI + 0.25);
  rearGuard.position.set(0, REAR.radius, REAR.z);
  const tail = add(lean, new THREE.BoxGeometry(0.06, 0.035, 0.02), new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 1.2 }));
  tail.position.set(0, REAR.radius + Math.sin(0.35) * (REAR.radius + 0.04), REAR.z - Math.cos(0.35) * (REAR.radius + 0.04));

  // --- Frame. -------------------------------------------------------------------
  const rearAxle = v(0, REAR.radius, REAR.z);
  tube(lean, v(0, 0.35, 0.93), v(0, 0.6, 0.9), 0.028); // head tube, behind the box's nose
  tube(lean, v(0, 0.4, 0.9), v(0, 0.17, 0.66), 0.026);
  tube(lean, v(0, 0.17, 0.66), v(0, 0.17, -0.16), 0.026); // under the box
  tube(lean, v(0, 0.17, -0.16), BB, 0.03);
  tube(lean, v(0, 0.44, -0.2), v(0, 0.44, -0.7), 0.025); // the upper tube
  tube(lean, v(0, 0.2, -0.2), v(0, 0.44, -0.2), 0.025);
  tube(lean, BB, v(0, 0.8, -0.765), 0.028); // seat tube
  tube(lean, v(0, 0.8, -0.765), v(0, 0.87, -0.79), 0.015, steel);
  for (const x of [0.065, -0.065]) {
    tube(lean, BB.clone().setX(x * 0.4), rearAxle.clone().setX(x), 0.014);
    tube(lean, v(x * 0.4, 0.62, -0.715), rearAxle.clone().setX(x), 0.012);
  }
  tube(lean, v(0, 0.44, -0.2), STEM_TOP, 0.022); // handlebar stem, a link rod steers the fork
  // Mid motor and the battery pack on the seat tube.
  const motor = add(lean, new THREE.CylinderGeometry(0.1, 0.1, 0.13, 20).rotateZ(Math.PI / 2), frameBlack, BB.clone().add(v(0, 0.02, 0.06)));
  motor.scale.set(1, 1, 1.25);
  const battery = add(lean, new THREE.BoxGeometry(0.075, 0.24, 0.06), plastic, v(0, 0.56, -0.84));
  battery.rotation.x = -0.35;
  // Saddle.
  const saddle = add(lean, new THREE.SphereGeometry(0.1, 16, 10), plastic, v(0, 0.885, -0.82));
  saddle.scale.set(0.85, 0.3, 1.25);
  add(lean, new THREE.BoxGeometry(0.05, 0.02, 0.14), plastic, v(0, 0.885, -0.69));
  // Frame number decal on the seat tube's left.
  const num = add(lean, new THREE.PlaneGeometry(0.16, 0.035), new THREE.MeshBasicMaterial({ map: textTexture('87155', 256, 56), transparent: true }), v(0.03, 0.62, -0.69));
  num.rotation.set(0, Math.PI / 2, Math.PI / 2 - 0.35);

  // Handlebar: swept back to the grips, turning with the steering.
  const bar = new THREE.Group();
  bar.position.copy(STEM_TOP);
  lean.add(bar);
  for (const s of [1, -1]) {
    tube(bar, v(0, 0, 0.02), v(0.13 * s, 0.02, 0.0), 0.012);
    tube(bar, v(0.13 * s, 0.02, 0), v(GRIP.x * s - 0.07 * s, GRIP.y, GRIP.z + 0.03), 0.012);
    tube(bar, v(GRIP.x * s - 0.07 * s, GRIP.y, GRIP.z + 0.03), v(GRIP.x * s + 0.05 * s, GRIP.y, GRIP.z - 0.01), 0.018, rubber);
    tube(bar, v(GRIP.x * s - 0.06 * s, GRIP.y + 0.01, GRIP.z + 0.05), v(GRIP.x * s + 0.02 * s, GRIP.y - 0.01, GRIP.z + 0.08), 0.006, steel); // brake lever
  }
  add(bar, new THREE.BoxGeometry(0.07, 0.03, 0.05), plastic, v(0, 0.035, -0.01)); // the lock's display

  // Cranks and pedals, turning about the crank axle.
  const crank = new THREE.Group();
  crank.position.copy(BB);
  lean.add(crank);
  add(crank, new THREE.CylinderGeometry(0.09, 0.09, 0.006, 28).rotateZ(Math.PI / 2), steel, v(-0.08, 0, 0));
  for (const s of [1, -1]) {
    // The left arm points forward at angle 0, the right one back.
    tube(crank, v(0.09 * s, 0, 0), v(0.09 * s, 0, CRANK * s), 0.013, frameBlack);
    add(crank, new THREE.BoxGeometry(0.1, 0.022, 0.07), plastic, v(0.15 * s, 0, CRANK * s));
  }

  // --- The cargo box: an open black tub on the frame. -----------------------
  const tub = new THREE.Group();
  lean.add(tub);
  // Floor and end walls: a thin panel along each profile edge, box wide.
  for (let i = 0; i < boxProfile.length - 1; i++) {
    const [z0, y0] = boxProfile[i], [z1, y1] = boxProfile[i + 1];
    const len = Math.hypot(z1 - z0, y1 - y0) + 0.02;
    const p = add(tub, new THREE.BoxGeometry(BOX_W * 2, 0.02, len), plastic, v(0, (y0 + y1) / 2, (z0 + z1) / 2));
    p.rotation.x = Math.atan2(-(y1 - y0), z1 - z0);
  }
  // The sides, and over each the painted panel.
  const shape = (flip: number) => new THREE.Shape(boxProfile.map(([z, y]) => new THREE.Vector2(z * flip, y)));
  for (const s of [1, -1]) {
    const wall = add(tub, new THREE.ExtrudeGeometry(shape(-s), { depth: 0.02, bevelEnabled: false }), plastic);
    wall.rotation.y = (s * Math.PI) / 2;
    wall.position.x = s > 0 ? BOX_W - 0.02 : -BOX_W + 0.02;
    // Left side (+x) reads with the front on the left, like the photos.
    const g = new THREE.ShapeGeometry(shape(-s)).rotateY((s * Math.PI) / 2).translate(s * (BOX_W + 0.002), 0, 0);
    const pos = g.getAttribute('position'), uv = g.getAttribute('uv');
    for (let k = 0; k < pos.count; k++) {
      const z = pos.getZ(k), y = pos.getY(k);
      const u = s > 0 ? (BOX_Z1 - z) / (BOX_Z1 - BOX_Z0) : (z - BOX_Z0) / (BOX_Z1 - BOX_Z0);
      uv.setXY(k, u, (y - BOX_Y0) / (BOX_Y1 - BOX_Y0));
    }
    add(tub, g, new THREE.MeshStandardMaterial({ map: boxLivery(s > 0), bumpMap: tex('plastic', 1.2, 0.55, false), bumpScale: 0.4, roughness: 0.55 }));
  }
  // The thick rim round the top.
  const rimShape = roundedRect(-BOX_W - 0.03, BOX_Z0 - 0.02, BOX_W + 0.03, BOX_Z1 + 0.02, 0.1);
  rimShape.holes.push(roundedRect(-BOX_W + 0.015, BOX_Z0 + 0.03, BOX_W - 0.015, BOX_Z1 - 0.03, 0.06));
  const rim = add(tub, new THREE.ExtrudeGeometry(rimShape, { depth: 0.045, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2 }), plastic);
  // The shape is drawn in (x, -z); lay it flat with its thickness up.
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.705;
  // A bench at the back of the box, and a briefcase riding in it.
  add(tub, new THREE.BoxGeometry(BOX_W * 2 - 0.04, 0.05, 0.2), plastic, v(0, 0.42, -0.08));
  const bag = new THREE.Group();
  bag.position.set(-0.02, 0.24, 0.42);
  bag.rotation.y = 0.25;
  tub.add(bag);
  const leather = mat(0x5b3a22, 0.55);
  const caseBox = add(bag, new THREE.BoxGeometry(0.42, 0.1, 0.32), leather, v(0, 0.05, 0));
  caseBox.receiveShadow = true;
  add(bag, new THREE.TorusGeometry(0.045, 0.01, 6, 12, Math.PI).rotateX(-Math.PI / 2), mat(0x2b1a10, 0.5), v(0, 0.1, -0.16)).rotation.x = Math.PI / 2;
  for (const x of [-0.12, 0.12]) add(bag, new THREE.BoxGeometry(0.03, 0.02, 0.02), steel, v(x, 0.08, -0.161));

  // --- The rider (rider.ts). -----------------------------------------------
  const hairLocks = tex('hair', 1, 1);
  hairLocks.center.set(0.5, 0.5);
  hairLocks.rotation = Math.PI / 2;
  const rider = createRider(lean, { wool: tex('wool', 2, 1), coat: tex('coat', 2, 2), hair: tex('hair', 3, 1), hairLocks });

  // --- A soft contact shadow. ----------------------------------------------------
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 2.9).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobTexture(), blending: THREE.MultiplyBlending, toneMapped: false, transparent: true, premultipliedAlpha: true, depthWrite: false }),
  );
  blob.position.y = 0.02;
  blob.renderOrder = 2;
  root.add(blob);

  // ~120 meshes, drawn every frame twice (colour and shadow): merge what never moves apart.
  const { before, after } = mergeStatic(root);
  console.log(`[zg] bike: ${before} meshes merged into ${after}`);

  // --- Posing. -------------------------------------------------------------------
  const cur: BodyState = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  const yAxis = v(0, 1, 0);
  let crankAngle = 0.6;
  let lastRear: number | null = null;
  let leanAngle = 0;
  let footDown = 1;
  let last = performance.now();
  const pedals: [THREE.Vector3, THREE.Vector3] = [v(0, 0, 0), v(0, 0, 0)];
  const grips: [THREE.Vector3, THREE.Vector3] = [v(0, 0, 0), v(0, 0, 0)];

  return {
    root,
    wheels: bikeWheels,
    pose(vehicle: Vehicle, prev: BodyState, alpha: number) {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      snapshot(vehicle, cur);
      root.position.lerpVectors(prev.p, cur.p, alpha);
      root.quaternion.slerpQuaternions(prev.q, cur.q, alpha);
      const c = vehicle.controller;
      const speed = vehicle.speed;

      // Wheels roll; the front one and the bars steer.
      const steer = c.wheelSteering(0) ?? 0;
      steerPivot.rotation.y = steer;
      // The wheels ride the springs (rays 0-1 front, 2-3 rear).
      const off = (i: number) => (bikeWheels[i].center.y + vehicle.wheelOffset(i) + bikeWheels[i + 1].center.y + vehicle.wheelOffset(i + 1)) / 2;
      steerPivot.position.y = off(0);
      rearWheel.position.y = off(2);
      bar.rotation.y = steer;
      frontWheel.rotation.x = c.wheelRotation(0) ?? 0;
      const rearSpin = c.wheelRotation(2) ?? 0;
      rearWheel.rotation.x = rearSpin;

      // Pedals turn with the rear wheel while driving (a freewheel), faster
      // when sprinting, and backwards while backing up; the rider sways a
      // little with each stroke.
      const dRear = lastRear === null ? 0 : rearSpin - lastRear;
      lastRear = rearSpin;
      const sprint = vehicle.cadence;
      if (vehicle.drive > 0) crankAngle += Math.max(dRear * 0.42 * (1 + 0.5 * sprint), dt * 2.5);
      else if (vehicle.drive < 0) crankAngle += Math.min(dRear * 0.42 * (1 + 0.5 * sprint), -dt * 2.5);
      crank.rotation.x = crankAngle;

      // Lean into turns (the balance a rider finds), and put a foot down at
      // a standstill.
      const yawRate = vehicle.body.angvel().y;
      const want = Math.max(-0.45, Math.min(0.45, Math.atan2(-Math.max(0, speed) * yawRate, 9.81)));
      const stopped = Math.abs(speed) < 0.4 && vehicle.drive <= 0;
      footDown += ((stopped ? 1 : 0) - footDown) * Math.min(1, dt * (stopped ? 4 : 10));
      leanAngle += (want - leanAngle) * Math.min(1, dt * 6);
      lean.rotation.z = leanAngle - 0.13 * footDown;

      for (const [i, side] of [[0, 1], [1, -1]] as const) {
        const a = crankAngle + (side > 0 ? 0 : Math.PI);
        pedals[i].set(0.15 * side, BB.y - Math.sin(a) * CRANK, BB.z + Math.cos(a) * CRANK);
        grips[i].set(GRIP.x * side, GRIP.y, GRIP.z).applyAxisAngle(yAxis, steer).add(STEM_TOP);
      }
      rider.pose({ pedals, grips, footDown, lean: lean.rotation.z, sprint, stroke: vehicle.drive !== 0 ? crankAngle : null });
    },
    setBraking() {},
  };
}

/** A rounded rectangle in the (x, -z) plane ExtrudeGeometry lays flat. */
function roundedRect(x0: number, z0: number, x1: number, z1: number, r: number) {
  const s = new THREE.Shape();
  const [a, b, c, d] = [x0, -z1, x1, -z0]; // x min, y min, x max, y max
  s.moveTo(a + r, b);
  s.lineTo(c - r, b);
  s.quadraticCurveTo(c, b, c, b + r);
  s.lineTo(c, d - r);
  s.quadraticCurveTo(c, d, c - r, d);
  s.lineTo(a + r, d);
  s.quadraticCurveTo(a, d, a, d - r);
  s.lineTo(a, b + r);
  s.quadraticCurveTo(a, b, a + r, b);
  return s;
}

/** The painted side of the box: black plastic with "DOLLY" moulded in, the
 * white band with "zBajsom na špicu", the Grad Zagreb crest and the blue
 * "Bajs powered by nextbike" tag. [frontLeft]: the bike's front is on the
 * picture's left (its left side). */
function boxLivery(frontLeft: boolean) {
  const W = 1200, H = Math.round((W * (BOX_Y1 - BOX_Y0)) / (BOX_Z1 - BOX_Z0));
  const ppm = W / (BOX_Z1 - BOX_Z0);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  // Canvas x of a bike z, and y of a height.
  const X = (z: number) => (frontLeft ? (BOX_Z1 - z) * ppm : (z - BOX_Z0) * ppm);
  const Y = (y: number) => (BOX_Y1 - y) * ppm;
  // Distance from the front, as a canvas offset along the reading direction.
  const at = (fromFront: number) => (frontLeft ? X(BOX_Z1) + fromFront * ppm : X(BOX_Z1) - fromFront * ppm);
  const paint = (grain: HTMLImageElement | null) => {
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.textAlign = 'left';
    // Moulded black plastic, the gen-image grain once it is in.
    if (grain) {
      g.fillStyle = g.createPattern(grain, 'repeat')!;
      g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(0, 0, 0, 0.45)';
      g.fillRect(0, 0, W, H);
    } else {
      g.fillStyle = '#161718';
      g.fillRect(0, 0, W, H);
    }
    g.fillStyle = 'rgba(255, 255, 255, 0.03)';
    g.fillRect(0, 0, W, Y(0.69));

    // The white band follows the sloped nose.
    const nose = (y: number) => 0.8 + ((y - 0.34) * 0.15) / 0.38 - 0.025;
    const top = 0.655, bottom = 0.425, back = -0.165;
    g.fillStyle = '#f4f5f4';
    g.beginPath();
    g.moveTo(X(nose(top)), Y(top));
    g.lineTo(X(back), Y(top));
    g.lineTo(X(back), Y(bottom));
    g.lineTo(X(nose(bottom)), Y(bottom));
    g.closePath();
    g.fill();

    /** Canvas x of a block [w] px wide whose front edge is [fromFront] m back. */
    const block = (fromFront: number, w: number) => (frontLeft ? at(fromFront) : at(fromFront) - w);
    /** Sets a font so [text] is [width] m wide. */
    const fit = (text: string, style: string, width: number) => {
      g.font = `${style} 100px 'Helvetica Neue', Arial, sans-serif`;
      const size = (100 * width * ppm) / g.measureText(text).width;
      g.font = `${style} ${size.toFixed(1)}px 'Helvetica Neue', Arial, sans-serif`;
      return width * ppm;
    };
    // Crest: a blue shield with a white three-towered castle, "GRAD ZAGREB".
    const sw = 0.05 * ppm, sh = 0.06 * ppm;
    const cx = block(0.12, 0.13 * ppm), cy = Y(0.615);
    g.fillStyle = '#2f6fc0';
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + sw, cy);
    g.lineTo(cx + sw, cy + sh * 0.6);
    g.quadraticCurveTo(cx + sw, cy + sh, cx + sw / 2, cy + sh);
    g.quadraticCurveTo(cx, cy + sh, cx, cy + sh * 0.6);
    g.closePath();
    g.fill();
    g.fillStyle = '#ffffff';
    const tw = sw / 7;
    for (const k of [1, 3, 5]) g.fillRect(cx + tw * k, cy + sh * (k === 3 ? 0.15 : 0.25), tw, sh * 0.5);
    g.fillRect(cx + tw, cy + sh * 0.5, tw * 5, sh * 0.25);
    g.fillStyle = '#222';
    g.textBaseline = 'top';
    fit('ZAGREB', '600', 0.062);
    g.fillText('GRAD', cx + sw + 0.012 * ppm, cy + 0.008 * ppm);
    g.fillText('ZAGREB', cx + sw + 0.012 * ppm, cy + 0.032 * ppm);
    // The slogan: "na špicu" under "zBajsom", sticking out past its end.
    g.fillStyle = BLUE;
    g.textBaseline = 'alphabetic';
    const x1 = block(0.29, 0.73 * ppm);
    const w1 = fit('zBajsom', '700', 0.58);
    g.fillText('zBajsom', x1, Y(0.54));
    const w2 = fit('na špicu', '700', 0.35);
    g.fillText('na špicu', x1 + w1 + 0.15 * ppm - w2, Y(0.468));
    // The tag, flush with the band's rear bottom corner.
    const tagW = 0.24 * ppm, tagH = 0.042 * ppm;
    const tagX = frontLeft ? X(back) - tagW : X(back);
    g.fillStyle = BLUE;
    g.fillRect(tagX, Y(bottom) - tagH, tagW, tagH);
    g.fillStyle = '#ffffff';
    fit('Bajs', 'italic 800', 0.07);
    g.fillText('Bajs', tagX + 0.015 * ppm, Y(bottom) - 0.01 * ppm);
    fit('nextbike', '600', 0.1);
    g.fillText('nextbike', tagX + tagW - 0.11 * ppm, Y(bottom) - 0.012 * ppm);
    fit('powered by', '400', 0.045);
    g.fillText('powered by', tagX + 0.092 * ppm, Y(bottom) - 0.014 * ppm);
    // "DOLLY", moulded into the black below.
    g.fillStyle = '#1f2022';
    g.textAlign = 'center';
    fit('DOLLY', '500', 0.3);
    g.fillText('DOLLY', (X(0.33) + X(0.03)) / 2, Y(0.33));
    // The grain shows faintly through the printed band too.
    if (grain) {
      g.globalCompositeOperation = 'multiply';
      g.globalAlpha = 0.07;
      g.fillStyle = g.createPattern(grain, 'repeat')!;
      g.fillRect(0, 0, W, H);
    }
  };
  paint(null);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const grain = new Image();
  grain.onload = () => {
    paint(grain);
    tex.needsUpdate = true;
  };
  grain.src = 'models/bike_plastic.jpg';
  return tex;
}

function textTexture(text: string, w: number, h: number) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#e8e8e8';
  g.font = `600 ${Math.round(h * 0.8)}px Arial, sans-serif`;
  g.textBaseline = 'middle';
  g.fillText(text, 4, h / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function blobTexture() {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, 'rgba(70,70,70,1)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}
