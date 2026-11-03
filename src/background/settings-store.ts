import { mergeSettings, type Settings } from '../core/settings';

export interface SettingsStore {
  get(): Promise<Settings>;
  /** Merge a patch (nested shortcuts/voice are merged too). */
  patch(patch: Partial<Settings>): Promise<Settings>;
  update(fn: (current: Settings) => Settings): Promise<Settings>;
}

export function createSettingsStore(area: Pick<chrome.storage.StorageArea, 'get' | 'set'> = chrome.storage.local): SettingsStore {
  let queue: Promise<unknown> = Promise.resolve();

  const read = async () => mergeSettings(((await area.get('settings')) as { settings?: Partial<Settings> }).settings);

  const update = (fn: (current: Settings) => Settings): Promise<Settings> => {
    const run = queue.then(async () => {
      const next = fn(await read());
      await area.set({ settings: next });
      return next;
    });
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    get: read,
    update,
    patch: (patch) =>
      update((cur) =>
        mergeSettings({
          ...cur,
          ...patch,
          shortcuts: { ...cur.shortcuts, ...(patch.shortcuts ?? {}) },
          voice: { ...cur.voice, ...(patch.voice ?? {}) },
        }),
      ),
  };
}

export function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : undefined;
  } catch {
    return undefined;
  }
}
