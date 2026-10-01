// The Bajs bike's rider: a man in a camel overcoat over a charcoal suit,
// white shirt and burgundy tie, leather gloves and black oxfords. Smooth
// lathed shapes rather than boxes; legs reach the pedals and arms the grips by
// two-bone IK each frame.
//
// Bike frame as vehicle.ts: z forward, y up, x to the rider's LEFT.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface RiderTextures {
  /** Charcoal suit wool, for the trousers. */
  wool?: THREE.Texture;
  /** Camel overcoat cloth. */
  coat?: THREE.Texture;
  /** Hair, strands running along v (the cap) ... */
  hair?: THREE.Texture;
  /** ... and the same turned to run along u (the locks). */
  hairLocks?: THREE.Texture;
}

/** Where the bike puts the rider's hands and feet, in the bike frame. */
export interface RiderPose {
  /** Left and right pedal centres. */
  pedals: [THREE.Vector3, THREE.Vector3];
  /** Left and right grips. */
  grips: [THREE.Vector3, THREE.Vector3];
  /** 0 riding .. 1 left foot on the road (stopped). */
  footDown: number;
  /** The bike's lean (its rotation about z), for the foot on the road. */
  lean: number;
  /** 0..1 pedalling cadence: leans the torso forward. */
  sprint: number;
  /** Crank angle, for a sway with each stroke; null when not pedalling. */
  stroke: number | null;
}

const HIP = new THREE.Vector3(0.095, 0.95, -0.8); // left hip joint
const PELVIS = new THREE.Vector3(0, 0.97, -0.8);
const THIGH = 0.45, SHIN = 0.45, UPPER_ARM = 0.3, FOREARM = 0.28;
/** Ankle above the pedal and behind it, so the ball of the foot is on it. */
const ANKLE_ON_PEDAL = new THREE.Vector3(0, 0.085, -0.11);

/** A rounded, tapered limb segment along +y from 0 to [len]: radius [r0] at
 * the start, [r1] at the end, [bulge] extra at [peak] (0..1) of the way. */
function limbGeometry(len: number, r0: number, r1: number, bulge = 0, peak = 0.35) {
  const pts: THREE.Vector2[] = [];
  const cap = 5;
  for (let i = 0; i <= cap; i++) {
    const a = (i / cap) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-3, r0 * Math.sin(a)), -r0 * 0.6 * Math.cos(a)));
  }
  const n = 10;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const hump = t < peak ? Math.sin((t / peak) * (Math.PI / 2)) : Math.cos(((t - peak) / (1 - peak)) * (Math.PI / 2));
    pts.push(new THREE.Vector2(r0 + (r1 - r0) * t + bulge * hump, len * t));
  }
  for (let i = 0; i <= cap; i++) {
    const a = (i / cap) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(1e-3, r1 * Math.cos(a)), len + r1 * 0.6 * Math.sin(a)));
  }
  return new THREE.LatheGeometry(pts, 18);
}

/** A lathe from (radius, height) pairs. */
function lathe(profile: [number, number][], segments = 24, phiStart = 0, phiLength = Math.PI * 2) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(1e-3, r), y)), segments, phiStart, phiLength);
}

/** A black oxford: origin at the ankle, sole 8.5 cm under it, toe forward
 * (+z). Upper, a brown sole and a heel. */
function shoeGeometries() {
  const W = 0.066;
  const upper = new THREE.Shape();
  // Side profile in (forward, up).
  upper.moveTo(-0.058, -0.083);
  upper.bezierCurveTo(-0.072, -0.065, -0.07, -0.02, -0.056, -0.004);
  upper.lineTo(0.02, -0.006);
  upper.bezierCurveTo(0.06, -0.018, 0.11, -0.04, 0.15, -0.052);
  upper.bezierCurveTo(0.195, -0.06, 0.212, -0.07, 0.205, -0.083);
  upper.lineTo(-0.058, -0.083);
  const sole = new THREE.Shape();
  sole.moveTo(-0.02, -0.083);
  sole.lineTo(0.21, -0.083);
  sole.bezierCurveTo(0.214, -0.09, 0.21, -0.094, 0.2, -0.094);
  sole.lineTo(-0.02, -0.094);
  sole.lineTo(-0.02, -0.083);
  const shape = (s: THREE.Shape, bevel: number, width: number) => {
    const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 10 });
    g.translate(0, 0, -width / 2).rotateY(-Math.PI / 2);
    // Narrow, rounded toe; a slimmer heel.
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i);
      const toe = Math.max(0, (z - 0.08) / 0.13);
      const heel = Math.max(0, (-0.02 - z) / 0.05);
      p.setX(i, p.getX(i) * (1 - 0.42 * toe * toe) * (1 - 0.12 * heel));
    }
    g.computeVertexNormals();
    return g;
  };
  const heel = new THREE.BoxGeometry(0.066, 0.022, 0.06).translate(0, -0.094, -0.035);
  return { upper: shape(upper, 0.014, W), sole: shape(sole, 0.004, W + 0.02), heel };
}

/** Short hair, parted on the rider's left: tapered, flattened locks laid over
 * the skull (an ellipsoid of radii [R] about [C], head frame), sweeping from
 * the part over the top to the right and back, a quiff over the forehead,
 * short locks down to the left ear and the nape, and sideburns. */
function hairGeometry() {
  const C = new THREE.Vector3(0, 0.168, -0.006);
  const R = new THREE.Vector3(0.086, 0.11, 0.1);
  /** A point [lift] (share of the radius) off the skull, by longitude (0 =
   * front, +pi/2 = his left) and latitude (0 = the equator). */
  const ll = (lon: number, lat: number, lift: number) =>
    new THREE.Vector3(Math.cos(lat) * Math.sin(lon) * R.x, Math.sin(lat) * R.y, Math.cos(lat) * Math.cos(lon) * R.z).multiplyScalar(1 + lift).add(C);
  /** The same, on the top, by the unit sphere's x and z. */
  const top = (ux: number, uz: number, lift: number) =>
    ll(Math.atan2(ux, uz), Math.acos(Math.min(1, Math.hypot(ux, uz))), lift);

  const out = new THREE.Vector3(), side = new THREE.Vector3(), tangent = new THREE.Vector3();
  const lock = (pts: THREE.Vector3[], width: number, thick: number) => {
    const curve = new THREE.CatmullRomCurve3(pts);
    const segs = 14, radial = 6;
    const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
    const pos = g.getAttribute('position');
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const c = curve.getPointAt(t);
      curve.getTangentAt(t, tangent);
      // Flat against the head: thin along the outward normal, wide across.
      out.copy(c).sub(C).divide(R).normalize();
      side.crossVectors(tangent, out).normalize();
      out.crossVectors(side, tangent).normalize();
      // Full at the root, a pointed tip.
      const w = t < 0.12 ? 0.7 + (t / 0.12) * 0.3 : 1 - 0.65 * ((t - 0.12) / 0.88) ** 1.8;
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        const k = i * (radial + 1) + j;
        pos.setXYZ(k,
          c.x + (out.x * Math.cos(a) * thick + side.x * Math.sin(a) * width) * w,
          c.y + (out.y * Math.cos(a) * thick + side.y * Math.sin(a) * width) * w,
          c.z + (out.z * Math.cos(a) * thick + side.z * Math.sin(a) * width) * w);
      }
    }
    g.computeVertexNormals();
    return g;
  };

  const locks: THREE.BufferGeometry[] = [];
  // Over the top to the right, the back ones curling round behind.
  for (let k = 0; k < 11; k++) {
    const uz = 0.8 - k * 0.145;
    locks.push(lock([
      top(0.4, uz, 0.1),
      top(0.05, uz * 0.95 - 0.04, 0.17),
      top(-0.4, uz * 0.85 - 0.1, 0.15),
      ll(-1.25 - k * 0.145, 0.42 - k * 0.015, 0.09),
      ll(-1.45 - k * 0.16, 0.22 - k * 0.008, 0.05),
    ], 0.032, 0.012));
  }
  // The quiff: up off the forehead and over to the right temple.
  locks.push(lock([top(0.38, 0.86, 0.1), ll(0.15, 0.56, 0.26), ll(-0.35, 0.6, 0.28), ll(-0.9, 0.52, 0.18), ll(-1.25, 0.38, 0.07)], 0.036, 0.016));
  locks.push(lock([top(0.34, 0.8, 0.13), ll(0.0, 0.62, 0.3), ll(-0.55, 0.66, 0.26), ll(-1.1, 0.5, 0.12)], 0.034, 0.015));
  locks.push(lock([top(0.3, 0.72, 0.15), ll(-0.15, 0.72, 0.28), ll(-0.75, 0.68, 0.2), ll(-1.2, 0.5, 0.08)], 0.032, 0.014));
  // The short side, down from the part to above the left ear.
  for (let k = 0; k < 6; k++) {
    const uz = 0.72 - k * 0.26;
    locks.push(lock([top(0.44, uz, 0.1), ll(1.05 + k * 0.22, 0.5, 0.1), ll(1.25 + k * 0.24, 0.26, 0.05)], 0.022, 0.009));
  }
  // The back, crown to nape.
  for (let k = 0; k < 7; k++) {
    const o = (k - 3) * 0.32;
    locks.push(lock([ll(Math.PI + o * 0.7, 1.15, 0.1), ll(Math.PI + o, 0.6, 0.1), ll(Math.PI + o * 1.08, 0.1, 0.06), ll(Math.PI + o * 1.1, -0.12, 0.03)], 0.028, 0.01));
  }
  // Sideburns.
  for (const s of [1, -1]) locks.push(lock([ll(1.3 * s, 0.32, 0.05), ll(1.33 * s, 0.12, 0.04), ll(1.35 * s, -0.04, 0.03)], 0.016, 0.006));
  return mergeGeometries(locks);
}

export function createRider(parent: THREE.Object3D, tex: RiderTextures = {}) {
  const coat = new THREE.MeshStandardMaterial({ color: tex.coat ? 0xffffff : 0xa67c52, map: tex.coat ?? null, roughness: 0.92 });
  const coatSkirt = coat.clone();
  coatSkirt.side = THREE.DoubleSide;
  const trousers = new THREE.MeshStandardMaterial({ color: tex.wool ? 0xffffff : 0x2a3040, map: tex.wool ?? null, roughness: 0.85 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.6 });
  const tieMat = new THREE.MeshStandardMaterial({ color: 0x7e1a26, roughness: 0.45 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xdcab88, roughness: 0.6 });
  const hair = new THREE.MeshStandardMaterial({ color: tex.hair ? 0xffffff : 0x3a2a1e, map: tex.hair ?? null, bumpMap: tex.hair ?? null, bumpScale: 0.5, roughness: 0.82, envMapIntensity: 0.25 });
  const locksMat = hair.clone();
  locksMat.map = locksMat.bumpMap = tex.hairLocks ?? null;
  const brows = new THREE.MeshStandardMaterial({ color: 0x33251a, roughness: 0.8 });
  const glove = new THREE.MeshStandardMaterial({ color: 0x4a2e1c, roughness: 0.45 });
  const leather = new THREE.MeshPhysicalMaterial({ color: 0x0b0b0c, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  const soleMat = new THREE.MeshStandardMaterial({ color: 0x3b2618, roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1510, roughness: 0.5 });

  const add = (to: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    to.add(mesh);
    return mesh;
  };

  // --- Torso: the buttoned overcoat, open at the neck on shirt and tie. -----
  const torso = new THREE.Group();
  torso.position.copy(PELVIS);
  parent.add(torso);
  const body = add(torso, lathe([
    [0, -0.1], [0.12, -0.09], [0.165, -0.03], [0.162, 0.08], [0.172, 0.22], [0.185, 0.33], [0.182, 0.4], [0.15, 0.46], [0.09, 0.495], [0.06, 0.505], [0, 0.51],
  ], 28), coat);
  body.scale.set(1.12, 1, 0.66);
  for (const s of [1, -1]) add(torso, new THREE.SphereGeometry(0.068, 16, 12), coat, 0.185 * s, 0.415, -0.005).scale.set(1, 0.9, 0.95);
  // Shirt and tie in the V, lapels either side, a turned-up collar behind.
  const vee = new THREE.Shape([new THREE.Vector2(-0.06, 0), new THREE.Vector2(0.06, 0), new THREE.Vector2(0, -0.19)]);
  add(torso, new THREE.ShapeGeometry(vee), shirt, 0, 0.49, 0.077).rotation.x = -0.22;
  const tie = add(torso, new THREE.CylinderGeometry(0.022, 0.012, 0.19, 4, 1).rotateY(Math.PI / 4), tieMat, 0, 0.39, 0.1);
  tie.scale.set(1, 1, 0.25);
  tie.rotation.x = -0.2;
  add(torso, new THREE.SphereGeometry(0.016, 8, 6), tieMat, 0, 0.475, 0.083).scale.set(1.2, 1, 0.6);
  for (const s of [1, -1]) {
    const lapel = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.075 * s, 0.01), new THREE.Vector2(0.018 * s, -0.22)]);
    const l = add(torso, new THREE.ExtrudeGeometry(lapel, { depth: 0.012, bevelEnabled: false }), coat, 0.035 * s, 0.5, 0.072);
    l.rotation.set(-0.2, 0.25 * s, 0);
  }
  add(torso, lathe([[0.085, 0], [0.09, 0.05], [0.082, 0.1]], 20, Math.PI * 0.3, Math.PI * 1.4), coatSkirt, 0, 0.455, -0.005).scale.set(1.15, 1, 0.95);
  for (const y of [0.24, 0.13, 0.02]) add(torso, new THREE.SphereGeometry(0.012, 8, 6), dark, 0, y, 0.113).scale.set(1, 1, 0.5);

  // Coat tails over the saddle: open in front, where the thighs come out.
  // Hung from the pelvis, not the torso, so they stay down when he leans.
  const skirt = add(parent, lathe([[0.176, 0.05], [0.184, -0.08], [0.205, -0.2], [0.22, -0.29]], 24, Math.PI * 0.42, Math.PI * 1.16), coatSkirt, PELVIS.x, PELVIS.y, PELVIS.z);
  skirt.scale.set(1.12, 1, 0.92);

  // --- Head. ----------------------------------------------------------------
  const head = new THREE.Group();
  head.position.set(0, 0.5, 0.01);
  torso.add(head);
  add(head, new THREE.CylinderGeometry(0.047, 0.055, 0.11, 14), skin, 0, 0.03, 0);
  add(head, new THREE.TorusGeometry(0.056, 0.012, 8, 20).rotateX(Math.PI / 2), shirt, 0, 0.0, 0.004);
  const skull = add(head, new THREE.SphereGeometry(0.1, 24, 18), skin, 0, 0.165, -0.005);
  skull.scale.set(0.84, 1.08, 0.98);
  const jaw = add(head, new THREE.SphereGeometry(0.07, 18, 12), skin, 0, 0.115, 0.03);
  jaw.scale.set(0.95, 0.85, 1);
  add(head, new THREE.SphereGeometry(0.03, 10, 8), skin, 0, 0.085, 0.07).scale.set(1.2, 0.8, 0.9); // chin
  const nose = add(head, new THREE.ConeGeometry(0.015, 0.045, 8).rotateX(Math.PI / 2 + 0.35), skin, 0, 0.152, 0.1);
  nose.scale.set(1, 1.3, 1);
  for (const s of [1, -1]) {
    add(head, new THREE.SphereGeometry(0.02, 10, 8), skin, 0.083 * s, 0.155, -0.005).scale.set(0.45, 1.1, 0.8); // ear
    add(head, new THREE.SphereGeometry(0.009, 8, 6), dark, 0.03 * s, 0.178, 0.086);
    const brow = add(head, new THREE.CapsuleGeometry(0.004, 0.026, 2, 6).rotateZ(Math.PI / 2), brows, 0.031 * s, 0.198, 0.088);
    brow.rotation.z = -0.12 * s;
  }
  add(head, new THREE.CapsuleGeometry(0.003, 0.025, 2, 6).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9a5a4a, roughness: 0.6 }), 0, 0.108, 0.093); // mouth
  // Hair: a close cap under 3D locks (hairGeometry).
  const cap = add(head, new THREE.SphereGeometry(0.1, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.56), hair, 0, 0.176, -0.012);
  cap.scale.set(0.9, 1.1, 1.02);
  cap.rotation.x = -0.62;
  add(head, hairGeometry(), locksMat);

  // --- Limbs. ---------------------------------------------------------------
  // Posed every frame: merge.ts must leave them alone.
  const moving = (mesh: THREE.Mesh) => ((mesh.userData.moves = true), mesh);
  const limb = (up: THREE.BufferGeometry, lo: THREE.BufferGeometry, m: THREE.Material, l0: number, l1: number) => ({
    up: moving(add(parent, up, m)),
    lo: moving(add(parent, lo, m)),
    l0,
    l1,
  });
  const shoe = shoeGeometries();
  const legs = [1, -1].map((s) => {
    const l = limb(limbGeometry(THIGH, 0.082, 0.058, 0.01, 0.3), limbGeometry(SHIN, 0.056, 0.046, 0.01, 0.3), trousers, THIGH, SHIN);
    // A slight break of the trouser leg over the shoe.
    add(l.lo, lathe([[0.047, SHIN - 0.06], [0.056, SHIN - 0.005], [0.052, SHIN + 0.01]], 16), trousers);
    const foot = new THREE.Group();
    parent.add(foot);
    add(foot, shoe.upper, leather);
    add(foot, shoe.sole, soleMat);
    add(foot, shoe.heel, soleMat);
    return { s, ...l, foot };
  });
  const arms = [1, -1].map((s) => {
    const l = limb(limbGeometry(UPPER_ARM, 0.058, 0.046, 0.006, 0.4), limbGeometry(FOREARM, 0.048, 0.04, 0.006, 0.3), coat, UPPER_ARM, FOREARM);
    // Coat cuff, a white shirt cuff, then the gloved hand along the forearm.
    add(l.lo, lathe([[0.046, FOREARM - 0.05], [0.049, FOREARM - 0.01], [0.04, FOREARM]], 16), coat);
    add(l.lo, new THREE.CylinderGeometry(0.036, 0.036, 0.018, 14), shirt, 0, FOREARM + 0.006, 0);
    const hand = new THREE.Group();
    l.lo.add(hand);
    hand.position.y = FOREARM + 0.05;
    add(hand, new THREE.SphereGeometry(0.045, 14, 10), glove).scale.set(0.8, 1.15, 0.6);
    add(hand, new THREE.CapsuleGeometry(0.013, 0.035, 3, 8), glove, 0.03 * s, 0.0, 0.025).rotation.set(0.6, 0, -0.5 * s);
    return { s, ...l };
  });

  // --- Posing. --------------------------------------------------------------
  const tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3() };
  const yAxis = new THREE.Vector3(0, 1, 0);
  const zAxis = new THREE.Vector3(0, 0, 1);
  type Limb = (typeof legs)[number] | (typeof arms)[number];
  /** Places a two-segment limb from [a] toward [target], its joint toward [pole]. */
  function solve(l: Limb, a: THREE.Vector3, target: THREE.Vector3, pole: THREE.Vector3) {
    const dir = tmp.b.copy(target).sub(a);
    const d = Math.min(l.l0 + l.l1 - 1e-4, Math.max(Math.abs(l.l0 - l.l1) + 1e-4, dir.length()));
    dir.normalize();
    const along = (l.l0 * l.l0 - l.l1 * l.l1 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l.l0 * l.l0 - along * along));
    const side = tmp.c.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
    const joint = tmp.d.copy(a).addScaledVector(dir, along).addScaledVector(side, h);
    l.up.position.copy(a);
    l.up.quaternion.setFromUnitVectors(yAxis, tmp.a.copy(joint).sub(a).normalize());
    l.lo.position.copy(joint);
    l.lo.quaternion.setFromUnitVectors(yAxis, tmp.a.copy(a).addScaledVector(dir, d).sub(joint).normalize());
  }
  const hip = new THREE.Vector3(), ankle = new THREE.Vector3(), ground = new THREE.Vector3();
  const shoulder = new THREE.Vector3(), pole = new THREE.Vector3();

  return {
    pose(p: RiderPose) {
      // Leans forward harder in a sprint, and sways a little with each stroke.
      torso.rotation.x = 0.14 + 0.12 * p.sprint;
      torso.rotation.z = p.stroke === null ? 0 : 0.03 * Math.sin(p.stroke);
      torso.updateMatrix();
      for (const leg of legs) {
        hip.copy(HIP).setX(HIP.x * leg.s);
        ankle.copy(p.pedals[leg.s > 0 ? 0 : 1]).add(ANKLE_ON_PEDAL);
        let flat = 0;
        if (leg.s > 0 && p.footDown > 0.01) {
          // The left foot on the road beside the bike, in the leaned frame.
          ground.set(0.36, 0.095, -0.5).applyAxisAngle(zAxis, -p.lean);
          ankle.lerp(ground, p.footDown);
          flat = p.footDown;
        }
        solve(leg, hip, ankle, pole.set(0.15 * leg.s, 0.3, 1));
        // The shoe hangs from where the shin really ends (short of an
        // unreachable target), toes a little down on the pedal.
        leg.foot.position.copy(leg.lo.position).addScaledVector(tmp.a.set(0, 1, 0).applyQuaternion(leg.lo.quaternion), SHIN);
        leg.foot.rotation.set(0.12 * (1 - flat), 0, -p.lean * flat);
      }
      for (const arm of arms) {
        shoulder.set(0.19 * arm.s, 0.415, -0.01).applyMatrix4(torso.matrix);
        // The wrist stops short of the grip so the glove closes round it.
        const grip = p.grips[arm.s > 0 ? 0 : 1];
        const toGrip = tmp.b.copy(grip).sub(shoulder);
        const reach = toGrip.length();
        solve(arm, shoulder, ankle.copy(shoulder).addScaledVector(toGrip, (reach - 0.05) / reach), pole.set(0.8 * arm.s, -1, -0.3));
      }
    },
  };
}
