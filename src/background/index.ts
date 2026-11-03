/** Wires the service worker. All listeners are registered synchronously at startup. */
import { createAnnotationRepo, createShotStore } from '../core/storage';
import { createChromeEngine } from '../speech/chrome';
import { createNativeEngine } from '../speech/native';
import { OFFSCREEN_PORT, type OffscreenPortEvent } from '../speech/offscreen-protocol';
import { createBadge } from './badge';
import { broadcast, sendToTarget } from './broadcast';
import { createHelperClient } from './helper-client';
import { createInjector } from './inject';
import { createChromeSpeechTransport, createRecorderClient } from './offscreen';
import { createRouter } from './router';
import { createSettingsStore } from './settings-store';
import { cropDataUrl, createVisibleTabCapturer } from './screenshots';
import { createSpeechController } from './speech';

export function initBackground(): void {
  const repo = createAnnotationRepo();
  const shots = createShotStore();
  const settings = createSettingsStore();
  const badge = createBadge({ repo });
  const injector = createInjector({ settings, broadcast });
  const captureVisibleTab = createVisibleTabCapturer();

  const helper = createHelperClient({
    onEvent: (e) =>
      void broadcast({ type: 'helper/downloadProgress', catalogId: e.catalogId, receivedBytes: e.receivedBytes, totalBytes: e.totalBytes, phase: e.phase }),
  });

  const speech = createSpeechController({
    getSettings: () => settings.get(),
    engines: {
      native: createNativeEngine({ helper, recorder: createRecorderClient(), getSettings: () => settings.get() }),
      chrome: createChromeEngine({ transport: createChromeSpeechTransport(), getSettings: () => settings.get() }),
    },
    emit: (target, state) => void sendToTarget(target, { type: 'speech/state', state }),
    emitLevel: (target, level) => void sendToTarget(target, { type: 'speech/level', level }),
  });

  const router = createRouter({
    repo,
    shots,
    settings,
    helper,
    speech,
    broadcast,
    captureShot: async ({ windowId, rect, dpr }) => cropDataUrl(await captureVisibleTab(windowId), rect, dpr),
    getUrl: (path) => chrome.runtime.getURL(path as never),
    openTab: (url) => chrome.tabs.create({ url }),
    onAnnotationsChanged: (pageKeys) => void badge.updateForPageKeys(pageKeys),
  });

  chrome.runtime.onMessage.addListener(router.listener);

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== OFFSCREEN_PORT) return;
    port.onMessage.addListener((m: OffscreenPortEvent) => speech.handleOffscreenEvent(m));
  });

  chrome.action.onClicked.addListener((tab) => void injector.toggle(tab));
  // Test hook for the e2e harness (toolbar clicks can't be automated).
  (globalThis as { __redlineTest?: unknown }).__redlineTest = {
    toggleTab: async (tabId: number) => injector.toggle(await chrome.tabs.get(tabId)),
  };
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command !== 'toggle-redline') return;
    if (tab) return void injector.toggle(tab);
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => t && injector.toggle(t));
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') void injector.autoMount(tabId, tab.url);
    if (changeInfo.status === 'complete' || changeInfo.url) void badge.updateTab(tabId, tab.url);
  });
  chrome.tabs.onActivated.addListener(({ tabId }) => void badge.updateTabById(tabId));
  chrome.webNavigation.onCompleted.addListener((d) => {
    if (d.frameId === 0) void injector.autoMount(d.tabId, d.url);
  });
}
