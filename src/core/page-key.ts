/**
 * Page identity for v1: origin + pathname. Query and hash are ignored, except hash routes
 * ("#/route" or "#!/route") which are kept because they are the route in hash-routed SPAs.
 * Trailing slashes are normalised ("/pricing/" → "/pricing"; root stays "/").
 * Unparseable URLs are returned unchanged.
 */
export function pageKeyFor(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }

  let base: string;
  if (u.origin && u.origin !== 'null') {
    base = u.origin;
  } else if (u.protocol === 'file:') {
    base = 'file://';
  } else {
    // about:blank, data:, blob: … no meaningful origin/path split.
    return url;
  }

  const path = trimTrailingSlash(u.pathname) || '/';
  let key = base + path;

  if (/^#!?\//.test(u.hash)) {
    key += trimTrailingSlash(u.hash);
  }
  return key;
}

function trimTrailingSlash(s: string): string {
  // Keep "#/" and "#!/" meaningful: only trim when something follows the leading slash.
  if (s === '/' || s === '#/' || s === '#!/') return s === '/' ? '' : s;
  return s.replace(/\/+$/, '');
}
