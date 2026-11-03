/** Where saved screenshots go under ~/.redline/shots (the helper sanitises again, defensively). */

const clean = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|-+$/g, '');

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** "/docs/getting started/" → "docs-getting-started"; "/" → "root"; at most 80 chars. */
export function pathSlug(pathname: string): string {
  const joined = pathname
    .split('/')
    .filter(Boolean)
    .map((seg) => clean(safeDecode(seg)))
    .filter(Boolean)
    .join('-');
  const slug = clean(joined).slice(0, 80).replace(/-+$/, '');
  return slug || 'root';
}

/** Compact UTC timestamp: 2026-11-03T09:14:05.123Z → 20261103-091405. */
export function shotTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, '').replace(/[-:]/g, '').replace('T', '-');
}

/**
 * `<host>[-<port>]/<page-path-slug or "root">/<timestamp>-<shotId>.png`, derived from the tab URL.
 * Works for any site; unparseable URLs fall back to "unknown-page".
 */
export function shotRelPath(pageUrl: string | undefined, shotId: string, date: Date = new Date()): string {
  let host = 'unknown-page';
  let slug = 'root';
  if (pageUrl) {
    try {
      const u = new URL(pageUrl);
      const hostname = clean(u.hostname) || 'local';
      host = u.port ? `${hostname}-${clean(u.port)}` : hostname;
      slug = pathSlug(u.pathname);
    } catch {
      // keep the fallbacks
    }
  }
  const id = clean(shotId) || 'shot';
  return `${host}/${slug}/${shotTimestamp(date)}-${id}.png`;
}
