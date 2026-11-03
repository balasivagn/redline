import type { Anchor, Rect } from '../schema';
import { collapseWhitespace, isRedlineUi } from './stable';
import { uniqueSelector } from './selector';
import { resolveXpath, xpathFor } from './xpath';

export { uniqueSelector };

export type AnchorInput =
  | { kind: 'pin'; element: Element; clientPoint: { x: number; y: number } }
  | { kind: 'area'; clientRect: Rect };

export type ResolvedAnchor =
  | { status: 'attached'; element: Element; clientPoint: { x: number; y: number }; clientRect?: Rect }
  | { status: 'detached'; clientPoint: { x: number; y: number }; clientRect?: Rect };

const EPS = 1;
const TEXT_HINT_LEN = 60;
const MAX_TEXT_CANDIDATES = 3000;

function scrollOf(doc: Document): { x: number; y: number } {
  const win = doc.defaultView;
  return { x: win?.scrollX ?? 0, y: win?.scrollY ?? 0 };
}

function boxOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

function ratio(value: number, size: number): number {
  return size > 0 ? value / size : 0;
}

function textOf(el: Element): string {
  return collapseWhitespace(el.textContent ?? '').slice(0, TEXT_HINT_LEN);
}

function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    outer.x <= inner.x + EPS &&
    outer.y <= inner.y + EPS &&
    outer.x + outer.width >= inner.x + inner.width - EPS &&
    outer.y + outer.height >= inner.y + inner.height - EPS
  );
}

function elementsAt(doc: Document, x: number, y: number): Element[] {
  if (typeof doc.elementsFromPoint === 'function') return doc.elementsFromPoint(x, y);
  const one = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(x, y) : null;
  return one ? [one] : [];
}

/** Smallest element (not Redline UI, not <html>) whose box fully contains `rect`. */
function smallestContainer(rect: Rect, doc: Document): Element {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const fallback = doc.body ?? doc.documentElement;
  const start = elementsAt(doc, cx, cy).find((e) => !isRedlineUi(e) && e !== doc.documentElement);
  let cur: Element | null = start ?? null;
  while (cur && cur !== doc.documentElement) {
    if (!isRedlineUi(cur) && containsRect(boxOf(cur), rect)) return cur;
    cur = cur.parentElement;
  }
  return fallback;
}

/** Build a persistent anchor. For areas, picks the smallest element that fully contains the box. */
export function buildAnchor(input: AnchorInput, doc: Document = document): { anchor: Anchor; element: Element } {
  const scroll = scrollOf(doc);

  if (input.kind === 'pin') {
    const element = input.element;
    const box = boxOf(element);
    const text = textOf(element);
    return {
      element,
      anchor: {
        kind: 'pin',
        selector: uniqueSelector(element),
        xpath: xpathFor(element),
        textHint: text ? `${element.localName}|${text}` : undefined,
        offset: {
          xRatio: ratio(input.clientPoint.x - box.x, box.width),
          yRatio: ratio(input.clientPoint.y - box.y, box.height),
        },
        pagePoint: { x: input.clientPoint.x + scroll.x, y: input.clientPoint.y + scroll.y },
      },
    };
  }

  const rect = input.clientRect;
  const element = smallestContainer(rect, doc);
  const box = boxOf(element);
  const text = textOf(element);
  const pageRect: Rect = { x: rect.x + scroll.x, y: rect.y + scroll.y, width: rect.width, height: rect.height };
  return {
    element,
    anchor: {
      kind: 'area',
      selector: uniqueSelector(element),
      xpath: xpathFor(element),
      textHint: text ? `${element.localName}|${text}` : undefined,
      offset: { xRatio: ratio(rect.x - box.x, box.width), yRatio: ratio(rect.y - box.y, box.height) },
      areaRatio: {
        x: ratio(rect.x - box.x, box.width),
        y: ratio(rect.y - box.y, box.height),
        width: ratio(rect.width, box.width),
        height: ratio(rect.height, box.height),
      },
      pagePoint: { x: pageRect.x, y: pageRect.y },
      pageRect,
    },
  };
}

function bySelector(selector: string, doc: Document): Element | null {
  try {
    const found = doc.querySelectorAll(selector);
    const el = found.length === 1 ? found[0]! : null;
    return el && !isRedlineUi(el) ? el : null;
  } catch {
    return null;
  }
}

function byTextHint(anchor: Anchor, doc: Document): Element | null {
  const hint = anchor.textHint;
  if (!hint) return null;
  const sep = hint.indexOf('|');
  if (sep <= 0) return null;
  const tag = hint.slice(0, sep);
  const text = hint.slice(sep + 1);
  if (!text) return null;

  let list: Element[];
  try {
    list = Array.from(doc.querySelectorAll(tag)).slice(0, MAX_TEXT_CANDIDATES);
  } catch {
    return null;
  }
  const matches = list.filter((e) => !isRedlineUi(e) && textOf(e) === text);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0]!;

  // Ambiguous: pick the candidate nearest to where the annotation was originally placed.
  const scroll = scrollOf(doc);
  const px = anchor.pagePoint.x - scroll.x;
  const py = anchor.pagePoint.y - scroll.y;
  let best = matches[0]!;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const m of matches) {
    const b = boxOf(m);
    const d = Math.hypot(b.x + b.width / 2 - px, b.y + b.height / 2 - py);
    if (d < bestDist) {
      best = m;
      bestDist = d;
    }
  }
  return best;
}

/** Re-find an anchor on the current DOM: selector → xpath → textHint → stored page coords. */
export function resolveAnchor(anchor: Anchor, doc: Document = document): ResolvedAnchor {
  const element =
    bySelector(anchor.selector, doc) ??
    (() => {
      const x = resolveXpath(anchor.xpath, doc);
      return x && !isRedlineUi(x) ? x : null;
    })() ??
    byTextHint(anchor, doc);

  if (element) {
    const box = boxOf(element);
    const clientPoint = {
      x: box.x + anchor.offset.xRatio * box.width,
      y: box.y + anchor.offset.yRatio * box.height,
    };
    const ar = anchor.areaRatio;
    const clientRect: Rect | undefined = ar
      ? {
          x: box.x + ar.x * box.width,
          y: box.y + ar.y * box.height,
          width: ar.width * box.width,
          height: ar.height * box.height,
        }
      : undefined;
    return { status: 'attached', element, clientPoint, ...(clientRect ? { clientRect } : {}) };
  }

  const scroll = scrollOf(doc);
  const pr = anchor.pageRect;
  return {
    status: 'detached',
    clientPoint: { x: anchor.pagePoint.x - scroll.x, y: anchor.pagePoint.y - scroll.y },
    ...(pr ? { clientRect: { x: pr.x - scroll.x, y: pr.y - scroll.y, width: pr.width, height: pr.height } } : {}),
  };
}
