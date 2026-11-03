/**
 * Pure framework-introspection logic. Runs in the page's MAIN world (see
 * src/entrypoints/probe.content.ts) where framework expandos are visible. No imports other
 * than types so it stays tiny and testable with fake fibers.
 */
import type { ComponentFrame, FrameworkInfo, SourceLocation } from '../schema';
import { resolveStackLocations, type SourceMapLike } from './sourcemap';
import { isLibraryPath, normalizeSourcePath } from './source-path';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Source = SourceLocation;

const STACK_MAX = 6;
const FRAMES_MAX = 12;
const PARENT_WALK_MAX = 60;
const FIBER_WALK_MAX = 400;

export function probeElement(el: Element): FrameworkInfo | undefined {
  try {
    return probeReact(el) ?? probeVue(el) ?? probeSvelte(el) ?? probeAngular(el);
  } catch {
    return undefined;
  }
}

const MAP_BUDGET_MS = 500;
const mapCache = new Map<string, Promise<SourceMapLike | undefined>>();

async function fetchModuleText(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(String(res.status));
  return res.text();
}

/**
 * probeElement + source-map correction. React 19 call sites come from `Error.stack`, whose
 * positions are in the transformed module the dev server sent; this maps them back to the
 * original file via the module's (inlined) source map. Falls back to the raw positions when a
 * map is missing or slow.
 */
export async function probeElementAsync(
  el: Element,
  opts: { fetchText?: (url: string) => Promise<string>; budgetMs?: number } = {},
): Promise<FrameworkInfo | undefined> {
  const info = probeElement(el);
  if (!info) return info;
  const fetchText = opts.fetchText ?? fetchModuleText;
  const origin = el.ownerDocument.defaultView?.location?.origin;
  try {
    const all = [info.source, info.usedAt, ...(info.frames ?? []).map((f) => f.usedAt)].filter(
      (l): l is Source => Boolean(l?.raw && (!origin || l.raw.startsWith(origin + '/'))),
    );
    if (!all.length) return info;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const mapped = await Promise.race([
      resolveStackLocations(all, fetchText, mapCache),
      new Promise<undefined>((r) => {
        timer = setTimeout(() => r(undefined), opts.budgetMs ?? MAP_BUDGET_MS);
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (!mapped) return info;
    const fix = (l: Source | undefined) => (l ? (mapped.get(l) ?? l) : l);
    const out: FrameworkInfo = { ...info };
    if (info.source) out.source = fix(info.source);
    if (info.usedAt) out.usedAt = fix(info.usedAt);
    if (info.frames) out.frames = info.frames.map((f) => (f.usedAt ? { ...f, usedAt: fix(f.usedAt) } : f));
    return out;
  } catch {
    return info;
  }
}

// ---------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------

function* ancestorsOrSelf(el: Element): Generator<Element> {
  let cur: Element | null = el;
  for (let i = 0; cur && i < PARENT_WALK_MAX; i++) {
    yield cur;
    cur = cur.parentElement;
  }
}

function uniqueNames(names: Array<string | undefined>): string[] {
  const out: string[] = [];
  for (const n of names) {
    if (n && out[out.length - 1] !== n) out.push(n);
    if (out.length >= STACK_MAX) break;
  }
  return out;
}

function baseNameNoExt(file: string): string | undefined {
  const base = file.split('/').pop()?.replace(/\.[^.]+$/, '');
  return base || undefined;
}

function build(
  name: FrameworkInfo['name'],
  stack: string[],
  source: Source | undefined,
): FrameworkInfo {
  const info: FrameworkInfo = { name };
  if (stack[0]) info.component = stack[0];
  if (stack.length) info.componentStack = stack;
  if (source) info.source = source;
  return info;
}

/** Normalised location from a framework-reported file (+ optional line/column). */
function locate(file: unknown, line?: unknown, column?: unknown): Source | undefined {
  if (typeof file !== 'string') return undefined;
  const loc = normalizeSourcePath(file);
  if (!loc) return undefined;
  // Prefer explicit numbers; a `file` string may or may not already carry `:line:col`.
  const out: Source = { file: loc.file, raw: loc.raw };
  const l = typeof line === 'number' ? line : loc.line;
  const c = typeof column === 'number' ? column : loc.column;
  if (l) out.line = l;
  if (c) out.column = c;
  return out;
}

// ---------------------------------------------------------------------------------------
// React
// ---------------------------------------------------------------------------------------

function findReactFiber(el: Element): { fiber: Any; host: Element } | undefined {
  for (const node of ancestorsOrSelf(el)) {
    for (const key of Object.keys(node)) {
      if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
        const fiber = (node as Any)[key];
        if (fiber) return { fiber, host: node };
      }
    }
  }
  return undefined;
}

function reactTypeName(type: Any, depth = 0): string | undefined {
  if (!type || depth > 4) return undefined;
  if (typeof type === 'function') return type.displayName || type.name || undefined;
  if (typeof type === 'object') {
    // Context providers / consumers are not "components" for our purposes.
    if ('_context' in type || 'Provider' in type || 'Consumer' in type) return undefined;
    if (type.displayName) return type.displayName;
    if (type.render) return reactTypeName(type.render, depth + 1); // forwardRef
    if (type.type) return reactTypeName(type.type, depth + 1); // memo
  }
  return undefined;
}

function isReactComponentFiber(fiber: Any): boolean {
  const t = fiber?.type;
  return typeof t === 'function' || (t !== null && typeof t === 'object');
}

export function parseStackFrames(stack: string): Array<{ fn?: string; file: string; line?: number; column?: number }> {
  const frames: Array<{ fn?: string; file: string; line?: number; column?: number }> = [];
  for (const raw of stack.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // Chrome/V8:  at fn (url:line:col)  |  at url:line:col
    let m = /^at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    // Firefox/Safari: fn@url:line:col
    if (!m) m = /^(.*?)@(.+?):(\d+):(\d+)$/.exec(line);
    if (!m) continue;
    frames.push({ fn: m[1] || undefined, file: m[2]!, line: Number(m[3]), column: Number(m[4]) });
  }
  return frames;
}

/** Frames that are React / bundler plumbing, never the code that created an element. */
const REACT_INTERNAL_FRAME = /react-dom|react-jsx|jsx-dev-runtime|jsx-runtime|react\.development|react\.production|react-server|react_jsx|react-stack|chunk-[A-Za-z0-9]+\.|webpack\/runtime|<anonymous>|^native /;
const REACT_INTERNAL_FN = /^(?:exports\.|Object\.)?jsxDEV|^(?:Object\.)?react-stack|^(?:exports\.)?jsxs?$/;

function sourceFromDebugStack(stackHolder: Any): Source | undefined {
  if (!stackHolder) return undefined;
  const text: unknown = typeof stackHolder === 'string' ? stackHolder : stackHolder.stack;
  if (typeof text !== 'string') return undefined;
  for (const f of parseStackFrames(text)) {
    if (REACT_INTERNAL_FRAME.test(f.file) || isLibraryPath(f.file) || (f.fn && REACT_INTERNAL_FN.test(f.fn))) continue;
    const loc = normalizeSourcePath(f.file);
    if (!loc) continue;
    return { file: loc.file, ...(f.line ? { line: f.line } : {}), ...(f.column ? { column: f.column } : {}), raw: `${f.file}:${f.line}:${f.column}` };
  }
  return undefined;
}

/** Where this fiber's element was created: `_debugSource` (React <= 18) or `_debugStack` (React 19). */
function sourceFromFiber(fiber: Any): Source | undefined {
  const ds = fiber?._debugSource;
  if (ds && typeof ds.fileName === 'string') {
    const loc = locate(ds.fileName, ds.lineNumber, ds.columnNumber);
    if (loc) return loc;
  }
  return sourceFromDebugStack(fiber?._debugStack);
}

/** Names that are plumbing wherever they are defined (providers, boundaries, React built-ins). */
const PLUMBING_NAME = /^(?:Suspense|StrictMode|Fragment|Profiler|SuspenseList|Activity|ViewTransition)$|(?:Provider|Consumer|Context|Boundary)$/;
/** Router / framework internals, trusted by name only when no source location is known. */
const INTERNAL_NAMES = new Set([
  'RenderedRoute', 'Routes', 'Router', 'Outlet', 'Navigate', 'InnerLayoutRouter', 'OuterLayoutRouter', 'LayoutRouter',
  'RenderFromTemplateContext', 'ScrollAndFocusHandler', 'RedirectBoundary', 'NotFoundBoundary', 'LoadingBoundary',
  'ErrorBoundaryHandler', 'HotReload', 'AppRouter', 'ServerRoot',
]);

export function isLibraryFrame(name: string, usedAt: Source | undefined): boolean {
  if (PLUMBING_NAME.test(name)) return true;
  if (usedAt) return isLibraryPath(usedAt.raw ?? usedAt.file);
  return INTERNAL_NAMES.has(name);
}

function probeReact(el: Element): FrameworkInfo | undefined {
  const found = findReactFiber(el);
  if (!found) return undefined;

  // The host element itself: where it is written (often inside a shared primitive).
  let source: Source | undefined;
  const all: ComponentFrame[] = [];
  let fiber: Any = found.fiber;
  for (let i = 0; fiber && i < FIBER_WALK_MAX; i++, fiber = fiber.return) {
    if (typeof fiber.type === 'string') {
      source ??= sourceFromFiber(fiber);
      continue;
    }
    if (!isReactComponentFiber(fiber)) continue;
    const name = reactTypeName(fiber.type);
    if (!name) continue;
    const usedAt = sourceFromFiber(fiber);
    const prev = all[all.length - 1];
    // memo/forwardRef wrappers produce several fibers for one component: keep one frame.
    if (prev && prev.component === name) {
      if (!prev.usedAt && usedAt) {
        prev.usedAt = usedAt;
        if (isLibraryFrame(name, usedAt)) prev.library = true;
        else delete prev.library;
      }
      continue;
    }
    const frame: ComponentFrame = { component: name };
    if (usedAt) frame.usedAt = usedAt;
    if (isLibraryFrame(name, usedAt)) frame.library = true;
    all.push(frame);
  }

  const stack = uniqueNames(all.filter((f) => !f.library).map((f) => f.component));
  const info = build('react', stack, source);
  const nearestApp = all.find((f) => !f.library);
  if (nearestApp?.usedAt) info.usedAt = nearestApp.usedAt;
  if (all.length) info.frames = all.slice(0, FRAMES_MAX);
  return info;
}

// ---------------------------------------------------------------------------------------
// Vue
// ---------------------------------------------------------------------------------------

function vue3Name(inst: Any): string | undefined {
  const t = inst?.type ?? {};
  return t.__name || t.name || (typeof t.__file === 'string' ? baseNameNoExt(t.__file) : undefined);
}

function probeVue(el: Element): FrameworkInfo | undefined {
  for (const node of ancestorsOrSelf(el)) {
    const inst: Any = (node as Any).__vueParentComponent;
    if (inst) {
      const names: Array<string | undefined> = [];
      for (let c = inst, i = 0; c && i < 40 && names.length < STACK_MAX + 4; c = c.parent, i++) names.push(vue3Name(c));
      return build('vue', uniqueNames(names), locate(inst.type?.__file));
    }
    const vm: Any = (node as Any).__vue__;
    if (vm && vm.$options) {
      const names: Array<string | undefined> = [];
      for (let c = vm, i = 0; c && i < 40 && names.length < STACK_MAX + 4; c = c.$parent, i++) {
        const o = c.$options ?? {};
        names.push(o.name || o._componentTag || (typeof o.__file === 'string' ? baseNameNoExt(o.__file) : undefined));
      }
      return build('vue', uniqueNames(names), locate(vm.$options.__file));
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------
// Svelte (dev mode adds __svelte_meta = { loc: { file, line, column } })
// ---------------------------------------------------------------------------------------

function probeSvelte(el: Element): FrameworkInfo | undefined {
  for (const node of ancestorsOrSelf(el)) {
    const loc: Any = (node as Any).__svelte_meta?.loc;
    if (loc && typeof loc.file === 'string') {
      const source = locate(loc.file, loc.line, loc.column);
      return build('svelte', uniqueNames([source && baseNameNoExt(source.file)]), source);
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------
// Angular (dev mode exposes window.ng)
// ---------------------------------------------------------------------------------------

function probeAngular(el: Element): FrameworkInfo | undefined {
  const win: Any = el.ownerDocument?.defaultView ?? globalThis;
  const ng = win?.ng;
  if (!ng || typeof ng.getComponent !== 'function') return undefined;

  const nameOf = (c: Any): string | undefined => c?.constructor?.name || undefined;
  let comp: Any;
  for (const node of ancestorsOrSelf(el)) {
    comp = ng.getComponent(node) ?? undefined;
    if (comp) break;
  }
  if (!comp && typeof ng.getOwningComponent === 'function') comp = ng.getOwningComponent(el) ?? undefined;
  if (!comp) return undefined;

  const names: Array<string | undefined> = [nameOf(comp)];
  if (typeof ng.getOwningComponent === 'function' && typeof ng.getHostElement === 'function') {
    let cur = comp;
    for (let i = 0; i < STACK_MAX + 2; i++) {
      const owner = ng.getOwningComponent(ng.getHostElement(cur));
      if (!owner || owner === cur) break;
      names.push(nameOf(owner));
      cur = owner;
    }
  }
  return build('angular', uniqueNames(names), undefined);
}
