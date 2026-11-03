import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onRedlineEvent, rpc } from '../../core/rpc';
import { DEFAULT_SETTINGS, type Settings } from '../../core/settings';
import type { Annotation } from '../../core/schema';
import { pageKeyFor } from '../../core/page-key';
import { resolveAnchor, type ResolvedAnchor } from '../../core/anchor';

export function useSettings(): [Settings, (patch: Partial<Settings>) => Promise<void>] {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    let alive = true;
    rpc('settings/get', {})
      .then((s) => alive && setSettings(s))
      .catch(() => {});
    const off = onRedlineEvent((e) => {
      if (e.type === 'settings/changed') setSettings(e.settings);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  const update = useCallback(async (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch })); // optimistic
    try {
      setSettings(await rpc('settings/set', { patch }));
    } catch {
      /* the next settings/changed event restores truth */
    }
  }, []);
  return [settings, update];
}

/** Current page key; follows SPA navigation (poll + popstate/hashchange). */
export function usePageKey(): string {
  const [key, setKey] = useState(() => pageKeyFor(location.href));
  useEffect(() => {
    const check = () => {
      const next = pageKeyFor(location.href);
      setKey((prev) => (prev === next ? prev : next));
    };
    const timer = window.setInterval(check, 400);
    window.addEventListener('popstate', check);
    window.addEventListener('hashchange', check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('popstate', check);
      window.removeEventListener('hashchange', check);
    };
  }, []);
  return key;
}

/** Bumps a counter on scroll/resize (rAF-throttled) so positioned UI can re-measure. */
export function useViewportTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let raf = 0;
    const bump = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setTick((t) => t + 1);
      });
    };
    window.addEventListener('scroll', bump, { capture: true, passive: true });
    window.addEventListener('resize', bump, { passive: true });
    return () => {
      window.removeEventListener('scroll', bump, { capture: true });
      window.removeEventListener('resize', bump);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return tick;
}

export function fallbackResolved(a: Annotation): ResolvedAnchor {
  return {
    status: 'detached',
    clientPoint: { x: a.anchor.pagePoint.x - window.scrollX, y: a.anchor.pagePoint.y - window.scrollY },
  };
}

export function resolveAll(list: Annotation[]): Map<string, ResolvedAnchor> {
  const map = new Map<string, ResolvedAnchor>();
  for (const a of list) {
    try {
      map.set(a.id, resolveAnchor(a.anchor));
    } catch {
      map.set(a.id, fallbackResolved(a));
    }
  }
  return map;
}

export interface PinsData {
  annotations: Annotation[];
  resolved: Map<string, ResolvedAnchor>;
  detachedIds: ReadonlySet<string>;
  reload: () => Promise<void>;
}

/**
 * Annotations for this page plus their resolved positions. Reloads on page-key change,
 * `ann/changed` / `settings/changed`; re-resolves on scroll, resize and DOM mutations.
 */
export function usePins(pageKey: string, host: HTMLElement | null, enabled: boolean): PinsData {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [resolved, setResolved] = useState<Map<string, ResolvedAnchor>>(() => new Map());
  const listRef = useRef<Annotation[]>([]);
  const pageKeyRef = useRef(pageKey);
  pageKeyRef.current = pageKey;

  const recompute = useCallback(() => setResolved(resolveAll(listRef.current)), []);

  const reload = useCallback(async () => {
    const key = pageKeyRef.current;
    try {
      const list = await rpc('ann/list', { pageKey: key });
      if (pageKeyRef.current !== key) return;
      listRef.current = list;
      setAnnotations(list);
      setResolved(resolveAll(list));
    } catch {
      /* background not ready; the next event will retry */
    }
  }, []);

  useEffect(() => {
    listRef.current = [];
    setAnnotations([]);
    setResolved(new Map());
    void reload();
  }, [pageKey, reload]);

  useEffect(() => {
    return onRedlineEvent((e) => {
      if (e.type === 'ann/changed' && e.pageKeys.includes(pageKeyRef.current)) void reload();
      else if (e.type === 'settings/changed') void reload();
    });
  }, [reload]);

  const tick = useViewportTick();
  useEffect(() => {
    if (enabled && tick > 0) recompute();
  }, [tick, enabled, recompute]);

  useEffect(() => {
    if (!enabled) return;
    let timer = 0;
    let last = 0;
    const schedule = () => {
      if (timer) return;
      const wait = Math.max(0, 250 - (Date.now() - last));
      timer = window.setTimeout(() => {
        timer = 0;
        last = Date.now();
        recompute();
      }, wait);
    };
    const mo = new MutationObserver((records) => {
      if (records.every((r) => host && (r.target === host || host.contains(r.target)))) return;
      schedule();
    });
    mo.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'open'],
    });
    return () => {
      mo.disconnect();
      if (timer) window.clearTimeout(timer);
    };
  }, [enabled, host, recompute]);

  const detachedKey = annotations.filter((a) => resolved.get(a.id)?.status === 'detached').map((a) => a.id).join('|');
  const detachedIds = useMemo<ReadonlySet<string>>(() => new Set(detachedKey ? detachedKey.split('|') : []), [detachedKey]);

  return { annotations, resolved, detachedIds, reload };
}
