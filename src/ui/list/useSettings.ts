import { useCallback, useEffect, useState } from 'react';
import { onRedlineEvent, rpc } from '../../core/rpc';
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from '../../core/settings';

/** Loads settings from the service worker, follows `settings/changed`, patches via `settings/set`. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    rpc('settings/get', {})
      .then((s) => {
        if (!alive) return;
        setSettings(mergeSettings(s));
        setLoaded(true);
      })
      .catch(() => alive && setLoaded(true));
    const off = onRedlineEvent((e) => {
      if (e.type === 'settings/changed') setSettings(mergeSettings(e.settings));
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const update = useCallback(async (patch: Partial<Settings>) => {
    setSettings((prev) => mergeSettings({ ...prev, ...patch }));
    try {
      setSettings(mergeSettings(await rpc('settings/set', { patch })));
    } catch (e) {
      console.warn('[redline] settings/set failed', e);
    }
  }, []);

  return { settings, loaded, update };
}
