/**
 * MAIN-world framework probe. Answers `redline:probe` requests from the isolated content
 * script (see detectFramework in src/core/capture) with component/source info that is only
 * visible to page JS (React fibers, Vue instances, window.ng …).
 *
 * Protocol (window CustomEvents, string payloads only):
 *   request : `redline:probe`        detail = request id; target has [data-redline-probe="<id>"]
 *   response: `redline:probe-result` detail = JSON.stringify({ id, info, pending? })
 *             `pending: true` marks a quick answer; a final one (no `pending`) follows once
 *             source-map line correction is done.
 */
import { probeElement, probeElementAsync } from '../core/capture/probe-logic';

const REQUEST = 'redline:probe';
const RESULT = 'redline:probe-result';
const ATTR = 'data-redline-probe';
const FLAG = '__redlineProbeInstalled';

function findByAttr(root: Document | ShadowRoot, id: string): Element | null {
  const sel = `[${ATTR}="${id.replace(/["\\]/g, '\\$&')}"]`;
  const direct = root.querySelector(sel);
  if (direct) return direct;
  for (const host of Array.from(root.querySelectorAll('*'))) {
    const sr = host.shadowRoot;
    if (sr) {
      const hit = findByAttr(sr, id);
      if (hit) return hit;
    }
  }
  return null;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',
  world: 'MAIN',
  main() {
    const w = window as unknown as Record<string, unknown>;
    if (w[FLAG]) return;
    w[FLAG] = true;

    const reply = (id: string, info: unknown, pending?: true) =>
      window.dispatchEvent(
        new CustomEvent(RESULT, { detail: JSON.stringify({ id, info: info ?? null, ...(pending ? { pending } : {}) }) }),
      );

    window.addEventListener(REQUEST, async (ev) => {
      const id = (ev as CustomEvent).detail;
      if (typeof id !== 'string' || !id) return;
      let el: Element | null = null;
      try {
        el = findByAttr(document, id);
        const quick = el ? probeElement(el) : undefined;
        if (!el || !quick) return reply(id, quick);
        // Answer right away, then refine call-site line numbers via the module's source map.
        reply(id, quick, true);
        reply(id, await probeElementAsync(el));
      } catch {
        reply(id, undefined);
      }
    });
  },
});
