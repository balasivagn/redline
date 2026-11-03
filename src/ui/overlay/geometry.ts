import type { CSSProperties } from 'react';
import type { Rect } from '../../core/schema';
import type { Corner } from '../../core/settings';

export interface Size {
  width: number;
  height: number;
}

/** Nearest viewport corner for a point (used when a dragged pill is released). */
export function snapCorner(p: { x: number; y: number }, vp: Size): Corner {
  const right = p.x >= vp.width / 2;
  const bottom = p.y >= vp.height / 2;
  return `${bottom ? 'b' : 't'}${right ? 'r' : 'l'}` as Corner;
}

/** Fixed-position style that pins an element to a viewport corner. */
export function cornerStyle(corner: Corner, offset = 16, extraRight = 0): CSSProperties {
  const style: CSSProperties = {};
  if (corner.startsWith('t')) style.top = offset;
  else style.bottom = offset;
  if (corner.endsWith('l')) style.left = offset;
  else style.right = offset + extraRight;
  return style;
}

/** Intersection of a rect with the viewport, or null when nothing is visible. */
export function clampRectToViewport(r: Rect, vp: Size): Rect | null {
  const x1 = Math.max(0, r.x);
  const y1 = Math.max(0, r.y);
  const x2 = Math.min(vp.width, r.x + r.width);
  const y2 = Math.min(vp.height, r.y + r.height);
  if (x2 - x1 < 1 || y2 - y1 < 1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export type Placement = 'below' | 'above' | 'inside';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(v, Math.max(min, max)));
}

/**
 * Where to put a floating box (comment box, hover label) relative to an anchor rect, kept inside
 * the viewport. Prefers below, then above, then inside the anchor's visible part.
 */
export function positionBox(
  anchor: Rect,
  box: Size,
  vp: Size,
  opts: { gap?: number; margin?: number } = {},
): { left: number; top: number; placement: Placement } {
  const gap = opts.gap ?? 10;
  const margin = opts.margin ?? 8;
  const visible = clampRectToViewport(anchor, vp) ?? { x: vp.width / 2, y: vp.height / 2, width: 0, height: 0 };
  const left = clamp(visible.x, margin, vp.width - box.width - margin);
  const belowTop = visible.y + visible.height + gap;
  if (belowTop + box.height <= vp.height - margin) return { left, top: belowTop, placement: 'below' };
  const aboveTop = visible.y - gap - box.height;
  if (aboveTop >= margin) return { left, top: aboveTop, placement: 'above' };
  const top = clamp(visible.y + visible.height - box.height - margin, margin, vp.height - box.height - margin);
  return { left, top, placement: 'inside' };
}

export const positionCommentBox = positionBox;

export function toRect(r: DOMRect | { left: number; top: number; width: number; height: number }): Rect {
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

export function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function rectContains(outer: Rect, inner: Rect, slack = 1): boolean {
  return (
    outer.x <= inner.x + slack &&
    outer.y <= inner.y + slack &&
    outer.x + outer.width >= inner.x + inner.width - slack &&
    outer.y + outer.height >= inner.y + inner.height - slack
  );
}

export const MIN_AREA = 8;
export function isBigEnough(r: Rect): boolean {
  return r.width >= MIN_AREA && r.height >= MIN_AREA;
}
