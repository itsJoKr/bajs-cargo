// Drives a headless Chrome over the DevTools protocol: loads the game,
// prints its console, runs page scripts and saves screenshots.
//
//   node tools/shot.mjs [--url http://localhost:5180/] [--out shot.png]
//        [--wait-ready 60] [--eval "js"]... [--hold KeyW:3000]...
//        [--size 1280x720] [--dpr 2] [--mobile] [--uncapped] [--throttle 4]
//
// Steps run in order: every --eval, --hold (key held for ms), --throttle
// (CPU slowed n times, a cheap laptop) and --shot <file> (a screenshot at
// that point) is executed as it appears. --uncapped lifts the 60 fps vsync
// cap, so zg.fps() measures what the machine could draw.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
let url = 'http://localhost:5180/';
let size = [1280, 720];
let mobile = false;
let dpr = 1;
let waitReady = 90;
let uncapped = false;
const steps = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--url') url = args[++i];
  else if (a === '--size') size = args[++i].split('x').map(Number);
  else if (a === '--mobile') mobile = true;
  else if (a === '--dpr') dpr = Number(args[++i]);
  else if (a === '--wait-ready') waitReady = Number(args[++i]);
  else if (a === '--eval') steps.push({ eval: args[++i] });
  else if (a === '--hold') steps.push({ hold: args[++i] });
  else if (a === '--sleep') steps.push({ sleep: Number(args[++i]) });
  else if (a === '--uncapped') uncapped = true;
  else if (a === '--throttle') steps.push({ throttle: Number(args[++i]) });
  else if (a === '--shot' || a === '--out') steps.push({ shot: args[++i] });
}

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'zg-chrome-'));
const proc = spawn(chrome, [
  '--headless=new',
  // navigator.webdriver: the game skips the lobby's Start button for a driven browser (main.ts).
  '--enable-automation',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  `--window-size=${size[0]},${size[1]}`,
  '--use-angle=metal',
  '--enable-gpu',
  '--ignore-gpu-blocklist',
  '--enable-unsafe-swiftshader',
  '--no-first-run',
  ...(uncapped ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : []),
  'about:blank',
], { stdio: 'ignore' });
// The profile is ~300 MB a run; left in the temp dir it filled the disk.
process.on('exit', () => {
  proc.kill();
  rmSync(profile, { recursive: true, force: true });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    target = list.find((t) => t.type === 'page');
  } catch {}
}
if (!target) throw new Error('no Chrome target');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
let ready = false;
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    console.log(`[console.${msg.params.type}] ${text}`);
    if (text.includes('Ready')) ready = true;
  } else if (msg.method === 'Runtime.exceptionThrown') {
    console.log(`[exception] ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: dpr, mobile, screenWidth: size[0], screenHeight: size[1] });
// A phone: touch only (pointer: coarse), which main.ts turns away with the desktop-only dialog.
if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
// A headless page never has focus, and the game pauses without it (main.ts checkAway).
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.navigate', { url });
const start = Date.now();
while (!ready && Date.now() - start < waitReady * 1000) await sleep(250);
// The override sometimes does not stick through the navigation (the page came up 756x469): again.
await send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: dpr, mobile, screenWidth: size[0], screenHeight: size[1] });
console.log(ready ? `ready after ${((Date.now() - start) / 1000).toFixed(1)} s` : 'NOT ready');

const keyInfo = { KeyW: ['w', 87], KeyS: ['s', 83], KeyA: ['a', 65], KeyD: ['d', 68], Space: [' ', 32], KeyR: ['r', 82], KeyH: ['h', 72], KeyM: ['m', 77], KeyB: ['b', 66] };
for (const step of steps) {
  if (step.eval) {
    const r = await send('Runtime.evaluate', { expression: step.eval, awaitPromise: true, returnByValue: true });
    console.log(`[eval] ${JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description)}`);
  } else if (step.sleep) {
    await sleep(step.sleep);
  } else if (step.throttle) {
    await send('Emulation.setCPUThrottlingRate', { rate: step.throttle });
  } else if (step.hold) {
    const [keys, ms] = step.hold.split(':');
    const codes = keys.split('+');
    for (const code of codes) {
      const [key, vk] = keyInfo[code];
      await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode: vk });
    }
    await sleep(Number(ms));
    for (const code of codes) {
      const [key, vk] = keyInfo[code];
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: vk });
    }
  } else if (step.shot) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(step.shot, Buffer.from(r.result.data, 'base64'));
    console.log(`saved ${step.shot}`);
  }
}
ws.close();
proc.kill();
await new Promise((r) => proc.once('exit', r));
process.exit(0);
