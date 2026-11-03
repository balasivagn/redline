import { cssAttrValue, cssEscape, isRedlineUi, isStableId, stableClasses, testIdOf } from './stable';

function queryRoot(el: Element): ParentNode {
  const root = el.getRootNode?.();
  return root && 'querySelectorAll' in root ? (root as ParentNode) : el.ownerDocument;
}

function matchesOnly(root: ParentNode, selector: string, el: Element): boolean {
  try {
    const found = root.querySelectorAll(selector);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

function countMatches(root: ParentNode, selector: string): number {
  try {
    return root.querySelectorAll(selector).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function sameTagIndex(el: Element): { index: number; total: number } {
  const parent = el.parentElement;
  if (!parent) return { index: 1, total: 1 };
  let index = 0;
  let total = 0;
  for (const sib of Array.from(parent.children)) {
    if (sib.localName === el.localName) {
      total++;
      if (sib === el) index = total;
    }
  }
  return { index: index || 1, total };
}

/** One path segment for `el`: `#id`, `[data-testid=…]`, or `tag.cls1.cls2[:nth-of-type(n)]`. */
function segmentFor(el: Element, root: ParentNode): { selector: string; global: boolean } {
  const tag = el.localName;
  const id = el.getAttribute('id');
  if (isStableId(id)) {
    const sel = `#${cssEscape(id)}`;
    if (countMatches(root, sel) === 1) return { selector: sel, global: true };
  }
  const tid = testIdOf(el);
  if (tid && !/["\\\n]/.test(tid.value)) {
    const attrSel = `[${tid.attr}="${cssAttrValue(tid.value)}"]`;
    if (countMatches(root, attrSel) === 1) return { selector: attrSel, global: true };
    const withTag = `${tag}${attrSel}`;
    if (countMatches(root, withTag) === 1) return { selector: withTag, global: true };
    return withSiblingIndex(el, withTag);
  }
  const classes = stableClasses(el, 3);
  const base = tag + classes.map((c) => `.${cssEscape(c)}`).join('');
  return withSiblingIndex(el, base);
}

function withSiblingIndex(el: Element, base: string): { selector: string; global: false } {
  const parent = el.parentElement;
  if (parent) {
    let clash = false;
    for (const sib of Array.from(parent.children)) {
      if (sib !== el) {
        try {
          if (sib.matches(base)) {
            clash = true;
            break;
          }
        } catch {
          clash = true;
          break;
        }
      }
    }
    if (clash) {
      const { index, total } = sameTagIndex(el);
      if (total > 1) return { selector: `${base}:nth-of-type(${index})`, global: false };
    }
  }
  return { selector: base, global: false };
}

/** Unique CSS selector, preferring #id, [data-testid], stable classes, then :nth-of-type. */
export function uniqueSelector(el: Element): string {
  const root = queryRoot(el);
  const parts: string[] = [];
  let cur: Element | null = el;
  let last = '';
  while (cur) {
    // Never route a selector through the Redline UI host.
    if (isRedlineUi(cur) && cur !== el) {
      cur = cur.parentElement;
      continue;
    }
    const seg = segmentFor(cur, root);
    parts.unshift(seg.selector);
    last = parts.join(' > ');
    if (matchesOnly(root, last, el)) return last;
    if (seg.global) {
      // A globally-unique ancestor anchors the chain; remaining ambiguity is resolved by
      // continuing down the path we already have, so there is nothing more to climb.
      break;
    }
    cur = cur.parentElement;
  }
  return last;
}
