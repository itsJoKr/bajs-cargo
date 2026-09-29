import type { WheelSpec } from '../src/vehicle.ts';

/** The Ferrari's wheels (web3d/public/models/ferrari.glb), turned to face +z. */
export const ferrariWheels: WheelSpec[] = [
  { center: { x: 0.843, y: 0.358, z: 1.155 }, radius: 0.36, front: true },
  { center: { x: -0.829, y: 0.358, z: 1.154 }, radius: 0.36, front: true },
  { center: { x: 0.821, y: 0.358, z: -1.495 }, radius: 0.36, front: false },
  { center: { x: -0.824, y: 0.358, z: -1.496 }, radius: 0.36, front: false },
];
