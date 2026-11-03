/** Runtime injection of the content scripts, action/command toggle and auto-mount. */
import type { SettingsStore } from './settings-store';
import { originOf } from './settings-store';
import type { EventInput } from './broadcast';

export const CONTENT_FILE = 'content-scripts/content.js';
export const PROBE_FILE = 'content-scripts/probe.js';

export function isInjectableUrl(url: string | undefined): boolean {
  const origin = originOf(url);
  if (!origin) return false;
  const u = new URL(url!);
  if (u.hostname === 'chromewebstore.google.com') return false;
  if (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore')) return false;
  return true;
}

export interface InjectApi {
  executeScript(injection: Record<string, unknown>): Promise<Array<{ result?: unknown }>>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

export const chromeInjectApi: InjectApi = {
  executeScript: (i) => chrome.scripting.executeScript(i as never) as Promise<Array<{ result?: unknown }>>,
  sendMessage: (tabId, m) => Promise.resolve(chrome.tabs.sendMessage(tabId, m)),
};

export interface TabLike { id?: number; url?: string }

export function createInjector(deps: {
  settings: SettingsStore;
  broadcast?: (e: EventInput) => void | Promise<void>;
  api?: InjectApi;
  sleep?: (ms: number) => Promise<void>;
}) {
  const api = deps.api ?? chromeInjectApi;
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const inflight = new Map<number, Promise<boolean>>();

  async function isMounted(tabId: number): Promise<boolean> {
    try {
      const res = await api.executeScript({
        target: { tabId },
        func: () => (globalThis as { __redlineMounted?: boolean }).__redlineMounted === true,
      });
      return res[0]?.result === true;
    } catch {
      return false;
    }
  }

  /** Inject both scripts. Throws when the page cannot be scripted. */
  async function inject(tabId: number): Promise<void> {
    await api.executeScript({ target: { tabId }, files: [PROBE_FILE], world: 'MAIN' }).catch(() => undefined); // probe is optional
    await api.executeScript({ target: { tabId }, files: [CONTENT_FILE] });
  }

  /** The listener may need a moment after injection. */
  async function sendEvent(tabId: number, type: 'ui/open' | 'ui/toggle'): Promise<void> {
    for (let i = 0; i < 6; i++) {
      try {
        await api.sendMessage(tabId, { channel: 'redline/event', type });
        return;
      } catch {
        await sleep(100);
      }
    }
  }

  /** Mount if needed (serialised per tab). Resolves true when it injected just now. */
  function ensureMounted(tabId: number): Promise<boolean> {
    const existing = inflight.get(tabId);
    if (existing) return existing;
    const p = (async () => {
      if (await isMounted(tabId)) return false;
      try {
        await inject(tabId);
        return true;
      } catch {
        return false; // chrome:// pages, store pages, blocked frames…
      }
    })().finally(() => inflight.delete(tabId));
    inflight.set(tabId, p);
    return p;
  }

  return {
    isMounted,
    ensureMounted,

    /** Toolbar action / `toggle-redline` command. */
    async toggle(tab: TabLike): Promise<void> {
      if (tab.id === undefined || !isInjectableUrl(tab.url)) return;
      if (await isMounted(tab.id)) {
        await sendEvent(tab.id, 'ui/toggle');
        return;
      }
      if (!(await ensureMounted(tab.id))) return;
      const origin = originOf(tab.url)!;
      const next = await deps.settings.update((cur) =>
        cur.enabledOrigins.includes(origin) ? cur : { ...cur, enabledOrigins: [...cur.enabledOrigins, origin] },
      );
      void deps.broadcast?.({ type: 'settings/changed', settings: next });
      await sendEvent(tab.id, 'ui/open');
    },

    /** tabs.onUpdated(complete) / webNavigation.onCompleted. */
    async autoMount(tabId: number, url: string | undefined): Promise<void> {
      if (!isInjectableUrl(url)) return;
      const settings = await deps.settings.get();
      if (!settings.enabledOrigins.includes(originOf(url)!)) return;
      await ensureMounted(tabId);
    },
  };
}
