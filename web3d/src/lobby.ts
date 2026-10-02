// The loading screen's lobby: while the city loads, the player dresses the rider (the coat's colour
// and cloth, the hair's colour) on a bike turning slowly in a little preview of its own. boot.ts
// opens it before the game's code has arrived; the choice is kept for the next visit (outfit.ts)
// and the game's rider wears it from the first frame. Once the city is in, a Start button.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildBikeModel, type BikeModel } from './bikeModel.ts';
import {
  atlasLoaded, coatOf, COATS, FABRICS, hairOf, HAIRS, paintSwatch, randomOutfit, saveOutfit, savedOutfit, type Colour, type Outfit,
} from './outfit.ts';

export interface Lobby {
  /** The city is in: offers the Start button (or starts at once when [auto]); resolves with the
   * outfit when the player sets off. */
  ready(auto: boolean): Promise<Outfit>;
  /** Stops the preview and frees its WebGL context. */
  close(): void;
}

export function openLobby(): Lobby {
  const $ = (id: string) => document.getElementById(id)!;
  let outfit = savedOutfit();
  const preview = startPreview($('preview') as HTMLCanvasElement);

  // Colour dots (coat, hair) and cloth tiles: radio buttons, the chosen one ringed.
  const dots = (box: HTMLElement, list: Colour[], key: 'coat' | 'hair') =>
    list.map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dot';
      b.title = c.name;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', c.name);
      b.style.setProperty('--c', c.hex);
      b.addEventListener('click', () => choose({ ...outfit, [key]: c.id }));
      box.append(b);
      return { id: c.id, el: b };
    });
  const coats = dots($('coats'), COATS, 'coat');
  const hairs = dots($('hairs'), HAIRS, 'hair');
  const fabrics = FABRICS.map((f, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cloth';
    b.title = f.name;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', f.name);
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    b.append(c);
    b.addEventListener('click', () => choose({ ...outfit, fabric: f.id }));
    $('fabrics').append(b);
    return { id: f.id, el: b, canvas: c, cell: i };
  });
  /** The cloth tiles in the coat's colour. */
  const paintCloths = () => fabrics.forEach((f) => paintSwatch(f.canvas, f.cell, coatOf(outfit).hex));
  void atlasLoaded().then(paintCloths);

  function choose(o: Outfit) {
    const recolour = o.coat !== outfit.coat;
    outfit = o;
    saveOutfit(o);
    show();
    if (recolour) paintCloths();
  }
  function show() {
    for (const [list, id] of [[coats, outfit.coat], [hairs, outfit.hair], [fabrics, outfit.fabric]] as const) {
      for (const s of list) s.el.setAttribute('aria-checked', String(s.id === id));
    }
    $('coatName').textContent = coatOf(outfit).name;
    $('fabricName').textContent = FABRICS.find((f) => f.id === outfit.fabric)!.name;
    $('hairName').textContent = hairOf(outfit).name;
    preview?.bike.dress(outfit);
  }
  show();
  paintCloths();
  $('shuffle').addEventListener('click', () => choose(randomOutfit()));

  return {
    ready(auto: boolean) {
      if (auto) return Promise.resolve(outfit);
      const start = $('start') as HTMLButtonElement;
      $('status').hidden = true;
      $('bar').hidden = true;
      start.hidden = false;
      return new Promise((done) => {
        const go = () => {
          removeEventListener('keydown', onKey);
          done(outfit);
        };
        const onKey = (e: KeyboardEvent) => {
          if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
          e.preventDefault();
          go();
        };
        addEventListener('keydown', onKey);
        start.addEventListener('click', go, { once: true });
      });
    },
    close() {
      preview?.stop();
      // Keys pressed to ride must not click a swatch that still has the focus. Only a lobby button:
      // blurring the body takes the focus from the window, and the game pauses (main.ts checkAway).
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.closest('#loading')) focused.blur();
    },
  };
}

/** The rider on the bike, pedalling on a turntable; drag to turn it. Null without WebGL. */
function startPreview(canvas: HTMLCanvasElement) {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    canvas.hidden = true;
    return null;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.45;
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.8);
  sun.position.set(-2, 4, 3);
  const rim = new THREE.DirectionalLight(0xcfe0ff, 1.4);
  rim.position.set(3, 2.5, -4);
  scene.add(sun, rim, new THREE.HemisphereLight(0xdfe8ff, 0x2c3e70, 0.7));

  const turntable = new THREE.Group();
  scene.add(turntable);
  const bike: BikeModel = buildBikeModel();
  bike.blob.visible = false; // multiplies onto the street, not onto a see-through canvas
  bike.root.position.z = 0.05; // turns about the middle of the bike, not its axle line
  turntable.add(bike.root);
  turntable.add(shadowDisc());

  const camera = new THREE.PerspectiveCamera(24, 4 / 3, 0.1, 50);
  camera.position.set(4.55, 2.0, 3.6);
  camera.lookAt(0, 0.86, 0);

  // Starts on the bike's left front quarter, the livery side.
  let yaw = -0.2, spin = 0.25, dragging = false, lastX = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yaw += (e.clientX - lastX) * 0.012;
    lastX = e.clientX;
  });
  const release = () => (dragging = false);
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  const fit = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const watch = new ResizeObserver(fit);
  watch.observe(canvas);
  fit();

  let raf = 0, last = performance.now();
  canvas.style.opacity = '0';
  const frame = (now: number) => {
    // Main-thread hitches while the city loads: the turn just skips ahead.
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!dragging) yaw += spin * dt;
    turntable.rotation.y = yaw;
    bike.showcase(dt);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  // The first frame once the cloth and the bike's own textures are in, then a fade-in.
  void Promise.all([bike.loaded, atlasLoaded()]).then(() => {
    last = performance.now();
    raf = requestAnimationFrame(frame);
    canvas.style.transition = 'opacity 0.4s';
    canvas.style.opacity = '1';
  });

  return {
    bike,
    stop() {
      cancelAnimationFrame(raf);
      spin = 0;
      watch.disconnect();
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

/** A soft round shadow on the floor under the bike. */
function shadowDisc() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(10, 20, 50, 0.55)');
  grad.addColorStop(1, 'rgba(10, 20, 50, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const disc = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 3.1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, toneMapped: false }),
  );
  disc.position.set(0, 0.002, 0);
  return disc;
}
