// Café terraces as loose furniture: every table with its two chairs and its
// parasol is a set of Rapier bodies the car can scatter. Tables come from
// city.json `terraces` (OSM outdoor seating, tool/src/street_props.dart) and
// from `terrace` features (features.ts).
//
// Each piece sleeps until something touches it and sits in a lower dominance
// group than the car, so it never slows or lifts the car. A slow car simply
// pushes it. A fast one would not: covering half a metre a step, the body
// swallows a chair deeper than the chair is tall and the contact presses it
// into the ground. So a moving car launches every piece its next step will
// reach (`step`): its speed, a lift, a spray to the side and a spin, and
// Rapier flies it from there. The parasol pole goes through the table top:
// tables and parasols do not collide with each other, nor parasols with
// parasols (their canopies overlap on tight terraces).
//
// Cost: a flying piece costs a contact against the city's triangle meshes
// every step. Cylinders and cones against a trimesh cost ~0.3 ms a piece a
// step, so every collider is a box (30 pieces flying: 2 ms, not 12). A
// launched piece stops colliding with other furniture (a spray of chairs
// would otherwise wake the next terrace, piece by piece). And with more than
// [crowd] pieces flying, a hit piece may just vanish instead ([vanish]), all
// of them past [maxFlying]: driving down a terrace is a spray, not a pile.
//
// Rendering: four instanced meshes (chairs, tables, parasol frames, canopies)
// whose instances follow the bodies, interpolated like the car.

import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** [x, z, base y, yaw, parasol colour]: yaw turns +z onto the chairs' line. */
export type TerraceTable = [number, number, number, number, string];

type Kind = 'chair' | 'table' | 'parasol';

/** Collision groups: (membership << 16) | filter. */
const TABLE = 0x0002, PARASOL = 0x0004, CHAIR = 0x0008;
const FURNITURE = CHAIR | TABLE | PARASOL;
const groups = {
  chair: (CHAIR << 16) | 0xffff,
  table: (TABLE << 16) | (0xffff & ~PARASOL),
  parasol: (PARASOL << 16) | (0xffff & ~(PARASOL | TABLE)),
};

/** Pieces flying at once before a hit piece may vanish, the chance it does,
 * and the count past which every hit piece does. */
const crowd = 4, vanish = 0.3, maxFlying = 24;

/** Car speed (m/s) from which it launches what it hits; slower, it pushes. */
const hitSpeed = 3;

function painted(g: THREE.BufferGeometry, color: string, y: number) {
  g.translate(0, y, 0);
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]), 3));
  return g.index ? g.toNonIndexed() : g;
}

/** Body-local geometry, origin on the ground under the piece. */
function chairGeometry() {
  const metal = '#2c2f33';
  const parts = [
    painted(new THREE.BoxGeometry(0.4, 0.05, 0.4), metal, 0.445),
    // The back on +z: away from the table.
    painted(new THREE.BoxGeometry(0.4, 0.41, 0.04).translate(0, 0, 0.19), metal, 0.675),
  ];
  for (const [x, z] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) {
    parts.push(painted(new THREE.CylinderGeometry(0.015, 0.015, 0.42, 5).translate(x, 0, z), metal, 0.21));
  }
  return mergeGeometries(parts)!;
}

function tableGeometry() {
  return mergeGeometries([
    painted(new THREE.CylinderGeometry(0.38, 0.38, 0.04, 12), '#7a5234', 0.74),
    painted(new THREE.CylinderGeometry(0.04, 0.04, 0.69, 6), '#2c2f33', 0.375),
    painted(new THREE.CylinderGeometry(0.25, 0.25, 0.03, 10), '#2c2f33', 0.015),
  ])!;
}

function parasolGeometry() {
  return mergeGeometries([
    painted(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 10), '#3a3d40', 0.03),
    painted(new THREE.CylinderGeometry(0.025, 0.025, 2.54, 6), '#d8d4cc', 1.33),
  ])!;
}

interface Piece {
  body: RAPIER_NS.RigidBody;
  kind: Kind;
  index: number;
  home: THREE.Vector3;
  homeQ: THREE.Quaternion;
  prev: THREE.Vector3;
  prevQ: THREE.Quaternion;
  /** Launched (while it is still awake). */
  kicked: boolean;
  /** Vanished when hit, until [Furniture.reset]. */
  gone: boolean;
}

export class Furniture {
  readonly root = new THREE.Group();
  private readonly pieces: Piece[] = [];
  private readonly byCollider = new Map<number, Piece>();
  private readonly byBody = new Map<number, Piece>();
  /** Launched and still awake. */
  private readonly flying = new Set<Piece>();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly meshes: Record<Kind, THREE.InstancedMesh>;
  private readonly canopies: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly one = new THREE.Vector3(1, 1, 1);

  private readonly R: typeof RAPIER_NS;
  private readonly world: RAPIER_NS.World;

  /**
   * [groundBelow] gives the static surface under (x, z) near [y], or null;
   * pieces stand on it rather than on the exported height. Call [settle]
   * once the pieces are built.
   */
  constructor(
    R: typeof RAPIER_NS,
    world: RAPIER_NS.World,
    tables: TerraceTable[],
    groundBelow: (x: number, y: number, z: number) => number | null = () => null,
  ) {
    this.R = R;
    this.world = world;
    this.root.name = 'furniture';
    const frame = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 });
    const n = tables.length;
    const instanced = (g: THREE.BufferGeometry, material: THREE.Material, count: number) => {
      const mesh = new THREE.InstancedMesh(g, material, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = mesh.receiveShadow = true;
      // Pieces fly: bounds computed once would cull them.
      mesh.frustumCulled = false;
      this.root.add(mesh);
      return mesh;
    };
    this.meshes = {
      chair: instanced(chairGeometry(), frame, 2 * n),
      table: instanced(tableGeometry(), frame, n),
      parasol: instanced(parasolGeometry(), frame, n),
    };
    this.canopies = instanced(
      new THREE.ConeGeometry(1.35, 0.5, 8, 1, true).translate(0, 2.5, 0),
      new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9 }),
      n,
    );

    const counts: Record<Kind, number> = { chair: 0, table: 0, parasol: 0 };
    const color = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [x, z, y, yaw, canopy] of tables) {
      const dx = Math.sin(yaw), dz = Math.cos(yaw);
      // A centimetre up: a piece born touching the ground starts a contact
      // on the first step, and a new contact wakes it.
      const at = (px: number, pz: number) => new THREE.Vector3(px, (groundBelow(px, y, pz) ?? y) + 0.01, pz);
      this.add('table', at(x, z), new THREE.Quaternion().setFromAxisAngle(up, yaw), counts.table++);
      for (const e of [-1, 1]) {
        const q = new THREE.Quaternion().setFromAxisAngle(up, e > 0 ? yaw : yaw + Math.PI);
        this.add('chair', at(x + dx * 0.62 * e, z + dz * 0.62 * e), q, counts.chair++);
      }
      const i = counts.parasol++;
      this.add('parasol', at(x, z), new THREE.Quaternion(), i);
      this.canopies.setColorAt(i, color.set(canopy));
    }
    this.place(1);
  }

  get count() {
    return this.pieces.length;
  }

  private add(kind: Kind, home: THREE.Vector3, homeQ: THREE.Quaternion, index: number) {
    const R = this.R;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(home.x, home.y, home.z)
        .setRotation(homeQ)
        .setCcdEnabled(true)
        .setDominanceGroup(-1)
        .setLinearDamping(kind === 'parasol' ? 0.5 : 0.15)
        .setAngularDamping(0.4),
    );
    const piece: Piece = {
      body, kind, index, home, homeQ,
      prev: home.clone(), prevQ: homeQ.clone(), kicked: false, gone: false,
    };
    this.pieces.push(piece);
    this.byBody.set(body.handle, piece);
    const collider = (desc: RAPIER_NS.ColliderDesc, y: number, mass: number, z = 0) => {
      const c = this.world.createCollider(
        desc.setTranslation(0, y, z).setMass(mass).setFriction(0.5).setRestitution(0.2).setCollisionGroups(groups[kind]),
        body,
      );
      this.byCollider.set(c.handle, piece);
    };
    if (kind === 'chair') {
      collider(R.ColliderDesc.cuboid(0.2, 0.235, 0.2), 0.235, 4);
      collider(R.ColliderDesc.cuboid(0.2, 0.205, 0.02), 0.675, 1.5, 0.19);
    } else if (kind === 'table') {
      // Boxes only (see the top): the round top as a square of its area.
      collider(R.ColliderDesc.cuboid(0.34, 0.02, 0.34), 0.74, 6);
      collider(R.ColliderDesc.cuboid(0.04, 0.345, 0.04), 0.375, 3);
      collider(R.ColliderDesc.cuboid(0.2, 0.03, 0.2), 0.03, 8);
    } else {
      collider(R.ColliderDesc.cuboid(0.27, 0.04, 0.27), 0.04, 18);
      collider(R.ColliderDesc.cuboid(0.025, 1.27, 0.025), 1.33, 2);
      collider(R.ColliderDesc.cuboid(1.2, 0.25, 1.2), 2.5, 3);
    }
  }

  /**
   * Before each physics step: remember poses to interpolate from, and launch
   * what [car] (a body whose shell spans [carHalf] around [carCenter], in its
   * own frame) reaches during the next [dt].
   */
  step(dt = 0, car?: RAPIER_NS.RigidBody, carHalf = { x: 0.95, y: 0.7, z: 2.25 }, carCenter = { x: 0, y: 0.65, z: 0 }) {
    this.world.forEachActiveRigidBody((b) => {
      const piece = this.byBody.get(b.handle);
      if (!piece) return;
      const t = b.translation(), r = b.rotation();
      piece.prev.set(t.x, t.y, t.z);
      piece.prevQ.set(r.x, r.y, r.z, r.w);
    });
    for (const piece of this.flying) if (piece.body.isSleeping()) this.flying.delete(piece);
    if (!car) return;
    const v = car.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed < hitSpeed) return;
    // The shell stretched along the car's own z by the distance it covers
    // this step (the car's frame: forward is -z).
    const cr = car.rotation();
    const q = this.q.set(cr.x, cr.y, cr.z, cr.w);
    const local = this.p.set(v.x, v.y, v.z).applyQuaternion(q.clone().invert());
    const lead = Math.abs(local.z) * dt + 0.1;
    const centre = new THREE.Vector3(carCenter.x, carCenter.y, carCenter.z + (Math.sign(local.z) * lead) / 2)
      .applyQuaternion(q)
      .add(car.translation() as THREE.Vector3Like);
    const shape = new this.R.Cuboid(carHalf.x, carHalf.y, carHalf.z + lead / 2);
    const hits = new Set<Piece>();
    this.world.intersectionsWithShape(centre, cr, shape, (collider) => {
      const piece = this.byCollider.get(collider.handle);
      if (piece && !this.flying.has(piece)) hits.add(piece);
      return true;
    }, this.R.QueryFilterFlags.ONLY_DYNAMIC, undefined, undefined, car);
    const cp = car.translation();
    for (const piece of hits) this.launch(piece, v, speed, cp);
  }

  /** Sends [piece] off ahead of a car at [carPos] moving at [v], or with
   * enough already flying, maybe out of the world. */
  private launch(piece: Piece, v: RAPIER_NS.Vector, speed: number, carPos: RAPIER_NS.Vector) {
    const b = piece.body;
    const n = this.flying.size;
    if (n >= maxFlying || (n > crowd && Math.random() < vanish)) {
      piece.gone = true;
      b.setEnabled(false);
      this.meshes[piece.kind].setMatrixAt(piece.index, this.hidden);
      this.meshes[piece.kind].instanceMatrix.needsUpdate = true;
      if (piece.kind === 'parasol') {
        this.canopies.setMatrixAt(piece.index, this.hidden);
        this.canopies.instanceMatrix.needsUpdate = true;
      }
      return;
    }
    this.flying.add(piece);
    if (!piece.kicked) {
      piece.kicked = true;
      // In flight it meets the city and the car, not the next terrace.
      for (let i = 0; i < b.numColliders(); i++) {
        const c = b.collider(i);
        c.setCollisionGroups(c.collisionGroups() & ~FURNITURE);
      }
    }
    const dir = new THREE.Vector3(v.x, 0, v.z).normalize();
    // Away from the car's line, so a terrace sprays to both sides.
    const t = b.translation();
    const off = new THREE.Vector3(t.x - carPos.x, 0, t.z - carPos.z);
    const side = off.addScaledVector(dir, -off.dot(dir));
    if (side.lengthSq() < 1e-4) side.set(-dir.z, 0, dir.x).multiplyScalar(Math.random() < 0.5 ? -1 : 1);
    side.normalize();
    const heavy = piece.kind === 'parasol' ? 0.75 : 1;
    const rnd = () => Math.random();
    const out = dir.multiplyScalar(speed * (1.05 + 0.3 * rnd()) * heavy)
      .addScaledVector(side, speed * (0.15 + 0.25 * rnd()) * heavy)
      .setY(Math.max(v.y, 0) + (1.5 + speed * 0.3 * (0.7 + 0.6 * rnd())) * heavy);
    b.setLinvel(out, true);
    const spin = (3 + speed * 0.4) * heavy;
    b.setAngvel({ x: (rnd() - 0.5) * 2 * spin, y: (rnd() - 0.5) * spin, z: (rnd() - 0.5) * 2 * spin }, true);
  }

  /** Poses the instances [alpha] of the way from the last step to now:
   * the moving pieces, or with [alpha] 1 every piece. */
  place(alpha: number) {
    const dirty = new Set<THREE.InstancedMesh>();
    const pose = (piece: Piece) => {
      if (piece.gone) return;
      const t = piece.body.translation(), r = piece.body.rotation();
      this.p.set(t.x, t.y, t.z);
      this.q.set(r.x, r.y, r.z, r.w);
      if (alpha < 1) {
        this.p.lerpVectors(piece.prev, this.p, alpha);
        this.q.slerpQuaternions(piece.prevQ, this.q, alpha);
      }
      this.m.compose(this.p, this.q, this.one);
      const mesh = this.meshes[piece.kind];
      mesh.setMatrixAt(piece.index, this.m);
      dirty.add(mesh);
      if (piece.kind === 'parasol') {
        this.canopies.setMatrixAt(piece.index, this.m);
        dirty.add(this.canopies);
      }
    };
    if (alpha >= 1) {
      for (const piece of this.pieces) {
        if (!piece.gone) pose(piece);
        else {
          this.meshes[piece.kind].setMatrixAt(piece.index, this.hidden);
          if (piece.kind === 'parasol') this.canopies.setMatrixAt(piece.index, this.hidden);
        }
      }
      for (const mesh of [...Object.values(this.meshes), this.canopies]) dirty.add(mesh);
    }
    else {
      this.world.forEachActiveRigidBody((b) => {
        const piece = this.byBody.get(b.handle);
        if (piece) pose(piece);
      });
    }
    for (const mesh of dirty) mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Steps [world] once and puts every piece to sleep. Call it once after
   * building: a body created asleep never gets its bounds into the world's
   * query structures (the launch query would not see it), and one left
   * awake costs a simulation step until it dozes off.
   */
  settle() {
    this.world.step();
    for (const piece of this.pieces) piece.body.sleep();
  }

  /** Every piece back where it stood. Awake, so the world's query structures
   * follow the move; they doze off again after a couple of seconds. */
  reset() {
    this.flying.clear();
    for (const piece of this.pieces) {
      const b = piece.body;
      b.setEnabled(true);
      if (piece.kicked) {
        for (let i = 0; i < b.numColliders(); i++) b.collider(i).setCollisionGroups(groups[piece.kind]);
      }
      b.setTranslation(piece.home, true);
      b.setRotation(piece.homeQ, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      piece.prev.copy(piece.home);
      piece.prevQ.copy(piece.homeQ);
      piece.kicked = false;
      piece.gone = false;
    }
    this.place(1);
  }

  /** Pieces launched and still flying or rolling, and pieces vanished. */
  stats() {
    return { flying: this.flying.size, gone: this.pieces.filter((p) => p.gone).length };
  }

  /** Pieces currently awake (moving). */
  awake() {
    let n = 0;
    this.world.forEachActiveRigidBody((b) => void (this.byBody.has(b.handle) && n++));
    return n;
  }
}
