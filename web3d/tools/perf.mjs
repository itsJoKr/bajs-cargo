// Performance check: does the game still fit its budgets, and is it no slower than before?
//
//   npm run perf                      budgets + timings against your saved baseline
//   npm run perf -- --save            this run becomes your machine's baseline (.perf-baseline.json)
//   npm run perf -- --no-timing       budgets only (any machine, CI with software GL)
//   npm run perf -- --shots out/      also save the six views as PNGs, for eyeballing a change
//   npm run perf -- --update-budget   rewrite perf-budget.json from this run (+15% headroom; maintainers)
//   [--url http://localhost:5180/]    the dev server (or a `vite preview`) must be up
//
// Two kinds of numbers. BUDGETS are the same on every machine: draw calls and triangles from six fixed
// cameras, shader programs, meshes, GPU memory (counted from the WebGL upload calls themselves, compressed
// textures at 1 byte a pixel whatever this GPU transcodes them to), and two
// counts that must stay 0 (materials re-resolved every frame; one material on instanced and plain meshes,
// see .claude/rules/zagreb-web.md "Frame rate"). They live in perf-budget.json, committed: going over
// fails, and raising one is a decision a pull request has to argue. TIMINGS depend on the machine: frames
// a second riding from the spawn into the square with vsync off, and with the CPU slowed 4x (a cheap
// laptop). They are compared with your own baseline only; more than 15% slower fails (20% for the
// slow CPU, which wanders more).
//
// Exit code 1 when anything fails. Chrome: $CHROME, else the usual macOS / Linux install.

import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const budgetPath = join(here, '..', 'perf-budget.json');
const baselinePath = join(here, '..', '.perf-baseline.json');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const url = option('--url', 'http://localhost:5180/');
const shots = option('--shots', null);
const timing = !flag('--no-timing');
const SLOWER = 0.85; // fps under 85% of the baseline fails
const SLOWER_CPU = 0.8; // the throttled ride wanders more (+-10%)
const HEADROOM = 1.15; // --update-budget: 15% over this run

/** Fixed cameras, web frame (eye, target); null = the chase camera at the spawn. */
const VIEWS = {
  chase: null,
  square: [[-100, 2.2, -2], [30, 7, -18]],
  ilica: [[-300, 2.2, -9], [-110, 5, -9]],
  cathedral: [[105, 2.2, -150], [180, 38, -167]],
  overview: [[-230, 230, 330], [10, 0, -20]],
  roof: [[40, 45, 60], [0, 0, -60]],
};

// Counts the bytes the page hands WebGL for textures and buffers, per object and mip level, so
// re-uploads replace and deletions subtract: the GPU memory the content takes, whatever made it.
const GPU_COUNTER = `(() => {
  // Bytes a pixel. Compressed formats count 1 whatever the GPU transcodes a KTX2 to (0.5 for ETC1/BC1,
  // 1 for BC7/ASTC), so the number is the same on every machine.
  const BPP = { 0x8058: 4, 0x8C43: 4, 0x8051: 4, 0x8C41: 4, 0x1908: 4, 0x1907: 4, 0x8229: 1, 0x1903: 1, 0x1909: 1, 0x822B: 2,
    0x881A: 8, 0x881B: 8, 0x8814: 16, 0x8815: 16, 0x822D: 2, 0x822E: 4, 0x81A5: 2, 0x81A6: 4, 0x8CAC: 4, 0x88F0: 4, 0x1902: 4, 0x84F9: 4 };
  const COMPRESSED = [0x8E8C, 0x8E8D, 0x93B0, 0x93D0, 0x9278, 0x9279, 0x9274, 0x9275, 0x83F0, 0x83F1, 0x83F2, 0x83F3, 0x8C4C, 0x8C4D,
    0x8C4E, 0x8C4F, 0x8DBB, 0x8DBD, 0x8D64, 0x9270, 0x9272];
  for (const f of COMPRESSED) BPP[f] = 1;
  const bpp = (f) => BPP[f] ?? 4;
  const stats = (window.__gpu = { tex: new Map(), buf: new Map() });
  const P = WebGL2RenderingContext.prototype;
  const st = new WeakMap();
  const state = (gl) => { let s = st.get(gl); if (!s) st.set(gl, (s = { unit: 0, tex: new Map(), buf: new Map() })); return s; };
  const boundTex = (gl, target) => {
    const t = target >= 0x8515 && target <= 0x851A ? 0x8513 : target; // cube faces live on the cube binding
    return state(gl).tex.get(state(gl).unit + ':' + t);
  };
  const setTex = (gl, target, key, bytes, shape) => {
    const t = boundTex(gl, target);
    if (!t) return;
    if (shape) (stats.shape ??= new Map()).set(t, shape);
    let m = stats.tex.get(t);
    if (!m) stats.tex.set(t, (m = new Map()));
    m.set(key, bytes);
  };
  const wrap = (name, after) => {
    const f = P[name];
    P[name] = function (...a) { const r = f.apply(this, a); try { after(this, a); } catch {} return r; };
  };
  wrap('activeTexture', (gl, [u]) => (state(gl).unit = u - 0x84C0));
  wrap('bindTexture', (gl, [target, t]) => state(gl).tex.set(state(gl).unit + ':' + target, t));
  wrap('deleteTexture', (gl, [t]) => stats.tex.delete(t));
  const size = (s) => [s.width ?? s.videoWidth ?? 0, s.height ?? s.videoHeight ?? 0];
  wrap('texImage2D', (gl, a) => {
    const [w, h] = a.length === 6 ? size(a[5]) : [a[3], a[4]];
    setTex(gl, a[0], a[0] + ':' + a[1], w * h * bpp(a[2]), a[1] === 0 && w + 'x' + h);
  });
  wrap('texImage3D', (gl, a) => setTex(gl, a[0], a[1], a[3] * a[4] * a[5] * bpp(a[2]), a[1] === 0 && a[3] + 'x' + a[4] + 'x' + a[5]));
  wrap('compressedTexImage2D', (gl, a) => setTex(gl, a[0], a[0] + ':' + a[1], a[3] * a[4], a[1] === 0 && a[3] + 'x' + a[4]));
  wrap('compressedTexImage3D', (gl, a) => setTex(gl, a[0], a[1], a[3] * a[4] * a[5], a[1] === 0 && a[3] + 'x' + a[4] + 'x' + a[5]));
  const storage = (levels, w, h, d, f) => { let b = 0; for (let l = 0; l < levels; l++) b += Math.max(1, w >> l) * Math.max(1, h >> l) * d * bpp(f); return b; };
  wrap('texStorage2D', (gl, a) => setTex(gl, a[0], 'storage', storage(a[1], a[3], a[4], a[0] === 0x8513 ? 6 : 1, a[2]), a[3] + 'x' + a[4]));
  wrap('texStorage3D', (gl, a) => setTex(gl, a[0], 'storage', storage(a[1], a[3], a[4], a[5], a[2]), a[3] + 'x' + a[4] + 'x' + a[5]));
  wrap('bindBuffer', (gl, [target, b]) => state(gl).buf.set(target, b));
  wrap('deleteBuffer', (gl, [b]) => stats.buf.delete(b));
  wrap('bufferData', (gl, a) => {
    const b = state(gl).buf.get(a[0]);
    if (b) stats.buf.set(b, typeof a[1] === 'number' ? a[1] : a[1]?.byteLength ?? 0);
  });
})();`;

// Measured in the page once the game is up: every view, the scene, the invariants.
const MEASURE = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const views = ${JSON.stringify(VIEWS)};
  const out = { views: {} };
  for (const [name, v] of Object.entries(views)) {
    if (v) zg.look(v[0], v[1], 62); else zg.drive();
    await sleep(500);
    const b = zg.bench(2);
    out.views[name] = { calls: b.calls, triangles: +(b.triangles / 1e6).toFixed(3) };
  }
  zg.drive();
  // The scene as built.
  let meshes = 0;
  const mats = new Map();
  zg.scene.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!mats.has(m)) mats.set(m, new Set());
      mats.get(m).add(o.isInstancedMesh ? 'inst' : 'mesh');
    }
  });
  out.meshes = meshes;
  out.materials = mats.size;
  out.sharedInstancedMaterials = [...mats.values()].filter((s) => s.size > 1).length;
  // Materials flagged needsUpdate while the game runs (each one is a program lookup a frame).
  const before = new Map([...mats.keys()].map((m) => [m, m.version]));
  await sleep(1000);
  out.perFrameMaterialUpdates = [...mats.keys()].filter((m) => m.version - before.get(m) > 10).length;
  out.programs = zg.renderer.info.programs.length;
  const sum = (m) => [...m.values()].reduce((a, v) => a + (typeof v === 'number' ? v : [...v.values()].reduce((x, y) => x + y, 0)), 0);
  out.textureMB = Math.round(sum(window.__gpu.tex) / 1e6);
  const g = window.__gpu;
  out.largestTextures = [...g.tex].map(([t, m]) => [g.shape?.get(t) ?? '?', [...m.values()].reduce((a, b) => a + b, 0)])
    .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([s, b]) => s + ' ' + Math.round(b / 1e6) + ' MB');
  out.bufferMB = Math.round(sum(window.__gpu.buf) / 1e6);
  return out;
})()`;

// ---------------------------------------------------------------------------------------------- Chrome

function findChrome() {
  const candidates = [
    process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  try {
    return execSync('command -v google-chrome chromium chromium-browser | head -1').toString().trim();
  } catch {
    throw new Error('no Chrome found: set CHROME=/path/to/chrome');
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [W, H] = [1920, 1080];
const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'zg-perf-'));
const chrome = spawn(findChrome(), [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`,
  ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
  '--enable-gpu',
  '--ignore-gpu-blocklist',
  '--enable-unsafe-swiftshader',
  '--disable-gpu-vsync',
  '--disable-frame-rate-limit',
  '--no-first-run',
  'about:blank',
], { stdio: 'ignore' });
const chromeExited = new Promise((r) => chrome.once('exit', r));
process.on('exit', () => {
  chrome.kill();
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  } catch {}
});

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
  } catch {}
}
if (!target) throw new Error('Chrome did not start');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
let readyMs = null, failed = null;
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    const m = text.match(/\[zg\] (\d+) ms: (Ready|Failed.*)/);
    if (m && m[2] === 'Ready') readyMs = Number(m[1]);
    else if (m) failed = m[2];
  } else if (msg.method === 'Runtime.exceptionThrown') {
    failed ??= msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text;
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed');
  return r.result?.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');
const metrics = { width: W, height: H, deviceScaleFactor: 1, mobile: false, screenWidth: W, screenHeight: H };
await send('Emulation.setDeviceMetricsOverride', metrics);
await send('Emulation.setFocusEmulationEnabled', { enabled: true }); // the game pauses without focus
await send('Page.addScriptToEvaluateOnNewDocument', { source: GPU_COUNTER });
const page = new URL(url);
page.searchParams.set('dpr', '1');
await send('Page.navigate', { url: page.href });
const start = Date.now();
while (readyMs === null && !failed && Date.now() - start < 180_000) await sleep(250);
if (readyMs === null) {
  console.error(`The game did not start: ${failed ?? 'timed out'} (is the dev server up at ${url}?)`);
  process.exit(1);
}
await send('Emulation.setDeviceMetricsOverride', metrics);
await sleep(1500);

// ---------------------------------------------------------------------------------------------- measure

const run = await evaluate(MEASURE);
if (shots) {
  mkdirSync(shots, { recursive: true });
  for (const [name, v] of Object.entries(VIEWS)) {
    await evaluate(v ? `zg.look(${JSON.stringify(v[0])}, ${JSON.stringify(v[1])}, 62)` : 'zg.drive()');
    await sleep(800);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(shots, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  }
  await evaluate('zg.drive()');
}
if (timing) {
  // The slow CPU first, from the untouched start (the noisier of the two: a second ride meets scattered
  // pigeons and fleeing people), then the full-speed one from the spawn again.
  run.load = readyMs;
  await send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await sleep(1500);
  run.fpsSlowCpu = await evaluate('zg.fps(10)');
  await send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await evaluate('zg.teleport(-70, -6, Math.PI / 2)');
  await sleep(1000);
  run.fps = await evaluate('zg.fps(8)');
}
ws.close();

// ---------------------------------------------------------------------------------------------- report

const rows = [];
let failures = 0;
const row = (name, value, limit, ok, unit = '') => {
  if (!ok) failures++;
  rows.push([name, `${value}${unit}`, limit === null ? '' : `${limit}${unit}`, ok ? 'ok' : 'OVER']);
};
const flat = {
  ...Object.fromEntries(Object.entries(run.views).flatMap(([v, m]) => [[`${v} calls`, m.calls], [`${v} triangles`, m.triangles]])),
  meshes: run.meshes,
  programs: run.programs,
  textureMB: run.textureMB,
  bufferMB: run.bufferMB,
  perFrameMaterialUpdates: run.perFrameMaterialUpdates,
  sharedInstancedMaterials: run.sharedInstancedMaterials,
};
const units = { textureMB: ' MB', bufferMB: ' MB' };

if (flag('--update-budget')) {
  const budget = Object.fromEntries(
    Object.entries(flat).map(([k, v]) => [k, v === 0 ? 0 : k.endsWith('triangles') ? +(v * HEADROOM).toFixed(2) : Math.ceil(v * HEADROOM)]),
  );
  writeFileSync(budgetPath, JSON.stringify(budget, null, 2) + '\n');
  console.log(`wrote ${budgetPath}`);
}
const budget = existsSync(budgetPath) ? JSON.parse(readFileSync(budgetPath, 'utf8')) : {};
for (const [k, v] of Object.entries(flat)) {
  const limit = budget[k] ?? null;
  row(k, v, limit, limit === null || v <= limit, units[k]);
}

if (timing) {
  const base = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : null;
  const fpsRow = (name, now, was, share = SLOWER) => {
    const limit = was ? +(was * share).toFixed(1) : null;
    const ok = limit === null || now >= limit;
    if (!ok) failures++;
    rows.push([name, `${now} fps`, limit === null ? '(no baseline)' : `>= ${limit} fps`, ok ? 'ok' : 'SLOWER']);
  };
  fpsRow('fps, riding', run.fps.fps, base?.fps);
  rows.push(['  frame p50 / p95 / p99', `${run.fps.p50} / ${run.fps.p95} / ${run.fps.p99} ms`, '', '']);
  fpsRow('fps, CPU 4x slower', run.fpsSlowCpu.fps, base?.fpsSlowCpu, SLOWER_CPU);
  rows.push(['  frame p50 / p95 / p99', `${run.fpsSlowCpu.p50} / ${run.fpsSlowCpu.p95} / ${run.fpsSlowCpu.p99} ms`, '', '']);
  rows.push(['load (to Ready)', `${run.load} ms`, '', '']);
  if (flag('--save')) {
    writeFileSync(baselinePath, JSON.stringify({ fps: run.fps.fps, fpsSlowCpu: run.fpsSlowCpu.fps, at: new Date().toISOString() }, null, 2) + '\n');
    rows.push(['', 'baseline saved', '', '']);
  }
}

const widths = [0, 1, 2, 3].map((i) => Math.max(...rows.map((r) => r[i].length), ['metric', 'value', 'budget', ''][i].length));
const line = (r) => r.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('   ');
console.log(line(['metric', 'value', 'budget', '']));
for (const r of rows) console.log(line(r));
console.log(`\nlargest textures: ${run.largestTextures.join(', ')}`);
if (shots) console.log(`views saved in ${shots}`);
console.log(failures ? `\n${failures} over budget or slower` : '\nall within budget');
chrome.kill();
await chromeExited;
process.exit(failures ? 1 : 0);
