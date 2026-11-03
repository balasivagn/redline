/** Heuristics for "is this id/class likely to survive a rebuild/re-render?" + small DOM helpers. */

export const REDLINE_UI_TAG = 'redline-ui';

const STATE_CLASS =
  /^(hover|hovered|active|focus|focused|focus-visible|selected|disabled|hidden|open|opened|closed|visible|show|shown|loading|loaded|dragging|current|checked|pressed|expanded|collapsed|error|valid|invalid|in-view|fade|fade-in|fade-out|ng-[a-z-]+|router-link-(active|exact-active))$/i;

/** A trailing `-xxxxx` / `_xxxxx` token mixing letters and digits looks like a content hash. */
function hasHashSuffix(s: string): boolean {
  const m = /[-_]([a-z0-9]{5,})$/i.exec(s);
  if (!m) return false;
  const tok = m[1]!;
  const digits = (tok.match(/\d/g) ?? []).length;
  const letters = (tok.match(/[a-z]/gi) ?? []).length;
  return digits >= 2 && letters >= 2;
}

function looksHashed(s: string): boolean {
  if (/^[a-f0-9]{8,}$/i.test(s) && /\d/.test(s) && /[a-f]/i.test(s)) return true; // hex hash
  if (/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}/i.test(s)) return true; // uuid
  if (/\d{4,}/.test(s)) return true; // long digit run
  return hasHashSuffix(s);
}

export function isStableId(id: string | null | undefined): id is string {
  if (!id || id.length > 64 || /\s/.test(id)) return false;
  if (/^[:«»]/.test(id)) return false; // React useId (":r1:", "«r1»")
  if (/^(ember|radix|headlessui|mui|rc|downshift|react-aria|__next|mat-|cdk-)/i.test(id) && /\d/.test(id)) return false;
  return !looksHashed(id);
}

export function isStableClass(cls: string): boolean {
  if (!cls || cls.length > 48) return false;
  if (/[[\]:/\\!@#%(),.=*]/.test(cls)) return false; // tailwind arbitrary values / variants
  if (/^(css|sc|jsx|svelte|emotion|styled|chakra|astro)-/i.test(cls)) return false;
  if (/^_/.test(cls) && /\d/.test(cls)) return false; // "_a1b2c" style hashes
  if (/^(is|has)-/i.test(cls) || /^redline-/i.test(cls)) return false;
  if (STATE_CLASS.test(cls)) return false;
  return !looksHashed(cls);
}

export function stableClasses(el: Element, max = 3): string[] {
  const out: string[] = [];
  for (const c of Array.from(el.classList ?? [])) {
    if (isStableClass(c)) {
      out.push(c);
      if (out.length >= max) break;
    }
  }
  return out;
}

/** CSS.escape with a minimal fallback for runtimes that lack it. */
export function cssEscape(value: string): string {
  const g = globalThis as { CSS?: { escape?: (s: string) => string } };
  if (g.CSS?.escape) return g.CSS.escape(value);
  return value
    .replace(/[^\w\u00A0-\uFFFF-]/g, '\\$&')
    .replace(/^(-?)(\d)/, (_m, dash: string, d: string) => `${dash}\\3${d} `);
}

export function cssAttrValue(v: string): string {
  return v.replace(/["\\]/g, '\\$&');
}

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function isRedlineUi(el: Element | null | undefined): boolean {
  return !!el && el.localName === REDLINE_UI_TAG;
}

export const TEST_ID_ATTRS = ['data-testid', 'data-test', 'data-qa', 'data-cy'] as const;

export function testIdOf(el: Element): { attr: string; value: string } | undefined {
  for (const attr of TEST_ID_ATTRS) {
    const v = el.getAttribute(attr);
    if (v) return { attr, value: v };
  }
  return undefined;
}
