// Zagreb Drive in three.js: the city around Trg bana Jelačića, a Rapier
// raycast-vehicle car, a chase camera and a small HUD.
//
// World frame: x east, y up, z SOUTH (north = -z), metres, origin at the
// Ban Jelačić statue. Headings are compass radians (0 = north, pi/2 = east).

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadCity } from './city.ts';
import { loadCarModel, snapshot, type BodyState } from './carModel.ts';
import { ChaseCamera } from './chaseCamera.ts';
import { Controls } from './input.ts';
import { Vehicle } from './vehicle.ts';
import { places } from './places.ts';
import { farTerrain, sampleGrid } from './terrain.ts';
import { Trams } from './trams.ts';
import { Furniture } from './furniture.ts';

const status = document.getElementById('status')!;
const t0 = performance.now();
const setStatus = (s: string) => {
  status.textContent = s;
  console.log(`[zg] ${(performance.now() - t0).toFixed(0)} ms: ${s}`);
};
const params = new URLSearchParams(location.search);

/** Where the car starts: Ilica's mouth, facing east onto the square. */
const spawn = { x: -70, z: -6, heading: Math.PI / 2 };

/** Late-afternoon sun from the south-west (direction TO the sun). */
const sunDirection = new THREE.Vector3(-0.45, 0.62, 0.64).normalize();

async function main() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.42;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.getElementById('app')!.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 3000);
  // The sky and the far horizon draw first, with their own depth range, so
  // the city keeps its depth precision.
  const farScene = new THREE.Scene();
  const farCamera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 20, 40000);
  renderer.autoClear = false;

  // Sky, and the same sky as image-based light.
  const sky = new Sky();
  sky.scale.setScalar(30000);
  const u = sky.material.uniforms;
  u.turbidity.value = 5;
  u.rayleigh.value = 1.4;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(sunDirection);
  farScene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene();
  const skyCopy = new Sky();
  skyCopy.scale.setScalar(1000);
  skyCopy.material.uniforms.sunPosition.value.copy(sunDirection);
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'] as const) {
    skyCopy.material.uniforms[k].value = u[k].value;
  }
  skyScene.add(skyCopy);
  const env = pmrem.fromScene(skyScene, 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.4;
  const haze = new THREE.Color(0xaebdcd);
  scene.fog = new THREE.FogExp2(haze, 0.0014);

  const sun = new THREE.DirectionalLight(0xfff1dc, 3.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const shadowSpan = 90;
  Object.assign(sun.shadow.camera, { left: -shadowSpan, right: shadowSpan, top: shadowSpan, bottom: -shadowSpan, near: 1, far: 600 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x5a5044, 0.25));
  const farSun = new THREE.DirectionalLight(0xfff1dc, 3.2);
  farSun.position.copy(sunDirection);
  farScene.add(farSun, new THREE.HemisphereLight(0xcfe0ff, 0x6a6050, 1.6));

  setStatus('Starting physics…');
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const dt = 1 / 60;
  world.timestep = dt;

  const city = await loadCity(renderer, RAPIER, world, (s) => setStatus(`Loading ${s}…`));
  await places.load('city/city.json');
  scene.add(city.root);
  if (city.far && city.ground) farScene.add(farTerrain(city.far, city.ground, haze));

  /** Height of the first static surface under (x, z), from 300 m down. */
  const groundAt = (x: number, z: number) => {
    const hit = world.castRay(
      new RAPIER.Ray({ x, y: 300, z }, { x: 0, y: -1, z: 0 }),
      600,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
    );
    return hit ? 300 - hit.timeOfImpact : 0;
  };

  setStatus('Loading car…');
  const carModel = await loadCarModel(env);
  scene.add(carModel.root);
  world.step(); // builds the query structures groundAt needs

  // Trams on the real tracks, inside the city's extent.
  const [ex0, ez0, ex1, ez1] = city.data.extent;
  const trams = new Trams(
    RAPIER,
    world,
    city.data.trams,
    (x, z) => x > ex0 + 6 && x < ex1 - 6 && z > ez0 + 6 && z < ez1 - 6,
    (x, z) => {
      // The rails, not a shelter roof or a tree trunk the ray might meet.
      const grid = city.ground ? sampleGrid(city.ground, x, z) : 0;
      const hit = groundAt(x, z);
      return hit > grid + 0.6 ? grid + 0.15 : hit;
    },
  );
  scene.add(trams.root);
  console.log(`[zg] ${trams.count} trams`);
  // Café chairs, tables and parasols: loose bodies the car scatters.
  const furniture = new Furniture(RAPIER, world, city.tables, (x, y, z) => {
    const hit = world.castRay(
      new RAPIER.Ray({ x, y: y + 1.2, z }, { x: 0, y: -1, z: 0 }),
      2.5,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
    );
    return hit ? y + 1.2 - hit.timeOfImpact : null;
  });
  furniture.settle();
  scene.add(furniture.root);
  console.log(`[zg] ${city.tables.length} café tables, ${furniture.count} furniture bodies`);
  const vehicle = new Vehicle(
    RAPIER,
    world,
    carModel.wheels,
    { x: spawn.x, y: groundAt(spawn.x, spawn.z) + 0.4, z: spawn.z },
    spawn.heading,
  );

  const castCamera = (from: THREE.Vector3, dir: THREE.Vector3, far: number) => {
    // Static and kinematic only: flying chairs do not yank the camera.
    const hit = world.castRay(new RAPIER.Ray(from, dir), far, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
    return hit ? hit.timeOfImpact : null;
  };
  const chase = new ChaseCamera(camera, castCamera);
  const controls = new Controls(document.getElementById('touch'));

  // Frame: the far horizon, then the city over it with fresh depth, then
  // ambient occlusion (GTAO) on the city, then tone mapping. 4x MSAA on
  // the scene target, since the composer bypasses the canvas's own.
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(farScene, farCamera));
  const cityPass = new RenderPass(scene, camera);
  cityPass.clear = false;
  cityPass.clearDepth = true;
  composer.addPass(cityPass);
  const ao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  ao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 2, scale: 1.1, samples: 12 });
  ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  ao.blendIntensity = 0.85;
  ao.enabled = params.get('ao') === '1'; // off by default; O toggles
  composer.addPass(ao);
  composer.addPass(new OutputPass());

  // Compile every program before the first frame, behind the loading screen.
  setStatus('Compiling shaders…');
  await renderer.compileAsync(scene, camera);
  setStatus('Ready');
  document.getElementById('loading')!.classList.add('hidden');
  if (params.has('pause')) return;

  const hudSpeed = document.getElementById('speed')!;
  const hudGear = document.getElementById('gear')!;
  const hudPlace = document.getElementById('place')!;
  const cov = city.data.coverage;
  if (cov) {
    document.getElementById('coverage')!.textContent =
      `Real facades: ${cov.done} of ${cov.walls} street walls`;
  }

  let freeLook: { eye: THREE.Vector3; target: THREE.Vector3 } | null = null;
  const prev: BodyState = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  snapshot(vehicle, prev);
  let acc = 0;
  let last = performance.now();
  let braking = false;
  let placeName = '';
  const carPos = new THREE.Vector3();
  let frames = 0;

  function teleport(x: number, z: number, heading: number) {
    vehicle.reset({ x, y: groundAt(x, z) + 0.5, z }, heading);
    snapshot(vehicle, prev);
    chase.snap();
  }

  function frame(now: number) {
    const elapsed = Math.min(0.1, (now - last) / 1000);
    last = now;
    const input = controls.read(elapsed);
    if (controls.took('KeyR')) {
      // Back on the wheels where the car is, facing where it faced.
      const p = vehicle.body.translation();
      teleport(p.x, p.z, vehicle.heading());
    }
    if (controls.took('Digit0')) teleport(spawn.x, spawn.z, spawn.heading);
    if (controls.took('KeyO')) ao.enabled = !ao.enabled;

    acc += elapsed;
    while (acc >= dt) {
      snapshot(vehicle, prev);
      vehicle.update(dt, input);
      const t = vehicle.body.translation();
      trams.step(dt, carPos.set(t.x, t.y, t.z));
      furniture.step(dt, vehicle.body);
      world.step();
      acc -= dt;
    }
    const alpha = acc / dt;
    carModel.pose(vehicle, prev, alpha);
    trams.place(alpha);
    furniture.place(alpha);
    const isBraking = input.brake > 0.05 && vehicle.speed > 0.5;
    if (isBraking !== braking) {
      braking = isBraking;
      carModel.setBraking(braking);
    }

    carPos.copy(carModel.root.position);
    if (freeLook) {
      camera.position.copy(freeLook.eye);
      camera.lookAt(freeLook.target);
    } else {
      chase.update(elapsed, carPos, vehicle.heading(), vehicle.speed);
    }

    // The shadow camera follows the car, snapped to whole shadow texels so
    // edges do not crawl as it moves.
    const focus = freeLook ? freeLook.target : carPos;
    const texel = (2 * shadowSpan) / sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    sun.target.position.set(fx, focus.y, fz);
    sun.position.set(fx, focus.y, fz).addScaledVector(sunDirection, 300);

    const kmh = Math.abs(vehicle.speed) * 3.6;
    hudSpeed.textContent = kmh.toFixed(0);
    hudGear.textContent = vehicle.reversing ? 'R' : 'D';
    const place = places.nearest(carPos.x, carPos.z);
    if (place !== placeName) {
      placeName = place;
      hudPlace.textContent = place;
    }

    const r0 = performance.now();
    farCamera.position.copy(camera.position);
    farCamera.quaternion.copy(camera.quaternion);
    if (farCamera.fov !== camera.fov || farCamera.aspect !== camera.aspect) {
      farCamera.fov = camera.fov;
      farCamera.aspect = camera.aspect;
      farCamera.updateProjectionMatrix();
    }
    composer.render(elapsed);
    frames++;
    if (frames <= 5 || frames % 300 === 0) {
      console.log(`[zg] frame ${frames}: render ${(performance.now() - r0).toFixed(1)} ms, total ${(performance.now() - now).toFixed(1)} ms`);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  });

  // A small debug surface for screenshots and comparisons with Street View:
  //   zg.look([ex, ey, ez], [tx, ty, tz], fov?)  parks the camera (web frame)
  //   zg.drive()                            back to the chase camera
  //   zg.teleport(x, z, heading)
  (window as unknown as { zg: unknown }).zg = {
    look(eye: number[], target: number[], fov?: number) {
      freeLook = { eye: new THREE.Vector3(...eye), target: new THREE.Vector3(...target) };
      if (fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    },
    drive() {
      freeLook = null;
      chase.snap();
    },
    teleport,
    groundAt,
    /** Frames street wall [id] (as in data/hero/coverage.json) straight on
     * from [distance] metres (default: far enough for its width), eye at
     * [eyeHeight] above the sidewalk. Returns false for an unknown wall. */
    lookAtWall(id: string, distance?: number, eyeHeight = 2.2) {
      const w = city.data.walls?.[id];
      if (!w) return false;
      const [ax, az, bx, bz, nx, nz, ground, eave] = w;
      const len = Math.hypot(bx - ax, bz - az);
      const d = distance ?? Math.max(12, Math.max(len, eave - ground) * 0.95);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      freeLook = {
        eye: new THREE.Vector3(mx + nx * d, ground + eyeHeight, mz + nz * d),
        target: new THREE.Vector3(mx, (ground + eave) / 2 + 1, mz),
      };
      return true;
    },
    renderer,
    scene,
    camera,
    vehicle,
    trams,
    furniture,
  };
  const park = params.get('park');
  if (park && parks[park]) {
    const [eye, target] = parks[park];
    freeLook = { eye: new THREE.Vector3(...eye), target: new THREE.Vector3(...target) };
  }
}

/** Fixed camera parks for comparisons (`?park=<name>`), web frame. */
const parks: Record<string, [[number, number, number], [number, number, number]]> = {
  square: [[-100, 2.2, -2], [30, 7, -18]],
  ilica: [[-300, 2.2, -9], [-110, 5, -9]],
  cathedral: [[105, 2.2, -150], [180, 38, -167]],
  overview: [[-230, 230, 330], [10, 0, -20]],
};

main().catch((e) => {
  console.error(e);
  const reason = e instanceof Error ? e.message : e instanceof Event ? `failed to load ${(e.target as { src?: string } | null)?.src ?? 'a resource'}` : String(e);
  setStatus(`Failed to start: ${reason}`);
});
