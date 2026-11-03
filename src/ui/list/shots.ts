import { rpc } from '../../core/rpc';
import { dataUrlToBlob } from './copy';

/** shotId → data URL, cached in memory for the lifetime of the page/extension view. */
const resolved = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

export function cachedShot(shotId: string): string | undefined {
  return resolved.get(shotId);
}

/** Load a screenshot's data URL via the service worker (once per shotId; misses are not cached). */
export function loadShot(shotId: string): Promise<string | null> {
  const hit = resolved.get(shotId);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(shotId);
  if (!p) {
    p = rpc('shot/get', { shotId })
      .then((res) => {
        if (res?.dataUrl) resolved.set(shotId, res.dataUrl);
        return res?.dataUrl ?? null;
      })
      .catch(() => null)
      .finally(() => inflight.delete(shotId));
    inflight.set(shotId, p);
  }
  return p;
}

export function clearShotCache(): void {
  resolved.clear();
  inflight.clear();
}

/** Put the screenshot on the clipboard as image/png. Throws an Error with a readable reason. */
export async function copyShotImage(shotId: string): Promise<void> {
  const dataUrl = await loadShot(shotId);
  if (!dataUrl) throw new Error('The screenshot is no longer stored');
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('This page does not allow copying images');
  }
  const blob = dataUrlToBlob(dataUrl);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob.type === 'image/png' ? blob : blob.slice(0, blob.size, 'image/png') })]);
}

/** Toast text for a failed image copy. */
export function copyImageError(e: unknown): string {
  const reason = e instanceof Error ? e.message : String(e);
  return `Couldn't copy the image: ${reason}`;
}
