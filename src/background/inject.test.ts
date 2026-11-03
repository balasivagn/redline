import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../core/settings';
import { CONTENT_FILE, createInjector, isInjectableUrl, PROBE_FILE, type InjectApi } from './inject';
import type { SettingsStore } from './settings-store';

function setup(opts: { mounted?: boolean; failInject?: boolean; origins?: string[] } = {}) {
  let settings: Settings = { ...DEFAULT_SETTINGS, enabledOrigins: opts.origins ?? [] };
  const store: SettingsStore = {
    get: async () => settings,
    update: async (fn) => (settings = fn(settings)),
    patch: async () => settings,
  };
  let mounted = opts.mounted ?? false;
  const injected: unknown[] = [];
  const sent: any[] = [];
  const api: InjectApi = {
    async executeScript(i) {
      if ('func' in i) return [{ result: mounted }];
      if (opts.failInject) throw new Error('Cannot access a chrome:// URL');
      injected.push(i);
      if ((i.files as string[])[0] === CONTENT_FILE) mounted = true;
      return [{}];
    },
    async sendMessage(tabId, m) { sent.push([tabId, m]); },
  };
  const injector = createInjector({ settings: store, api, sleep: async () => {} });
  return { injector, injected, sent, get settings() { return settings; } };
}

describe('isInjectableUrl', () => {
  it('allows http(s) and rejects browser pages and the web store', () => {
    expect(isInjectableUrl('http://localhost:3000/x')).toBe(true);
    expect(isInjectableUrl('https://example.com')).toBe(true);
    expect(isInjectableUrl('chrome://extensions')).toBe(false);
    expect(isInjectableUrl('chrome-extension://abc/options.html')).toBe(false);
    expect(isInjectableUrl('https://chromewebstore.google.com/detail/x')).toBe(false);
    expect(isInjectableUrl(undefined)).toBe(false);
  });
});

describe('injector', () => {
  it('first toggle injects, enables the origin and sends ui/open', async () => {
    const t = setup();
    await t.injector.toggle({ id: 4, url: 'http://localhost:3000/pricing' });
    expect(t.injected).toEqual([
      { target: { tabId: 4 }, files: [PROBE_FILE], world: 'MAIN' },
      { target: { tabId: 4 }, files: [CONTENT_FILE] },
    ]);
    expect(t.settings.enabledOrigins).toEqual(['http://localhost:3000']);
    expect(t.sent).toEqual([[4, { channel: 'redline/event', type: 'ui/open' }]]);
  });

  it('toggle on a mounted tab sends ui/toggle without re-injecting', async () => {
    const t = setup({ mounted: true });
    await t.injector.toggle({ id: 4, url: 'https://a.test/' });
    expect(t.injected).toEqual([]);
    expect(t.sent).toEqual([[4, { channel: 'redline/event', type: 'ui/toggle' }]]);
  });

  it('does nothing on pages it cannot inject into', async () => {
    const t = setup({ failInject: true });
    await t.injector.toggle({ id: 1, url: 'chrome://extensions' });
    await t.injector.toggle({ id: 1, url: 'https://a.test/' });
    expect(t.sent).toEqual([]);
    expect(t.settings.enabledOrigins).toEqual([]);
  });

  it('auto-mounts only enabled origins and dedupes concurrent calls', async () => {
    const t = setup({ origins: ['https://a.test'] });
    await t.injector.autoMount(1, 'https://other.test/');
    expect(t.injected).toEqual([]);
    await Promise.all([t.injector.autoMount(2, 'https://a.test/x'), t.injector.autoMount(2, 'https://a.test/x')]);
    expect(t.injected).toHaveLength(2); // probe + content, once
    await t.injector.autoMount(2, 'https://a.test/x'); // already mounted
    expect(t.injected).toHaveLength(2);
  });
});
