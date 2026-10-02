// Bajs Cargo in three.js: the city around Trg bana Jelačića, a Rapier
// raycast-vehicle car, a chase camera and a small HUD. boot.ts loads it as a
// chunk of its own behind the lobby (lobby.ts) and calls `run`.
//
// World frame: x east, y up, z SOUTH (north = -z), metres, origin at the
// Ban Jelačić statue. Headings are compass radians (0 = north, pi/2 = east).

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Sky } from 'three/addons/objects/Sky.js';
import { loadCity } from './city.ts';
import { loadCarModel, snapshot, type BodyState, type CarModel } from './carModel.ts';
import { buildBikeModel } from './bikeModel.ts';
import { ChaseCamera } from './chaseCamera.ts';
import { Controls } from './input.ts';
import { Vehicle, bikeTuning, carTuning, type VehicleTuning } from './vehicle.ts';
import { places } from './places.ts';
import { COMPASS_DELAY, loadDeliveries, TOTAL_JOBS } from './deliveries.ts';
import { farTerrain, sampleGrid } from './terrain.ts';
import { Trams } from './trams.ts';
import { GameAudio } from './audio.ts';
import { scoreImage, shareImage } from './scoreCard.ts';
import { Pigeons } from './birds.ts';
import { Catenary } from './catenary.ts';
import { SquareProps } from './squareprops.ts';
import { ParkProps, PARK_TYPES } from './parkprops.ts';
import { ParkingLot, PARKING_TYPES } from './parking.ts';
import { Crowd, type Striker, type Threat } from './people.ts';
import { Furniture } from './furniture.ts';
import type { Lobby } from './lobby.ts';
import type { Outfit } from './outfit.ts';

const status = document.getElementById('status')!;
const t0 = performance.now();
/** The loading bar, 0..1, never going back. */
let barAt = 0;
const setBar = (f: number) => {
  barAt = Math.max(barAt, Math.min(1, f));
  const el = document.querySelector<HTMLElement>('#bar i');
  if (el) el.style.width = `${Math.round(barAt * 100)}%`;
};
const setStatus = (s: string) => {
  status.textContent = s;
  console.log(`[zg] ${(performance.now() - t0).toFixed(0)} ms: ${s}`);
};
const params = new URLSearchParams(location.search);

/** Where the car starts: Ilica's mouth, facing east onto the square. */
const spawn = { x: -70, z: -6, heading: Math.PI / 2 };

/** Late-afternoon sun from the south-west (direction TO the sun). */
const sunDirection = new THREE.Vector3(-0.45, 0.62, 0.64).normalize();

async function main(lobby: Lobby) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(startRatio());
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
  // world.step() follows every step with a sweep of all bodies and colliders through JS
  // (mapNewSoftBodies: for bodies the wasm side makes itself, soft bodies and snapshots), 1 ms a
  // frame with the furniture's ~1,900 bodies, three times the physics. Bodies and colliders made
  // from JS are mapped when created and unmapped when removed, so the loop steps the pipeline alone.
  const stepWorld = () =>
    world.physicsPipeline.step(world.gravity, world.integrationParameters, world.islands, world.broadPhase, world.narrowPhase,
      world.bodies, world.colliders, world.softBodies, world.impulseJoints, world.multibodyJoints, world.ccdSolver);

  const city = await loadCity(renderer, RAPIER, world, (s) => setStatus(`Loading ${s}…`), (f) => setBar(0.05 + 0.7 * f));
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

  setBar(0.8);
  setStatus('Loading car…');
  const carModel = await loadCarModel(env);
  scene.add(carModel.root);
  const bikeModel = buildBikeModel();
  scene.add(bikeModel.root);
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
  }, city.data.stalls ?? []);
  furniture.settle();
  scene.add(furniture.root);
  const allProps = city.data.props ?? [];
  const squareProps = new SquareProps(allProps.filter((p) => !PARK_TYPES.has(p.type) && !PARKING_TYPES.has(p.type)), RAPIER, world);
  scene.add(squareProps.root);
  const parkProps = new ParkProps(allProps.filter((p) => PARK_TYPES.has(p.type)), RAPIER, world);
  scene.add(parkProps.root);
  const parking = new ParkingLot(allProps.filter((p) => PARKING_TYPES.has(p.type)), RAPIER, world);
  scene.add(parking.root);
  // Pedestrians on the square and the streets (people.ts): they probe the static world for ground and props.
  // 87 walkers on and around the square, 30 more in places further out (Dolac, Kaptol, Praška, Vlaška...);
  // ?people=N sets the total, shared out the same way.
  const walkShape = new RAPIER.Cylinder(0.6, 0.3);
  const fixedOnly = RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC;
  const crowdSize = params.has('people') ? Number(params.get('people')) : 117;
  const crowdAround = Math.round((crowdSize * 30) / 117);
  const crowd = city.data.walk && crowdSize > 0
    ? new Crowd(city.data.walk, (x, z, level) => {
        const g = level ?? (city.ground ? sampleGrid(city.ground, x, z) : 0);
        const hit = world.castRay(new RAPIER.Ray({ x, y: g + 3, z }, { x: 0, y: -1, z: 0 }), 6, true, fixedOnly);
        if (!hit) return { y: g, free: false };
        const y = g + 3 - hit.timeOfImpact;
        if (y > g + 1.0 || y < g - 0.6) return { y, free: false };
        let free = true;
        world.intersectionsWithShape({ x, y: y + 0.95, z }, { x: 0, y: 0, z: 0, w: 1 }, walkShape, () => ((free = false), false), fixedOnly);
        return { y, free };
      }, crowdSize - crowdAround, furniture.seats(), furniture.spots(), crowdAround)
    : null;
  if (crowd) {
    const ball = new RAPIER.Ball(0.3);
    crowd.solid = (x, y, z) => {
      let inside = false;
      world.intersectionsWithShape({ x, y, z }, { x: 0, y: 0, z: 0, w: 1 }, ball, () => ((inside = true), false), fixedOnly);
      return inside;
    };
    // Not solid: a ray starting inside a prop finds the floor under it, not its own start.
    const down = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    crowd.floor = (x, y, z) => {
      down.origin = { x, y, z };
      const hit = world.castRay(down, 60, false, fixedOnly);
      return hit ? y - hit.timeOfImpact : city.ground ? sampleGrid(city.ground, x, z) : 0;
    };
  }
  const pigeons = crowd && !params.has('nopigeons') ? new Pigeons(crowd, 84) : null;
  if (crowd) {
    scene.add(crowd.root);
    console.log(`[zg] ${crowd.people.length} pedestrians`);
  }
  if (pigeons) scene.add(pigeons.root);
  const threats: Threat[] = [];
  const strikers: Striker[] = [];
  const catenary = params.has('wires') ? new Catenary(city.data.trams, groundAt, RAPIER, world, city.data) : null;
  if (catenary) scene.add(catenary.root);
  console.log(`[zg] ${city.tables.length} café tables, ${city.data.stalls?.length ?? 0} market stalls, ${furniture.count} furniture bodies`);
  // What you ride: the Bajs cargo bike, or the Ferrari (B swaps, ?ride=car).
  type Ride = 'car' | 'bike';
  const key = (k: string, label: string) => `<span><kbd>${k}</kbd>${label}</span>`;
  const HELP_CAR = key('W', 'gas') + key('S', 'brake') + key('Space', 'handbrake');
  // Tapping W (or S in reverse) adds pedal strokes on the bike; the car has no such boost.
  const tapHint = (keys: string) => `<div class="tap"><div>${keys}</div><small>tap to go faster</small></div>`;
  const HELP_BIKE = tapHint(key('W', 'pedal') + key('S', 'brake')) + key('Space', 'skid');
  const rides: Record<Ride, { model: CarModel; tuning: VehicleTuning; camera: [number, number]; help: string }> = {
    car: { model: carModel, tuning: carTuning, camera: [7.2, 2.3], help: HELP_CAR },
    bike: { model: bikeModel, tuning: bikeTuning, camera: [4.6, 2.0], help: HELP_BIKE },
  };
  let ride: Ride = params.get('ride') === 'car' ? 'car' : 'bike';
  const makeVehicle = (x: number, y: number, z: number, heading: number) =>
    new Vehicle(RAPIER, world, rides[ride].model.wheels, { x, y, z }, heading, rides[ride].tuning);
  let vehicle = makeVehicle(spawn.x, groundAt(spawn.x, spawn.z) + 0.4, spawn.z, spawn.heading);
  let model = rides[ride].model;

  const castCamera = (from: THREE.Vector3, dir: THREE.Vector3, far: number) => {
    // Static and kinematic only: flying chairs do not yank the camera.
    const hit = world.castRay(new RAPIER.Ray(from, dir), far, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
    return hit ? hit.timeOfImpact : null;
  };
  const chase = new ChaseCamera(camera, castCamera);
  addEventListener('mousemove', (e) => chase.orbit(e.movementX, e.movementY));
  [chase.distance, chase.height] = rides[ride].camera;
  const controls = new Controls();

  // Delivery jobs: pale pads in front of every business's door, one of them the current job.
  // Static ground only: a tram standing at a door at load time must not lift its pad onto the roof.
  const padRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const deliveries = await loadDeliveries(
    'city/deliveries.json',
    city.data.walls ?? {},
    (x, z, from) => {
      padRay.origin = { x, y: from, z };
      const hit = world.castRay(padRay, from + 10, true, fixedOnly);
      return hit ? from - hit.timeOfImpact : null;
    },
    (x, z) => (city.ground ? sampleGrid(city.ground, x, z) : 0),
    { extent: city.data.extent ?? [-1e9, -1e9, 1e9, 1e9], blocked: city.data.blocked ?? [] },
  );
  scene.add(deliveries.root);
  deliveries.next();

  // three draws a transparent double-sided material twice, back faces then front, flagging it
  // needsUpdate at each flip: a full program lookup, twice a frame, for every sign, pane and net.
  // They are flat (one side faces the camera at a time), so one pass draws the same.
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
      if (mat.transparent && mat.side === THREE.DoubleSide) mat.forceSinglePass = true;
    }
  });

  // Compile every program before the first frame, behind the loading screen.
  setBar(0.9);
  setStatus('Compiling shaders…');
  await renderer.compileAsync(scene, camera);
  for (const r of Object.values(rides)) r.model.root.visible = r.model === model;
  setBar(1);
  setStatus('Ready');
  // The player sets off from the lobby in what they chose there. A driven browser (shot.mjs, perf.mjs)
  // or `?go` starts at once; `?lobby` waits for the button even then.
  const outfit = await lobby.ready((navigator.webdriver || params.has('go')) && !params.has('lobby'));
  bikeModel.dress(outfit);
  lobby.close();
  document.getElementById('loading')!.classList.add('hidden');
  document.getElementById('hud')!.hidden = false;
  if (params.has('pause')) return;

  const hudSpeed = document.getElementById('speed')!;
  const hudGear = document.getElementById('gear')!;
  const hudPlace = document.getElementById('place')!;
  const hudHelp = document.getElementById('help')!;
  const hudFlipped = document.getElementById('flipped')!;
  const hudFps = document.getElementById('fps')!;
  const hudJob = document.getElementById('job')!;
  const hudJobName = document.getElementById('jobName')!;
  const hudJobStreet = document.getElementById('jobStreet')!;
  const hudJobCount = document.getElementById('jobCount')!;
  const hudCompass = document.getElementById('compass')!;
  const hudCompassArrow = hudCompass.firstElementChild as SVGElement;
  const viewDir = new THREE.Vector3();
  const hudToast = document.getElementById('toast')!;
  const hudTimer = document.getElementById('timer')!;
  const finishEl = document.getElementById('finish')!;
  const hudPenalty = document.getElementById('penalty')!;
  const hudPenaltyLeft = document.getElementById('penaltyLeft')!;
  /** Seconds since the first frame; stops at the last delivery. */
  let runTime = 0;
  /** The last delivery is in: the world, the timer and the sound stop for good. */
  let finished = false;
  /** Seconds still held at base after 0: the clock runs on, so the jump back is no shortcut. */
  let penalty = 0;
  const fmtTime = (t: number) => {
    const s = Math.floor(t);
    return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} sec` : `${s} sec`;
  };
  document.getElementById('again')!.addEventListener('click', () => location.reload());
  const hitsText = (n: number) => (n === 0 ? 'No pedestrians hit' : `${n} pedestrian${n === 1 ? '' : 's'} hit`);
  /** The share picture: the last frame under the score, drawn right after that frame's render. */
  let scoreCard: HTMLCanvasElement | null = null;
  const copyScore = document.getElementById('copyScore') as HTMLButtonElement;
  copyScore.addEventListener('click', async () => {
    if (!scoreCard) return;
    const how = await shareImage(scoreCard);
    copyScore.textContent = how === 'copied' ? 'Copied! Paste it anywhere' : 'Saved as an image';
    setTimeout(() => (copyScore.textContent = 'Copy score image'), 2500);
  });
  let toastFor = 0;
  let jobShown: unknown = null;
  /** Seconds spent on the side or roof; past ~1 s the HUD offers a reset. */
  let flippedFor = 0;
  const helpTail = key('R', 'reset') + key('0', 'base, 5 s wait');
  hudHelp.innerHTML = rides[ride].help + helpTail;
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

  /** Swaps the car for the bike (or back) where you are, facing the same way. */
  function switchRide(to: Ride = ride === 'car' ? 'bike' : 'car') {
    if (to === ride) return;
    const p = vehicle.body.translation();
    const heading = vehicle.heading();
    vehicle.free();
    ride = to;
    model.root.visible = false;
    model = rides[ride].model;
    model.root.visible = true;
    vehicle = makeVehicle(p.x, groundAt(p.x, p.z) + 0.3, p.z, heading);
    [chase.distance, chase.height] = rides[ride].camera;
    hudHelp.innerHTML = rides[ride].help + helpTail;
    braking = false;
    model.setBraking(false);
    snapshot(vehicle, prev);
    chase.snap();
  }

  let resetTapped = false;
  hudFlipped.addEventListener('pointerdown', () => (resetTapped = true));

  // Frame rate and render resolution. The GPU cost is per pixel (a 5K Retina screen has 16x the
  // pixels of a 1280x720 window), so the pixel ratio starts under a pixel budget (startRatio) and
  // follows the frame rate: a step down after two seconds under 55 fps (or one under 40), sized by
  // how far under it is (pixels go with the square of the ratio), a step up after 4 s over 58, never
  // back to a step that dropped frames. A step down that does not make it 10% faster means the CPU
  // holds the frame rate back, not the pixels: the sharper picture comes back and stays the floor.
  // The first 2 s (shaders warming up) do not count. `?dpr=1.5` fixes it.
  const fixedRatio = Number(params.get('dpr')) || 0;
  const res = {
    frames: 0, ms: 0, steady: 0, slow: 0, warmup: 2, raised: false, ceiling: Infinity, floor: 0,
    lowered: null as { ratio: number; fps: number } | null,
  };
  const setRatio = (r: number) => {
    renderer.setPixelRatio(r);
    renderer.setSize(innerWidth, innerHeight);
  };
  function measure(ms: number) {
    if (ms > 250) {
      // A hidden tab or a hitch (a shader compiling): not the frame rate.
      res.frames = res.ms = 0;
      return;
    }
    res.frames++;
    res.ms += ms;
    if (res.ms < 1000) return;
    const fps = (res.frames * 1000) / res.ms;
    res.frames = res.ms = 0;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    hudFps.textContent = `${fps.toFixed(0)} fps · ${size.x}×${size.y}`;
    if (fixedRatio || res.warmup-- > 0) return;
    const ratio = renderer.getPixelRatio();
    if (res.lowered) {
      const was = res.lowered;
      res.lowered = null;
      // (Near 60 the gain is capped by the display, so reaching 55 counts as helping.)
      if (fps < 55 && fps < was.fps * 1.1) {
        res.floor = was.ratio;
        res.slow = 0;
        setRatio(was.ratio);
        return;
      }
    }
    if (fps < 55) {
      res.steady = 0;
      if (++res.slow < 2 && fps >= 40 && !res.raised) return;
      const raised = res.raised;
      if (raised) res.ceiling = ratio;
      res.raised = false;
      res.slow = 0;
      const down = Math.max(MIN_RATIO, res.floor, ratio * 0.95 * Math.sqrt(fps / 60));
      if (down < ratio - 0.01) {
        setRatio(down);
        // Undoing a step up proves nothing about the CPU.
        if (!raised) res.lowered = { ratio, fps };
      }
    } else if (fps > 58) {
      res.raised = false;
      res.slow = 0;
      const up = Math.min(maxRatio(), ratio / RATIO_STEP);
      if (++res.steady >= 4 && up > ratio + 0.01 && up < res.ceiling - 0.01) {
        setRatio(up);
        res.raised = true;
        res.steady = 0;
      }
    } else {
      res.steady = res.slow = 0;
    }
  }

  // The far horizon, then the city over it with fresh depth, straight to
  // the canvas (its own 4x MSAA, tone mapping in the materials).
  function render() {
    farCamera.position.copy(camera.position);
    farCamera.quaternion.copy(camera.quaternion);
    if (farCamera.fov !== camera.fov || farCamera.aspect !== camera.aspect) {
      farCamera.fov = camera.fov;
      farCamera.aspect = camera.aspect;
      farCamera.updateProjectionMatrix();
    }
    renderer.clear();
    renderer.render(farScene, farCamera);
    renderer.clearDepth();
    renderer.render(scene, camera);
  }

  const audio = new GameAudio();
  furniture.onHit = (kind, x, y, z, speed) => audio.hit(kind, x, y, z, speed);
  if (pigeons) pigeons.onScatter = (x, y, z) => audio.flapBurst(x, y, z);
  if (crowd) crowd.onHit = (x, y, z, speed) => audio.pedestrianHit(x, y, z, speed);

  // Away from the game (another tab, another window): the world, the timer and the sound stop,
  // the canvas keeps the last frame; back again, it carries on where it was.
  const pausedEl = document.getElementById('paused')!;
  let paused = false;
  function checkAway() {
    const away = document.hidden || !document.hasFocus();
    if (away === paused) return;
    paused = away;
    pausedEl.hidden = !away || finished;
    audio.pause(away || finished);
    // The first frame back only restarts the clock, so the time away never reaches the world.
    if (!away) last = -1;
  }
  addEventListener('blur', checkAway);
  addEventListener('focus', checkAway);
  document.addEventListener('visibilitychange', checkAway);
  checkAway();

  function frame(now: number) {
    if (paused || finished || last < 0) {
      if (!paused) last = now;
      requestAnimationFrame(frame);
      return;
    }
    measure(now - last);
    const elapsed = Math.min(0.1, (now - last) / 1000);
    last = now;
    let input = controls.read(elapsed);
    if (controls.took('KeyR') || resetTapped) {
      resetTapped = false;
      // Back on the wheels where the car is, facing where it faced.
      const p = vehicle.body.translation();
      teleport(p.x, p.z, vehicle.heading());
    }
    if (controls.took('Digit0') && penalty <= 0) {
      teleport(spawn.x, spawn.z, spawn.heading);
      penalty = 5;
    }
    if (penalty > 0) {
      // Held at base: no pedalling, no steering; at a standstill the brakes hold the bike.
      input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
      penalty -= elapsed;
      hudPenaltyLeft.textContent = String(Math.max(1, Math.ceil(penalty)));
    }
    hudPenalty.classList.toggle('show', penalty > 0);
    if (controls.took('KeyB')) switchRide();

    acc += elapsed;
    while (acc >= dt) {
      snapshot(vehicle, prev);
      vehicle.update(dt, input);
      const t = vehicle.body.translation();
      trams.step(dt, carPos.set(t.x, t.y, t.z));
      furniture.step(dt, vehicle.body, vehicle.tuning.sweep.half, vehicle.tuning.sweep.at);
      stepWorld();
      acc -= dt;
    }
    const alpha = acc / dt;
    model.pose(vehicle, prev, alpha);
    trams.place(alpha);
    furniture.place(alpha);
    squareProps.update(now / 1000);
    if (crowd) {
      const t = vehicle.body.translation(), v = vehicle.body.linvel();
      threats.length = 0;
      threats.push({ x: t.x, z: t.z, vx: v.x, vz: v.z, r: ride === 'car' ? 3 : 2.2 });
      trams.hazards((x, z) => threats.push({ x, z, vx: 0, vz: 0, r: 2.6 }));
      const fwd = Math.hypot(v.x, v.z) > 0.5 ? { x: v.x / Math.hypot(v.x, v.z), z: v.z / Math.hypot(v.x, v.z) } : { x: 0, z: 0 };
      const reach = ride === 'car' ? 1.8 : 0.9, rad = ride === 'car' ? 1.2 : 0.6;
      strikers.length = 0;
      strikers.push({ x: t.x, z: t.z, vx: v.x, vz: v.z, r: rad }, { x: t.x + fwd.x * reach, z: t.z + fwd.z * reach, vx: v.x, vz: v.z, r: rad * 0.9 });
      crowd.step(elapsed, threats, strikers);
      crowd.place();
      if (pigeons) {
        pigeons.step(elapsed, threats);
        pigeons.place();
      }
    }
    const isBraking = input.brake > 0.05 && vehicle.speed > 0.5;
    if (isBraking !== braking) {
      braking = isBraking;
      model.setBraking(braking);
    }

    carPos.copy(model.root.position);
    if (freeLook) {
      camera.position.copy(freeLook.eye);
      camera.lookAt(freeLook.target);
    } else {
      chase.update(elapsed, carPos, vehicle.heading(), vehicle.speed, input.throttle > 0 || input.brake > 0 || Math.abs(vehicle.speed) > 1);
    }

    // The shadow camera follows the car, snapped to whole shadow texels so
    // edges do not crawl as it moves.
    const focus = freeLook ? freeLook.target : carPos;
    const texel = (2 * shadowSpan) / sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    sun.target.position.set(fx, focus.y, fz);
    sun.position.set(fx, focus.y, fz).addScaledVector(sunDirection, 300);

    // On its side or roof and not going anywhere: say how to get back up.
    const q = vehicle.body.rotation();
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    flippedFor = upY < 0.5 && vehicle.body.linvel().y ** 2 + vehicle.speed ** 2 < 9 ? flippedFor + elapsed : 0;
    hudFlipped.classList.toggle('show', flippedFor > 0.8);

    const kmh = Math.abs(vehicle.speed) * 3.6;
    hudSpeed.textContent = kmh.toFixed(0);
    // On the bike: the pedal cadence as a bar, so the tapping shows.
    const bar = '▮'.repeat(Math.round(vehicle.cadence * 5)).padEnd(5, '▯');
    hudGear.textContent = ride === 'bike' ? (vehicle.reversing ? 'R ' : '') + bar : vehicle.reversing ? 'R' : 'D';
    if (!finished) runTime += elapsed;
    deliveries.update(elapsed, carPos, vehicle.speed);
    if (deliveries.justDelivered) {
      audio.delivered();
      hudToast.textContent = `Delivered to ${deliveries.justDelivered.name}`;
      hudToast.classList.add('show');
      toastFor = 2.5;
      if (deliveries.delivered >= TOTAL_JOBS && !finished) {
        finished = true;
        document.getElementById('finalTime')!.textContent = fmtTime(runTime);
        if (crowd) {
          const el = document.getElementById('finalHits')!;
          el.textContent = hitsText(crowd.hits);
          el.hidden = false;
        }
        finishEl.hidden = false;
        hudPenalty.classList.remove('show');
        // Game over: from the next frame on nothing moves; the sound stops once the chime has rung.
        setTimeout(() => audio.pause(true), 1200);
      }
    }
    hudTimer.textContent = fmtTime(runTime);
    if (toastFor > 0 && (toastFor -= elapsed) <= 0) hudToast.classList.remove('show');
    const job = deliveries.current;
    hudJob.hidden = !job;
    if (job) {
      if (job !== jobShown) {
        jobShown = job;
        hudJobName.textContent = job.name;
        hudJobCount.textContent = `Delivery ${deliveries.delivered + 1} of ${TOTAL_JOBS}`;
      }
      // The street is a hint that arrives late.
      const wait = deliveries.streetIn();
      hudJobStreet.textContent = wait > 0 ? `street in ${Math.ceil(wait)}…` : job.street;
      hudJob.classList.toggle('waiting', wait > 0);
      // A late hint too: an arrow from the rider to the pad, turned so that up is the way the camera looks.
      const compass = deliveries.age >= COMPASS_DELAY;
      hudCompass.classList.toggle('show', compass);
      if (compass) {
        camera.getWorldDirection(viewDir);
        const bearing = Math.atan2(job.pos.x - carPos.x, carPos.z - job.pos.z); // clockwise from north (-z)
        const view = Math.atan2(viewDir.x, -viewDir.z);
        hudCompassArrow.style.transform = `rotate(${(bearing - view).toFixed(3)}rad)`;
      }
    }
    audio.update(elapsed, { ride, speed: vehicle.speed, drive: vehicle.drive, cadence: vehicle.cadence, throttle: input.throttle, handbrake: input.handbrake }, camera, trams.audioSources(), pigeons ? pigeons.flockSpots() : []);
    const place = places.nearest(carPos.x, carPos.z);
    if (place !== placeName) {
      placeName = place;
      hudPlace.textContent = place;
    }

    const r0 = performance.now();
    render();
    if (finished && !scoreCard) {
      scoreCard = scoreImage(renderer.domElement, {
        done: `All ${TOTAL_JOBS} delivered`,
        time: fmtTime(runTime),
        hits: crowd ? hitsText(crowd.hits) : null,
      });
    }
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
    // A new window size (or another screen): back under the budget, and every step may be tried again.
    res.ceiling = Infinity;
    res.floor = 0;
    res.lowered = null;
    res.steady = res.slow = 0;
    res.warmup = 1;
    setRatio(fixedRatio || Math.min(renderer.getPixelRatio(), startRatio()));
  });

  // A small debug surface for screenshots and comparisons with Street View:
  //   zg.look([ex, ey, ez], [tx, ty, tz], fov?)  parks the camera (web frame)
  //   zg.drive()                            back to the chase camera
  //   zg.teleport(x, z, heading)
  //   zg.ride('bike' | 'car')               swap what you ride
  //   zg.dress({ coat, fabric, hair })      the rider's outfit (ids from outfit.ts)
  (window as unknown as { zg: unknown }).zg = {
    ride: (to: Ride) => switchRide(to),
    dress: (o: Partial<Outfit>) => bikeModel.dress({ ...outfit, ...o }),
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
    /** Delivery jobs: `deliveries.destinations`, `deliveries.current`; `job(id)` forces the current job. */
    deliveries,
    audio,
    job(id: string) {
      const d = deliveries.destinations.find((x) => x.id === id);
      if (d) {
        deliveries.current = d;
        deliveries.age = 0;
      }
      return d ?? null;
    },
    world,
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
    /** Rays from (ox, oy, oz) along [dirs] (flat x, y, z): the wall hits as [x, y, z, nx, nz] (vertical faces only). */
    wallHits(ox: number, oy: number, oz: number, dirs: number[], far = 200) {
      const out: number[] = [];
      for (let i = 0; i < dirs.length; i += 3) {
        const ray = new RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: dirs[i], y: dirs[i + 1], z: dirs[i + 2] });
        const hit = world.castRayAndGetNormal(ray, far, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
        if (!hit || Math.abs(hit.normal.y) > 0.3) continue;
        const t = hit.timeOfImpact;
        out.push(ox + dirs[i] * t, oy + dirs[i + 1] * t, oz + dirs[i + 2] * t, hit.normal.x, hit.normal.z);
      }
      return out;
    },
    /** Like wallHits, but against the rendered meshes (roofs block): the visible vertical faces
     * that are NOT hero pictures, as [x, y, z, nx, nz, tile]. */
    plainHits(ox: number, oy: number, oz: number, dirs: number[], far = 200) {
      const rc = new THREE.Raycaster();
      rc.far = far;
      const out: number[] = [];
      for (let i = 0; i < dirs.length; i += 3) {
        rc.set(new THREE.Vector3(ox, oy, oz), new THREE.Vector3(dirs[i], dirs[i + 1], dirs[i + 2]));
        const hit = rc.intersectObject(city.root, true)[0];
        if (!hit || !hit.face || Math.abs(hit.face.normal.y) > 0.3) continue;
        const info = (hit.object as THREE.Mesh).geometry.getAttribute('aInfo');
        const tile = info ? info.getX(hit.face.a) : -99;
        if (tile < 0) continue;
        out.push(hit.point.x, hit.point.y, hit.point.z, hit.face.normal.x, hit.face.normal.z, tile);
      }
      return out;
    },
    /** What the pixel (px, py) shows: the point, its normal and the atlas tile (< 0 = hero page). */
    pick(px: number, py: number) {
      const rc = new THREE.Raycaster();
      rc.setFromCamera(new THREE.Vector2((px / innerWidth) * 2 - 1, 1 - (py / innerHeight) * 2), camera);
      const hit = rc.intersectObject(city.root, true)[0];
      if (!hit || !hit.face) return null;
      const info = (hit.object as THREE.Mesh).geometry.getAttribute('aInfo');
      const r = (v: number) => Math.round(v * 10) / 10;
      return { x: r(hit.point.x), y: r(hit.point.y), z: r(hit.point.z), nx: r(hit.face.normal.x), nz: r(hit.face.normal.z), tile: info ? info.getX(hit.face.a) : null };
    },
    /** Renders [n] frames back to back, each waited out on the GPU: ms per frame and the draw stats. */
    bench(n = 30) {
      const gl = renderer.getContext();
      const px = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      renderer.info.autoReset = false;
      renderer.info.reset();
      render();
      const { calls, triangles } = renderer.info.render;
      renderer.info.autoReset = true;
      const t = performance.now();
      for (let i = 0; i < n; i++) {
        render();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      }
      const ms = (performance.now() - t) / n;
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      return { ms: Math.round(ms * 10) / 10, calls, triangles, width: size.x, height: size.y };
    },
    /** The real game loop for [secs] seconds, riding (W held) behind the chase camera: frames a second
     * and frame-time percentiles. Over 60 only with `shot.mjs --uncapped`. */
    async fps(secs = 8) {
      freeLook = null;
      chase.snap();
      const times: number[] = [];
      let on = true, prevT = performance.now();
      const tick = (t: number) => {
        times.push(t - prevT);
        prevT = t;
        if (on) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      await new Promise((r) => setTimeout(r, secs * 1000));
      on = false;
      dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
      times.shift();
      const sorted = [...times].sort((a, b) => a - b);
      const p = (q: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] * 10) / 10;
      const mean = times.reduce((a, b) => a + b, 0) / times.length;
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      return { fps: Math.round(10000 / mean) / 10, p50: p(0.5), p95: p(0.95), p99: p(0.99), width: size.x, height: size.y };
    },
    renderer,
    scene,
    camera,
    get vehicle() {
      return vehicle;
    },
    trams,
    furniture,
    crowd,
    pigeons,
  };
  const park = params.get('park');
  if (park && parks[park]) {
    const [eye, target] = parks[park];
    freeLook = { eye: new THREE.Vector3(...eye), target: new THREE.Vector3(...target) };
  }
}

/** Render resolution limits: at most the screen's pixel ratio (and 2), at least 0.6. */
const MIN_RATIO = 0.6;
const RATIO_STEP = 0.85;
/** Pixels the first frame may draw: ~2560x1600, which a laptop GPU fills at 60 fps here. */
const PIXEL_BUDGET = 4.2e6;
const maxRatio = () => Math.min(devicePixelRatio, 2);
function startRatio() {
  const fixed = Number(params.get('dpr'));
  if (fixed) return fixed;
  return Math.max(MIN_RATIO, Math.min(maxRatio(), Math.sqrt(PIXEL_BUDGET / (innerWidth * innerHeight))));
}

/** Fixed camera parks for comparisons (`?park=<name>`), web frame. */
const parks: Record<string, [[number, number, number], [number, number, number]]> = {
  square: [[-100, 2.2, -2], [30, 7, -18]],
  ilica: [[-300, 2.2, -9], [-110, 5, -9]],
  cathedral: [[105, 2.2, -150], [180, 38, -167]],
  overview: [[-230, 230, 330], [10, 0, -20]],
};

/** Loads the city behind the lobby, then runs the game. */
export function run(lobby: Lobby) {
  main(lobby).catch((e) => {
    console.error(e);
    const reason = e instanceof Error ? e.message : e instanceof Event ? `failed to load ${(e.target as { src?: string } | null)?.src ?? 'a resource'}` : String(e);
    setStatus(`Failed to start: ${reason}`);
  });
}
