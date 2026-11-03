/**
 * Pure helpers that turn the location strings frameworks and dev servers report (URLs from
 * stack traces, `_debugSource.fileName`, Vue `__file` …) into project-relative paths.
 * No imports other than types: this runs in the page's MAIN world.
 */
import type { SourceLocation } from '../schema';

/** Directory names that mark the root of a project (monorepo roots first, `src` last). */
const ROOT_MARKERS = new Set(['packages', 'apps', 'libs', 'src']);

/** Webpack layer prefixes Next.js puts in front of paths, e.g. `(app-pages-browser)/`. */
const LAYER_PREFIX = /^\((?:app-pages-browser|ssr|rsc|pages-dir-browser|pages-dir-node|action-browser|api|middleware|edge-ssr|instrument|shared|app-metadata-route)\)\//;

/**
 * Paths that belong to a library or framework runtime rather than application code:
 * installed packages, Vite's pre-bundled deps / virtual modules, bundler chunk runtimes.
 */
export function isLibraryPath(path: string | undefined): boolean {
  if (!path) return false;
  const p = path.replace(/\\/g, '/');
  return p.includes('node_modules') || p.includes('/.vite/deps/') || p.includes('/@id/') || p.includes('/_next/static/chunks/');
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Remove every dev-server / bundler decoration, leaving a (possibly absolute) file path. */
function stripDecorations(input: string): string {
  let s = input;
  // Repeat: Next nests prefixes, e.g. rsc://React/Server/webpack-internal:///(rsc)/./app/page.tsx
  for (let i = 0; i < 6; i++) {
    const before = s;
    s = s.replace(/^rsc:\/\/React\/[^/]*\//, '');
    s = s.replace(/^webpack-internal:\/\/\//, '');
    s = s.replace(/^webpack:\/\/[^/]*\//, '');
    s = s.replace(/^file:\/\//, '');
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, ''); // http(s)://host:port, other schemes
    s = s.replace(LAYER_PREFIX, '');
    s = s.replace(/^\/@fs(?=\/)/, '');
    s = s.replace(/^\/@id\//, '');
    s = s.replace(/^(?:\.{1,2}\/)+/, '');
    if (s === before) break;
  }
  return s;
}

/** Cut an absolute-ish path down to where the project starts. */
function shortenToProject(path: string): string {
  const parts = path.split('/').filter((p) => p !== '');
  const nm = parts.indexOf('node_modules');
  let cut = -1;
  for (let i = 0; i < parts.length - 1; i++) {
    if (ROOT_MARKERS.has(parts[i]!)) {
      cut = i;
      break;
    }
  }
  // Library files: keep the node_modules/… tail rather than a `src` folder inside a package.
  if (nm !== -1 && (cut === -1 || nm < cut)) cut = nm;
  if (cut > 0) return parts.slice(cut).join('/');
  if (cut === 0) return parts.join('/');
  // No project marker: at least drop the home directory prefix (/Users/<me>/, /home/<me>/).
  if (parts.length > 3 && /^(users|home)$/i.test(parts[0]!)) return parts.slice(2).join('/');
  return parts.join('/');
}

/**
 * Normalise a URL or path (optionally ending in `:line[:column]`) to a project-relative
 * {@link SourceLocation}. The unmodified input is kept in `raw`. Returns undefined when no
 * file name remains.
 */
export function normalizeSourcePath(input: string | undefined | null): SourceLocation | undefined {
  if (typeof input !== 'string') return undefined;
  const raw = input.trim();
  if (!raw) return undefined;

  let rest = raw;
  let line: number | undefined;
  let column: number | undefined;
  const two = /^(.*):(\d+):(\d+)$/.exec(rest);
  const one = two ? undefined : /^(.*):(\d+)$/.exec(rest);
  // A bare `http://host:5173` is an origin, not a file with a line number.
  if (two) {
    rest = two[1]!;
    line = Number(two[2]);
    column = Number(two[3]);
  } else if (one && !/^[a-z][a-z0-9+.-]*:\/\/[^/]*$/i.test(one[1]!)) {
    rest = one[1]!;
    line = Number(one[2]);
  }

  rest = rest.replace(/\\/g, '/');
  rest = stripDecorations(rest);
  rest = rest.replace(/[?#].*$/, '');
  rest = stripDecorations(rest); // a query may have hidden a prefix on the first pass
  rest = safeDecode(rest);
  rest = rest.replace(/^\/+/, '').replace(/^[A-Za-z]:(?=\/)/, ''); // Windows drive letter
  rest = rest.replace(/^\/+/, '').replace(/^(?:\.{1,2}\/)+/, '');
  const file = shortenToProject(rest);
  if (!file) return undefined;

  return {
    file,
    ...(line !== undefined && line > 0 ? { line } : {}),
    ...(column !== undefined && column > 0 ? { column } : {}),
    raw,
  };
}
