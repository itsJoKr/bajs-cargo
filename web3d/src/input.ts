// Keyboard, gamepad and touch controls, merged into one DriveInput. Touch buttons press the same
// virtual keys as the keyboard (a tap on the pedal button is a pedal stroke, like a tap on W); the
// steering pad on the left is a stick, and a drag anywhere else turns the camera like the mouse.

import type { DriveInput } from './vehicle.ts';

export class Controls {
  private keys = new Set<string>();
  /** Keys pressed once since the last read (R, C, ...). */
  private pressed = new Set<string>();
  /** Smoothed keyboard steering, so a tap is not a full-lock flick. */
  private keySteer = 0;
  /** Gas presses since the last read, and their decaying sum: pedal strokes.
   * The brake keys count their own, for backing up on the bike. */
  private taps = 0;
  private strokes = 0;
  private backTaps = 0;
  private backStrokes = 0;
  private padGas = false;
  private padBrake = false;
  /** The touch steering pad, -1..1 while a finger is on it, else null. */
  private touchSteer: number | null = null;
  /** Fingers dragging the view (pointer id -> last position). */
  private drags = new Map<number, { x: number; y: number }>();
  /** Called with the movement of a finger dragging the view, like mouse movement. */
  onLook: (dx: number, dy: number) => void = () => {};

  constructor(touchRoot?: HTMLElement | null) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.touchSteer = null;
      this.drags.clear();
    });
    if (touchRoot) this.bindTouch(touchRoot);
  }

  /** A finger is turning the view: the chase camera should not swing back behind yet. */
  get looking() {
    return this.drags.size > 0;
  }

  private down(code: string) {
    this.keys.add(code);
    this.pressed.add(code);
    if (code === 'KeyW' || code === 'ArrowUp') this.taps++;
    if (code === 'KeyS' || code === 'ArrowDown') this.backTaps++;
  }

  /** Buttons with `data-key` hold that key while pressed; `data-tap` presses it once. The `#steer`
   * pad steers by where the finger is across it; touches on the game itself turn the view. */
  private bindTouch(root: HTMLElement) {
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    for (const el of root.querySelectorAll<HTMLElement>('[data-key]')) {
      const code = el.dataset.key!;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        el.classList.add('on');
        this.down(code);
      });
      const up = () => {
        el.classList.remove('on');
        this.keys.delete(code);
      };
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, up);
    }
    for (const el of root.querySelectorAll<HTMLElement>('[data-tap]')) {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.pressed.add(el.dataset.tap!);
      });
    }
    const pad = root.querySelector<HTMLElement>('#steer');
    if (pad) {
      const knob = pad.querySelector<HTMLElement>('.knob')!;
      const move = (e: PointerEvent) => {
        const r = pad.getBoundingClientRect();
        const v = (e.clientX - (r.left + r.width / 2)) / (r.width * 0.4);
        // A small dead zone round the middle, full lock short of the ends.
        const s = Math.max(-1, Math.min(1, Math.sign(v) * Math.max(0, Math.abs(v) - 0.08) / 0.92));
        this.touchSteer = s;
        knob.style.transform = `translateX(${s * (r.width / 2 - knob.offsetWidth / 2 - 6)}px)`;
      };
      pad.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        pad.setPointerCapture(e.pointerId);
        pad.classList.add('on');
        move(e);
      });
      pad.addEventListener('pointermove', (e) => {
        if (pad.hasPointerCapture(e.pointerId)) move(e);
      });
      const up = () => {
        this.touchSteer = null;
        pad.classList.remove('on');
        knob.style.transform = '';
      };
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(ev, up);
    }
    // The view: a finger on the game (not on a control) drags the camera round the rider.
    addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || !(e.target instanceof HTMLCanvasElement)) return;
      this.drags.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    addEventListener('pointermove', (e) => {
      const was = this.drags.get(e.pointerId);
      if (!was) return;
      // A finger moves the view about twice as far as the mouse would: screens are small.
      this.onLook((e.clientX - was.x) * 1.6, (e.clientY - was.y) * 1.6);
      was.x = e.clientX;
      was.y = e.clientY;
    });
    for (const ev of ['pointerup', 'pointercancel']) addEventListener(ev, (e) => this.drags.delete((e as PointerEvent).pointerId));
  }

  /** True once per press of [code]. */
  took(code: string) {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  read(dt: number): DriveInput {
    const k = (...codes: string[]) => codes.some((c) => this.keys.has(c));
    const left = k('KeyA', 'ArrowLeft');
    const right = k('KeyD', 'ArrowRight');
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    // Keys ramp the stick in and snap it back faster.
    const rate = target === 0 || Math.sign(target) !== Math.sign(this.keySteer) ? 6 : 3.5;
    this.keySteer += Math.max(-rate * dt, Math.min(rate * dt, target - this.keySteer));
    const input: DriveInput = {
      throttle: k('KeyW', 'ArrowUp') ? 1 : 0,
      brake: k('KeyS', 'ArrowDown') ? 1 : 0,
      steer: this.keySteer,
      handbrake: k('Space'),
    };
    if (this.touchSteer !== null) input.steer = this.touchSteer;
    const pad = navigator.getGamepads?.().find((p) => p);
    let padTap = false;
    let padBackTap = false;
    if (pad) {
      const trigger = pad.buttons[7]?.value ?? 0;
      padTap = trigger > 0.6 && !this.padGas;
      this.padGas = trigger > (this.padGas ? 0.3 : 0.6);
      const left = pad.buttons[6]?.value ?? 0;
      padBackTap = left > 0.6 && !this.padBrake;
      this.padBrake = left > (this.padBrake ? 0.3 : 0.6);
      const stick = pad.axes[0] ?? 0;
      if (Math.abs(stick) > 0.08) input.steer = stick;
      input.throttle = Math.max(input.throttle, pad.buttons[7]?.value ?? 0);
      input.brake = Math.max(input.brake, pad.buttons[6]?.value ?? 0);
      input.handbrake ||= !!pad.buttons[0]?.pressed;
    }
    // Cadence: every press adds a stroke, strokes fade over ~0.35 s, so
    // tapping 7-8 times a second keeps it near 1 and holding lets it drop.
    const fade = Math.exp(-dt / 0.35);
    this.strokes = this.strokes * fade + this.taps + (padTap ? 1 : 0);
    this.backStrokes = this.backStrokes * fade + this.backTaps + (padBackTap ? 1 : 0);
    this.taps = this.backTaps = 0;
    input.cadence = Math.min(1, this.strokes / 2.6);
    input.backCadence = Math.min(1, this.backStrokes / 2.6);
    return input;
  }
}
