import { mkdir, lstat, realpath, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { HelperError } from './util';

const MAX_SEGMENT = 120;
const MAX_SEGMENTS = 8;

/**
 * Validate and sanitise a relative path coming from the extension. Rejects absolute paths,
 * `.`/`..` and empty segments; every other character outside [A-Za-z0-9._-] becomes `-`.
 */
export function sanitizeRelPath(relPath: unknown): string[] {
  if (typeof relPath !== 'string' || relPath.length === 0 || relPath.length > 1000) {
    throw new HelperError('bad-path', 'relPath must be a non-empty string');
  }
  if (relPath.includes('\0')) throw new HelperError('bad-path', 'relPath contains a NUL byte');
  if (relPath.startsWith('/') || relPath.startsWith('\\') || /^[A-Za-z]:/.test(relPath) || isAbsolute(relPath)) {
    throw new HelperError('bad-path', 'relPath must be relative');
  }
  const raw = relPath.split(/[\\/]/);
  if (raw.length > MAX_SEGMENTS) throw new HelperError('bad-path', 'relPath is too deep');
  return raw.map((seg) => {
    if (seg === '' || seg === '.' || seg === '..') throw new HelperError('bad-path', `invalid path segment "${seg}"`);
    return seg.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, MAX_SEGMENT);
  });
}

const inside = (root: string, p: string): boolean => p === root || p.startsWith(root + sep);

/** Write a PNG atomically under `shotsDir`; returns the absolute path. */
export async function saveShot(shotsDir: string, relPath: unknown, pngBase64: string): Promise<string> {
  const segments = sanitizeRelPath(relPath);
  const bytes = Buffer.from(pngBase64, 'base64');
  if (bytes.length === 0) throw new HelperError('bad-request', 'pngBase64 is empty');

  await mkdir(shotsDir, { recursive: true });
  const realRoot = await realpath(shotsDir);
  const target = join(shotsDir, ...segments);
  const dir = dirname(target);
  await mkdir(dir, { recursive: true });
  // A symlinked sub-directory must not lead outside the shots root.
  if (!inside(realRoot, await realpath(dir))) throw new HelperError('bad-path', 'path escapes the shots folder');
  // Never write through a symlink that already sits at the target.
  const existing = await lstat(target).catch(() => null);
  if (existing && !existing.isFile()) throw new HelperError('bad-path', 'target exists and is not a file');

  const tmp = join(dir, `.${basename(target)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    await writeFile(tmp, bytes, { mode: 0o600 });
    await rename(tmp, target);
  } catch (e) {
    await unlink(tmp).catch(() => undefined);
    throw e;
  }
  return target;
}

/** Delete saved screenshots; anything outside `shotsDir` (after resolving symlinks) is ignored. */
export async function deleteShots(shotsDir: string, paths: unknown[]): Promise<number> {
  const realRoot = await realpath(shotsDir).catch(() => null);
  if (!realRoot) return 0;
  let deleted = 0;
  for (const p of paths) {
    if (typeof p !== 'string' || !isAbsolute(p)) continue;
    try {
      const realDir = await realpath(dirname(p));
      if (realDir === realRoot || !inside(realRoot, realDir)) continue;
      const file = join(realDir, basename(p));
      const st = await lstat(file);
      if (!st.isFile() && !st.isSymbolicLink()) continue;
      await unlink(file);
      deleted++;
      // Remove now-empty parents, never the root itself.
      let dir: string = realDir;
      while (dir !== realRoot && inside(realRoot, dir)) {
        try {
          await rmdir(dir);
        } catch {
          break; // not empty (or gone)
        }
        dir = dirname(dir);
      }
    } catch {
      // missing file or unreadable dir: nothing to delete
    }
  }
  return deleted;
}
