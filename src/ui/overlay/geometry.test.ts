import { describe, expect, it } from 'vitest';
import { clampRectToViewport, cornerStyle, isBigEnough, normalizeRect, positionCommentBox, snapCorner } from './geometry';

const vp = { width: 1000, height: 800 };

describe('snapCorner', () => {
  it('picks the nearest corner', () => {
    expect(snapCorner({ x: 900, y: 700 }, vp)).toBe('br');
    expect(snapCorner({ x: 100, y: 700 }, vp)).toBe('bl');
    expect(snapCorner({ x: 900, y: 50 }, vp)).toBe('tr');
    expect(snapCorner({ x: 10, y: 10 }, vp)).toBe('tl');
  });
  it('treats the exact centre as bottom-right', () => {
    expect(snapCorner({ x: 500, y: 400 }, vp)).toBe('br');
  });
});

describe('cornerStyle', () => {
  it('maps corners to fixed offsets and shifts right-side corners for the drawer', () => {
    expect(cornerStyle('br')).toEqual({ bottom: 16, right: 16 });
    expect(cornerStyle('tl')).toEqual({ top: 16, left: 16 });
    expect(cornerStyle('tr', 16, 380)).toEqual({ top: 16, right: 396 });
    expect(cornerStyle('bl', 16, 380)).toEqual({ bottom: 16, left: 16 });
  });
});

describe('positionCommentBox', () => {
  const box = { width: 400, height: 200 };
  it('goes below the anchor when there is room, left-aligned', () => {
    const p = positionCommentBox({ x: 100, y: 100, width: 200, height: 100 }, box, vp);
    expect(p).toEqual({ left: 100, top: 210, placement: 'below' });
  });
  it('flips above when there is no room below', () => {
    const p = positionCommentBox({ x: 100, y: 600, width: 200, height: 100 }, box, vp);
    expect(p.placement).toBe('above');
    expect(p.top).toBe(600 - 10 - 200);
  });
  it('keeps the box inside the viewport horizontally', () => {
    expect(positionCommentBox({ x: 900, y: 100, width: 80, height: 40 }, box, vp).left).toBe(1000 - 400 - 8);
    expect(positionCommentBox({ x: -50, y: 100, width: 80, height: 40 }, box, vp).left).toBe(8);
  });
  it('falls back to inside placement for viewport-sized anchors', () => {
    const p = positionCommentBox({ x: 0, y: 0, width: 1000, height: 800 }, box, vp);
    expect(p.placement).toBe('inside');
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.top + box.height).toBeLessThanOrEqual(800 - 8);
  });
  it('uses the visible part of a partly off-screen anchor', () => {
    const p = positionCommentBox({ x: 100, y: -500, width: 200, height: 540 }, box, vp);
    expect(p.placement).toBe('below');
    expect(p.top).toBe(40 + 10);
  });
  it('centres on the viewport when the anchor is fully off-screen', () => {
    const p = positionCommentBox({ x: 100, y: 5000, width: 50, height: 50 }, box, vp);
    expect(p.top + box.height).toBeLessThanOrEqual(800);
    expect(p.top).toBeGreaterThanOrEqual(0);
  });
  it('never returns negative coordinates for tiny viewports', () => {
    const p = positionCommentBox({ x: 0, y: 0, width: 10, height: 10 }, box, { width: 300, height: 150 });
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.top).toBeGreaterThanOrEqual(8);
  });
});

describe('rect helpers', () => {
  it('clamps to the viewport and returns null when nothing is visible', () => {
    expect(clampRectToViewport({ x: -10, y: -10, width: 50, height: 50 }, vp)).toEqual({ x: 0, y: 0, width: 40, height: 40 });
    expect(clampRectToViewport({ x: 2000, y: 0, width: 50, height: 50 }, vp)).toBeNull();
  });
  it('normalizes a drag in any direction and enforces the 8x8 minimum', () => {
    const r = normalizeRect({ x: 50, y: 60 }, { x: 10, y: 20 });
    expect(r).toEqual({ x: 10, y: 20, width: 40, height: 40 });
    expect(isBigEnough({ x: 0, y: 0, width: 8, height: 8 })).toBe(true);
    expect(isBigEnough({ x: 0, y: 0, width: 7, height: 40 })).toBe(false);
  });
});
