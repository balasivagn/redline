import { describe, expect, it } from 'vitest';
import { computeCropBox, computeCropPlan, createCaptureQueue } from './screenshots';

describe('computeCropBox', () => {
  it('scales by dpr', () => {
    expect(computeCropBox({ x: 10, y: 20, width: 100, height: 50 }, 2, 2000, 1000)).toEqual({ sx: 20, sy: 40, sw: 200, sh: 100 });
  });
  it('clamps to the bitmap', () => {
    expect(computeCropBox({ x: -5, y: 90, width: 500, height: 500 }, 1, 300, 100)).toEqual({ sx: 0, sy: 90, sw: 300, sh: 10 });
    expect(computeCropBox({ x: 1000, y: 1000, width: 10, height: 10 }, 1, 100, 100)).toEqual({ sx: 99, sy: 99, sw: 1, sh: 1 });
  });
});

describe('computeCropPlan', () => {
  it('adds 60 CSS px of padding on every side and works at dpr', () => {
    const p = computeCropPlan({ x: 200, y: 300, width: 100, height: 50 }, 2, 2560, 1720);
    expect(p.src).toEqual({ sx: 280, sy: 480, sw: 440, sh: 340 }); // (200-60)*2 .. (300+60)*2
    expect(p.outline).toEqual({ x: 120, y: 120, width: 200, height: 100 });
    expect(p.scale).toBe(1);
    expect([p.width, p.height]).toEqual([440, 340]);
    expect(p.lineWidth).toBe(4); // 2 px × dpr
  });

  it('clamps the padding to the viewport edges and keeps the outline on the element', () => {
    const p = computeCropPlan({ x: 10, y: 20, width: 100, height: 100 }, 1, 1280, 860);
    expect(p.src).toEqual({ sx: 0, sy: 0, sw: 170, sh: 180 });
    expect(p.outline).toEqual({ x: 10, y: 20, width: 100, height: 100 });
    const q = computeCropPlan({ x: 1200, y: 800, width: 80, height: 60 }, 1, 1280, 860);
    expect(q.src).toEqual({ sx: 1140, sy: 740, sw: 140, sh: 120 });
    expect(q.outline).toEqual({ x: 60, y: 60, width: 80, height: 60 });
  });

  it('clips a rect that hangs outside the viewport', () => {
    const p = computeCropPlan({ x: -50, y: 800, width: 200, height: 200 }, 1, 1280, 860);
    expect(p.src).toEqual({ sx: 0, sy: 740, sw: 210, sh: 120 });
    expect(p.outline).toEqual({ x: 0, y: 60, width: 150, height: 60 });
  });

  it('scales down so the longest side is at most 1600 px (outline scales with it)', () => {
    const p = computeCropPlan({ x: 0, y: 0, width: 1280, height: 400 }, 2, 2560, 1720);
    expect(p.src.sw).toBe(2560);
    expect(p.scale).toBeCloseTo(1600 / 2560);
    expect(p.width).toBe(1600);
    expect(p.height).toBe(Math.round(p.src.sh * p.scale));
    expect(Math.max(p.width, p.height)).toBeLessThanOrEqual(1600);
    expect(p.lineWidth).toBeCloseTo(4 * p.scale);
  });
});

describe('capture queue', () => {
  it('spaces calls and retries once on quota errors', async () => {
    let t = 0;
    const sleeps: number[] = [];
    let calls = 0;
    const capture = createCaptureQueue({
      now: () => t,
      sleep: async (ms) => { sleeps.push(ms); t += ms; },
      capture: async () => {
        calls++;
        if (calls === 2) throw new Error('This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.');
        return `data:${calls}`;
      },
    });
    expect(await capture(1)).toBe('data:1');
    expect(await capture(1)).toBe('data:3'); // 2nd attempt hit quota, retried
    expect(calls).toBe(3);
    expect(sleeps.some((s) => s >= 1000)).toBe(true);
  });

  it('does not retry other errors and keeps the queue alive', async () => {
    let calls = 0;
    const capture = createCaptureQueue({
      minGapMs: 0,
      capture: async () => { calls++; if (calls === 1) throw new Error('No window'); return 'ok'; },
    });
    await expect(capture(1)).rejects.toThrow('No window');
    expect(await capture(1)).toBe('ok');
    expect(calls).toBe(2);
  });
});
