// The rider's wardrobe: what the lobby offers (lobby.ts) and the rider wears (rider.ts). The cloths
// and the hair are one small greyscale atlas, models/outfits.jpg (tool/make_outfits.py), cut into
// a texture per cell and tinted with the chosen colour in the material.

import * as THREE from 'three';

export interface Colour {
  id: string;
  name: string;
  /** What it looks like on average: the material colour is this over ATLAS_MEAN. */
  hex: string;
}

export const COATS: Colour[] = [
  { id: 'camel', name: 'Camel', hex: '#aa7b50' },
  { id: 'charcoal', name: 'Charcoal', hex: '#3d3f45' },
  { id: 'navy', name: 'Navy', hex: '#1f2b47' },
  { id: 'green', name: 'Bottle green', hex: '#2c4a38' },
  { id: 'burgundy', name: 'Burgundy', hex: '#6a2331' },
  { id: 'rust', name: 'Rust', hex: '#9b4a28' },
  { id: 'oatmeal', name: 'Oatmeal', hex: '#cdbf9f' },
  { id: 'bajs', name: 'Bajs blue', hex: '#2f6fe0' },
];

/** In atlas order. */
export const FABRICS = [
  { id: 'melton', name: 'Melton wool' },
  { id: 'tweed', name: 'Tweed' },
  { id: 'herringbone', name: 'Herringbone' },
  { id: 'houndstooth', name: 'Houndstooth' },
  { id: 'glencheck', name: 'Glen check' },
  { id: 'corduroy', name: 'Corduroy' },
];
/** The hair's cell, after the cloths. */
export const HAIR_CELL = FABRICS.length;

export const HAIRS: Colour[] = [
  { id: 'black', name: 'Black', hex: '#1b1512' },
  { id: 'brown', name: 'Brown', hex: '#3a2619' },
  { id: 'chestnut', name: 'Chestnut', hex: '#6b3d22' },
  { id: 'ginger', name: 'Ginger', hex: '#a4532a' },
  { id: 'blond', name: 'Blond', hex: '#c7a36c' },
  { id: 'grey', name: 'Grey', hex: '#a5a29c' },
];

export interface Outfit {
  coat: string;
  fabric: string;
  hair: string;
}

/** The camel melton coat and brown hair the rider always wore. */
export const DEFAULT_OUTFIT: Outfit = { coat: 'camel', fabric: 'melton', hair: 'brown' };

const KEY = 'bajs-cargo.outfit';

/** The outfit chosen on an earlier visit, else the default. Storage can be missing or throw. */
export function savedOutfit(): Outfit {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Outfit> | null;
    if (o) return resolve(o);
  } catch {
    // Private window or blocked storage: the default.
  }
  return { ...DEFAULT_OUTFIT };
}

export function saveOutfit(o: Outfit) {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    // Not kept, still worn this time.
  }
}

/** Known ids only: anything else falls back to the default's. */
function resolve(o: Partial<Outfit>): Outfit {
  const known = <T extends { id: string }>(list: T[], id: string | undefined, def: string) => (list.some((c) => c.id === id) ? id! : def);
  return {
    coat: known(COATS, o.coat, DEFAULT_OUTFIT.coat),
    fabric: known(FABRICS, o.fabric, DEFAULT_OUTFIT.fabric),
    hair: known(HAIRS, o.hair, DEFAULT_OUTFIT.hair),
  };
}

export const coatOf = (o: Outfit) => COATS.find((c) => c.id === o.coat)!;
export const hairOf = (o: Outfit) => HAIRS.find((c) => c.id === o.hair)!;
export const fabricIndex = (o: Outfit) => FABRICS.findIndex((f) => f.id === o.fabric);

export function randomOutfit(): Outfit {
  const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];
  return { coat: pick(COATS).id, fabric: pick(FABRICS).id, hair: pick(HAIRS).id };
}

/** The cells' mean linear value (make_outfits.py MEAN): a colour over it comes out as itself on average. */
export const ATLAS_MEAN = 0.5;
const CELL = 128;

/** The material colour that makes a cell look like [hex]. */
export const tint = (hex: string, into = new THREE.Color()) => into.set(hex).multiplyScalar(1 / ATLAS_MEAN);

let cells: HTMLCanvasElement[] | null = null;
let atlas: Promise<void> | null = null;
let drawn = false;
/** Textures made before the atlas came: re-uploaded when it does. */
const waiting: THREE.Texture[] = [];

/** One canvas per atlas cell, plain grey (the atlas mean) until the atlas is in. */
function cellCanvases() {
  if (cells) return cells;
  cells = Array.from({ length: HAIR_CELL + 1 }, () => {
    const c = document.createElement('canvas');
    c.width = c.height = CELL;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.fillStyle = '#bcbcbc'; // sRGB of 0.5
    g.fillRect(0, 0, CELL, CELL);
    return c;
  });
  atlas = new Promise((done) => {
    const img = new Image();
    img.onload = () => {
      cells!.forEach((c, i) => c.getContext('2d')!.drawImage(img, i * CELL, 0, CELL, CELL, 0, 0, CELL, CELL));
      drawn = true;
      for (const t of waiting) t.needsUpdate = true;
      waiting.length = 0;
      done();
    };
    // A missing atlas leaves the cloth plain.
    img.onerror = () => done();
    img.src = 'models/outfits.jpg';
  });
  return cells;
}

/** Resolves once the atlas is drawn into the cells. */
export function atlasLoaded() {
  cellCanvases();
  return atlas!;
}

/** A repeating texture of cell [i]; it updates itself when the atlas arrives. */
export function cellTexture(i: number) {
  const t = new THREE.CanvasTexture(cellCanvases()[i]);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (!drawn) waiting.push(t);
  return t;
}

/** Paints cell [i] tinted [hex] into [canvas] (a swatch), as the material would: in linear light. */
export function paintSwatch(canvas: HTMLCanvasElement, i: number, hex: string) {
  const src = cellCanvases()[i];
  const g = canvas.getContext('2d')!;
  g.drawImage(src, 0, 0, canvas.width, canvas.height);
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  const c = tint(hex);
  const k = [c.r, c.g, c.b];
  const d = img.data;
  for (let p = 0; p < d.length; p += 4) {
    const v = LIN[d[p]];
    for (let ch = 0; ch < 3; ch++) d[p + ch] = toSrgb(v * k[ch]);
  }
  g.putImageData(img, 0, 0);
}

const LIN = Array.from({ length: 256 }, (_, i) => (i <= 10 ? i / 255 / 12.92 : ((i / 255 + 0.055) / 1.055) ** 2.4));
const toSrgb = (v: number) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : v >= 1 ? 1 : 1.055 * v ** (1 / 2.4) - 0.055));
