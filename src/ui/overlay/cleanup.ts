/** Ids/tags of nodes the content script puts in the page itself (outside the shadow root). */
export const CURSOR_STYLE_ID = 'redline-cursor-style';
export const HOST_TAG = 'redline-ui';

/**
 * Remove anything Redline left in the host page: the crosshair cursor style, leftover shadow
 * hosts. Safe to call repeatedly; used when the UI is removed or the content script is torn down.
 */
export function removeStrayNodes(doc: Document = document): number {
  let n = 0;
  for (const el of Array.from(doc.querySelectorAll(`#${CURSOR_STYLE_ID}, ${HOST_TAG}`))) {
    el.remove();
    n++;
  }
  return n;
}
