import { frameworkInfoSchema, type DomSnapshot, type FrameworkInfo, type PageInfo } from '../schema';
import { collapseWhitespace, isRedlineUi, isStableId, stableClasses, testIdOf } from '../anchor/stable';

const TEXT_MAX = 200;
const HTML_MAX = 2048;
const ANCESTOR_MAX = 6;
const CLASS_MAX = 40;

export const PROBE_REQUEST_EVENT = 'redline:probe';
export const PROBE_RESULT_EVENT = 'redline:probe-result';
export const PROBE_ATTR = 'data-redline-probe';
// After a quick (pending) answer the probe may still fetch a module to correct line numbers.
const PROBE_TIMEOUT_MS = 150;
const PROBE_REFINE_MS = 900;

const STYLE_PROPS = [
  'display',
  'position',
  'width',
  'height',
  'margin',
  'padding',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'color',
  'background-color',
  'border',
  'border-radius',
  'gap',
  'flex-direction',
  'justify-content',
  'align-items',
  'z-index',
  'opacity',
] as const;

const FLEX_GRID_ONLY = new Set(['gap', 'flex-direction', 'justify-content', 'align-items']);

function isDefaultish(prop: string, value: string, display: string): boolean {
  switch (prop) {
    case 'position':
      return value === 'static';
    case 'margin':
    case 'padding':
    case 'border-radius':
      return /^0(px)?(\s+0(px)?)*$/.test(value);
    case 'border':
      return /^0(px)?\s+\w+/.test(value) || value.startsWith('none');
    case 'background-color':
      return value === 'rgba(0, 0, 0, 0)' || value === 'transparent';
    case 'line-height':
    case 'gap':
    case 'align-items':
    case 'justify-content':
      return value === 'normal';
    case 'flex-direction':
      return value === 'row' && !display.includes('flex');
    case 'z-index':
      return value === 'auto';
    case 'opacity':
      return value === '1';
    default:
      return false;
  }
}

function curatedStyles(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  const win = el.ownerDocument.defaultView;
  if (!win) return out;
  let cs: CSSStyleDeclaration;
  try {
    cs = win.getComputedStyle(el);
  } catch {
    return out;
  }
  const display = cs.getPropertyValue('display').trim();
  const flexOrGrid = display.includes('flex') || display.includes('grid');
  for (const prop of STYLE_PROPS) {
    if (FLEX_GRID_ONLY.has(prop) && !flexOrGrid) continue;
    const value = cs.getPropertyValue(prop).trim();
    if (!value || value === 'none' || isDefaultish(prop, value, display)) continue;
    out[prop] = value;
  }
  return out;
}

function textOf(el: Element): string {
  const raw = (el as HTMLElement).innerText;
  return collapseWhitespace(typeof raw === 'string' && raw ? raw : (el.textContent ?? ''));
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Synchronous DOM facts (no framework info). */
export function captureDom(el: Element): DomSnapshot {
  const r = el.getBoundingClientRect();
  const id = el.getAttribute('id');
  const role = el.getAttribute('role');
  const ariaLabel = el.getAttribute('aria-label');
  const testId = testIdOf(el)?.value;

  const ancestors: string[] = [];
  const html = el.ownerDocument.documentElement;
  const body = el.ownerDocument.body;
  for (let p = el.parentElement; p && ancestors.length < ANCESTOR_MAX; p = p.parentElement) {
    if (p === html || p === body || isRedlineUi(p)) continue;
    ancestors.push(describeElement(p));
  }

  return {
    tag: el.localName,
    ...(id ? { id } : {}),
    classes: Array.from(el.classList ?? []).slice(0, CLASS_MAX),
    ...(role ? { role } : {}),
    ...(ariaLabel ? { ariaLabel } : {}),
    ...(testId ? { testId } : {}),
    text: truncate(textOf(el), TEXT_MAX),
    outerHTML: truncate(el.outerHTML ?? '', HTML_MAX),
    rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    styles: curatedStyles(el),
    ancestors,
  };
}

export function capturePage(): PageInfo {
  const win = window;
  return {
    url: win.location.href,
    origin: win.location.origin,
    path: win.location.pathname,
    title: document.title,
    viewport: { width: win.innerWidth, height: win.innerHeight, dpr: win.devicePixelRatio || 1 },
    scroll: { x: win.scrollX, y: win.scrollY },
    userAgent: navigator.userAgent,
  };
}

/** Short label for hover UI and lists, e.g. "div.card.card--pro" (max ~3 classes). */
export function describeElement(el: Element): string {
  const tag = el.localName;
  const id = el.getAttribute('id');
  if (isStableId(id)) return `${tag}#${id}`;
  const classes = stableClasses(el, 3);
  return tag + classes.map((c) => `.${c}`).join('');
}

/**
 * Framework/component/source info. The content script runs in Chrome's ISOLATED world and
 * cannot see page expandos (__reactFiber$…, __vueParentComponent), so this asks the MAIN-world
 * probe (src/entrypoints/probe.content.ts) over a DOM CustomEvent bridge. Resolves undefined
 * after ~150 ms if the probe is absent.
 */
export function detectFramework(el: Element): Promise<FrameworkInfo | undefined> {
  const win = el.ownerDocument.defaultView ?? window;
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (value: FrameworkInfo | undefined) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      win.removeEventListener(PROBE_RESULT_EVENT, onResult);
      el.removeAttribute(PROBE_ATTR);
      resolve(value);
    };

    let partial: FrameworkInfo | undefined;
    const onResult = (ev: Event) => {
      try {
        const msg = JSON.parse(String((ev as CustomEvent).detail)) as { id?: string; info?: unknown; pending?: boolean };
        if (msg.id !== id) return;
        const parsed = frameworkInfoSchema.safeParse(msg.info);
        const info = parsed.success ? parsed.data : undefined;
        if (msg.pending) {
          // Quick answer; a refined one (source-mapped line numbers) follows shortly.
          partial = info;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => finish(partial), PROBE_REFINE_MS);
          return;
        }
        finish(info);
      } catch {
        /* not ours */
      }
    };

    win.addEventListener(PROBE_RESULT_EVENT, onResult);
    timer = setTimeout(() => finish(undefined), PROBE_TIMEOUT_MS);
    el.setAttribute(PROBE_ATTR, id);
    try {
      win.dispatchEvent(new CustomEvent(PROBE_REQUEST_EVENT, { detail: id }));
    } catch {
      finish(undefined);
    }
  });
}
