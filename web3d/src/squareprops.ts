// Free-standing props placed by hand in data/props.json (tool frame; the export turns each into
// city.json `props`: {type, x, z (web frame, z south), y (ground), heading (radians clockwise from
// north), ...the rest of the item}): candelabra and frontage lamps, flagpoles, ad columns, the
// square clock, tram-stop info posts and poster cases, bins, bollards, the chain ring round
// Manduševac, kiosk banners, planters, a signpost, an info board and a tourist cart.
//
// All procedural: repeated things are InstancedMeshes (one per prototype part), unique or varied
// things are merged per material. Every model faces -z (north at heading 0) and rotates by -heading.
// Every solid prop gets a static Rapier collider so the bike and car hit it.

import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface PropItem {
  type: string;
  x: number;
  z: number;
  y: number;
  heading?: number;
  [key: string]: unknown;
}

type V3 = [number, number, number];
interface Part {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
}

// ---------------------------------------------------------------------------------------------
// small helpers

const Y = new THREE.Vector3(0, 1, 0);

function mulberry(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Moves / rotates / scales a geometry in place and returns it. */
function put<G extends THREE.BufferGeometry>(g: G, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], s: V3 | number = 1): G {
  const sc = typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), sc));
  return g;
}

/** Box with its bottom at y0, centred on (x, z). */
const box = (w: number, h: number, d: number, y0 = 0, x = 0, z = 0) => put(new THREE.BoxGeometry(w, h, d), [x, y0 + h / 2, z]);
/** Cylinder (or cone frustum) with its bottom at y0. */
const cyl = (rTop: number, rBot: number, h: number, y0 = 0, seg = 16, x = 0, z = 0, open = false) =>
  put(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open), [x, y0 + h / 2, z]);
/** Lathe profile [radius, height] pairs, bottom to top. */
const lathe = (pts: [number, number][], seg = 16, y0 = 0) =>
  put(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), [0, y0, 0]);
const sphere = (r: number, x: number, y: number, z: number, sy = 1, seg = 12) =>
  put(new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.75))), [x, y, z], [0, 0, 0], [1, sy, 1]);

/** A round strut between two points. */
function strut(a: V3, b: V3, r: number, seg = 6): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const d = vb.clone().sub(va);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1, false);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, d.clone().normalize()));
  g.translate(...va.clone().add(vb).multiplyScalar(0.5).toArray());
  return g;
}

function tube(pts: THREE.Vector3[], r: number, segs: number, radial = 4): THREE.BufferGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, r, radial, false);
}

/** Flat and indexed geometries merge only when alike: non-indexed, position / normal / uv only. */
function prep(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const o = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(o.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') o.deleteAttribute(k);
  if (!o.attributes.uv) o.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((o.attributes.position.count) * 2), 2));
  return o;
}

/** Box-projected UVs in metres (for granite: the tile is `tile` metres). */
function triUV(g: THREE.BufferGeometry, tile = 0.7): THREE.BufferGeometry {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) [u, v] = [p.getX(i), p.getZ(i)];
    else if (ax >= az) [u, v] = [p.getZ(i), p.getY(i)];
    else [u, v] = [p.getX(i), p.getY(i)];
    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = v / tile;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Groups parts by material and merges each group into one geometry. */
function merged(parts: Part[]): Part[] {
  const by = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const p of parts) {
    const list = by.get(p.mat) ?? [];
    list.push(prep(p.geo));
    by.set(p.mat, list);
  }
  return [...by].map(([mat, list]) => ({ geo: mergeGeometries(list, false), mat }));
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function texOf(c: HTMLCanvasElement, opts: { repeat?: boolean; aniso?: number } = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = opts.aniso ?? 8;
  if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------------------------------------
// canvas drawings

function graniteCanvas(): HTMLCanvasElement {
  const [c, x] = canvas(256, 256);
  const rnd = mulberry(11);
  x.fillStyle = '#867970';
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) {
    const px = rnd() * 256;
    const py = rnd() * 256;
    const r = 8 + rnd() * 26;
    x.fillStyle = rnd() < 0.5 ? 'rgba(180,160,150,0.13)' : 'rgba(60,52,48,0.13)';
    for (const [ox, oy] of [[0, 0], [-256, 0], [256, 0], [0, -256], [0, 256]]) {
      x.beginPath();
      x.arc(px + ox, py + oy, r, 0, Math.PI * 2);
      x.fill();
    }
  }
  const cols = ['#6b6059', '#a89c92', '#574f4a', '#b9aea4', '#8a695f', '#403b38'];
  for (let i = 0; i < 9000; i++) {
    x.fillStyle = cols[Math.floor(rnd() * cols.length)];
    x.globalAlpha = 0.25 + rnd() * 0.5;
    const s = rnd() < 0.7 ? 1.5 : 2.5;
    const px = rnd() * 256;
    const py = rnd() * 256;
    x.fillRect(px, py, s, s);
    // wrap so the tile is seamless
    if (px > 254) x.fillRect(px - 256, py, s, s);
    if (py > 254) x.fillRect(px, py - 256, s, s);
  }
  x.globalAlpha = 1;
  return c;
}

const TITLES: [string, string, string][] = [
  ['ZAGREBAČKA FILHARMONIJA', 'KONCERT', 'Lisinski, 20 h'],
  ['HNK ZAGREB', 'PREMIJERA', 'Sezona 2025/26'],
  ['ADVENT U ZAGREBU', 'FESTIVAL', 'Sve do 6. siječnja'],
  ['ZAGREB FILM FESTIVAL', '14. – 19. 10.', 'Kino Europa'],
];

function face(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, rnd: () => number) {
  const skins = ['#e9b992', '#d99c73', '#f1c9a5', '#b9784f'];
  const hair = ['#2a1d16', '#5b3a22', '#c9a24a', '#161616', '#7a2f1c'];
  c.fillStyle = hair[Math.floor(rnd() * hair.length)];
  c.beginPath();
  c.arc(cx, cy - r * 0.05, r * 0.5, Math.PI, 0);
  c.fill();
  c.fillStyle = skins[Math.floor(rnd() * skins.length)];
  c.beginPath();
  c.ellipse(cx, cy, r * 0.36, r * 0.44, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = ['#2b3a67', '#a3283a', '#f2f0ea', '#1f6e5a'][Math.floor(rnd() * 4)];
  c.beginPath();
  c.ellipse(cx, cy + r * 0.85, r * 0.62, r * 0.4, 0, Math.PI, 0);
  c.fill();
}

type PosterKind = 'medallion' | 'concert' | 'theatre' | 'festival' | 'white' | 'pink';

function drawPoster(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, kind: PosterKind, variant: number, rnd: () => number) {
  const t = TITLES[variant % TITLES.length];
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const line = (s: string, cy: number, size: number, col: string, weight = 'bold') => {
    c.fillStyle = col;
    c.font = `${weight} ${size}px "Helvetica Neue", Arial, sans-serif`;
    c.fillText(s, x + w / 2, y + cy * h, w * 0.94);
  };
  if (kind === 'medallion') {
    const g = c.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#3a63d6');
    g.addColorStop(1, '#1c3796');
    c.fillStyle = g;
    c.fillRect(x, y, w, h);
    line(t[0], 0.07, w * 0.075, '#ffffff');
    line(t[1], 0.135, w * 0.11, '#ffd23a');
    const cols = ['#f4b73a', '#e0562f', '#f0dcc0', '#39395a', '#e98a3d'];
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 3; k++) {
        const cx = x + w * (0.22 + 0.28 * k);
        const cy = y + h * (0.3 + 0.19 * r);
        c.fillStyle = cols[Math.floor(rnd() * cols.length)];
        c.beginPath();
        c.arc(cx, cy, w * 0.115, 0, Math.PI * 2);
        c.fill();
        c.save();
        c.beginPath();
        c.arc(cx, cy, w * 0.1, 0, Math.PI * 2);
        c.clip();
        face(c, cx, cy, w * 0.1, rnd);
        c.restore();
      }
    }
    line(t[2], 0.93, w * 0.07, '#ffffff', 'normal');
  } else if (kind === 'concert') {
    c.fillStyle = '#16161e';
    c.fillRect(x, y, w, h);
    c.fillStyle = '#e8641e';
    c.beginPath();
    c.arc(x + w * 0.5, y + h * 0.42, w * 0.34, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#16161e';
    c.beginPath();
    c.arc(x + w * 0.58, y + h * 0.38, w * 0.26, 0, Math.PI * 2);
    c.fill();
    line('KONCERT', 0.8, w * 0.17, '#ffffff');
    line(t[0], 0.9, w * 0.07, '#e8641e');
    line(t[2], 0.955, w * 0.06, '#dddddd', 'normal');
  } else if (kind === 'theatre') {
    c.fillStyle = '#a3182c';
    c.fillRect(x, y, w, h);
    c.fillStyle = '#111';
    c.beginPath();
    c.ellipse(x + w * 0.5, y + h * 0.4, w * 0.3, w * 0.36, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#a3182c';
    c.beginPath();
    c.ellipse(x + w * 0.38, y + h * 0.36, w * 0.06, w * 0.03, 0.4, 0, Math.PI * 2);
    c.ellipse(x + w * 0.62, y + h * 0.36, w * 0.06, w * 0.03, -0.4, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc(x + w * 0.5, y + h * 0.5, w * 0.12, 0.1, Math.PI - 0.1);
    c.fill();
    line('HNK ZAGREB', 0.82, w * 0.14, '#ffffff');
    line('PREMIJERA', 0.91, w * 0.08, '#f4d6d6');
    line('Sezona 2025/26', 0.96, w * 0.055, '#f4d6d6', 'normal');
  } else if (kind === 'festival') {
    c.fillStyle = '#f5c400';
    c.fillRect(x, y, w, h);
    c.fillStyle = '#1d3f9f';
    c.beginPath();
    c.moveTo(x, y + h * 0.55);
    c.lineTo(x + w, y + h * 0.3);
    c.lineTo(x + w, y + h * 0.62);
    c.lineTo(x, y + h * 0.88);
    c.fill();
    line('ZAGREB', 0.15, w * 0.19, '#1d3f9f');
    line('FILM', 0.27, w * 0.19, '#d63a2a');
    line('FESTIVAL', 0.4, w * 0.15, '#1d3f9f');
    line('14. – 19. 10.', 0.72, w * 0.1, '#ffffff');
    line('Kino Europa', 0.95, w * 0.07, '#1d3f9f', 'normal');
  } else if (kind === 'pink') {
    c.fillStyle = '#f6d9e1';
    c.fillRect(x, y, w, h);
    c.fillStyle = '#d43c7a';
    c.fillRect(x, y + h * 0.62, w, h * 0.12);
    line('ADVENT', 0.2, w * 0.17, '#a3184f');
    line('U ZAGREBU', 0.32, w * 0.13, '#a3184f');
    line('Trg bana Jelačića', 0.68, w * 0.075, '#ffffff');
    line('sve do 6.1.', 0.9, w * 0.08, '#8a1c47', 'normal');
  } else {
    c.fillStyle = '#f2f1ec';
    c.fillRect(x, y, w, h);
    c.fillStyle = '#111';
    c.fillRect(x, y, w, h * 0.16);
    line(t[0], 0.08, w * 0.07, '#ffffff');
    line(t[1], 0.3, w * 0.15, '#111111');
    for (let i = 0; i < 7; i++) {
      c.fillStyle = '#666';
      c.fillRect(x + w * 0.1, y + h * (0.48 + i * 0.05), w * (0.5 + rnd() * 0.35), h * 0.012);
    }
    line(t[2], 0.93, w * 0.07, '#111', 'normal');
  }
  c.restore();
}

/** The drum's paper: 6 x 2 posters in a 2048 x 1000 canvas (a 4.1 x 1.95 m wrap). */
function columnTexture(style: string, seed: number): THREE.CanvasTexture {
  const [cv, c] = canvas(2048, 1000);
  const rnd = mulberry(seed);
  c.fillStyle = '#d8d8d4';
  c.fillRect(0, 0, 2048, 1000);
  const kinds: PosterKind[] =
    style === 'blue' ? ['medallion'] : style === 'pink' ? ['pink', 'white', 'festival'] : ['white', 'concert', 'theatre', 'festival', 'white'];
  for (let r = 0; r < 2; r++) {
    for (let k = 0; k < 6; k++) {
      let kind = kinds[Math.floor(rnd() * kinds.length)];
      if (style === 'blue' && rnd() < 0.2) kind = 'concert';
      drawPoster(c, k * 341.33 + 2, r * 500 + 3, 337, 494, kind, Math.floor(rnd() * 4), rnd);
    }
  }
  // worn paper edges
  c.strokeStyle = 'rgba(255,255,255,0.35)';
  c.lineWidth = 2;
  for (let k = 0; k <= 6; k++) {
    c.beginPath();
    c.moveTo(k * 341.33, 0);
    c.lineTo(k * 341.33, 1000);
    c.stroke();
  }
  const t = texOf(cv);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function panelPoster(kind: number): THREE.CanvasTexture {
  const [cv, c] = canvas(512, 700);
  const rnd = mulberry(40 + kind);
  if (kind === 0) {
    const g = c.createLinearGradient(0, 0, 512, 700);
    g.addColorStop(0, '#151b4a');
    g.addColorStop(1, '#3b0d18');
    c.fillStyle = g;
    c.fillRect(0, 0, 512, 700);
    // a face lit from the side
    c.fillStyle = '#c96a4a';
    c.beginPath();
    c.ellipse(290, 250, 105, 140, 0.1, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#7a2a1a';
    c.beginPath();
    c.ellipse(340, 250, 60, 140, 0.1, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#8b1d1d';
    c.beginPath();
    c.moveTo(120, 700);
    c.quadraticCurveTo(290, 380, 470, 700);
    c.fill();
    c.fillStyle = '#e6e04a';
    c.fillRect(150, 470, 250, 26);
  } else {
    c.fillStyle = '#e04f1c';
    c.fillRect(0, 0, 512, 700);
    const g = c.createRadialGradient(256, 300, 20, 256, 300, 360);
    g.addColorStop(0, '#ffb347');
    g.addColorStop(1, '#c62a13');
    c.fillStyle = g;
    c.fillRect(0, 0, 512, 700);
    c.fillStyle = '#1a0d0a';
    c.beginPath();
    c.arc(256, 280, 130, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#f7d58a';
    c.font = 'bold 84px Arial';
    c.textAlign = 'center';
    c.fillText('FILM', 256, 480);
    c.font = 'bold 44px Arial';
    c.fillText('U KINIMA OD 9.10.', 256, 560);
  }
  c.fillStyle = 'rgba(255,255,255,0.9)';
  c.font = 'bold 28px Arial';
  c.textAlign = 'center';
  c.fillText(kind === 0 ? 'ZAGREB · LIVE' : 'CINESTAR', 256, 660);
  for (let i = 0; i < 40; i++) {
    c.fillStyle = `rgba(0,0,0,${rnd() * 0.05})`;
    c.fillRect(rnd() * 512, rnd() * 700, 60, 2);
  }
  return texOf(cv);
}

function ledTexture(lines: string[]): THREE.CanvasTexture {
  const cols = 96;
  const rows = 30;
  const [small, s] = canvas(cols, rows);
  s.fillStyle = '#000';
  s.fillRect(0, 0, cols, rows);
  s.fillStyle = '#fff';
  s.font = 'bold 10px monospace';
  s.textBaseline = 'top';
  lines.forEach((l, i) => s.fillText(l, 1, i * 10));
  const px = s.getImageData(0, 0, cols, rows).data;
  const cell = 6;
  const [cv, c] = canvas(cols * cell, rows * cell);
  c.fillStyle = '#050505';
  c.fillRect(0, 0, cv.width, cv.height);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const on = px[(y * cols + x) * 4] > 110;
      c.fillStyle = on ? '#ff8f1c' : '#1b1109';
      c.beginPath();
      c.arc(x * cell + cell / 2, y * cell + cell / 2, on ? 2.3 : 1.2, 0, Math.PI * 2);
      c.fill();
    }
  }
  return texOf(cv);
}

function timetableTexture(): THREE.CanvasTexture {
  const [cv, c] = canvas(256, 512);
  c.fillStyle = '#f4f4f0';
  c.fillRect(0, 0, 256, 512);
  c.fillStyle = '#1d4f9c';
  c.fillRect(0, 0, 256, 92);
  c.fillStyle = '#fff';
  c.font = 'bold 34px Arial';
  c.textAlign = 'left';
  c.fillText('ZET', 16, 44);
  c.font = 'bold 22px Arial';
  c.fillText('Trg bana Jelačića', 16, 78);
  c.fillStyle = '#111';
  c.font = 'bold 20px Arial';
  const rows = ['1  Zapadni kol.', '6  Črnomerec', '11 Dubec', '12 Dubrava', '13 Žitnjak', '14 Mihaljevac', '17 Prečko'];
  rows.forEach((r, i) => {
    c.fillText(r, 16, 130 + i * 30);
    c.fillStyle = '#c9c9c4';
    c.fillRect(16, 138 + i * 30, 224, 1.5);
    c.fillStyle = '#111';
  });
  c.font = '15px Arial';
  for (let i = 0; i < 14; i++) c.fillText(`${5 + i}:00  ${(7 + i * 5) % 60}  ${(19 + i * 7) % 60}  ${(33 + i * 11) % 60}`, 16, 360 + i * 11);
  return texOf(cv);
}

function grilleTexture(): THREE.CanvasTexture {
  const [cv, c] = canvas(128, 64);
  c.fillStyle = '#9a9ea0';
  c.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 16; i++) {
    c.fillStyle = '#4b4f52';
    c.fillRect(6, 4 + i * 4, 116, 2);
  }
  return texOf(cv);
}

function clockFaceTexture(): { tex: THREE.CanvasTexture; draw: (d: Date) => void } {
  const [cv, c] = canvas(512, 512);
  const tex = texOf(cv);
  const draw = (d: Date) => {
    c.clearRect(0, 0, 512, 512);
    c.fillStyle = '#f3efe2';
    c.beginPath();
    c.arc(256, 256, 250, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#26282a';
    c.lineWidth = 10;
    c.beginPath();
    c.arc(256, 256, 244, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = '#1b1c1e';
    c.font = 'bold 54px Georgia, serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let h = 1; h <= 12; h++) {
      const a = (h / 12) * Math.PI * 2;
      c.fillText(String(h), 256 + Math.sin(a) * 190, 256 - Math.cos(a) * 190);
    }
    for (let m = 0; m < 60; m++) {
      const a = (m / 60) * Math.PI * 2;
      c.lineWidth = m % 5 === 0 ? 6 : 2;
      c.beginPath();
      c.moveTo(256 + Math.sin(a) * 228, 256 - Math.cos(a) * 228);
      c.lineTo(256 + Math.sin(a) * 240, 256 - Math.cos(a) * 240);
      c.stroke();
    }
    const hand = (a: number, len: number, wd: number) => {
      c.lineWidth = wd;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(256 - Math.sin(a) * 30, 256 + Math.cos(a) * 30);
      c.lineTo(256 + Math.sin(a) * len, 256 - Math.cos(a) * len);
      c.stroke();
    };
    const mins = d.getMinutes() + d.getSeconds() / 60;
    hand(((d.getHours() % 12) + mins / 60) / 12 * Math.PI * 2, 120, 16);
    hand((mins / 60) * Math.PI * 2, 185, 10);
    c.fillStyle = '#1b1c1e';
    c.beginPath();
    c.arc(256, 256, 14, 0, Math.PI * 2);
    c.fill();
    tex.needsUpdate = true;
  };
  draw(new Date());
  return { tex, draw };
}

function croatianFlag(): THREE.CanvasTexture {
  const [cv, c] = canvas(720, 360);
  const h = 120;
  c.fillStyle = '#b4141c';
  c.fillRect(0, 0, 720, h);
  c.fillStyle = '#e4e4e2';
  c.fillRect(0, h, 720, h);
  c.fillStyle = '#141f78';
  c.fillRect(0, 2 * h, 720, h);
  // the shield: 5 x 5 chequers, red first
  const sx = 360 - 40;
  const sy = 120;
  const q = 16;
  c.save();
  c.beginPath();
  c.moveTo(sx, sy);
  c.lineTo(sx + 5 * q, sy);
  c.lineTo(sx + 5 * q, sy + 4 * q);
  c.quadraticCurveTo(sx + 5 * q, sy + 6.2 * q, sx + 2.5 * q, sy + 6.6 * q);
  c.quadraticCurveTo(sx, sy + 6.2 * q, sx, sy + 4 * q);
  c.closePath();
  c.clip();
  for (let r = 0; r < 7; r++)
    for (let k = 0; k < 5; k++) {
      c.fillStyle = (r + k) % 2 === 0 ? '#e2231a' : '#f4f4f4';
      c.fillRect(sx + k * q, sy + r * q, q, q);
    }
  c.restore();
  c.strokeStyle = '#1c1c1c';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(sx, sy);
  c.lineTo(sx + 5 * q, sy);
  c.lineTo(sx + 5 * q, sy + 4 * q);
  c.quadraticCurveTo(sx + 5 * q, sy + 6.2 * q, sx + 2.5 * q, sy + 6.6 * q);
  c.quadraticCurveTo(sx, sy + 6.2 * q, sx, sy + 4 * q);
  c.closePath();
  c.stroke();
  // the crown of five small shields
  const small = ['#1d4fb8', '#1d4fb8', '#1d4fb8', '#1d4fb8', '#1d4fb8'];
  c.fillStyle = '#f0c419';
  c.fillRect(sx - 2, sy - 12, 5 * q + 4, 8);
  for (let i = 0; i < 5; i++) {
    const cx = sx + (i + 0.5) * q;
    c.fillStyle = small[i];
    c.fillRect(cx - 6, sy - 34, 12, 20);
    c.fillStyle = '#f0c419';
    if (i === 0) {
      c.beginPath();
      c.arc(cx, sy - 24, 3.5, 0, Math.PI * 2);
      c.fill();
    } else if (i === 1) {
      c.fillRect(cx - 6, sy - 28, 12, 3);
      c.fillRect(cx - 6, sy - 21, 12, 3);
    } else if (i === 2) {
      c.fillRect(cx - 3, sy - 30, 6, 12);
    } else if (i === 3) {
      c.fillRect(cx - 4, sy - 26, 8, 8);
    } else {
      c.fillStyle = '#d8d8d8';
      c.fillRect(cx - 4, sy - 28, 8, 3);
      c.fillRect(cx - 4, sy - 22, 8, 3);
    }
  }
  c.fillStyle = '#f0c419';
  c.beginPath();
  c.moveTo(sx - 2, sy - 12);
  for (let i = 0; i <= 5; i++) {
    c.lineTo(sx + i * q, sy - 34);
    c.lineTo(sx + (i + 0.5) * q, sy - 12);
  }
  c.globalAlpha = 0.0;
  c.fill();
  c.globalAlpha = 1;
  return texOf(cv);
}

function bannerTexture(kind: string): THREE.CanvasTexture {
  const [cv, c] = canvas(256, 960);
  const purple = kind === 'purple';
  const g = c.createLinearGradient(0, 0, 256, 960);
  g.addColorStop(0, purple ? '#6a2d9a' : '#2447b3');
  g.addColorStop(1, purple ? '#3d1665' : '#122a75');
  c.fillStyle = g;
  c.fillRect(0, 0, 256, 960);
  c.fillStyle = 'rgba(255,255,255,0.9)';
  c.beginPath();
  c.arc(128, 180, 78, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = purple ? '#6a2d9a' : '#2447b3';
  c.beginPath();
  c.arc(128, 180, 62, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#fff';
  c.font = 'bold 76px Arial';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('Z', 128, 184);
  c.save();
  c.translate(128, 620);
  c.rotate(-Math.PI / 2);
  c.font = 'bold 118px Arial';
  c.fillText(purple ? 'FESTIVAL' : 'ZAGREB', 0, 0, 640);
  c.restore();
  c.fillStyle = '#ffd23a';
  c.fillRect(30, 900, 196, 6);
  return texOf(cv);
}

function jamnicaTexture(): THREE.CanvasTexture {
  const [cv, c] = canvas(1400, 300);
  const rnd = mulberry(5);
  c.fillStyle = '#b3251e';
  c.fillRect(0, 0, 1400, 300);
  c.fillStyle = '#d6c9a0';
  c.fillRect(10, 10, 430, 280);
  c.fillStyle = '#8a3a22';
  c.font = 'bold 40px Georgia, serif';
  c.textAlign = 'center';
  c.fillText('1828', 225, 70);
  c.fillStyle = '#c3221a';
  c.font = 'italic bold 118px Georgia, serif';
  c.fillText('Jamnica', 225, 178, 400);
  c.fillStyle = '#5a3820';
  c.font = 'bold 34px Arial';
  c.fillText('IZVORNO NAŠA', 225, 250);
  const g = c.createLinearGradient(440, 0, 1390, 300);
  g.addColorStop(0, '#a7885f');
  g.addColorStop(1, '#5c4630');
  c.fillStyle = g;
  c.fillRect(440, 10, 950, 280);
  for (let i = 0; i < 9; i++) {
    const cx = 500 + i * 100 + rnd() * 20;
    const cy = 80 + rnd() * 40;
    face(c, cx, cy, 52, rnd);
  }
  const shade = c.createLinearGradient(0, 170, 0, 300);
  shade.addColorStop(0, 'rgba(20,10,5,0)');
  shade.addColorStop(1, 'rgba(20,10,5,0.75)');
  c.fillStyle = shade;
  c.fillRect(440, 170, 950, 130);
  c.fillStyle = '#ffffff';
  c.font = 'bold 50px Arial';
  c.fillText('Što god da se radi, radi se uz Jamnicu.', 915, 258, 900);
  return texOf(cv);
}

function novineTexture(): THREE.CanvasTexture {
  const [cv, c] = canvas(1000, 300);
  c.fillStyle = '#1b3f92';
  c.fillRect(0, 0, 1000, 300);
  c.fillStyle = '#f4f4ef';
  c.fillRect(24, 24, 952, 252);
  c.fillStyle = '#1b3f92';
  c.font = 'bold 150px Georgia, serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('Novine', 520, 150, 640);
  c.fillStyle = '#1b3f92';
  c.fillRect(70, 70, 150, 160);
  c.fillStyle = '#f4f4ef';
  for (let i = 0; i < 7; i++) c.fillRect(84, 84 + i * 20, 122, 8);
  c.font = 'bold 28px Arial';
  c.fillStyle = '#e2231a';
  c.fillText('TISAK · MEDIJI', 830, 240);
  return texOf(cv);
}

function signTexture(): THREE.CanvasTexture {
  const [cv, c] = canvas(512, 384);
  c.fillStyle = '#2d3f52';
  c.fillRect(0, 0, 512, 384);
  const rows: [string, number][] = [
    ['Umjetnički paviljon', 1],
    ['Muzej Mimara', -1],
    ['Strossmayerova galerija', 1],
    ['Muzej suvremene umjetnosti', 1],
    ['Arheološki muzej', -1],
  ];
  rows.forEach(([t, dir], i) => {
    const y = i * 76.8;
    c.fillStyle = '#1f2f40';
    c.fillRect(0, y, 512, 4);
    c.fillStyle = '#fff';
    c.font = 'bold 30px Arial';
    c.textAlign = dir > 0 ? 'left' : 'right';
    c.textBaseline = 'middle';
    c.fillText(t, dir > 0 ? 24 : 488, y + 38, 380);
    c.beginPath();
    const ax = dir > 0 ? 470 : 42;
    c.moveTo(ax + 22 * dir, y + 38);
    c.lineTo(ax, y + 22);
    c.lineTo(ax, y + 54);
    c.fill();
  });
  return texOf(cv);
}

function boardTexture(): THREE.CanvasTexture {
  const [cv, c] = canvas(512, 384);
  const rnd = mulberry(9);
  c.fillStyle = '#e8e3d3';
  c.fillRect(0, 0, 512, 384);
  c.fillStyle = '#5b3b22';
  c.fillRect(0, 0, 512, 54);
  c.fillStyle = '#f3ead2';
  c.font = 'bold 34px Georgia, serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('ZAGREB · CENTAR', 256, 28);
  for (let i = 0; i < 46; i++) {
    c.fillStyle = ['#c8beab', '#d7cfbd', '#b9c9a5', '#c9d3d8'][Math.floor(rnd() * 4)];
    c.fillRect(20 + rnd() * 400, 70 + rnd() * 250, 30 + rnd() * 70, 16 + rnd() * 40);
  }
  c.strokeStyle = '#fff';
  c.lineWidth = 6;
  c.beginPath();
  c.moveTo(20, 200);
  c.lineTo(500, 160);
  c.moveTo(250, 60);
  c.lineTo(290, 370);
  c.stroke();
  c.fillStyle = '#d8342a';
  c.beginPath();
  c.arc(270, 190, 9, 0, Math.PI * 2);
  c.fill();
  return texOf(cv);
}

// ---------------------------------------------------------------------------------------------
// materials

interface Mats {
  granite: THREE.MeshStandardMaterial;
  iron: THREE.MeshStandardMaterial;
  opal: THREE.MeshStandardMaterial;
  zinc: THREE.MeshStandardMaterial;
  blackIron: THREE.MeshStandardMaterial;
  binGrey: THREE.MeshStandardMaterial;
  binDark: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  alu: THREE.MeshStandardMaterial;
  cream: THREE.MeshStandardMaterial;
  roofGrey: THREE.MeshStandardMaterial;
  soil: THREE.MeshStandardMaterial;
  bollard: THREE.MeshStandardMaterial;
  chain: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  cartWhite: THREE.MeshStandardMaterial;
  cartBlue: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
}

function makeMats(): Mats {
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  const granite = std({ map: texOf(graniteCanvas(), { repeat: true }), roughness: 0.9, metalness: 0 });
  return {
    granite,
    iron: std({ color: 0xf3f1ea, roughness: 0.45, metalness: 0.15 }),
    opal: std({ color: 0xfaf7ee, roughness: 0.35, metalness: 0, emissive: 0xffeecb, emissiveIntensity: 0.22 }),
    zinc: std({ color: 0x484c50, roughness: 0.55, metalness: 0.5 }),
    blackIron: std({ color: 0x1d2420, roughness: 0.55, metalness: 0.5 }),
    binGrey: std({ color: 0x3b4044, roughness: 0.6, metalness: 0.35 }),
    binDark: std({ color: 0x141618, roughness: 0.7, metalness: 0.2 }),
    steel: std({ color: 0x8b9094, roughness: 0.4, metalness: 0.7 }),
    alu: std({ color: 0x9da2a5, roughness: 0.45, metalness: 0.6 }),
    cream: std({ color: 0xeee8d6, roughness: 0.6, metalness: 0.05 }),
    roofGrey: std({ color: 0x6b7074, roughness: 0.6, metalness: 0.35 }),
    soil: std({ color: 0x3a2a1e, roughness: 1 }),
    bollard: std({ color: 0x84888a, roughness: 0.5, metalness: 0.4 }),
    chain: std({ color: 0x101210, roughness: 0.5, metalness: 0.7 }),
    wood: std({ color: 0x5d3f27, roughness: 0.85 }),
    cartWhite: std({ color: 0xf1f3f4, roughness: 0.4, metalness: 0.2 }),
    cartBlue: std({ color: 0x1b5fc2, roughness: 0.4, metalness: 0.2 }),
    rubber: std({ color: 0x1a1a1a, roughness: 0.9 }),
    glass: std({ color: 0x9fc2c9, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.45 }),
  };
}

// ---------------------------------------------------------------------------------------------
// prototypes

interface LampSpec {
  height: number;
  block: number; // side of the granite block
  step1: number;
  step2: number;
  base: number; // scale of the baluster base
  rShaft: [number, number]; // radius at the foot, at the head
  topArms: number;
  topReach: number;
  topGlobe: number;
  topY: number; // height of the arm roots
  lowArms: number;
  lowReach: number;
  lowGlobe: number;
  lowY: number;
  crown: number; // radius of the upright globe (0 = none)
}

const CANDELABRA: LampSpec = {
  height: 14, block: 1.6, step1: 0.32, step2: 0.18, base: 1, rShaft: [0.16, 0.1],
  topArms: 4, topReach: 1.05, topGlobe: 0.25, topY: 12.7, lowArms: 3, lowReach: 0.9, lowGlobe: 0.22, lowY: 9.4, crown: 0.26,
};
const MEDIUM: LampSpec = {
  height: 7, block: 0.9, step1: 0.3, step2: 0.15, base: 0.55, rShaft: [0.09, 0.06],
  topArms: 3, topReach: 0.62, topGlobe: 0.17, topY: 6.05, lowArms: 0, lowReach: 0, lowGlobe: 0, lowY: 0, crown: 0.2,
};
const SMALL: LampSpec = {
  height: 4.5, block: 0.9, step1: 0.3, step2: 0.15, base: 0.4, rShaft: [0.07, 0.05],
  topArms: 0, topReach: 0, topGlobe: 0, topY: 0, lowArms: 0, lowReach: 0, lowGlobe: 0, lowY: 0, crown: 0.28,
};

function fluted(rBot: number, rTop: number, y0: number, y1: number, seg = 36, flutes = 12, depth = 0.06): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, y1 - y0, seg, 1, true);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const f = 1 + depth * Math.cos(flutes * Math.atan2(z, x));
    p.setX(i, x * f);
    p.setZ(i, z * f);
  }
  g.translate(0, (y0 + y1) / 2, 0);
  g.computeVertexNormals();
  return g;
}

function granitePart(g: THREE.BufferGeometry, M: Mats, tile = 0.7): Part {
  return { geo: triUV(g, tile), mat: M.granite };
}

/** One arm of scroll work reaching out at heading phi from the pole, ending in a hanging globe. */
function scrollArm(y0: number, R: number, phi: number, gR: number, M: Mats, out: Part[]) {
  const at = (u: number, v: number) => new THREE.Vector3(Math.sin(phi) * u * R, y0 + v * R, -Math.cos(phi) * u * R);
  const r = Math.max(0.012, R * 0.022);
  out.push({ geo: tube([at(0.03, 0.03), at(0.28, 0.3), at(0.62, 0.4), at(0.9, 0.22), at(1, -0.02), at(1, -0.16)], r, 14, 4), mat: M.iron });
  const curl: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const a = -Math.PI / 2 + t * Math.PI * 2 * 1.25;
    const rr = 0.22 * (1 - 0.85 * t);
    curl.push(at(0.42 + Math.cos(a) * rr, 0.6 + Math.sin(a) * rr));
  }
  out.push({ geo: tube(curl, r * 0.8, 16, 4), mat: M.iron });
  const ex = at(1, -0.16);
  out.push({ geo: cyl(gR * 0.3, gR * 0.4, 0.11, ex.y - 0.11, 8, ex.x, ex.z), mat: M.iron });
  out.push({ geo: sphere(gR, ex.x, ex.y - 0.11 - gR * 1.0, ex.z, 1.1, 12), mat: M.opal });
}

function lampParts(s: LampSpec, M: Mats): Part[] {
  const parts: Part[] = [];
  parts.push(granitePart(box(s.block, s.step1, s.block), M));
  parts.push(granitePart(box(s.block * 0.78, s.step2, s.block * 0.78, s.step1), M));
  const y0 = s.step1 + s.step2;
  const b = s.base;
  const profile: [number, number][] = [
    [0.34, 0], [0.34, 0.1], [0.28, 0.14], [0.27, 0.3], [0.2, 0.36], [0.24, 0.48], [0.29, 0.62], [0.27, 0.8], [0.2, 0.98], [0.17, 1.2], [0.2, 1.3], [0.15, 1.38], [0.15, 1.5],
  ];
  parts.push({ geo: lathe(profile.map(([r, y]) => [r * b * (s.height > 10 ? 1 : 1.1), y * b] as [number, number]), 16, y0), mat: M.iron });
  const yb = y0 + 1.5 * b;
  const yTop = s.topArms ? s.topY : s.height - s.crown * 2 - 0.35;
  parts.push({ geo: fluted(s.rShaft[0], s.rShaft[1], yb, yTop, s.height > 10 ? 36 : 20, 12, s.height > 10 ? 0.06 : 0.05), mat: M.iron });
  // collars
  const rAt = (y: number) => s.rShaft[0] + (s.rShaft[1] - s.rShaft[0]) * ((y - yb) / (yTop - yb));
  const collars = s.height > 10 ? [yb + 0.02, 4.6, 9.15] : [yb + 0.02, yb + (yTop - yb) * 0.55];
  for (const y of collars) parts.push({ geo: cyl(rAt(y) + 0.04, rAt(y) + 0.04, 0.09, y, 14), mat: M.iron });
  // crown cup and the upright globe
  parts.push({ geo: lathe([[rAt(yTop), 0], [rAt(yTop) + 0.05, 0.05], [0.13 * (s.height > 10 ? 1 : 0.7), 0.16], [0.05, 0.25]], 12, yTop), mat: M.iron });
  if (s.crown > 0) {
    const cy = s.topArms ? yTop + 0.25 + s.crown : s.height - s.crown * 1.1 - 0.05;
    if (s.topArms) parts.push({ geo: cyl(0.03, 0.03, s.crown * 0.8, yTop + 0.2, 6), mat: M.iron });
    parts.push({ geo: cyl(s.crown * 0.35, s.crown * 0.4, 0.09, cy - s.crown * 1.1 - 0.05, 8), mat: M.iron });
    parts.push({ geo: sphere(s.crown, 0, cy, 0, 1.1, 14), mat: M.opal });
    parts.push({ geo: cyl(0.03, 0.05, 0.14, cy + s.crown * 1.1, 6), mat: M.iron });
    parts.push({ geo: sphere(0.045, 0, cy + s.crown * 1.1 + 0.17, 0, 1, 6), mat: M.iron });
  }
  for (let i = 0; i < s.topArms; i++) scrollArm(s.topY, s.topReach, (i / s.topArms) * Math.PI * 2 + Math.PI / s.topArms, s.topGlobe, M, parts);
  for (let i = 0; i < s.lowArms; i++) scrollArm(s.lowY, s.lowReach, (i / s.lowArms) * Math.PI * 2, s.lowGlobe, M, parts);
  return merged(parts);
}

function flagpoleParts(M: Mats): Part[] {
  const parts: Part[] = [];
  parts.push(granitePart(box(2.2, 0.45, 2.2), M, 0.8));
  parts.push(granitePart(box(1.5, 0.45, 1.5, 0.45), M, 0.8));
  parts.push({
    geo: lathe([[0.36, 0], [0.36, 0.06], [0.28, 0.14], [0.24, 0.35], [0.3, 0.5], [0.22, 0.7], [0.16, 0.85], [0.14, 1.0]], 16, 0.9),
    mat: M.iron,
  });
  parts.push({ geo: cyl(0.075, 0.14, 17.6, 1.9, 16), mat: M.iron });
  parts.push({ geo: cyl(0.2, 0.2, 0.11, 3, 16), mat: M.iron });
  parts.push({ geo: cyl(0.17, 0.17, 0.05, 3.11, 16), mat: M.iron });
  parts.push({ geo: cyl(0.08, 0.08, 0.05, 17.9, 12), mat: M.iron });
  parts.push({ geo: sphere(0.13, 0, 19.62, 0, 1, 12), mat: M.iron });
  parts.push({ geo: cyl(0.05, 0.075, 0.16, 19.5, 8), mat: M.iron });
  return merged(parts);
}

function adColumnParts(M: Mats): Part[] {
  const parts: Part[] = [];
  parts.push(granitePart(lathe([[0.86, 0], [0.86, 0.36], [0.8, 0.44], [0.72, 0.5]], 32), M, 0.7));
  parts.push({ geo: cyl(0.66, 0.66, 0.3, 0.5, 32), mat: M.iron });
  // the light band under the cap and the dark cap with its rain lip
  parts.push({ geo: cyl(0.7, 0.7, 0.24, 2.75, 32), mat: M.cream });
  parts.push({ geo: lathe([[0.79, 0], [0.79, 0.07], [0.7, 0.13], [0.62, 0.2], [0.4, 0.38], [0.14, 0.5], [0.05, 0.55]], 32, 2.99), mat: M.zinc });
  parts.push({ geo: cyl(0.02, 0.05, 0.1, 3.5, 6), mat: M.zinc });
  parts.push({ geo: sphere(0.05, 0, 3.62, 0, 1, 6), mat: M.zinc });
  return merged(parts);
}

function binParts(M: Mats): Part[] {
  const parts: Part[] = [];
  parts.push({ geo: cyl(0.2, 0.225, 0.74, 0.06, 16), mat: M.binGrey });
  parts.push({ geo: cyl(0.235, 0.235, 0.05, 0.02, 16), mat: M.binDark });
  parts.push({ geo: cyl(0.235, 0.215, 0.2, 0.8, 16), mat: M.binDark });
  parts.push({ geo: box(0.27, 0.085, 0.03, 0.83, 0, -0.225), mat: M.binGrey });
  parts.push({ geo: box(0.3, 0.02, 0.2, 1.0, 0, 0), mat: M.steel });
  return merged(parts);
}

function chainPostParts(M: Mats): Part[] {
  return merged([
    { geo: lathe([[0.075, 0], [0.075, 0.05], [0.05, 0.09], [0.045, 0.52], [0.075, 0.58], [0.075, 0.64], [0.05, 0.69], [0.0, 0.71]], 10), mat: M.blackIron },
  ]);
}

function bollardParts(M: Mats): Part[] {
  return merged([
    { geo: lathe([[0.125, 0], [0.125, 0.78], [0.1, 0.86], [0.05, 0.9], [0, 0.91]], 14), mat: M.bollard },
    { geo: cyl(0.128, 0.128, 0.05, 0.62, 14), mat: M.binDark },
  ]);
}

function bushParts(): { geo: THREE.BufferGeometry; mat: THREE.Material }[] {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  return [{ geo: prep(put(new THREE.IcosahedronGeometry(1, 1), [0, 0, 0], [0, 0, 0], [0.34, 0.24, 0.34])), mat }];
}

// ---------------------------------------------------------------------------------------------
// instancing and merging

class Inst {
  private protos = new Map<string, { parts: Part[]; mats: THREE.Matrix4[]; cols: (THREE.Color | null)[] }>();
  def(name: string, parts: Part[]) {
    this.protos.set(name, { parts, mats: [], cols: [] });
  }
  place(name: string, m: THREE.Matrix4, color: THREE.Color | null = null) {
    const p = this.protos.get(name)!;
    p.mats.push(m.clone());
    p.cols.push(color);
  }
  build(root: THREE.Group) {
    // Instanced meshes get their own copy of a material the merged statics also use: three picks the
    // program by instanced-or-not, and one material drawn both ways rebuilt it on every switch.
    const own = new Map<THREE.Material, THREE.Material>();
    const instMat = (m: THREE.Material) => {
      let c = own.get(m);
      if (!c) {
        c = m.clone();
        c.onBeforeCompile = m.onBeforeCompile;
        c.customProgramCacheKey = m.customProgramCacheKey;
        own.set(m, c);
      }
      return c;
    };
    for (const [name, p] of this.protos) {
      if (!p.mats.length) continue;
      p.parts.forEach((part, k) => {
        const im = new THREE.InstancedMesh(part.geo, instMat(part.mat), p.mats.length);
        p.mats.forEach((m, i) => im.setMatrixAt(i, m));
        if (p.cols.some((c) => c)) p.cols.forEach((c, i) => im.setColorAt(i, c ?? new THREE.Color(1, 1, 1)));
        im.castShadow = true;
        im.receiveShadow = true;
        im.name = `${name}_${k}`;
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        root.add(im);
      });
    }
  }
}

class Statics {
  private map = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(parts: Part[], m: THREE.Matrix4) {
    for (const p of parts) {
      const g = prep(p.geo.clone());
      g.applyMatrix4(m);
      const list = this.map.get(p.mat) ?? [];
      list.push(g);
      this.map.set(p.mat, list);
    }
  }
  build(root: THREE.Group, noShadow: Set<THREE.Material>) {
    for (const [mat, list] of this.map) {
      const mesh = new THREE.Mesh(mergeGeometries(list, false), mat);
      mesh.castShadow = !noShadow.has(mat);
      mesh.receiveShadow = true;
      mesh.name = 'static';
      root.add(mesh);
    }
  }
}

// ---------------------------------------------------------------------------------------------

export class SquareProps {
  readonly root = new THREE.Group();

  readonly items: PropItem[];
  readonly R: typeof RAPIER_NS;
  readonly world: RAPIER_NS.World;

  private timeU = { value: 0 };
  private clockDraw: ((d: Date) => void) | null = null;
  private clockMinute = -1;
  /** Solid pieces made / triangles added, for the console. */
  private colliders = 0;

  constructor(items: PropItem[], R: typeof RAPIER_NS, world: RAPIER_NS.World) {
    this.items = items;
    this.R = R;
    this.world = world;
    this.root.name = 'squareprops';
    try {
      this.build();
    } catch (e) {
      console.error('[zg] squareprops failed', e);
    }
  }

  /** Every frame: [time] in seconds (flags wave, the clock shows the time). */
  update(time: number) {
    this.timeU.value = time;
    const minute = Math.floor(Date.now() / 60000);
    if (this.clockDraw && minute !== this.clockMinute) {
      this.clockMinute = minute;
      this.clockDraw(new Date());
    }
  }

  // ---- colliders (item frame: local offsets rotate with the heading) -----------------------

  private solid(desc: RAPIER_NS.ColliderDesc, it: PropItem, lx: number, ly: number, lz: number, extraRot = 0) {
    const h = -(it.heading ?? 0);
    const c = Math.cos(h);
    const s = Math.sin(h);
    const ang = h + extraRot;
    desc.setTranslation(it.x + lx * c + lz * s, it.y + ly, it.z - lx * s + lz * c).setRotation({ x: 0, y: Math.sin(ang / 2), z: 0, w: Math.cos(ang / 2) });
    this.world.createCollider(desc);
    this.colliders++;
  }
  private cuboid(it: PropItem, hx: number, hy: number, hz: number, lx = 0, ly = hy, lz = 0) {
    this.solid(this.R.ColliderDesc.cuboid(hx, hy, hz), it, lx, ly, lz);
  }
  private cylinder(it: PropItem, hh: number, r: number, lx = 0, ly = hh, lz = 0) {
    this.solid(this.R.ColliderDesc.cylinder(hh, r), it, lx, ly, lz);
  }

  // ---- build -------------------------------------------------------------------------------

  private build() {
    const M = makeMats();
    const inst = new Inst();
    const stat = new Statics();
    const noShadow = new Set<THREE.Material>();
    const matrixOf = (it: PropItem, extraRot = 0) =>
      new THREE.Matrix4().compose(
        new THREE.Vector3(it.x, it.y, it.z),
        new THREE.Quaternion().setFromAxisAngle(Y, -(it.heading ?? 0) + extraRot),
        new THREE.Vector3(1, 1, 1),
      );
    const num = (it: PropItem, k: string, d: number) => (typeof it[k] === 'number' ? (it[k] as number) : d);

    inst.def('candelabra', lampParts(CANDELABRA, M));
    inst.def('lamp_medium', lampParts(MEDIUM, M));
    inst.def('lamp_small', lampParts(SMALL, M));
    inst.def('flagpole', flagpoleParts(M));
    inst.def('adcolumn', adColumnParts(M));
    inst.def('bin', binParts(M));
    inst.def('chainpost', chainPostParts(M));
    inst.def('bollard', bollardParts(M));
    inst.def('bush', bushParts());
    const dots = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    inst.def('geranium', [{ geo: prep(new THREE.IcosahedronGeometry(0.06, 0)), mat: dots }]);

    const counts: Record<string, number> = {};
    const unknown = new Set<string>();
    const rnd = mulberry(77);
    const clockFace = clockFaceTexture();
    this.clockDraw = clockFace.draw;

    // flags and banners: own meshes so the vertex shader can wave them
    const flagMeshes: THREE.Mesh[] = [];
    const wavy = (tex: THREE.Texture, amp: number, yAmp: number, phase: number) => {
      const mat = new THREE.MeshStandardMaterial({ map: tex, color: 0x9a9a9a, roughness: 0.75, side: THREE.DoubleSide });
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = this.timeU;
        sh.uniforms.uPhase = { value: phase };
        sh.uniforms.uAmp = { value: amp };
        sh.uniforms.uYAmp = { value: yAmp };
        sh.vertexShader =
          'attribute float aWave;\nuniform float uTime;\nuniform float uPhase;\nuniform float uAmp;\nuniform float uYAmp;\n' +
          sh.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            float ph = aWave * 7.0 - uTime * 4.2 + uPhase;
            transformed.x += (sin(ph) * 0.2 + sin(ph * 2.3 + 1.3) * 0.06) * aWave * uAmp;
            transformed.y += sin(aWave * 5.0 - uTime * 3.1 + uPhase) * 0.05 * aWave * uYAmp;`,
          );
      };
      return mat;
    };

    for (const it of this.items) {
      counts[it.type] = (counts[it.type] ?? 0) + 1;
      const M4 = matrixOf(it);
      switch (it.type) {
        case 'candelabra':
        case 'lamp_medium':
        case 'lamp_small': {
          const spec = it.type === 'candelabra' ? CANDELABRA : it.type === 'lamp_medium' ? MEDIUM : SMALL;
          inst.place(it.type, matrixOf(it, ((num(it, 'variant', 0) % 4) * Math.PI) / 2));
          this.cuboid(it, spec.block / 2, (spec.step1 + spec.step2) / 2 + 0.05, spec.block / 2);
          this.cylinder(it, (spec.height - spec.step1) / 2, 0.16, 0, spec.step1 + (spec.height - spec.step1) / 2);
          break;
        }
        case 'flagpole': {
          inst.place('flagpole', M4);
          this.cuboid(it, 1.1, 0.225, 1.1, 0, 0.225);
          this.cuboid(it, 0.75, 0.225, 0.75, 0, 0.675);
          this.cylinder(it, 9.5, 0.14, 0, 9.5 + 0.9);
          const kind = String(it.flag ?? 'hr');
          const phase = rnd() * 6;
          if (kind === 'hr') {
            const w = 3.6;
            const h = 1.8;
            const g = new THREE.PlaneGeometry(w, h, 18, 8);
            g.translate(w / 2, 0, 0);
            const wv = new Float32Array(g.attributes.position.count);
            for (let i = 0; i < wv.length; i++) wv[i] = g.attributes.position.getX(i) / w;
            g.setAttribute('aWave', new THREE.BufferAttribute(wv, 1));
            g.rotateY(Math.PI / 2);
            const mesh = new THREE.Mesh(g, wavy(croatianFlag(), 1.0, 1.0, phase));
            mesh.position.set(0, 17.3, -0.13);
            const holder = new THREE.Group();
            holder.add(mesh);
            holder.position.set(it.x, it.y, it.z);
            holder.rotation.y = -(it.heading ?? 0);
            this.root.add(holder);
            flagMeshes.push(mesh);
          } else {
            const bw = 1.2;
            const bh = 3.8;
            // crossbar along the heading, banner hanging under it
            stat.add([{ geo: strut([0, 17.75, 0], [0, 17.75, -bw - 0.35], 0.03, 6), mat: M.iron }], M4);
            const g = new THREE.PlaneGeometry(bw, bh, 5, 14);
            g.translate(0, -bh / 2, 0);
            const wv = new Float32Array(g.attributes.position.count);
            for (let i = 0; i < wv.length; i++) wv[i] = -g.attributes.position.getY(i) / bh;
            g.setAttribute('aWave', new THREE.BufferAttribute(wv, 1));
            g.rotateY(Math.PI / 2);
            const mesh = new THREE.Mesh(g, wavy(bannerTexture(kind), 0.7, 0, phase));
            mesh.position.set(0, 17.68, -bw / 2 - 0.2);
            const holder = new THREE.Group();
            holder.add(mesh);
            holder.position.set(it.x, it.y, it.z);
            holder.rotation.y = -(it.heading ?? 0);
            this.root.add(holder);
            flagMeshes.push(mesh);
          }
          break;
        }
        case 'adcolumn': {
          inst.place('adcolumn', M4);
          const style = String(it.style ?? 'blue');
          const tex = columnTexture(style, Math.round(it.x * 7 + it.z * 13));
          const drum = new THREE.Mesh(
            put(new THREE.CylinderGeometry(0.65, 0.65, 1.95, 40, 1, true), [0, 0.8 + 0.975, 0]),
            new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0 }),
          );
          drum.position.set(it.x, it.y, it.z);
          drum.rotation.y = -(it.heading ?? 0);
          drum.castShadow = true;
          drum.receiveShadow = true;
          this.root.add(drum);
          this.cylinder(it, 1.8, 0.7);
          this.cylinder(it, 0.25, 0.86, 0, 0.25);
          break;
        }
        case 'bin':
          inst.place('bin', M4);
          this.cylinder(it, 0.5, 0.23);
          break;
        case 'bollard': {
          const count = num(it, 'count', 0);
          if (count > 0) {
            const rx = num(it, 'rx', 1);
            const rz = num(it, 'rz', 1);
            for (let i = 0; i < count; i++) {
              const a = (i / count) * Math.PI * 2;
              const sub = { ...it, x: it.x + Math.cos(a) * rx, z: it.z + Math.sin(a) * rz };
              inst.place('bollard', matrixOf(sub));
              this.cylinder(sub, 0.45, 0.13);
            }
          } else {
            inst.place('bollard', M4);
            this.cylinder(it, 0.45, 0.13);
          }
          break;
        }
        case 'chainring': {
          const count = num(it, 'count', 20);
          const rx = num(it, 'rx', 7.2);
          const rz = num(it, 'rz', 4.2);
          const h = it.heading ?? 0;
          const ph = num(it, 'phase', 0);
          const pts: [number, number][] = [];
          for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2 + ph;
            const lx = Math.cos(a) * rx;
            const lz = Math.sin(a) * rz;
            const px = it.x + lx * Math.cos(h) + lz * Math.sin(h);
            const pz = it.z - lx * Math.sin(h) + lz * Math.cos(h);
            pts.push([px, pz]);
            const sub = { ...it, x: px, z: pz, heading: 0 };
            inst.place('chainpost', matrixOf(sub));
            this.cylinder(sub, 0.35, 0.075);
          }
          const chains: THREE.BufferGeometry[] = [];
          for (let i = 0; i < count; i++) {
            const [ax, az] = pts[i];
            const [bx, bz] = pts[(i + 1) % count];
            const seg: THREE.Vector3[] = [];
            for (let k = 0; k <= 6; k++) {
              const t = k / 6;
              seg.push(new THREE.Vector3(ax + (bx - ax) * t, it.y + 0.6 - 0.15 * 4 * t * (1 - t), az + (bz - az) * t));
            }
            chains.push(prep(tube(seg, 0.011, 8, 4)));
          }
          if (chains.length) stat.add([{ geo: mergeGeometries(chains, false), mat: M.chain }], new THREE.Matrix4());
          break;
        }
        case 'clock': {
          const parts: Part[] = [];
          parts.push(granitePart(cyl(1.27, 1.56, 0.6, 0, 4).rotateY(Math.PI / 4), M, 0.8));
          for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) parts.push({ geo: strut([sx * 0.9, 0.55, sz * 0.9], [sx * 0.42, 4.2, sz * 0.42], 0.07, 8), mat: M.cream });
          parts.push({ geo: cyl(0.85, 0.55, 0.3, 3.95, 8).rotateY(Math.PI / 8), mat: M.cream });
          parts.push({ geo: cyl(0.85, 0.85, 0.9, 4.2, 8).rotateY(Math.PI / 8), mat: M.cream });
          parts.push({ geo: cyl(0.02, 0.98, 0.5, 5.1, 8).rotateY(Math.PI / 8), mat: M.roofGrey });
          parts.push({ geo: sphere(0.05, 0, 5.63, 0, 1, 6), mat: M.roofGrey });
          const dial = new THREE.MeshStandardMaterial({ map: clockFace.tex, roughness: 0.5 });
          for (let k = 0; k < 4; k++) {
            const g = new THREE.CircleGeometry(0.66, 36);
            g.rotateY((k * Math.PI) / 2);
            const a = (k * Math.PI) / 2;
            g.translate(Math.sin(a) * 0.795, 4.65, Math.cos(a) * 0.795);
            parts.push({ geo: g, mat: dial });
          }
          stat.add(parts, M4);
          this.cuboid(it, 1.05, 0.3, 1.05);
          for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) this.cylinder(it, 0.6, 0.1, sx * 0.85, 1.1, sz * 0.85);
          break;
        }
        case 'ledpost': {
          const parts: Part[] = [];
          parts.push({ geo: cyl(0.045, 0.05, 2.75, 0, 10), mat: M.iron });
          parts.push({ geo: cyl(0.12, 0.12, 0.04, 0, 12), mat: M.steel });
          const lines = Array.isArray(it.lines) ? (it.lines as string[]) : ['6  ČRNOMEREC  2 min', '13 ŽITNJAK   5 min', '17 PREČKO    9 min'];
          const led = new THREE.MeshStandardMaterial({ map: ledTexture(lines), emissiveMap: ledTexture(lines), emissive: 0xffffff, emissiveIntensity: 1.1, color: 0x222222, roughness: 0.5 });
          parts.push({ geo: box(1.18, 0.46, 0.13, 2.3), mat: M.alu });
          for (const s of [1, -1]) {
            const g = new THREE.PlaneGeometry(1.06, 0.34);
            if (s < 0) g.rotateY(Math.PI);
            g.translate(0, 2.53, s * 0.067);
            parts.push({ geo: g, mat: led });
          }
          const plate = new THREE.MeshStandardMaterial({ map: timetableTexture(), roughness: 0.6 });
          parts.push({ geo: box(0.44, 0.86, 0.03, 1.15, 0.28, 0), mat: M.alu });
          for (const s of [1, -1]) {
            const g = new THREE.PlaneGeometry(0.4, 0.8);
            if (s < 0) g.rotateY(Math.PI);
            g.translate(0.28, 1.58, s * 0.017);
            parts.push({ geo: g, mat: plate });
          }
          stat.add(parts, M4);
          this.cylinder(it, 1.3, 0.06);
          break;
        }
        case 'posterpanel': {
          const parts: Part[] = [];
          const W = 1.2;
          const Hh = 1.95;
          parts.push({ geo: box(W, Hh, 0.06, 0.05, 0, 0), mat: M.alu });
          parts.push({ geo: box(0.06, Hh, 0.15, 0.05, W / 2 - 0.03, 0), mat: M.alu });
          parts.push({ geo: box(0.06, Hh, 0.15, 0.05, -W / 2 + 0.03, 0), mat: M.alu });
          parts.push({ geo: box(W, 0.07, 0.15, 0.05 + Hh - 0.07, 0, 0), mat: M.alu });
          parts.push({ geo: box(W, 0.06, 0.15, 0.05, 0, 0), mat: M.alu });
          parts.push({ geo: box(0.1, 0.05, 0.12, 0, 0.4, 0), mat: M.blackIron });
          parts.push({ geo: box(0.1, 0.05, 0.12, 0, -0.4, 0), mat: M.blackIron });
          const pTex = panelPoster(num(it, 'poster', 0));
          const glow = new THREE.MeshStandardMaterial({ map: pTex, emissiveMap: pTex, emissive: 0xffffff, emissiveIntensity: 0.85, color: 0x333333, roughness: 0.4 });
          const grille = new THREE.MeshStandardMaterial({ map: grilleTexture(), roughness: 0.5, metalness: 0.4 });
          for (const s of [1, -1]) {
            const g = new THREE.PlaneGeometry(W - 0.12, 1.42);
            if (s < 0) g.rotateY(Math.PI);
            g.translate(0, 0.05 + 0.38 + 0.71 + 0.05, s * 0.032);
            parts.push({ geo: g, mat: glow });
            const gr = new THREE.PlaneGeometry(W - 0.12, 0.34);
            if (s < 0) gr.rotateY(Math.PI);
            gr.translate(0, 0.05 + 0.06 + 0.17, s * 0.078);
            parts.push({ geo: gr, mat: grille });
          }
          stat.add(parts, M4);
          this.cuboid(it, W / 2, 1.0, 0.08, 0, 1.0);
          break;
        }
        case 'kiosk_banner': {
          const w = num(it, 'w', 3.5);
          const hgt = num(it, 'h', 0.75);
          const tex = String(it.kind ?? 'jamnica') === 'novine' ? novineTexture() : jamnicaTexture();
          const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(w, hgt),
            new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12 }),
          );
          mesh.position.set(it.x, it.y + num(it, 'y0', 2.0) + hgt / 2, it.z);
          mesh.rotation.y = Math.PI - (it.heading ?? 0);
          this.root.add(mesh);
          break;
        }
        case 'planter': {
          const size = (it.size as number[] | undefined) ?? [8, 1, 0.55];
          const [len, wid, hh] = size;
          const parts: Part[] = [];
          parts.push(granitePart(box(wid, hh, len, 0), M, 0.8));
          parts.push({ geo: box(wid - 0.24, 0.02, len - 0.24, hh - 0.02), mat: M.soil });
          stat.add(parts, M4);
          this.cuboid(it, wid / 2, hh / 2, len / 2);
          const nb = Math.max(2, Math.round(len / 0.42));
          const greens = ['#2c5523', '#37662a', '#264a1f', '#3f6f2c'];
          for (let i = 0; i < nb; i++) {
            const lz = -len / 2 + ((i + 0.5) / nb) * len + (rnd() - 0.5) * 0.15;
            const lx = (rnd() - 0.5) * (wid - 0.5);
            const s = 0.7 + rnd() * 0.5;
            const m = new THREE.Matrix4()
              .copy(M4)
              .multiply(new THREE.Matrix4().compose(new THREE.Vector3(lx, hh + 0.05, lz), new THREE.Quaternion().setFromAxisAngle(Y, rnd() * 6), new THREE.Vector3(s * 1.25, s * 0.95, s * 1.25)));
            inst.place('bush', m, new THREE.Color(greens[Math.floor(rnd() * greens.length)]));
          }
          const nd = Math.round(len * 12);
          const pinks = ['#c42a4c', '#d84a6c', '#b5182e', '#e07890', '#e59aae'];
          for (let i = 0; i < nd; i++) {
            const lz = (rnd() - 0.5) * len;
            const lx = (rnd() - 0.5) * (wid - 0.35);
            const m = new THREE.Matrix4().copy(M4).multiply(new THREE.Matrix4().makeTranslation(lx, hh + 0.2 + rnd() * 0.16, lz));
            inst.place('geranium', m, new THREE.Color(pinks[Math.floor(rnd() * pinks.length)]));
          }
          break;
        }
        case 'signpost': {
          const parts: Part[] = [];
          for (const s of [-0.55, 0.55]) parts.push({ geo: cyl(0.04, 0.045, 3.3, 0, 8, s, 0), mat: M.steel });
          const tex = signTexture();
          const plate = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
          for (const s of [1, -1]) {
            const g = new THREE.PlaneGeometry(1.2, 0.9);
            if (s < 0) g.rotateY(Math.PI);
            g.translate(0, 2.65, s * 0.03);
            parts.push({ geo: g, mat: plate });
          }
          parts.push({ geo: box(1.22, 0.9, 0.05, 2.2), mat: M.blackIron });
          stat.add(parts, M4);
          this.cuboid(it, 0.65, 1.5, 0.1, 0, 1.5);
          break;
        }
        case 'infoboard': {
          const parts: Part[] = [];
          for (const s of [-0.75, 0.75]) parts.push({ geo: box(0.12, 2.3, 0.12, 0, s, 0), mat: M.wood });
          parts.push({ geo: box(1.7, 1.2, 0.08, 1.05), mat: M.wood });
          const tex = new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.7 });
          for (const s of [1, -1]) {
            const g = new THREE.PlaneGeometry(1.5, 1.1);
            if (s < 0) g.rotateY(Math.PI);
            g.translate(0, 1.65, s * 0.045);
            parts.push({ geo: g, mat: tex });
          }
          stat.add(parts, M4);
          this.cuboid(it, 0.85, 1.15, 0.08, 0, 1.15);
          break;
        }
        case 'cart': {
          const parts: Part[] = [];
          parts.push({ geo: box(1.5, 0.45, 3.0, 0.22), mat: M.cartWhite });
          parts.push({ geo: box(1.52, 0.16, 3.02, 0.5), mat: M.cartBlue });
          for (const z of [-0.85, 0.15, 1.05]) {
            parts.push({ geo: box(1.2, 0.12, 0.5, 0.72, 0, z), mat: M.cartBlue });
            parts.push({ geo: box(1.2, 0.5, 0.1, 0.8, 0, z + 0.22), mat: M.cartBlue });
          }
          for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) parts.push({ geo: box(0.05, 1.4, 0.05, 0.7, sx * 0.72, sz * 1.42), mat: M.iron });
          parts.push({ geo: box(1.6, 0.07, 3.1, 2.1), mat: M.cartWhite });
          parts.push({ geo: box(1.62, 0.04, 3.12, 2.17), mat: M.cartBlue });
          for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]])
            parts.push({ geo: put(new THREE.CylinderGeometry(0.27, 0.27, 0.2, 14), [sx * 0.72, 0.27, sz * 1.0], [0, 0, Math.PI / 2]), mat: M.rubber });
          stat.add(parts, M4);
          this.cuboid(it, 0.8, 0.8, 1.55, 0, 0.8);
          break;
        }
        default:
          unknown.add(it.type);
      }
    }

    inst.build(this.root);
    stat.build(this.root, noShadow);
    void flagMeshes;
    if (unknown.size) console.warn(`[zg] squareprops: unknown prop types ${[...unknown].join(', ')}`);
    console.log(
      `[zg] square props: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}; ${this.colliders} colliders`,
    );
  }
}
