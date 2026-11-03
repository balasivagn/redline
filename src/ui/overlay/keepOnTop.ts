/**
 * Keep the Redline host above page UI. The host already carries the max
 * z-index, but pages still beat it two ways:
 *
 *  1. Page elements with the same z-index appended to <body> later — DOM
 *     order wins ties (cookie banners, chat widgets, toolbars do this).
 *  2. Top-layer UI (<dialog>, popover, fullscreen) — always paints above
 *     normal content regardless of z-index.
 *
 * Fix: promote the host into the top layer via the Popover API, keep it the
 * last child of <body>, and re-promote whenever the page opens new top-layer
 * UI so we stay topmost. Returns a disposer.
 */
export function keepOnTop(host: HTMLElement): () => void {
  const hasPopover = typeof host.showPopover === 'function';
  if (hasPopover) host.setAttribute('popover', 'manual');

  /** Re-assert "topmost": end of <body> (z-index ties) + last in top layer. */
  const promote = () => {
    if (!host.isConnected) return;
    const body = document.body;
    if (body && body.lastElementChild !== host) body.append(host);
    if (!hasPopover) return;
    try {
      if (host.matches(':popover-open')) host.hidePopover(); // re-enter → topmost
      host.showPopover();
    } catch {
      // Host detached mid-call — nothing to promote.
    }
  };
  promote();

  // Page appended to <body> → we may have lost a z-index tie.
  const bodyObserver = new MutationObserver((mutations) => {
    if (!mutations.some((m) => m.addedNodes.length > 0)) return;
    if (document.body?.lastElementChild !== host) promote();
  });
  bodyObserver.observe(document.body, { childList: true });

  // Another popover toggled (capture phase works even though it doesn't bubble),
  // a dialog went modal, or fullscreen changed → re-assert topmost.
  const onToggle = (e: Event) => {
    if (e.target !== host) promote();
  };
  document.addEventListener('toggle', onToggle, true);
  document.addEventListener('fullscreenchange', promote);
  const dialogObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.target instanceof HTMLDialogElement && m.target.open) {
        promote();
        return;
      }
    }
  });
  dialogObserver.observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ['open'],
  });

  return () => {
    bodyObserver.disconnect();
    dialogObserver.disconnect();
    document.removeEventListener('toggle', onToggle, true);
    document.removeEventListener('fullscreenchange', promote);
  };
}
