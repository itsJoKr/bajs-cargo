// The crowd: pedestrians on the square and the streets around it, and a few
// more who keep to places further out (`AREAS`: Dolac, Kaptol, Praška, Vlaška...).
//
// One InstancedMesh of a low-poly person (about 2,500 triangles). The walk cycle
// runs in the vertex shader: every vertex carries a limb id (thigh, shin, arm)
// and the shader swings it about its joint from a per-instance phase and
// amplitude, so 300 people cost one draw call and no CPU skinning. Clothes come
// from per-instance colours (jacket, trousers, hair, skin, accent) picked by a
// per-vertex part id; a coat, a backpack or a hat is a part that collapses when
// the person does not wear it.
//
// They walk on city.json `walk` (tool/src/walk.dart): 1 m cells outside
// buildings and carriageways. Every cell is probed once against Rapier (ground
// height, and props such as shelters, the statue and lamp posts) the first time
// somebody wants to step on it; on hand-shaped levels (the Dolac plateau, its
// stairs) the grid says how high to look. Nobody steps more than `STEP` up or
// down, so the plateau's retaining walls hold them like a kerb. People are not
// bodies: they see the car, bike and trams coming and move out of the way (with more
// haste the closer it is), and stand and chat. A vehicle above ~2.5 m/s that still reaches one
// (`Striker`s passed to `step`) sends them flying: a hand-written tumble of a stiff rod that lands on
// its ends (`Fly`, ground from `floor`), a bounce off scenery (`solid`), a few seconds lying, then
// they get up and walk back to the grid if they landed off it (`onHit` is the sound).

import * as THREE from 'three';

/** city.json `walk`: x0, z0 = web-frame corner, 1 m cells, row-major bits. */
export interface WalkData {
  x0: number;
  z0: number;
  cell: number;
  w: number;
  h: number;
  bits: string;
  /** The ground of walkable cells on levels (tool/src/levels.dart), over cells i0.., j0..
   * (base64 bytes, row-major, 0 = not on a level, else byte / 5 - 10 m). */
  levels?: { i0: number; j0: number; w: number; h: number; y: string };
}

/** Ground height and freedom of the cell around (x, z); [ground] is roughly where the
 * ground is on a level (the Dolac plateau), else the terrain grid knows. */
export type Probe = (x: number, z: number, ground?: number) => { y: number; free: boolean };

/** A chair to sit on: where, which way the sitter faces, and whether it has been disturbed. */
export interface Seat {
  x: number;
  y: number;
  z: number;
  heading: number;
  disturbed: () => boolean;
}

/** Something to keep away from: a point with a velocity and a radius. */
export interface Threat {
  x: number;
  z: number;
  vx: number;
  vz: number;
  r: number;
}

// ---------------------------------------------------------------- the model

/** The middle of the square (web frame): the statue stands at about (12, -18.5). */
export const CENTRE = { x: 10, z: -14 };

/** The most a walker steps up or down from one cell to the next, m (kerbs, sloped steps). */
const STEP = 0.5;

/** Places off the square where some walkers spend their day, web frame (z south): the
 * cells within [r] m of the line, and each place's share of those walkers. */
const AREAS: { name: string; line: [number, number][]; r: number; share: number }[] = [
  { name: 'Dolac', line: [[-15, -115], [15, -140], [45, -160]], r: 22, share: 6 },
  { name: 'Kaptol, before the Cathedral', line: [[143, -172]], r: 26, share: 5 },
  { name: 'Praška', line: [[36, 36], [32, 99], [26, 157], [24, 182]], r: 10, share: 4 },
  { name: 'Vlaška', line: [[125, -96], [151, -85], [172, -66], [193, -49], [216, -39], [252, -26]], r: 10, share: 4 },
  {
    name: 'Tkalčićeva',
    line: [[-35, -86], [-49, -92], [-64, -112], [-73, -132], [-79, -164], [-68, -201], [-55, -231]],
    r: 8,
    share: 3,
  },
  { name: 'Jurišićeva', line: [[104, 50], [134, 62], [170, 67], [213, 71], [260, 76]], r: 10, share: 2 },
  { name: 'Bogovićeva', line: [[-213, 91], [-153, 92], [-106, 93], [-61, 96]], r: 9, share: 2 },
  { name: 'Gajeva', line: [[-54, 22], [-58, 53], [-62, 111], [-62, 164], [-57, 204]], r: 8, share: 1 },
  { name: 'Ilica', line: [[-235, -7], [-170, -3], [-102, -2]], r: 10, share: 1 },
  { name: 'Petrinjska', line: [[146, 74], [163, 113], [181, 152], [197, 188], [213, 227]], r: 9, share: 1 },
  { name: 'Opatovina', line: [[30, -180], [20, -200], [19, -237]], r: 12, share: 1 },
];

/** Distance from (x, z) to a polyline (one point: to the point). */
function lineDistance(x: number, z: number, line: [number, number][]) {
  if (line.length === 1) return Math.hypot(x - line[0][0], z - line[0][1]);
  let best = Infinity;
  for (let k = 0; k + 1 < line.length; k++) {
    const [ax, az] = line[k], [bx, bz] = line[k + 1];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

const HIP_Y = 0.92, KNEE_Y = 0.47, SHOULDER_Y = 1.42;
const LEG_X = 0.09, SHOULDER_X = 0.2;

/** Vertex part ids (which colour) and limb ids (which joint). */
const Part = { Skin: 0, Hair: 1, Jacket: 2, Pants: 3, Fixed: 4, Accent: 5 } as const;
const Limb = { Body: 0, ThighL: 1, ThighR: 2, ShinL: 3, ShinR: 4, ArmL: 5, ArmR: 6 } as const;
/** Optional parts: 0 always, 1 only in a long coat, 2 backpack, 3 hat. */
const Opt = { Always: 0, Coat: 1, Pack: 2, Hat: 3 } as const;

interface Piece {
  g: THREE.BufferGeometry;
  part: number;
  limb: number;
  opt?: number;
  /** Colour multiplier for Fixed parts (linear), else a shade factor. */
  shade?: number;
  fixed?: THREE.Color;
}

const lathe = (profile: [number, number][], seg = 10) =>
  new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);

/** A capsule from (0, y0) down or up to (0, y1) along y. */
const limb = (r0: number, r1: number, y0: number, y1: number, seg = 7) => {
  const len = Math.abs(y1 - y0);
  const g = new THREE.CylinderGeometry(Math.max(r0, r1), Math.min(r0, r1), len, seg, 1);
  // Cylinder: radiusTop first, so a limb wider at the top has r0 > r1.
  g.translate(0, (y0 + y1) / 2, 0);
  return g;
};

function personPieces(): Piece[] {
  const P: Piece[] = [];
  const add = (g: THREE.BufferGeometry, part: number, limb: number, opt: number = Opt.Always, fixed?: string) =>
    P.push({ g, part, limb, opt, fixed: fixed ? new THREE.Color(fixed) : undefined });

  // Torso: a lathe scaled thin in z (chest deeper than the waist is wide).
  const torso = lathe([[0.001, 0.86], [0.15, 0.88], [0.165, 1.0], [0.155, 1.15], [0.18, 1.32], [0.19, 1.42], [0.11, 1.5], [0.001, 1.5]], 16);
  torso.scale(1, 1, 0.66);
  add(torso, Part.Jacket, Limb.Body);
  // The long coat: a skirt over the thighs.
  const coat = lathe([[0.16, 0.95], [0.2, 0.75], [0.235, 0.52], [0.25, 0.5], [0.001, 0.5]], 16);
  coat.scale(1, 1, 0.7);
  add(coat, Part.Jacket, Limb.Body, Opt.Coat);
  add(limb(0.048, 0.04, 1.5, 1.58, 8), Part.Skin, Limb.Body);
  const head = new THREE.SphereGeometry(0.105, 16, 12);
  head.scale(0.9, 1.12, 1);
  head.translate(0, 1.64, 0.01);
  add(head, Part.Skin, Limb.Body);
  // Jaw and chin: a little narrower and lower than the skull.
  const jaw = new THREE.SphereGeometry(0.075, 12, 8);
  jaw.scale(0.95, 0.85, 1);
  jaw.translate(0, 1.592, 0.028);
  add(jaw, Part.Skin, Limb.Body);
  // Ears.
  for (const sx of [-1, 1]) {
    const ear = new THREE.SphereGeometry(0.02, 6, 5);
    ear.scale(0.4, 1, 0.7);
    ear.translate(sx * 0.093, 1.64, 0);
    add(ear, Part.Skin, Limb.Body);
  }
  // Eyes and a nose, so a face is not blank at arm's length.
  for (const sx of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.011, 6, 4);
    eye.translate(sx * 0.036, 1.655, 0.096);
    add(eye, Part.Fixed, Limb.Body, Opt.Always, '#1c1a19');
    const brow = new THREE.BoxGeometry(0.04, 0.008, 0.01);
    brow.rotateZ(sx * -0.12);
    brow.translate(sx * 0.037, 1.675, 0.097);
    add(brow, Part.Hair, Limb.Body);
  }
  const nose = new THREE.SphereGeometry(0.018, 6, 5);
  nose.scale(0.8, 1, 1.1);
  nose.translate(0, 1.625, 0.108);
  add(nose, Part.Skin, Limb.Body);
  // Hair: a skull cap that stays clear of the face (hairline above the
  // brows), thick sides over the ears and a full back that reaches the nape.
  const hair = new THREE.SphereGeometry(0.114, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.56);
  hair.scale(0.93, 1.12, 1.05);
  hair.rotateX(-0.42);
  hair.translate(0, 1.655, -0.006);
  add(hair, Part.Hair, Limb.Body);
  const back = new THREE.SphereGeometry(0.108, 14, 10, 0, Math.PI * 2, Math.PI * 0.25, Math.PI * 0.5);
  back.scale(0.92, 1.0, 1.0);
  back.rotateX(Math.PI / 2 + 0.35);
  back.scale(1, 1, 1);
  back.translate(0, 1.625, -0.035);
  add(back, Part.Hair, Limb.Body);
  for (const sx of [-1, 1]) {
    const side = new THREE.SphereGeometry(0.03, 8, 6);
    side.scale(0.55, 1.5, 1.2);
    side.translate(sx * 0.088, 1.668, 0.0);
    add(side, Part.Hair, Limb.Body);
  }
  // A fringe: a flat tuft over the forehead.
  const fringe = new THREE.SphereGeometry(0.05, 10, 6);
  fringe.scale(1.55, 0.5, 0.75);
  fringe.rotateX(0.35);
  fringe.translate(0.01, 1.7, 0.072);
  add(fringe, Part.Hair, Limb.Body);
  // Hat (a beanie): a slightly larger cap.
  const hat = new THREE.SphereGeometry(0.12, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
  hat.scale(0.98, 1.05, 1.06);
  hat.translate(0, 1.66, 0);
  add(hat, Part.Accent, Limb.Body, Opt.Hat);
  // Backpack.
  const pack = new THREE.BoxGeometry(0.28, 0.4, 0.14);
  pack.translate(0, 1.2, -0.17);
  add(pack, Part.Accent, Limb.Body, Opt.Pack);

  for (const s of [1, -1]) {
    const [thigh, shin, arm] = s > 0 ? [Limb.ThighL, Limb.ShinL, Limb.ArmL] : [Limb.ThighR, Limb.ShinR, Limb.ArmR];
    const x = s * LEG_X;
    const th = limb(0.078, 0.06, HIP_Y + 0.02, KNEE_Y, 7);
    th.translate(x, 0, 0);
    add(th, Part.Pants, thigh);
    const sh = limb(0.058, 0.042, KNEE_Y, 0.09, 7);
    sh.translate(x, 0, 0);
    add(sh, Part.Pants, shin);
    // Shoe: a wedge forward of the ankle.
    const shoe = new THREE.BoxGeometry(0.09, 0.07, 0.24);
    shoe.translate(x, 0.035, 0.05);
    add(shoe, Part.Fixed, shin, Opt.Always, '#2a2622');
    // Arm: sleeve, then the hand.
    const ax = s * SHOULDER_X;
    const sleeve = limb(0.05, 0.04, SHOULDER_Y + 0.02, 0.98, 7);
    sleeve.translate(ax, 0, 0);
    add(sleeve, Part.Jacket, arm);
    const hand = new THREE.SphereGeometry(0.04, 8, 6);
    hand.scale(0.85, 1.2, 0.7);
    hand.translate(ax, 0.93, 0);
    add(hand, Part.Skin, arm);
  }
  return P;
}

function personGeometry() {
  const geos: THREE.BufferGeometry[] = [];
  for (const p of personPieces()) {
    const g = p.g;
    const n = g.getAttribute('position').count;
    const info = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) info.set([p.part, p.limb, p.opt ?? Opt.Always], i * 3);
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 3));
    const c = p.fixed ?? new THREE.Color(1, 1, 1);
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]), 3));
    g.deleteAttribute('uv');
    geos.push(g);
  }
  return mergeGeos(geos);
}

/** Indexed, so the posing vertex shader runs once per vertex, not three times per triangle (a fifth
 * of the work: the crowd is drawn whole, twice a frame with its shadow). */
function mergeGeos(geos: THREE.BufferGeometry[]) {
  const names = ['position', 'normal', 'aInfo', 'color'];
  const merged = new THREE.BufferGeometry();
  const index: number[] = [];
  let base = 0;
  for (const g of geos) {
    const n = g.getAttribute('position').count;
    if (g.index) for (let i = 0; i < g.index.count; i++) index.push(base + g.index.getX(i));
    else for (let i = 0; i < n; i++) index.push(base + i);
    base += n;
  }
  merged.setIndex(index);
  for (const name of names) {
    const size = geos[0].getAttribute(name).itemSize;
    const total = geos.reduce((s, g) => s + g.getAttribute(name).count, 0);
    const out = new Float32Array(total * size);
    let at = 0;
    for (const g of geos) {
      out.set(g.getAttribute(name).array as Float32Array, at);
      at += g.getAttribute(name).array.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(out, size));
  }
  return merged;
}

/** Shader: the walk cycle, seated pose and clothes. Injected into both the
 * colour and the depth material (shadows must follow the legs too). */
const POSE_VERT = /* glsl */ `
attribute vec3 aInfo;   // part (colour), limb (joint), optional-part id
attribute vec4 iAnim;   // phase, amplitude 0..1, seated 0..1, worn bits (coat 1, backpack 2, hat 4)
#define aLimb aInfo.y
#define aOpt aInfo.z

mat3 rotX(float a) {
  float c = cos(a), s = sin(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
}

// Poses [v] (a point when [point] is 1, a direction when 0).
vec3 pose(vec3 v, float point) {
  float ph = iAnim.x, amp = iAnim.y, seat = iAnim.z;
  float l = aLimb;
  float left = (l == 1.0 || l == 3.0 || l == 5.0) ? 1.0 : -1.0;
  vec3 p = v;
  if (l > 0.5) {
    float swing = amp * 0.55 * sin(ph) * left;
    if (l < 4.5) {
      // Legs: thigh about the hip; the shin also flexes at the knee.
      float thigh = mix(swing, 1.45, seat);
      float kneeVel = cos(ph) * left;
      float flex = mix(amp * 0.95 * max(0.0, kneeVel), 1.5, seat);
      vec3 hip = vec3(left * ${LEG_X.toFixed(3)}, ${HIP_Y.toFixed(3)}, 0.0) * point;
      if (l > 2.5) {
        vec3 knee = vec3(left * ${LEG_X.toFixed(3)}, ${KNEE_Y.toFixed(3)}, 0.0) * point;
        p = rotX(flex) * (p - knee) + knee;
      }
      p = rotX(-thigh) * (p - hip) + hip;
    } else {
      // Arms swing against the leg on their side; seated, they rest forward.
      float a = mix(-swing, 0.55, seat);
      vec3 sh = vec3(left * ${SHOULDER_X.toFixed(3)}, ${SHOULDER_Y.toFixed(3)}, 0.0) * point;
      p = rotX(-a) * (p - sh) + sh;
    }
  }
  if (point > 0.5) {
    p.y += amp * 0.022 * abs(sin(ph)) - seat * 0.47;
    p.z -= seat * 0.06;
  }
  return p;
}
`;

const POSE_BEGIN_NORMAL = /* glsl */ `
vec3 objectNormal = pose(vec3(normal), 0.0);
`;
const POSE_BEGIN = /* glsl */ `
vec3 transformed = pose(vec3(position), 1.0);
// Coat, backpack and hat vanish (collapse) when the person does not wear them.
float wornBits = iAnim.w;
bool worn = aOpt < 0.5 || (aOpt < 1.5 && mod(wornBits, 2.0) >= 1.0) || (aOpt > 1.5 && aOpt < 2.5 && mod(floor(wornBits / 2.0), 2.0) >= 1.0) || (aOpt > 2.5 && wornBits >= 4.0);
if (!worn) transformed = vec3(0.0);
`;
const POSE_COLOR = /* glsl */ `
attribute vec3 iJacket;
attribute vec3 iPants;
attribute vec3 iHair;
attribute vec3 iSkin;
attribute vec3 iAccent;
varying vec3 vPersonColor;
`;
const POSE_COLOR_MAIN = /* glsl */ `
{
  float part = aInfo.x;
  vec3 c = vec3(1.0);
  if (part < 0.5) c = iSkin;
  else if (part < 1.5) c = iHair;
  else if (part < 2.5) c = iJacket;
  else if (part < 3.5) c = iPants;
  else if (part > 4.5) c = iAccent;
  vColor.rgb = c * color.rgb;
}
`;

function personMaterial() {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${POSE_VERT}\n${POSE_COLOR}`)
      .replace('#include <beginnormal_vertex>', POSE_BEGIN_NORMAL)
      .replace('#include <begin_vertex>', POSE_BEGIN)
      // The chunk multiplies vColor by `color`; then the person's own colour goes in.
      .replace('#include <color_vertex>', `#include <color_vertex>\n${POSE_COLOR_MAIN}`);
  };
  return material;
}

function depthMaterial() {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${POSE_VERT}`)
      .replace('#include <begin_vertex>', POSE_BEGIN);
  };
  return material;
}

// ------------------------------------------------------------- the palette

const JACKETS = [
  '#1d2229', '#232a3a', '#3a3f47', '#6b6f75', '#b8a58a', '#8a6a48', '#4b5a3e', '#7a2b33', '#3e5f86',
  '#d8d6d0', '#a8322f', '#2f5d46', '#c9962e', '#c98a9a', '#e0662a', '#e8c930', '#2d8a8a', '#5b4a6e', '#101010', '#7d8f9c',
];
const PANTS = ['#1b1d21', '#22283a', '#3a4e73', '#4a5f86', '#7d766a', '#5a5348', '#8b8b8b', '#c8bfae', '#2d2d2d', '#5b3a29', '#d6d2c8'];
const HAIRS = ['#15110e', '#2a1c12', '#4a3020', '#6a4a2c', '#c9a15a', '#d8c08a', '#8a8a86', '#b0b0ac', '#8a3a1a', '#0a0a0a'];
const SKINS = ['#f0c8a8', '#e3b08a', '#c68a62', '#9a6544', '#6b432c'];

const tint = (hex: string) => new THREE.Color(hex);

// ---------------------------------------------------------------- the crowd

/** A person sent flying: the body's middle [cy], its velocity, and its tumble about the model's x
 * axis (0 upright, +pi/2 face down with the head along the heading) with the spin of it; [twist]
 * turns the heading. In the air it is a stiff rod in the vertical plane of the heading (`FLY_*`)
 * that lands on its ends; once it has come to rest it lies flat, then stands up about its feet. */
interface Fly {
  phase: 'air' | 'down';
  cy: number;
  vx: number;
  vy: number;
  vz: number;
  tumble: number;
  spin: number;
  twist: number;
  /** Seconds left on the ground. */
  t: number;
  /** The tumble when getting up began (NaN until then). */
  from: number;
  /** Seconds in the air (a cap, for anything that never settles). */
  air: number;
}

/** The flying body as a rod (m, at scale 1): the middle above the soles, the head above the
 * middle, half its thickness lying down; its moment of inertia per kg about the middle. */
const FLY_FEET = 0.9, FLY_HEAD = 0.85, FLY_THICK = 0.15, FLY_INERTIA = 0.2;
/** Ground friction and the bounce of a hard landing. */
const FLY_MU = 0.6, FLY_BOUNCE = 0.25;
/** Seconds to stand up. */
const GET_UP = 0.9;
const GRAVITY = 9.8;

/** Something that knocks people over: a point on a vehicle with its velocity. */
export interface Striker {
  x: number;
  z: number;
  vx: number;
  vz: number;
  r: number;
}

interface Person {
  x: number;
  z: number;
  y: number;
  /** Heading, radians, model forward (+z) turned by rotation.y. */
  h: number;
  speed: number;
  /** Comfortable walking speed, m/s. */
  pace: number;
  scale: number;
  phase: number;
  amp: number;
  state: 'walk' | 'idle' | 'flee' | 'sit' | 'fly';
  /** Knocked down by a vehicle: flying, then lying, then getting up. */
  fly?: Fly;
  seat: Seat | null;
  /** 0 standing .. 1 seated (eases, so people sit and stand up over half a second). */
  sitBlend: number;
  timer: number;
  tx: number;
  tz: number;
  /** A companion this person walks beside, or -1. */
  leader: number;
  offX: number;
  offZ: number;
  tries: number;
  /** Chatting while idle: the way they face. */
  face: number;
  /** Got up off the walk grid (a road, under the café chairs): walks straight back to it. */
  lost?: boolean;
  /** Where they walk: an index into `AREAS`, or -1 for the square and the streets round it. */
  area: number;
}

/** Cells to spawn on and walk to, with a running sum of their weights. */
interface Pool {
  cells: { x: number; z: number }[];
  cumulative: Float64Array;
}

/** Deterministic random numbers, so a given crowd is repeatable. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type { Person };

export class Crowd {
  readonly root = new THREE.Group();
  readonly people: Person[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly walk: WalkData;
  private readonly bits: Uint8Array;
  /** 0 unknown, 1 free, 2 blocked; and the probed height. */
  private readonly state: Uint8Array;
  private readonly height: Float32Array;
  private readonly reach: Uint8Array;
  private readonly probe: Probe;
  private readonly rand: () => number;
  /** Ground heights on levels (`WalkData.levels`). */
  private readonly levelY: Uint8Array | null = null;
  /** The square's crowd (`square`) and one pool per entry of `AREAS`. */
  private square: Pool = { cells: [], cumulative: new Float64Array(0) };
  private areas: Pool[] = [];
  private readonly hash = new Map<number, number[]>();
  private readonly tmp = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly size = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly matrix = new THREE.Matrix4();
  private readonly worn: Float32Array;
  /** Set by the game: is a small ball at this point inside solid scenery? (flying people bounce off it) */
  solid: ((x: number, y: number, z: number) => boolean) | null = null;
  /** Set by the game: the height of the first static surface below (x, y, z) (where flying people land). */
  floor: ((x: number, y: number, z: number) => number) | null = null;
  /** Called when a vehicle sends somebody flying, with the speed of the blow (the sound). */
  onHit: ((x: number, y: number, z: number, speed: number) => void) | null = null;
  /** People knocked over so far (somebody already lying in the way, hit again, does not count twice). */
  hits = 0;

  /** [count] walkers on and around the square, [around] more in `AREAS`. */
  constructor(
    walk: WalkData,
    probe: Probe,
    count: number,
    seats: Seat[] = [],
    blockSpots: [number, number, number][] = [],
    around = 0,
    seed = 7,
  ) {
    this.walk = walk;
    this.probe = probe;
    this.rand = rng(seed);
    const raw = atob(walk.bits);
    this.bits = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    if (walk.levels) this.levelY = Uint8Array.from(atob(walk.levels.y), (c) => c.charCodeAt(0));
    this.state = new Uint8Array(walk.w * walk.h);
    this.height = new Float32Array(walk.w * walk.h);
    this.reach = new Uint8Array(walk.w * walk.h);
    // Tables and chairs are loose bodies the probe ignores: keep walkers off them.
    for (const [bx, bz, br] of blockSpots) {
      for (let dz = -br; dz <= br; dz += 0.5) {
        for (let dx = -br; dx <= br; dx += 0.5) {
          if (dx * dx + dz * dz > br * br) continue;
          const c = this.at(bx + dx, bz + dz);
          if (c >= 0) this.state[c] = 2;
        }
      }
    }
    this.flood();
    this.weigh();

    const geo = personGeometry();
    const max = count + around + seats.length;
    const attr = (n: number) => new THREE.InstancedBufferAttribute(new Float32Array(max * n), n);
    const iAnim = attr(4), iJacket = attr(3), iPants = attr(3), iHair = attr(3), iSkin = attr(3), iAccent = attr(3);
    const worn = (this.worn = new Float32Array(max));
    geo.setAttribute('iAnim', iAnim);
    geo.setAttribute('iJacket', iJacket);
    geo.setAttribute('iPants', iPants);
    geo.setAttribute('iHair', iHair);
    geo.setAttribute('iSkin', iSkin);
    geo.setAttribute('iAccent', iAccent);
    this.mesh = new THREE.InstancedMesh(geo, personMaterial(), max);
    this.mesh.customDepthMaterial = depthMaterial();
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    this.root.name = 'crowd';

    const pick = <T,>(a: T[]) => a[Math.floor(this.rand() * a.length)];
    const put = (a: THREE.InstancedBufferAttribute, i: number, c: THREE.Color) => a.setXYZ(i, c.r, c.g, c.b);
    const dress = (i: number) => {
      put(iJacket, i, tint(pick(JACKETS)));
      put(iPants, i, tint(pick(PANTS)));
      put(iHair, i, tint(pick(HAIRS)));
      put(iSkin, i, tint(pick(SKINS)));
      put(iAccent, i, tint(pick(JACKETS)));
      worn[i] = (this.rand() < 0.25 ? 1 : 0) + (this.rand() < 0.16 ? 2 : 0) + (this.rand() < 0.12 ? 4 : 0);
    };
    const homes = [...Array<number>(count).fill(-1), ...this.share(around)];
    for (let i = 0; i < homes.length; i++) {
      const area = homes[i];
      const c = this.spawnSpot(area);
      const person: Person = {
        x: c.x,
        z: c.z,
        y: 0,
        h: this.rand() * Math.PI * 2,
        speed: 0,
        pace: 0.9 + this.rand() * 0.7,
        scale: 0.93 + this.rand() * 0.14,
        phase: this.rand() * 6.28,
        amp: 0,
        state: 'idle',
        timer: this.rand() * 6,
        tx: c.x,
        tz: c.z,
        leader: -1,
        offX: 0,
        offZ: 0,
        tries: 0,
        face: this.rand() * 6.28,
        seat: null,
        sitBlend: 0,
        area,
      };
      // Some walk in pairs: this one follows the previous person.
      if (i > 0 && this.rand() < 0.22 && this.people[i - 1].leader < 0 && this.people[i - 1].area === area) {
        const lead = this.people[i - 1];
        person.leader = i - 1;
        person.x = lead.x + (this.rand() - 0.5) * 1.4;
        person.z = lead.z + (this.rand() - 0.5) * 1.4;
        if (!this.free(this.at(person.x, person.z))) {
          person.x = lead.x;
          person.z = lead.z;
        }
        person.offX = (this.rand() < 0.5 ? -1 : 1) * (0.8 + this.rand() * 0.4);
        person.offZ = -0.3 - this.rand() * 0.4;
        person.pace = lead.pace;
        person.scale = this.rand() < 0.3 ? 0.62 + this.rand() * 0.12 : person.scale;
      }
      const ic = this.at(person.x, person.z);
      person.y = this.cellY(ic);
      this.people.push(person);
      dress(i);
    }
    // Café guests: someone on about every other chair near the centre.
    for (const seat of seats) {
      if (Math.hypot(seat.x, seat.z) > 220 || this.rand() > 0.404) continue;
      const i = this.people.length;
      this.people.push({
        x: seat.x, z: seat.z, y: seat.y, h: seat.heading, speed: 0, pace: 1.2, scale: 0.93 + this.rand() * 0.14,
        phase: 0, amp: 0, state: 'sit', timer: this.rand(), tx: seat.x, tz: seat.z, leader: -1, offX: 0, offZ: 0,
        tries: 0, face: seat.heading, seat, sitBlend: 1, area: -1,
      });
      dress(i);
    }
    this.mesh.count = this.people.length;
    this.place();
  }

  // ---- the grid

  private at(x: number, z: number) {
    const i = Math.floor((x - this.walk.x0) / this.walk.cell);
    const j = Math.floor((z - this.walk.z0) / this.walk.cell);
    return i < 0 || j < 0 || i >= this.walk.w || j >= this.walk.h ? -1 : j * this.walk.w + i;
  }

  private walkable(idx: number) {
    if (idx < 0) return false;
    const w = this.walk.w;
    const i = idx % w, j = (idx - i) / w;
    return (this.bits[j * ((w + 7) >> 3) + (i >> 3)] >> (i & 7)) & 1;
  }

  /** The ground of a cell on a level (the Dolac plateau, its stairs), or undefined. */
  private level(idx: number) {
    const l = this.walk.levels;
    if (!l || !this.levelY) return undefined;
    const w = this.walk.w;
    const i = idx % w - l.i0, j = (idx - (idx % w)) / w - l.j0;
    if (i < 0 || j < 0 || i >= l.w || j >= l.h) return undefined;
    const v = this.levelY[j * l.w + i];
    return v ? v / 5 - 10 : undefined;
  }

  /** The cell's probe result (ground height, free of props), cached. */
  private free(idx: number) {
    if (idx < 0 || !this.walkable(idx)) return false;
    if (this.state[idx] === 0) {
      const w = this.walk.w;
      const i = idx % w, j = (idx - i) / w;
      const r = this.probe(this.walk.x0 + (i + 0.5) * this.walk.cell, this.walk.z0 + (j + 0.5) * this.walk.cell, this.level(idx));
      this.state[idx] = r.free ? 1 : 2;
      this.height[idx] = r.y;
    }
    return this.state[idx] === 1;
  }

  private cellY(idx: number) {
    if (idx < 0) return 0;
    this.free(idx);
    return this.height[idx];
  }

  /** Somebody standing at height [y] can step onto the cell: free, and no wall up or down. */
  private stepTo(idx: number, y: number) {
    return this.free(idx) && Math.abs(this.height[idx] - y) < STEP;
  }

  /** Marks the cells connected to the square: islands in courtyards stay empty. */
  private flood() {
    const { w, h } = this.walk;
    const seed = this.nearestWalkable(CENTRE.x + 14, CENTRE.z + 12);
    const stack = [seed];
    this.reach[seed] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const i = c % w, j = (c - i) / w;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
        const n = nj * w + ni;
        if (this.reach[n] || !this.walkable(n)) continue;
        this.reach[n] = 1;
        stack.push(n);
      }
    }
  }

  private nearestWalkable(x: number, z: number) {
    for (let r = 0; r < 60; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const idx = this.at(x + dx, z + dz);
          if (this.walkable(idx)) return idx;
        }
      }
    }
    return 0;
  }

  /** Density: most people on the square, fewer in the streets around it; the areas'
   * walkers anywhere in their area. */
  private weigh() {
    const { w, h, x0, z0, cell } = this.walk;
    const squareSums: number[] = [];
    const areas = AREAS.map((a) => {
      const xs = a.line.map((q) => q[0]), zs = a.line.map((q) => q[1]);
      const box = [Math.min(...xs) - a.r, Math.min(...zs) - a.r, Math.max(...xs) + a.r, Math.max(...zs) + a.r];
      return { box, cells: [] as { x: number; z: number }[], sums: [] as number[] };
    });
    const squareCells: { x: number; z: number }[] = [];
    let total = 0;
    for (let idx = 0; idx < w * h; idx++) {
      if (!this.reach[idx]) continue;
      const i = idx % w, j = (idx - i) / w;
      const x = x0 + (i + 0.5) * cell, z = z0 + (j + 0.5) * cell;
      const r = Math.hypot(x - CENTRE.x, z - CENTRE.z);
      if (r <= 190) {
        total += 0.05 + 1.6 * Math.exp(-((r / 62) ** 2)) + 0.25 * Math.exp(-((r / 150) ** 2));
        squareCells.push({ x, z });
        squareSums.push(total);
      }
      AREAS.forEach((a, k) => {
        const { box, cells, sums } = areas[k];
        if (x < box[0] || z < box[1] || x > box[2] || z > box[3] || lineDistance(x, z, a.line) > a.r) return;
        cells.push({ x, z });
        sums.push(cells.length);
      });
    }
    this.square = { cells: squareCells, cumulative: Float64Array.from(squareSums) };
    this.areas = areas.map((a) => ({ cells: a.cells, cumulative: Float64Array.from(a.sums) }));
  }

  /** [n] walkers' areas, in proportion to the areas' shares (largest remainders first); an
   * area with no reachable cell sends its walkers to the square. */
  private share(n: number) {
    const total = AREAS.reduce((s, a) => s + a.share, 0);
    const exact = AREAS.map((a) => (n * a.share) / total);
    const counts = exact.map(Math.floor);
    const order = exact.map((_, k) => k).sort((a, b) => exact[b] - counts[b] - (exact[a] - counts[a]));
    for (let k = 0; counts.reduce((s, c) => s + c, 0) < n; k++) counts[order[k % order.length]]++;
    return counts.flatMap((c, k) => Array<number>(c).fill(this.areas[k].cells.length ? k : -1));
  }

  /** A random point in a random cell of the area's pool (-1: the square's). */
  private spawnCell(area = -1) {
    const pool = area < 0 ? this.square : this.areas[area];
    const cum = pool.cumulative;
    const t = this.rand() * cum[cum.length - 1];
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    const c = pool.cells[lo];
    return { x: c.x + (this.rand() - 0.5) * 0.9, z: c.z + (this.rand() - 0.5) * 0.9 };
  }

  /** Where somebody starts: a cell of the area that is free, if a few tries find one. */
  private spawnSpot(area: number) {
    let c = this.spawnCell(area);
    for (let tries = 0; tries < 12 && !this.free(this.at(c.x, c.z)); tries++) c = this.spawnCell(area);
    return c;
  }

  /** The straight line a -> b, starting at height [y], crosses only free cells and no wall up or down. */
  private clear(ax: number, az: number, bx: number, bz: number, y: number) {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(d / 0.6);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const c = this.at(ax + (bx - ax) * t, az + (bz - az) * t);
      if (!this.stepTo(c, y)) return false;
      y = this.height[c];
    }
    return true;
  }

  /** Ground height under (x, z) (the probed cell). */
  heightAt(x: number, z: number) {
    return this.cellY(this.at(x, z));
  }

  /** A random free, reachable spot between [rMin] and [rMax] m from (cx, cz), and within
   * [maxFromOrigin] m of the square's middle (CENTRE); null when a few tries find none. */
  spot(cx: number, cz: number, rMin: number, rMax: number, maxFromOrigin = Infinity) {
    for (let tries = 0; tries < 40; tries++) {
      const a = this.rand() * Math.PI * 2;
      const r = rMin + this.rand() * (rMax - rMin);
      const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      if (Math.hypot(x - CENTRE.x, z - CENTRE.z) > maxFromOrigin) continue;
      const idx = this.at(x, z);
      if (idx < 0 || !this.reach[idx] || !this.free(idx)) continue;
      return { x, z, y: this.height[idx] };
    }
    return null;
  }

  private pickTarget(p: Person) {
    for (let tries = 0; tries < 12; tries++) {
      const c = this.spawnCell(p.area);
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < 8 || d > 70) continue;
      if (!this.reach[this.at(c.x, c.z)]) continue;
      if (this.clear(p.x, p.z, c.x, c.z, p.y)) {
        p.tx = c.x;
        p.tz = c.z;
        return true;
      }
    }
    // Nowhere in sight: a short hop in some direction.
    for (let tries = 0; tries < 8; tries++) {
      const a = this.rand() * Math.PI * 2, d = 3 + this.rand() * 8;
      const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
      if (this.clear(p.x, p.z, x, z, p.y)) {
        p.tx = x;
        p.tz = z;
        return true;
      }
    }
    return false;
  }

  /** Off the grid: aim for the nearest free, reachable cell (the first ring of cells that has one). */
  private wayBack(p: Person) {
    const { cell, x0, z0 } = this.walk;
    for (let r = 1; r <= 12; r++) {
      let best = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const c = this.at(p.x + dx * cell, p.z + dz * cell);
          // Not up or down a wall (off the edge of the Dolac plateau).
          if (c < 0 || !this.reach[c] || !this.free(c) || Math.abs(this.height[c] - p.y) > 1.2) continue;
          const i = c % this.walk.w, j = (c - i) / this.walk.w;
          const x = x0 + (i + 0.5) * cell, z = z0 + (j + 0.5) * cell;
          const d = Math.hypot(x - p.x, z - p.z);
          if (d < best) {
            best = d;
            p.tx = x;
            p.tz = z;
          }
        }
      }
      if (best < Infinity) return true;
    }
    // Nothing near (a rooftop, a courtyard): put them on the nearest spot that is.
    const s = this.spot(p.x, p.z, 0, 10);
    if (s) {
      p.x = p.tx = s.x;
      p.z = p.tz = s.z;
      p.y = s.y;
      p.lost = false;
    }
    return false;
  }

  // ---- the step

  /** Advances the crowd [dt] seconds; [threats] are what people get out of the way of. */
  step(dt: number, threats: Threat[], strikers: Striker[] = []) {
    const people = this.people;
    for (const s of strikers) {
      const sp = Math.hypot(s.vx, s.vz);
      if (sp < 2.5) continue;
      for (const q of people) {
        // Somebody lying in the way is hit again; somebody in the air is not (the vehicle follows them).
        if (q.fly?.phase === 'air' || Math.hypot(q.x - s.x, q.z - s.z) > s.r) continue;
        this.knock(q, s, sp);
      }
    }
    // A hash of who stands where, for keeping a little apart.
    this.hash.clear();
    people.forEach((p, i) => {
      const k = Math.floor(p.x / 2) * 4096 + Math.floor(p.z / 2);
      const l = this.hash.get(k);
      if (l) l.push(i);
      else this.hash.set(k, [i]);
    });
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      if (p.fly) {
        this.stepFly(p, p.fly, dt);
        continue;
      }
      if (p.state === 'sit') {
        // Stays put until the chair is knocked about.
        p.timer -= dt;
        if (p.timer <= 0) {
          p.timer = 0.25 + this.rand() * 0.2;
          if (p.seat!.disturbed()) {
            p.seat = null;
            p.state = 'flee';
            p.timer = 1;
            const a = this.rand() * Math.PI * 2;
            p.tx = p.x + Math.sin(a) * 5;
            p.tz = p.z + Math.cos(a) * 5;
            // The chair's own cell is kept clear of walkers and knows no height: the seat's floor does.
            const c = this.at(p.x, p.z);
            if (this.free(c)) p.y = this.height[c];
          }
        }
        continue;
      }
      p.sitBlend = Math.max(0, p.sitBlend - dt * 2.5);
      if (p.lost) {
        const c = this.at(p.x, p.z);
        if (c >= 0 && this.reach[c] && this.free(c)) p.lost = false;
      }
      // Threats first: anything coming at them.
      let fx = 0, fz = 0, urgency = 0;
      for (const t of threats) {
        const dx = p.x - t.x, dz = p.z - t.z;
        const dsq = dx * dx + dz * dz;
        const reach = t.r + Math.hypot(t.vx, t.vz) * 0.9;
        if (dsq > reach * reach) continue;
        const d = Math.sqrt(dsq) + 1e-3;
        // Away from it, and sideways off its line of travel.
        const sp = Math.hypot(t.vx, t.vz);
        let ax = dx / d, az = dz / d;
        if (sp > 1) {
          const side = dx * t.vz - dz * t.vx > 0 ? 1 : -1;
          ax += (-t.vz / sp) * side * 1.2;
          az += (t.vx / sp) * side * 1.2;
        }
        const w = 1 - d / reach;
        fx += ax * w;
        fz += az * w;
        urgency = Math.max(urgency, w);
      }
      if (urgency > 0) {
        p.state = 'flee';
        p.timer = 0.8;
        const l = Math.hypot(fx, fz) || 1;
        p.tx = p.x + (fx / l) * 6;
        p.tz = p.z + (fz / l) * 6;
        p.leader = -1;
      } else if (p.state === 'flee') {
        p.timer -= dt;
        if (p.timer <= 0) {
          p.state = 'idle';
          p.timer = 0.3;
        }
      }

      let want = 0;
      let dirx = 0, dirz = 0;
      if (p.state === 'idle') {
        p.timer -= dt;
        if (p.timer <= 0) {
          if (p.lost ? this.wayBack(p) : this.pickTarget(p)) p.state = 'walk';
          else p.timer = 2 + this.rand() * 3;
        }
      }
      if (p.leader >= 0 && p.state !== 'flee') {
        const l = people[p.leader];
        // Beside the companion, in their frame.
        const s = Math.sin(l.h), c = Math.cos(l.h);
        p.tx = l.x + c * p.offX + s * p.offZ;
        p.tz = l.z - s * p.offX + c * p.offZ;
        const d = Math.hypot(p.tx - p.x, p.tz - p.z);
        if (l.state === 'idle' || d < 0.25) want = l.state === 'idle' ? 0 : l.speed;
        else want = Math.min(2.6, l.speed + d * 1.2);
        p.state = l.state === 'flee' || (p.state as string) === 'flee' ? 'flee' : 'walk';
        dirx = p.tx - p.x;
        dirz = p.tz - p.z;
      } else if (p.state === 'walk' || p.state === 'flee') {
        dirx = p.tx - p.x;
        dirz = p.tz - p.z;
        const d = Math.hypot(dirx, dirz);
        if (d < 0.8 && p.state === 'walk' && !p.lost) {
          // Arrived: often stop for a while, then go on.
          if (this.rand() < 0.45) {
            p.state = 'idle';
            p.timer = 3 + this.rand() * 12;
            p.face = p.h + (this.rand() - 0.5) * 2;
          } else if (!this.pickTarget(p)) {
            p.state = 'idle';
            p.timer = 1;
          }
          dirx = dirz = 0;
        } else {
          want = p.state === 'flee' ? Math.min(3.6, 1.8 + urgency * 3) : p.pace;
        }
      }

      // Keep a little apart from others.
      const cx = Math.floor(p.x / 2), cz = Math.floor(p.z / 2);
      let sx = 0, sz = 0;
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          const l = this.hash.get((cx + a) * 4096 + (cz + b));
          if (!l) continue;
          for (const k of l) {
            if (k === i) continue;
            const q = people[k];
            const dx = p.x - q.x, dz = p.z - q.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < 0.64 && d2 > 1e-6) {
              const d = Math.sqrt(d2);
              sx += (dx / d) * (0.8 - d);
              sz += (dz / d) * (0.8 - d);
            }
          }
        }
      }
      const dl = Math.hypot(dirx, dirz);
      if (dl > 1e-3) {
        dirx /= dl;
        dirz /= dl;
      }
      // Speed follows the wish.
      const accel = p.state === 'flee' ? 8 : 2.2;
      p.speed += Math.max(-accel * dt * 1.5, Math.min(accel * dt, want - p.speed));
      const mx = dirx * p.speed + sx * 1.2, mz = dirz * p.speed + sz * 1.2;
      const mv = Math.hypot(mx, mz);
      if (mv > 0.02) {
        // Turn toward the way of travel.
        let da = Math.atan2(mx, mz) - p.h;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        const turn = (p.state === 'flee' ? 9 : 4.5) * dt;
        p.h += Math.max(-turn, Math.min(turn, da));
        const nx = p.x + mx * dt, nz = p.z + mz * dt;
        if (p.lost || this.stepTo(this.at(nx, nz), p.y)) {
          p.x = nx;
          p.z = nz;
          p.tries = 0;
        } else if (this.stepTo(this.at(nx, p.z), p.y)) p.x = nx;
        else if (this.stepTo(this.at(p.x, nz), p.y)) p.z = nz;
        else if (++p.tries > 8) {
          // Stuck against something: choose another way.
          p.tries = 0;
          if (p.state === 'flee') p.state = 'idle';
          if (!this.pickTarget(p)) {
            p.state = 'idle';
            p.timer = 1;
          }
        }
      } else if (p.state === 'idle') {
        // Turn to face a chat partner's way.
        let da = p.face - p.h;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        p.h += Math.max(-1.5 * dt, Math.min(1.5 * dt, da));
      }
      // Off the grid the cells know no height: ask the world. A cell nobody may step on (a
      // chair's, just stood up from) knows none either: stay at the height they are.
      const here = this.at(p.x, p.z);
      const gy = p.lost && this.floor ? this.floor(p.x, p.y + 1, p.z) : this.free(here) ? this.height[here] : p.y;
      p.y += (gy - p.y) * Math.min(1, dt * 12);
      // Stride: the legs move with the ground covered, arms and legs fade in and out.
      const sp = Math.hypot(mx, mz);
      p.amp += (Math.min(1, sp / 1.3) - p.amp) * Math.min(1, dt * 8);
      p.phase += (sp * 4.6 + (p.state === 'flee' ? 3 : 0)) * dt;
    }
  }

  /** A vehicle at speed [sp] hits [p]: off they go (again, when they were lying in the way). */
  private knock(p: Person, s: Striker, sp: number) {
    const dx = s.vx / sp, dz = s.vz / sp;
    const side = (this.rand() - 0.5) * 0.5 * sp;
    const vx = Math.max(-22, Math.min(22, s.vx * (0.9 + 0.25 * this.rand()) - dz * side));
    const vz = Math.max(-22, Math.min(22, s.vz * (0.9 + 0.25 * this.rand()) + dx * side));
    const down = p.fly;
    // Tumbling head over heels along the line of the blow (somebody lying keeps their heading:
    // turning them would jump). Struck below the middle, the legs go first and the head mostly
    // falls back toward the vehicle.
    if (!down) p.h = Math.atan2(vx, vz);
    const along = Math.sin(p.h) * vx + Math.cos(p.h) * vz >= 0 ? 1 : -1;
    p.fly = {
      phase: 'air',
      cy: down ? down.cy : p.y + FLY_FEET * p.scale,
      vx,
      vz,
      vy: down ? Math.min(5, 1 + sp * 0.25) : Math.min(9, 2.5 + sp * 0.3 + this.rand()),
      tumble: down ? down.tumble : 0,
      spin: (this.rand() < 0.8 ? -along : along) * (3 + this.rand() * 2.5 + sp * 0.3),
      twist: (this.rand() - 0.5) * 3,
      t: 3.5 + this.rand() * 2,
      from: NaN,
      air: 0,
    };
    p.state = 'fly';
    p.seat = null;
    p.leader = -1;
    p.speed = 0;
    p.lost = false;
    if (!down) this.hits++;
    this.onHit?.(p.x, p.y + 1, p.z, sp);
  }

  private stepFly(p: Person, f: Fly, dt: number) {
    const s = p.scale, feet = FLY_FEET * s, head = FLY_HEAD * s, thick = FLY_THICK * s;
    // The first surface under the body, looking from a little above it (kerbs, steps).
    const ground = this.floor ? this.floor(p.x, f.cy + 0.5, p.z) : this.probe(p.x, p.z).y;
    // A café guest straightens out of the chair pose in the air.
    p.sitBlend = Math.max(0, p.sitBlend - dt * 3);
    let mx = 0, mz = 0;
    if (f.phase === 'air') {
      f.air += dt;
      p.phase += 16 * dt;
      p.amp = 1;
      // Substeps of at most 1/90 s, so the ends meet the ground before they sink into it.
      const n = Math.min(8, Math.ceil(dt * 90)), h = dt / n;
      let touched = false;
      for (let k = 0; k < n; k++) {
        f.vy -= GRAVITY * h;
        f.cy += f.vy * h;
        f.tumble += f.spin * h;
        p.h += f.twist * h;
        mx += f.vx * h;
        mz += f.vz * h;
        if (this.land(p, f, ground, feet, head, thick)) touched = true;
      }
      const settled = touched && f.vx * f.vx + f.vy * f.vy + f.vz * f.vz < 0.36 && Math.abs(f.spin) < 1.5;
      if (settled || f.air > 10) f.phase = 'down';
    } else {
      // Slides to a stop and lies there, face up or down, then gets up, turning about the feet.
      const k = Math.exp(-5 * dt);
      f.vx *= k;
      f.vz *= k;
      mx = f.vx * dt;
      mz = f.vz * dt;
      f.t -= dt;
      if (f.t > GET_UP) {
        const lying = Math.round((f.tumble - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
        f.tumble += (lying - f.tumble) * Math.min(1, dt * 5);
      } else {
        if (Number.isNaN(f.from)) f.from = f.tumble;
        const standing = Math.round(f.from / (2 * Math.PI)) * 2 * Math.PI;
        const u = 1 - Math.max(0, f.t) / GET_UP;
        f.tumble = f.from + (standing - f.from) * u * u * (3 - 2 * u);
      }
      p.amp += (0 - p.amp) * Math.min(1, dt * 6);
      // The middle where the lowest point of the body touches the ground.
      const c = Math.cos(f.tumble);
      const rest = ground + Math.max(feet * c, -head * c) + thick * Math.abs(Math.sin(f.tumble));
      if (f.cy > rest + 0.3) f.phase = 'air'; // slid off an edge
      else f.cy = rest;
    }
    this.slide(p, f, mx, mz, ground);
    p.y = ground;
    if (f.phase === 'down' && f.t <= 0) {
      // Standing: the feet are on the ground, so the walk picks up from here without a jump.
      p.fly = undefined;
      p.state = 'idle';
      p.timer = 0.6;
      const c = this.at(p.x, p.z);
      p.lost = !(c >= 0 && this.reach[c] && this.free(c));
    }
  }

  /** The body's two ends against the ground at [ground]: pushes it out, then the impulses of the
   * contact (a bounce on a hard landing) and of friction (which tips it over), for a rod in the
   * vertical plane of the heading. True when an end touched. */
  private land(p: Person, f: Fly, ground: number, feet: number, head: number, thick: number) {
    const sn = Math.sin(f.tumble), cs = Math.cos(f.tumble), under = thick * Math.abs(sn);
    const hx = Math.sin(p.h), hz = Math.cos(p.h);
    const inertia = FLY_INERTIA * p.scale * p.scale;
    let touched = false;
    for (let it = 0; it < 4; it++) {
      // Feet, head, feet, head: a body lying flat rests on both.
      const l = it % 2 ? head : -feet;
      const ef = l * sn, ey = l * cs;
      const depth = ground - (f.cy + ey - under);
      if (depth <= 0) continue;
      touched = true;
      f.cy += depth;
      // The end's velocity: the middle's plus the turn (ef along the heading, ey up).
      const vn = f.vy - f.spin * ef;
      if (vn >= 0) continue;
      const jn = (-(1 + (vn < -2.5 ? FLY_BOUNCE : 0)) * vn) / (1 + (ef * ef) / inertia);
      f.vy += jn;
      f.spin -= (ef * jn) / inertia;
      let u = f.vx * hx + f.vz * hz, w = f.vx * hz - f.vz * hx;
      const cap = FLY_MU * jn;
      const jt = Math.max(-cap, Math.min(cap, -(u + f.spin * ey) / (1 + (ey * ey) / inertia)));
      u += jt;
      f.spin += (ey * jt) / inertia;
      w -= Math.max(-cap, Math.min(cap, w));
      f.vx = u * hx + w * hz;
      f.vz = u * hz - w * hx;
      f.twist *= 0.8;
    }
    return touched;
  }

  /** Moves a flying body by (mx, mz) unless its middle would end up inside scenery: then it
   * bounces off the side it hit (x, z or both in a corner). */
  private slide(p: Person, f: Fly, mx: number, mz: number, ground: number) {
    const nx = p.x + mx, nz = p.z + mz;
    // Clear of the ground under it, so only walls, kerbs and props count.
    const y = Math.max(f.cy, ground + 0.4);
    if (!this.solid || !this.solid(nx, y, nz)) {
      p.x = nx;
      p.z = nz;
      return;
    }
    const hitX = this.solid(nx, y, p.z), hitZ = this.solid(p.x, y, nz);
    if (hitX || !hitZ) f.vx *= -0.3;
    else p.x = nx;
    if (hitZ || !hitX) f.vz *= -0.3;
    else p.z = nz;
    f.spin *= 0.6;
  }

  /** Writes the poses to the GPU. */
  place() {
    const anim = this.mesh.geometry.getAttribute('iAnim') as THREE.InstancedBufferAttribute;
    for (let i = 0; i < this.people.length; i++) {
      const p = this.people[i];
      if (p.fly) {
        // Heading, then the tumble about the body's middle (not the feet).
        this.euler.set(p.fly.tumble, p.h, 0);
        this.quat.setFromEuler(this.euler);
        this.tmp.set(0, FLY_FEET * p.scale, 0).applyQuaternion(this.quat);
        this.pos.set(p.x, p.fly.cy, p.z).sub(this.tmp);
      } else {
        this.euler.set(0, p.h, 0);
        this.quat.setFromEuler(this.euler);
        this.pos.set(p.x, p.y, p.z);
      }
      this.matrix.compose(this.pos, this.quat, this.size.setScalar(p.scale));
      this.mesh.setMatrixAt(i, this.matrix);
      anim.setXYZW(i, p.phase, p.amp, p.sitBlend, this.worn[i]);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    anim.needsUpdate = true;
  }
}
