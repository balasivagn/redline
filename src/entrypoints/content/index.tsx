import '../../ui/shared/styles.css';
import '../../ui/overlay/overlay.css';
import { mountOverlay } from '../../ui/overlay/mount';
import { keepOnTop } from '../../ui/overlay/keepOnTop';

declare global {
  // eslint-disable-next-line no-var
  var __redlineMounted: boolean | undefined;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',
  cssInjectionMode: 'ui',
  async main(ctx) {
    if (globalThis.__redlineMounted) return;
    globalThis.__redlineMounted = true;
    let stopKeepOnTop: (() => void) | undefined;
    try {
      const ui = await createShadowRootUi(ctx, {
        name: 'redline-ui',
        position: 'modal',
        zIndex: 2147483647,
        isolateEvents: true,
        onMount(container, _shadow, host) {
          return mountOverlay(container, host, () => ui.remove());
        },
        onRemove(root) {
          stopKeepOnTop?.();
          stopKeepOnTop = undefined;
          root?.unmount();
          globalThis.__redlineMounted = false;
        },
      });
      ui.mount();
      stopKeepOnTop = keepOnTop(ui.shadowHost);
    } catch (err) {
      globalThis.__redlineMounted = false;
      console.error('[redline] failed to mount', err);
    }
  },
});
