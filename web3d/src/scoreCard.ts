// The score as a picture to paste anywhere: the last frame of the ride under the finish card,
// drawn on a 2D canvas, copied to the clipboard (or saved as a file where that is not allowed).

const W = 1200, H = 630;
const BLUE = '#2f6fe0';
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

export interface Score {
  /** The small caps line over the title ("All 8 delivered"). */
  done: string;
  time: string;
  /** "12 pedestrians hit", or null without a crowd. */
  hits: string | null;
}

/** Draws the share picture over [frame], the game canvas. Call it in the same task as the frame's
 * render: WebGL clears its drawing buffer once the frame is on screen. */
export function scoreImage(frame: HTMLCanvasElement, score: Score): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0a1f4a';
  ctx.fillRect(0, 0, W, H);
  // The frame, scaled to cover and cropped round its centre.
  const k = Math.max(W / frame.width, H / frame.height);
  const fw = W / k, fh = H / k;
  if (frame.width > 0 && frame.height > 0) {
    ctx.drawImage(frame, (frame.width - fw) / 2, (frame.height - fh) / 2, fw, fh, 0, 0, W, H);
  }
  ctx.fillStyle = '#0a1f4a59';
  ctx.fillRect(0, 0, W, H);

  const cw = 560, ch = score.hits ? 360 : 310;
  const cx = (W - cw) / 2, cy = (H - ch) / 2;
  ctx.save();
  ctx.shadowColor = '#0006';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = BLUE;
  ctx.beginPath();
  ctx.roundRect(cx, cy, cw, ch, 28);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  let y = cy + 62;
  ctx.globalAlpha = 0.85;
  ctx.font = `600 22px ${FONT}`;
  ctx.letterSpacing = '2px';
  ctx.fillText(score.done.toUpperCase(), W / 2, y);
  ctx.letterSpacing = '0px';
  ctx.globalAlpha = 1;

  // "Bajs" heavy italic, "Cargo" regular, centred as one line.
  y += 74;
  ctx.textAlign = 'left';
  const bold = `italic 800 64px ${FONT}`, light = `400 64px ${FONT}`;
  ctx.font = bold;
  const a = ctx.measureText('Bajs ').width;
  ctx.font = light;
  const b = ctx.measureText('Cargo').width;
  let x = (W - a - b) / 2;
  ctx.font = bold;
  ctx.fillText('Bajs ', x, y);
  x += a;
  ctx.font = light;
  ctx.fillText('Cargo', x, y);
  ctx.textAlign = 'center';

  y += 86;
  ctx.font = `700 56px ${FONT}`;
  ctx.fillText(score.time, W / 2, y);
  if (score.hits) {
    y += 54;
    ctx.globalAlpha = 0.9;
    ctx.font = `500 28px ${FONT}`;
    ctx.fillText(score.hits, W / 2, y);
    ctx.globalAlpha = 1;
  }
  ctx.globalAlpha = 0.75;
  ctx.font = `500 20px ${FONT}`;
  ctx.fillText('Zagreb', W / 2, cy + ch - 28);
  ctx.globalAlpha = 1;
  return canvas;
}

/** Copies [canvas] to the clipboard as a PNG; where the browser will not, downloads it instead.
 * Call it straight from the click: Safari only lets a ClipboardItem made during the gesture through,
 * so it gets the blob as a promise. */
export async function shareImage(canvas: HTMLCanvasElement): Promise<'copied' | 'saved'> {
  const png = new Promise<Blob>((ok, fail) =>
    canvas.toBlob((b) => (b ? ok(b) : fail(new Error('no PNG'))), 'image/png'),
  );
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return 'copied';
  } catch (e) {
    console.warn('[zg] clipboard refused the score image, saving it instead', e);
    const url = URL.createObjectURL(await png);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bajs-cargo-score.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return 'saved';
  }
}
