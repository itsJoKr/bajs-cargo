// Keyboard and gamepad controls, merged into one DriveInput. No touch
// controls: the game is desktop only (main.ts turns phones and tablets away).

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

  constructor() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.taps++;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') this.backTaps++;
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
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
