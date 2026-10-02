// The game's sound, all synthesised with Web Audio (no sample files): the bike's freewheel
// ticks and tyre hiss, the car's engine, trams that rumble and whine from where they are (and ring
// a school bell when held up), and the delivery chime. The context starts on the first key or
// click (browsers insist); M mutes.

import * as THREE from 'three';

export interface DriveState {
  ride: 'bike' | 'car';
  /** Signed speed, m/s. */
  speed: number;
  /** Signed drive force sign (> 0 pedalling / gas). */
  drive: number;
  /** Bike: tap cadence 0..1. */
  cadence: number;
  /** Throttle input 0..1 (car). */
  throttle: number;
  handbrake: boolean;
}

/** A tram to hear: a stable id, where its middle is and how fast it goes. */
export interface TramSource {
  id: number;
  x: number;
  y: number;
  z: number;
  speed: number;
  /** Held up by the car or another tram. */
  blocked: boolean;
}

const TRAM_VOICES = 4;
/** The bell in the cathedral's tower (web frame). */
const CATHEDRAL_BELL = new THREE.Vector3(174.7, 62, -168);
/** Distances (m) from the bell: full loudness to the main square's far side, fading to silence by BELL_GONE. */
const BELL_FULL = 340;
const BELL_GONE = 560;
/** The middle of the main square, where the murmur is loudest. */
const SQUARE = new THREE.Vector3(12, 0, -18);
const TRAM_RANGE = 110;

interface TramVoice {
  id: number;
  panner: PannerNode;
  gain: GainNode;
  whine: OscillatorNode;
  rumble: BiquadFilterNode;
  nextHorn: number;
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private muted = false;
  private paused = false;
  private bikeGain!: GainNode;
  private tyre!: BiquadFilterNode;
  private tyreGain!: GainNode;
  private engine!: OscillatorNode;
  private engineSub!: OscillatorNode;
  private engineFilter!: BiquadFilterNode;
  private engineGain!: GainNode;
  private skid!: BiquadFilterNode;
  private skidGain!: GainNode;
  private lastHit = 0;
  private lastCrash = 0;
  private wings: AudioBuffer[] = [];
  private bellBuf: AudioBuffer | null = null;
  private nextFlutter = 2;
  private prevSpeed = 0;
  private nextChurch = 6;
  private hum!: GainNode;
  private humFilter!: BiquadFilterNode;
  private voices: TramVoice[] = [];
  private pedalPhase = 0;
  private time = 0;
  private readonly fwd = new THREE.Vector3();

  constructor() {
    const start = () => {
      if (!this.ctx) this.build();
      if (!this.paused) void this.ctx?.resume();
    };
    addEventListener('keydown', (e) => {
      start();
      if (e.code === 'KeyM' && !e.repeat) this.setMuted(!this.muted);
    });
    addEventListener('pointerdown', start);
  }

  get isMuted() {
    return this.muted;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  /** The game is paused (the player went to another tab or window): the context stops, and with it every sound. */
  pause(p: boolean) {
    this.paused = p;
    if (this.ctx) void (p ? this.ctx.suspend() : this.ctx.resume());
  }

  private build() {
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // Two seconds of white noise, looped by every hiss and rumble.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Tyres and wind, for both rides (louder with speed).
    this.tyre = ctx.createBiquadFilter();
    this.tyre.type = 'bandpass';
    this.tyre.Q.value = 0.6;
    this.tyreGain = ctx.createGain();
    this.tyreGain.gain.value = 0;
    this.loop().connect(this.tyre).connect(this.tyreGain).connect(this.master);

    // Rear wheel locked by the handbrake: a rubbery squeal over a scrub.
    this.skid = ctx.createBiquadFilter();
    this.skid.type = 'bandpass';
    this.skid.Q.value = 7;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    this.loop().connect(this.skid).connect(this.skidGain).connect(this.master);

    // The city's murmur: crowd, distant traffic. Fades in over the main square.
    this.humFilter = ctx.createBiquadFilter();
    this.humFilter.type = 'lowpass';
    this.humFilter.frequency.value = 500;
    this.hum = ctx.createGain();
    this.hum.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.23;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(this.humFilter.frequency);
    lfo.start();
    this.loop().connect(this.humFilter).connect(this.hum).connect(this.master);

    this.bikeGain = ctx.createGain();
    this.bikeGain.connect(this.master);

    // The car's engine: a saw and a sub octave through a low-pass that opens with the revs.
    this.engine = ctx.createOscillator();
    this.engine.type = 'sawtooth';
    this.engineSub = ctx.createOscillator();
    this.engineSub.type = 'square';
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 2;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engine.connect(this.engineFilter);
    this.engineSub.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.engine.start();
    this.engineSub.start();

    for (let i = 0; i < TRAM_VOICES; i++) this.voices.push(this.tramVoice(ctx));

    // Wing-flap recordings (BigSoundBank, CC0: "Flight of a Pigeon" s0840 and s0476; public/sounds).
    for (const url of ['sounds/wings1.mp3', 'sounds/wings2.mp3', 'sounds/wings3.mp3', 'sounds/wings4.mp3']) {
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data))
        .then((buf) => this.wings.push(buf))
        .catch(() => {});
    }
    // The cathedral bell: a real strike (BigSoundBank "Bell 1 O'clock" s3446, CC0), played slowed down.
    fetch('sounds/bell.mp3')
      .then((r) => r.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
      .then((buf) => (this.bellBuf = buf))
      .catch(() => {});
  }

  private loop(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random();
    src.start();
    return src;
  }

  private tramVoice(ctx: AudioContext): TramVoice {
    const panner = ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = 12;
    panner.rolloffFactor = 1.4;
    panner.maxDistance = TRAM_RANGE;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    // Wheel rumble on the rails: band-limited noise.
    const rumble = ctx.createBiquadFilter();
    rumble.type = 'bandpass';
    rumble.frequency.value = 220;
    rumble.Q.value = 0.9;
    this.loop().connect(rumble).connect(gain);
    // The traction motors' rising whine.
    const whine = ctx.createOscillator();
    whine.type = 'sine';
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0.03;
    const whineFilter = ctx.createBiquadFilter();
    whineFilter.type = 'lowpass';
    whineFilter.frequency.value = 700;
    whine.connect(whineFilter).connect(whineGain).connect(gain);
    whine.start();
    gain.connect(panner).connect(this.master);
    return { id: -1, panner, gain, whine, rumble, nextHorn: 0 };
  }

  /** A short noise burst through a band-pass: one tick of the freewheel. */
  private tick(freq: number, level: number, when = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.03);
    src.connect(f).connect(g).connect(this.bikeGain);
    src.start(t, Math.random() * 1.5, 0.05);
  }

  private tone(freq: number, when: number, len: number, level: number, dest: AudioNode, type: OscillatorType = 'sine') {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  /** A package handed over: a bright three-note chime. */
  delivered() {
    if (!this.ctx) return;
    [659.25, 783.99, 1046.5].forEach((f, i) => {
      this.tone(f, i * 0.09, 0.7, 0.16, this.master);
      this.tone(f * 2, i * 0.09, 0.4, 0.04, this.master);
    });
  }

  /** The car sends a piece of café furniture flying: wood clatter, a thud, rattling metal. */
  hit(kind: string, x: number, y: number, z: number, speed: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.time - this.lastHit < 0.05) return;
    this.lastHit = this.time;
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    p.refDistance = 5;
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
    p.connect(this.master);
    const lvl = Math.min(1, 0.35 + speed / 20);
    const knock = (freq: number, when: number, len: number, level: number, q = 3) => {
      const t = ctx.currentTime + when;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq * (0.9 + Math.random() * 0.2);
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(level * lvl, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + len);
      src.connect(f).connect(g).connect(p);
      src.start(t, Math.random() * 1.5, len + 0.05);
    };
    const thud = (freq: number, len: number, level: number) => {
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(freq * 0.45, t + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(level * lvl, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + len);
      o.connect(g).connect(p);
      o.start(t);
      o.stop(t + len + 0.05);
    };
    if (kind === 'chair') {
      thud(190, 0.12, 0.5);
      for (let i = 0; i < 4; i++) knock(1100 + i * 300, 0.02 + i * 0.07 + Math.random() * 0.03, 0.06, 0.5);
    } else if (kind === 'table') {
      thud(110, 0.2, 0.8);
      knock(700, 0.03, 0.1, 0.5);
      knock(1500, 0.14, 0.05, 0.3);
    } else if (kind === 'parasol') {
      knock(380, 0, 0.18, 0.5, 1);
      this.tone(2100, 0.03, 0.25, 0.05, p, 'triangle');
      knock(2500, 0.08, 0.05, 0.25);
    } else {
      // A market stall: a heavy crash.
      thud(85, 0.3, 1);
      knock(500, 0, 0.3, 0.7, 1);
      for (let i = 0; i < 5; i++) knock(900 + i * 250, 0.05 + i * 0.06, 0.07, 0.5);
    }
    setTimeout(() => p.disconnect(), 1500);
  }

  private spot(ctx: AudioContext, x: number, y: number, z: number, ref: number) {
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    p.refDistance = ref;
    p.rolloffFactor = 1.3;
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
    p.connect(this.master);
    return p;
  }

  /** One bird's wing clatter from a recording, at a random pitch, after [delay] seconds. */
  private flap(dest: AudioNode, delay: number, level: number, long = true) {
    const ctx = this.ctx!;
    const pool = long ? this.wings : this.wings.slice(2);
    if (pool.length === 0) return;
    const src = ctx.createBufferSource();
    src.buffer = pool[Math.floor(Math.random() * pool.length)];
    src.playbackRate.value = 0.9 + Math.random() * 0.35;
    const g = ctx.createGain();
    g.gain.value = level;
    src.connect(g).connect(dest);
    src.start(ctx.currentTime + delay);
  }

  /** A flock takes off: a handful of birds' wing clatter layered, each a little late. */
  flapBurst(x: number, y: number, z: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.wings.length === 0) return;
    const p = this.spot(ctx, x, y, z, 6);
    const n = 7;
    for (let i = 0; i < n; i++) this.flap(p, Math.random() * 0.45, 0.5 + Math.random() * 0.3);
    setTimeout(() => p.disconnect(), 3500);
  }

  /** A single bird fluttering up or shuffling on the ground, now and then. */
  private flutter(x: number, y: number, z: number) {
    const ctx = this.ctx;
    if (!ctx || this.wings.length === 0) return;
    const p = this.spot(ctx, x, y, z, 4);
    this.flap(p, 0, 0.25 + Math.random() * 0.2, false);
    setTimeout(() => p.disconnect(), 2500);
  }

  /** A pedestrian struck by the car or bike: a dull thump and a short "oof". */
  pedestrianHit(x: number, y: number, z: number, speed: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    p.refDistance = 5;
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
    p.connect(this.master);
    const lvl = Math.min(1, 0.4 + speed / 15);
    const t = ctx.currentTime;
    // The body blow.
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.8 * lvl, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.18);
    o.connect(g).connect(p);
    o.start(t);
    o.stop(t + 0.2);
    // The voice: a falling buzz through a vowel-ish band-pass, a little after the impact.
    const pitch = 120 + Math.random() * 90;
    const v = ctx.createOscillator();
    v.type = 'sawtooth';
    v.frequency.setValueAtTime(pitch * 1.5, t + 0.03);
    v.frequency.exponentialRampToValueAtTime(pitch * 0.8, t + 0.35);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 650;
    f1.Q.value = 3;
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0.0001, t + 0.03);
    vg.gain.exponentialRampToValueAtTime(0.5 * lvl, t + 0.06);
    vg.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    v.connect(f1).connect(vg).connect(p);
    v.start(t + 0.03);
    v.stop(t + 0.4);
    setTimeout(() => p.disconnect(), 1000);
  }

  /** The tram's warning: a school bell, a long rattling ring. */
  private schoolBell(v: TramVoice) {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(v.panner);
    const pulses = 26;
    for (let i = 0; i < pulses; i++) {
      const t = t0 + i * 0.045;
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.04);
    }
    g.gain.setValueAtTime(0, t0 + pulses * 0.045);
    for (const [f, lvl] of [[1010, 0.3], [1517, 0.22], [2760, 0.1]] as const) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = lvl;
      o.connect(og).connect(g);
      o.start(t0);
      o.stop(t0 + pulses * 0.045 + 0.05);
    }
    setTimeout(() => g.disconnect(), (pulses * 0.045 + 0.3) * 1000);
  }

  /** A collision with something solid: a low thump and a crunch of noise. */
  private crash(power: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9 * power, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.3);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.35);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.7 * power, t);
    ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.25);
    src.connect(f).connect(ng).connect(this.master);
    src.start(t, Math.random() * 1.5, 0.3);
  }

  /** The cathedral's great bell: one low stroke, heard on Kaptol, Dolac and the main square. */
  private churchBell(camPos: THREE.Vector3) {
    const ctx = this.ctx!;
    const at = CATHEDRAL_BELL;
    const dist = camPos.distanceTo(at);
    // The panner's roll-off alone carries it across the whole map: fade it out past the square.
    const k = Math.min(1, Math.max(0, (dist - BELL_FULL) / (BELL_GONE - BELL_FULL)));
    const fade = 1 - k * k * (3 - 2 * k);
    if (fade <= 0) return;
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 70;
    p.rolloffFactor = 0.45;
    p.maxDistance = 5000;
    p.positionX.value = at.x;
    p.positionY.value = at.y;
    p.positionZ.value = at.z;
    // Distance takes the top off the sound.
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = Math.max(900, 7000 - dist * 12);
    air.connect(p).connect(this.master);
    const t = ctx.currentTime;
    if (this.bellBuf) {
      // The recording's small bell (~610 Hz) slowed to ~0.45: a big, low bell with a long tail.
      const src = ctx.createBufferSource();
      src.buffer = this.bellBuf;
      src.playbackRate.value = 0.45;
      const g = ctx.createGain();
      g.gain.value = 1.4 * fade;
      src.connect(g).connect(air);
      src.start(t);
    } else {
      const f = 92;
      // Fallback until the recording loads: a big bell's partials, each beating slightly.
      for (const [ratio, lvl, decay] of [[0.5, 0.7, 9], [1, 1, 8], [1.2, 0.6, 5.5], [1.5, 0.5, 4.5], [2, 0.55, 4]] as const) {
        for (const beat of [1, 1.0035]) {
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.value = f * ratio * beat;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(lvl * 0.45 * fade, t + 0.012);
          g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
          o.connect(g).connect(air);
          o.start(t);
          o.stop(t + decay + 0.1);
        }
      }
    }
    setTimeout(() => {
      air.disconnect();
      p.disconnect();
    }, 18000);
  }

  /** Once a frame: the vehicle's sounds, the trams' (from [trams]) and the listener at [camera]. */
  update(dt: number, s: DriveState, camera: THREE.Camera, trams: TramSource[], pigeons: { x: number; y: number; z: number }[] = []) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.time += dt;
    const now = ctx.currentTime;
    const v = Math.abs(s.speed);

    // Listener: where the camera is and looks.
    const L = ctx.listener;
    camera.updateMatrixWorld();
    const p = camera.position;
    camera.getWorldDirection(this.fwd);
    if (L.positionX) {
      L.positionX.value = p.x;
      L.positionY.value = p.y;
      L.positionZ.value = p.z;
      L.forwardX.value = this.fwd.x;
      L.forwardY.value = this.fwd.y;
      L.forwardZ.value = this.fwd.z;
      L.upX.value = 0;
      L.upY.value = 1;
      L.upZ.value = 0;
    }

    const bike = s.ride === 'bike';

    // The great bell: one stroke a minute.
    if (this.time > this.nextChurch) {
      this.nextChurch = this.time + 60;
      this.churchBell(p);
    }

    // Pigeons near the listener flutter now and then.
    if (this.time > this.nextFlutter) {
      this.nextFlutter = this.time + 2.5 + Math.random() * 5;
      const close = pigeons.filter((f) => Math.hypot(f.x - p.x, f.z - p.z) < 30);
      if (close.length) {
        const f = close[Math.floor(Math.random() * close.length)];
        this.flutter(f.x, f.y, f.z);
      }
    }

    // City murmur, loudest on the square.
    const dSq = Math.hypot(p.x - SQUARE.x, p.z - SQUARE.z);
    this.hum.gain.setTargetAtTime(0.05 * Math.max(0, Math.min(1, (260 - dSq) / 200)), now, 0.5);

    // A hard stop against a wall or a kerb: a dull crunch, by how much speed vanished in a frame.
    const lost = Math.abs(this.prevSpeed) - Math.abs(s.speed);
    if (lost / Math.max(dt, 1e-3) > 45 && lost > 2 && this.time - this.lastCrash > 0.35) {
      this.lastCrash = this.time;
      this.crash(Math.min(1, lost / 12));
    }
    this.prevSpeed = s.speed;
    // Tyre hiss / wind.
    this.tyre.frequency.setTargetAtTime(400 + v * 90, now, 0.1);
    this.tyreGain.gain.setTargetAtTime(Math.min(0.22, (bike ? 0.004 : 0.006) * v + (v > 0.2 ? 0.01 : 0)), now, 0.1);

    // Pedalling: a freewheel tick every half turn of the cranks; quicker and higher with speed and sprint.
    this.bikeGain.gain.value = bike ? 1 : 0;
    if (bike && s.drive > 0) {
      const revsPerSec = 0.55 + Math.min(v, 14) * 0.11 + s.cadence * 1.0;
      this.pedalPhase += dt * revsPerSec * 2;
      if (this.pedalPhase >= 1) {
        this.pedalPhase -= 1;
        this.tick(1400 + revsPerSec * 700, 0.18 + 0.1 * s.cadence);
        this.tick(320, 0.1, 0.004);
      }
    } else if (bike && v > 1.5) {
      // Coasting: the freewheel's buzz of clicks, slowing with the wheel.
      this.pedalPhase += dt * v * 1.3;
      if (this.pedalPhase >= 1) {
        this.pedalPhase -= 1;
        this.tick(3200, 0.06);
      }
    }

    // The handbrake locks the rear wheel: a squeal that drops with speed, a scrub under it.
    const skidding = s.handbrake && v > 1.5;
    this.skid.frequency.setTargetAtTime(1500 + v * 55, now, 0.05);
    this.skidGain.gain.setTargetAtTime(skidding ? Math.min(0.3, 0.05 + v * 0.02) : 0, now, skidding ? 0.03 : 0.08);

    // Car engine: revs climb through five gears.
    if (!bike) {
      const gearTop = [9, 17, 27, 40, 60];
      let gear = 0;
      while (gear < gearTop.length - 1 && v > gearTop[gear]) gear++;
      const lo = gear === 0 ? 0 : gearTop[gear - 1] * 0.62;
      const rpm = Math.min(1, 0.22 + 0.78 * ((v - lo) / (gearTop[gear] - lo)));
      const f = 38 + 95 * rpm + 20 * s.throttle;
      this.engine.frequency.setTargetAtTime(f, now, 0.06);
      this.engineSub.frequency.setTargetAtTime(f * 0.5, now, 0.06);
      this.engineFilter.frequency.setTargetAtTime(300 + 900 * rpm + 700 * s.throttle, now, 0.08);
      this.engineGain.gain.setTargetAtTime(0.05 + 0.09 * s.throttle + 0.02 * rpm, now, 0.08);
    } else {
      this.engineGain.gain.setTargetAtTime(0, now, 0.05);
    }

    // Trams: the nearest few, each voice keeping its tram while it is heard.
    const near = trams
      .map((t) => ({ t, d: Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z) }))
      .filter((e) => e.d < TRAM_RANGE)
      .sort((a, b) => a.d - b.d)
      .slice(0, TRAM_VOICES);
    const used = new Set<TramVoice>();
    const assigned = new Map<TramVoice, { t: TramSource; d: number }>();
    for (const e of near) {
      const own = this.voices.find((x) => x.id === e.t.id);
      if (own) {
        used.add(own);
        assigned.set(own, e);
      }
    }
    for (const e of near) {
      if ([...assigned.values()].includes(e)) continue;
      const free = this.voices.find((x) => !used.has(x));
      if (!free) break;
      used.add(free);
      free.id = e.t.id;
      free.gain.gain.cancelScheduledValues(now);
      free.gain.gain.value = 0;
      assigned.set(free, e);
    }
    for (const voice of this.voices) {
      const e = assigned.get(voice);
      if (!e) {
        voice.id = -1;
        voice.gain.gain.setTargetAtTime(0, now, 0.15);
        continue;
      }
      const sp = Math.abs(e.t.speed);
      voice.panner.positionX.value = e.t.x;
      voice.panner.positionY.value = e.t.y + 1.5;
      voice.panner.positionZ.value = e.t.z;
      voice.gain.gain.setTargetAtTime(sp < 0.15 ? 0.1 : 0.45 + Math.min(sp, 12) * 0.05, now, 0.2);
      voice.rumble.frequency.setTargetAtTime(160 + sp * 25, now, 0.2);
      voice.whine.frequency.setTargetAtTime(140 + sp * 14, now, 0.3);
      // Held up by the car (or a tram ahead): ring the school bell until it can go.
      if (e.t.blocked && sp < 2 && e.d < 90 && this.time > voice.nextHorn) {
        voice.nextHorn = this.time + 2.2;
        this.schoolBell(voice);
      } else if (!e.t.blocked) voice.nextHorn = this.time + 0.4;
    }
  }
}
