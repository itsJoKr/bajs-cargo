// The car you see: the Ferrari 458 from the three.js examples (CC BY,
// see web3d/ATTRIBUTION.md), turned to face +z and posed each frame from
// the Rapier vehicle (body, suspension travel, steering and wheel spin).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import type { Vehicle, WheelSpec } from './vehicle.ts';

export interface BodyState {
  p: THREE.Vector3;
  q: THREE.Quaternion;
}

export interface CarModel {
  root: THREE.Group;
  wheels: WheelSpec[];
  pose(vehicle: Vehicle, prev: BodyState, alpha: number): void;
  setBraking(on: boolean): void;
}

const wheelNames = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'];

export async function loadCarModel(envMap: THREE.Texture | null): Promise<CarModel> {
  const draco = new DRACOLoader().setDecoderPath('draco/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const gltf = await loader.loadAsync('models/ferrari.glb');
  const model = gltf.scene;
  // The model faces -z; the physics car faces +z.
  model.rotation.y = Math.PI;
  const root = new THREE.Group();
  root.name = 'car';
  root.add(model);
  root.updateMatrixWorld(true);

  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xb3121d,
    metalness: 0.6,
    roughness: 0.35,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x111418,
    metalness: 0.2,
    roughness: 0.05,
    transparent: true,
    opacity: 0.55,
  });
  const byName = (n: string) => model.getObjectByName(n) as THREE.Mesh | undefined;
  const body = byName('body');
  if (body) body.material = bodyMaterial;
  const glassMesh = byName('glass');
  if (glassMesh) glassMesh.material = glass;
  const tailLights = byName('lights_red');
  const tailMaterial = tailLights ? ((tailLights.material as THREE.MeshStandardMaterial).clone()) : undefined;
  if (tailLights && tailMaterial) tailLights.material = tailMaterial;

  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (envMap && 'envMapIntensity' in mat) mat.envMapIntensity = 1;
  });

  // Each wheel moves into a pivot at its axle, in the car frame: the pivot
  // steers about y and drops with the suspension, the wheel spins inside.
  const wheels: WheelSpec[] = [];
  const pivots: THREE.Group[] = [];
  const spinners: { node: THREE.Object3D; base: THREE.Quaternion }[] = [];
  const box = new THREE.Box3();
  for (const name of wheelNames) {
    const node = model.getObjectByName(name)!;
    box.setFromObject(node);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const pivot = new THREE.Group();
    pivot.position.copy(center);
    root.add(pivot);
    const worldQ = node.getWorldQuaternion(new THREE.Quaternion());
    const nodeWorld = node.getWorldPosition(new THREE.Vector3());
    pivot.attach(node);
    node.position.copy(nodeWorld.sub(center));
    node.quaternion.copy(worldQ);
    pivots.push(pivot);
    spinners.push({ node, base: worldQ.clone() });
    wheels.push({
      center: { x: center.x, y: center.y, z: center.z },
      radius: size.y / 2,
      front: name.includes('_f'),
    });
  }

  // A soft contact shadow under the car, from the example's AO texture.
  const ao = await new THREE.TextureLoader().loadAsync('models/ferrari_ao.png');
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.655 * 4, 1.3 * 4).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: ao,
      blending: THREE.MultiplyBlending,
      toneMapped: false,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
    }),
  );
  shadow.position.y = 0.02;
  shadow.renderOrder = 2;
  root.add(shadow);

  const spinAxis = new THREE.Vector3(1, 0, 0);
  const spinQ = new THREE.Quaternion();
  const cur: BodyState = { p: new THREE.Vector3(), q: new THREE.Quaternion() };

  return {
    root,
    wheels,
    // [alpha] blends the last two physics states for smooth motion at any
    // display rate.
    pose(vehicle, prev, alpha) {
      snapshot(vehicle, cur);
      root.position.lerpVectors(prev.p, cur.p, alpha);
      root.quaternion.slerpQuaternions(prev.q, cur.q, alpha);
      for (let i = 0; i < pivots.length; i++) {
        const w = wheels[i];
        pivots[i].position.y = w.center.y + vehicle.wheelOffset(i);
        pivots[i].rotation.y = vehicle.controller.wheelSteering(i) ?? 0;
        const spin = vehicle.controller.wheelRotation(i) ?? 0;
        // The wheel spins about the car's x axis (its axle), before the steer.
        spinQ.setFromAxisAngle(spinAxis, spin);
        spinners[i].node.quaternion.copy(spinQ).multiply(spinners[i].base);
      }
    },
    setBraking(on) {
      if (tailMaterial) {
        tailMaterial.emissive = new THREE.Color(on ? 0xff1010 : 0x000000);
        tailMaterial.emissiveIntensity = on ? 3 : 0;
      }
    },
  };
}

/** Records the physics state before a step, for interpolation. */
export function snapshot(vehicle: Vehicle, into: BodyState) {
  const t = vehicle.body.translation();
  const r = vehicle.body.rotation();
  into.p.set(t.x, t.y, t.z);
  into.q.set(r.x, r.y, r.z, r.w);
}
