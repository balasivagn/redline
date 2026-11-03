import type { Rect } from '../core/schema';

/** Crop box in device pixels, clamped to the captured bitmap. */
export function computeCropBox(rect: Rect, dpr: number, bitmapW: number, bitmapH: number) {
  const sx = Math.min(Math.max(0, Math.round(rect.x * dpr)), Math.max(0, bitmapW - 1));
  const sy = Math.min(Math.max(0, Math.round(rect.y * dpr)), Math.max(0, bitmapH - 1));
  const sw = Math.max(1, Math.min(Math.round(rect.width * dpr), bitmapW - sx));
  const sh = Math.max(1, Math.min(Math.round(rect.height * dpr), bitmapH - sy));
  return { sx, sy, sw, sh };
}

export const SHOT_PADDING_CSS_PX = 60;
export const SHOT_MAX_SIDE = 1600;
export const SHOT_OUTLINE_CSS_PX = 2;
export const SHOT_OUTLINE_COLOR = '#e5484d';

export interface CropPlan {
  /** Source box in device pixels of the captured bitmap. */
  src: { sx: number; sy: number; sw: number; sh: number };
  /** The original rect inside the (unscaled) crop, device pixels. */
  outline: { x: number; y: number; width: number; height: number };
  /** Output factor (≤ 1) that brings the longest side to `maxSide`. */
  scale: number;
  /** Final image size in pixels. */
  width: number;
  height: number;
  /** Outline stroke width in final-image pixels (2 CSS px × dpr × scale, at least 1). */
  lineWidth: number;
}

/**
 * Crop-with-context geometry. `rect` is in viewport CSS px; the crop adds `padding` CSS px on
 * every side (clamped to the viewport), is taken at `dpr`, and is scaled down so the longest
 * side is ≤ `maxSide`. The original rect is reported (in crop pixels) for the outline.
 */
export function computeCropPlan(
  rect: Rect,
  dpr: number,
  bitmapW: number,
  bitmapH: number,
  opts: { padding?: number; maxSide?: number } = {},
): CropPlan {
  const padding = opts.padding ?? SHOT_PADDING_CSS_PX;
  const maxSide = opts.maxSide ?? SHOT_MAX_SIDE;
  const vw = bitmapW / dpr;
  const vh = bitmapH / dpr;
  // The element itself, kept inside the viewport.
  const ex0 = Math.min(Math.max(rect.x, 0), vw);
  const ey0 = Math.min(Math.max(rect.y, 0), vh);
  const ex1 = Math.min(Math.max(rect.x + rect.width, 0), vw);
  const ey1 = Math.min(Math.max(rect.y + rect.height, 0), vh);
  const padded = {
    x: Math.max(0, ex0 - padding),
    y: Math.max(0, ey0 - padding),
    width: Math.min(vw, ex1 + padding) - Math.max(0, ex0 - padding),
    height: Math.min(vh, ey1 + padding) - Math.max(0, ey0 - padding),
  };
  const src = computeCropBox(padded, dpr, bitmapW, bitmapH);
  const ox = Math.round(ex0 * dpr) - src.sx;
  const oy = Math.round(ey0 * dpr) - src.sy;
  const outline = {
    x: ox,
    y: oy,
    width: Math.max(1, Math.round((ex1 - ex0) * dpr)),
    height: Math.max(1, Math.round((ey1 - ey0) * dpr)),
  };
  const scale = Math.min(1, maxSide / Math.max(src.sw, src.sh));
  return {
    src,
    outline,
    scale,
    width: Math.max(1, Math.round(src.sw * scale)),
    height: Math.max(1, Math.round(src.sh * scale)),
    lineWidth: Math.max(1, SHOT_OUTLINE_CSS_PX * dpr * scale),
  };
}

/**
 * Crop a captured PNG data URL around `rect` (viewport CSS px) with 60 px of context, outline the
 * original rect in red, and cap the longest side at 1600 px. Runs in the service worker.
 */
export async function cropDataUrl(dataUrl: string, rect: Rect, dpr: number): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  try {
    const plan = computeCropPlan(rect, dpr, bitmap.width, bitmap.height);
    const { sx, sy, sw, sh } = plan.src;
    const canvas = new OffscreenCanvas(plan.width, plan.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create a canvas for the screenshot.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, plan.width, plan.height);
    // Outline just outside the element so its own edge stays visible.
    const half = plan.lineWidth / 2;
    ctx.strokeStyle = SHOT_OUTLINE_COLOR;
    ctx.lineWidth = plan.lineWidth;
    ctx.strokeRect(
      plan.outline.x * plan.scale - half,
      plan.outline.y * plan.scale - half,
      plan.outline.width * plan.scale + plan.lineWidth,
      plan.outline.height * plan.scale + plan.lineWidth,
    );
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return { blob, width: plan.width, height: plan.height };
  } finally {
    bitmap.close();
  }
}

const QUOTA_RE = /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|quota/i;

/** Serialises captureVisibleTab calls (≈2/s quota): spaces them out and retries once on quota errors. */
export function createCaptureQueue(opts: {
  capture: (windowId: number) => Promise<string>;
  minGapMs?: number;
  retryDelayMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}) {
  const gap = opts.minGapMs ?? 550;
  const retryDelay = opts.retryDelayMs ?? 1100;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  let last = -Infinity;
  let chain: Promise<unknown> = Promise.resolve();

  async function once(windowId: number): Promise<string> {
    const wait = last + gap - now();
    if (wait > 0) await sleep(wait);
    last = now();
    try {
      return await opts.capture(windowId);
    } finally {
      last = now();
    }
  }

  return function capture(windowId: number): Promise<string> {
    const run = chain.then(async () => {
      try {
        return await once(windowId);
      } catch (e) {
        if (!QUOTA_RE.test(e instanceof Error ? e.message : String(e))) throw e;
        await sleep(retryDelay);
        return once(windowId);
      }
    });
    chain = run.catch(() => undefined);
    return run;
  };
}

export function createVisibleTabCapturer() {
  return createCaptureQueue({
    capture: (windowId) => chrome.tabs.captureVisibleTab(windowId, { format: 'png' }),
  });
}
