import { SCHEMA, newId, type Anchor, type Annotation, type DomSnapshot, type FrameworkInfo, type PageInfo, type Rect } from '../../core/schema';
import { captureDom, capturePage, detectFramework } from '../../core/capture';
import { pageKeyFor } from '../../core/page-key';
import { rpc } from '../../core/rpc';
import type { CommentSource } from './text';
import { clampRectToViewport } from './geometry';

export interface BuildArgs {
  id: string;
  now: string;
  pageKey: string;
  page: PageInfo;
  anchor: Anchor;
  dom: DomSnapshot;
  framework?: FrameworkInfo;
  text: string;
  source: CommentSource;
  screenshot?: Annotation['screenshot'];
}

/** Assemble a brand-new annotation (number 0: the background assigns the next number). */
export function buildAnnotation(a: BuildArgs): Annotation {
  const dom: DomSnapshot = a.framework ? { ...a.dom, framework: a.framework } : a.dom;
  return {
    schema: SCHEMA,
    id: a.id,
    number: 0,
    pageKey: a.pageKey,
    createdAt: a.now,
    updatedAt: a.now,
    page: a.page,
    comment: { text: a.text, source: a.source },
    tags: [],
    meta: {},
    anchor: a.anchor,
    dom,
    ...(a.screenshot ? { screenshot: a.screenshot } : {}),
  };
}

export interface CreateArgs {
  element: Element;
  anchor: Anchor;
  text: string;
  source: CommentSource;
  /** Already-captured DOM facts and framework info, if the comment box has them. */
  dom?: DomSnapshot;
  framework?: FrameworkInfo | Promise<FrameworkInfo | undefined>;
  screenshot?: Annotation['screenshot'];
}

/** Capture page/DOM/framework facts and build the annotation for a new comment. */
export async function createAnnotation(args: CreateArgs): Promise<Annotation> {
  const framework = await (args.framework ?? detectFramework(args.element));
  return buildAnnotation({
    id: newId(),
    now: new Date().toISOString(),
    pageKey: pageKeyFor(location.href),
    page: capturePage(),
    anchor: args.anchor,
    dom: args.dom ?? captureDom(args.element),
    framework,
    text: args.text,
    source: args.source,
    screenshot: args.screenshot,
  });
}

/** Editing an existing comment changes its text only (anchor and DOM facts stay). */
export function withEditedText(prev: Annotation, text: string, dictated: string[], now = new Date().toISOString()): Annotation {
  let source: CommentSource;
  if (text === prev.comment.text) source = prev.comment.source;
  else if (dictated.length === 0) source = prev.comment.source === 'typed' ? 'typed' : 'mixed';
  else source = 'mixed';
  return { ...prev, comment: { text, source }, updatedAt: now };
}

/** Re-point an existing comment at a new element (keeps id, number, text, screenshot). */
export function withNewAnchor(
  prev: Annotation,
  next: { anchor: Anchor; dom: DomSnapshot; framework?: FrameworkInfo; page: PageInfo },
  now = new Date().toISOString(),
): Annotation {
  return {
    ...prev,
    anchor: next.anchor,
    page: next.page,
    dom: next.framework ? { ...next.dom, framework: next.framework } : next.dom,
    updatedAt: now,
  };
}

/** "div.card.card--pro" style label from a stored DOM snapshot. */
export function describeDom(dom: DomSnapshot): string {
  const id = dom.id ? `#${dom.id}` : '';
  const classes = dom.classes.slice(0, 3).map((c) => `.${c}`).join('');
  return `${dom.tag.toLowerCase()}${id}${classes}`;
}

// rAF can stall (throttled/occluded windows); never wait on it for more than 100 ms.
const nextFrame = () =>
  new Promise<void>((r) => {
    requestAnimationFrame(() => r());
    setTimeout(r, 100);
  });

export const SHOT_TIMEOUT_MS = 10_000;

/** Reject after `ms` so a stuck step can never leave the UI waiting forever. */
export function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Screenshot of `rect` (viewport CSS px) with our own UI hidden. Returns undefined when the rect
 * is not visible. Always restores the host's visibility.
 */
export async function captureShot(
  host: HTMLElement,
  rect: Rect,
  viewport = { width: window.innerWidth, height: window.innerHeight },
): Promise<Annotation['screenshot'] | undefined> {
  const clipped = clampRectToViewport(rect, viewport);
  if (!clipped) return undefined;
  const prev = host.style.visibility;
  host.style.visibility = 'hidden';
  // WXT styles the shadow host with `:host { all: initial !important }`, which beats the inline
  // style above, and some panels force `visibility: visible` anyway. A later `:host` rule inside the
  // shadow root wins that fight (the padded crop shows more than the element, so a leftover
  // comment box would otherwise end up in the picture).
  const hide = host.shadowRoot ? document.createElement('style') : null;
  if (hide) {
    hide.textContent = ':host { opacity: 0 !important; }';
    host.shadowRoot?.appendChild(hide);
  }
  try {
    await nextFrame();
    await nextFrame();
    // Give the compositor time to present the hidden state before the tab is captured.
    await new Promise<void>((r) => setTimeout(r, 60));
    const res = await withTimeout(
      rpc('shot/capture', { rect: clipped, dpr: window.devicePixelRatio || 1 }),
      SHOT_TIMEOUT_MS,
      'the screenshot took too long',
    );
    return { shotId: res.shotId, width: res.width, height: res.height, ...(res.path ? { path: res.path } : {}) };
  } finally {
    host.style.visibility = prev;
    hide?.remove();
  }
}
