/** Element-picking helpers (no React). */
import type { Rect } from '../../core/schema';
import { rectContains, toRect } from './geometry';

export function isRootish(el: Element): boolean {
  return el === document.documentElement || el === document.body;
}

/** Element under the point, ignoring our own shadow host. */
export function pickAt(x: number, y: number, host: Element | null): Element | null {
  const stack = document.elementsFromPoint?.(x, y) ?? [];
  for (const el of stack) if (el !== host) return el;
  const el = document.elementFromPoint(x, y);
  return el && el !== host ? el : null;
}

/** ↑ : parent (never above <body>). */
export function parentOf(el: Element): Element | null {
  const p = el.parentElement;
  return p && !isRootish(p) ? p : null;
}

/** ↓ : child under/near the point, else the first element child. */
export function childToward(el: Element, x: number, y: number): Element | null {
  const kids = Array.from(el.children);
  if (kids.length === 0) return null;
  const hit = kids.find((k) => {
    const r = k.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && r.width > 0 && r.height > 0;
  });
  return hit ?? kids[0] ?? null;
}

/** Smallest ancestor-or-self of the element at `start` whose box fully contains `rect`. */
export function containingElement(start: Element | null, rect: Rect): Element | null {
  let el: Element | null = start;
  while (el && !rectContains(toRect(el.getBoundingClientRect()), rect, 2)) el = el.parentElement;
  return el ?? document.body;
}
