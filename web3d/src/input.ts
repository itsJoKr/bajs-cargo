// Keyboard, gamepad and touch controls, merged into one DriveInput.

import type { DriveInput } from './vehicle.ts';

export class Controls {
  private keys = new Set<string>();
  private touch = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  /** Keys pressed once since the last read (R, C, ...). */
  private pressed = new Set<string>();
  /** Smoothed keyboard steering, so a tap is not a full-lock flick. */
  private keySteer = 0;

  constructor(touchRoot: HTMLElement | null) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    if (touchRoot) this.bindTouch(touchRoot);
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
    if (pad) {
      const stick = pad.axes[0] ?? 0;
      if (Math.abs(stick) > 0.08) input.steer = stick;
      input.throttle = Math.max(input.throttle, pad.buttons[7]?.value ?? 0);
      input.brake = Math.max(input.brake, pad.buttons[6]?.value ?? 0);
      input.handbrake ||= !!pad.buttons[0]?.pressed;
    }
    input.throttle = Math.max(input.throttle, this.touch.throttle);
    input.brake = Math.max(input.brake, this.touch.brake);
    if (this.touch.steer !== 0) input.steer = this.touch.steer;
    input.handbrake ||= this.touch.handbrake;
    return input;
  }

  private bindTouch(root: HTMLElement) {
    const hold = (id: string, set: (on: boolean) => void) => {
      const el = root.querySelector<HTMLElement>(`#${id}`);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => {
        el.setPointerCapture(e.pointerId);
        set(true);
      });
      for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, () => set(false));
    };
    hold('gas', (on) => (this.touch.throttle = on ? 1 : 0));
    hold('brake', (on) => (this.touch.brake = on ? 1 : 0));
    hold('hand', (on) => (this.touch.handbrake = on));
    const stick = root.querySelector<HTMLElement>('#stick');
    if (!stick) return;
    const knob = stick.querySelector<HTMLElement>('.knob')!;
    const move = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect();
      const v = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
      this.touch.steer = v;
      knob.style.transform = `translateX(${v * (r.width / 2 - 28)}px)`;
    };
    stick.addEventListener('pointerdown', (e) => {
      stick.setPointerCapture(e.pointerId);
      move(e);
    });
    stick.addEventListener('pointermove', (e) => {
      if (stick.hasPointerCapture(e.pointerId)) move(e);
    });
    for (const ev of ['pointerup', 'pointercancel']) {
      stick.addEventListener(ev, () => {
        this.touch.steer = 0;
        knob.style.transform = '';
      });
    }
  }
}
