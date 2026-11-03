import { useCallback, useEffect, useMemo, useState } from 'react';
import { onRedlineEvent, rpc } from '../../core/rpc';
import type { Annotation, PageSummary } from '../../core/schema';
import { CopyMenu, type CopyScopeOption } from '../../ui/list/CopyMenu';
import { loadAllAnnotations } from '../../ui/list/copy';
import { ReviewList } from '../../ui/list/ReviewList';
import { ToastHost, useToasts } from '../../ui/list/Toast';
import { formatRelativeTime } from '../../ui/list/time';
import { useSettings } from '../../ui/list/useSettings';
import { cn } from '../../ui/shared/cn';
import { groupByOrigin, hashForPage, originCheckState, pageFromHash, toggleOrigin, togglePage, type OriginGroup } from './groups';
import { filterPages, tokenize } from './search';

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rl-accent-2';

function openUrl(url: string) {
  try {
    void chrome.tabs.create({ url });
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

export function App() {
  const { settings } = useSettings();
  const { toasts, push, dismiss } = useToasts();
  const [pages, setPages] = useState<PageSummary[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [openKey, setOpenKey] = useState<string | null>(() => pageFromHash(location.hash));
  const [annotations, setAnnotations] = useState<Record<string, Annotation[]> | undefined>();
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const rows = await rpc('ann/listAll', {});
      setPages(rows);
      setError('');
      const alive = new Set(rows.map((r) => r.pageKey));
      setChecked((c) => {
        const next = new Set([...c].filter((k) => alive.has(k)));
        return next.size === c.size ? c : next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPages((p) => p ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
    const off = onRedlineEvent((e) => {
      if (e.type === 'ann/changed') {
        void load();
        setAnnotations(undefined); // search index is stale
      }
    });
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      off();
      clearInterval(tick);
    };
  }, [load]);

  useEffect(() => {
    const onHash = () => setOpenKey(pageFromHash(location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Search needs comment text/selectors: load them lazily, only once the user types.
  const searching = tokenize(query).length > 0;
  const pagesSig = (pages ?? []).map((p) => `${p.pageKey}:${p.updatedAt}:${p.count}`).join('|');
  useEffect(() => {
    if (!searching || !pages || annotations) return;
    let alive = true;
    const keys = pages.map((p) => p.pageKey);
    (keys.length ? rpc('ann/listPages', { pageKeys: keys }) : Promise.resolve([] as Annotation[]))
      .then((rows) => {
        if (!alive) return;
        const by: Record<string, Annotation[]> = {};
        for (const a of rows) (by[a.pageKey] ??= []).push(a);
        setAnnotations(by);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching, pagesSig, annotations]);

  const matches = useMemo(() => filterPages(pages ?? [], annotations, query), [pages, annotations, query]);
  const matchCount = useMemo(() => new Map(matches.map((m) => [m.page.pageKey, m.matches])), [matches]);
  const groups = useMemo(() => groupByOrigin(matches.map((m) => m.page)), [matches]);
  const total = (pages ?? []).reduce((n, p) => n + p.count, 0);

  const selectPage = (key: string) => {
    setOpenKey(key);
    history.replaceState(null, '', hashForPage(key));
  };

  const scopes: CopyScopeOption[] = [
    { id: 'checked', label: `Checked pages${checked.size ? ` (${checked.size})` : ''}`, disabled: checked.size === 0 },
    { id: 'all', label: 'All pages' },
  ];
  const resolve = async (scope: string): Promise<Annotation[]> => {
    if (scope === 'all') return loadAllAnnotations();
    const keys = [...checked];
    return keys.length ? rpc('ann/listPages', { pageKeys: keys }) : [];
  };

  const openPage = pages?.find((p) => p.pageKey === openKey);

  return (
    <div className="flex h-screen flex-col bg-rl-ink text-rl-text">
      <header className="flex flex-wrap items-center gap-4 border-b border-rl-line px-5 py-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <span aria-hidden="true" className="text-rl-accent">✎</span> Redline — All reviews
        </h1>
        <span className="text-xs text-rl-muted">
          {pages ? `${total} comment${total === 1 ? '' : 's'} · ${pages.length} page${pages.length === 1 ? '' : 's'}` : ''}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <label className="relative block">
            <span className="sr-only">Search comments, titles, URLs and selectors</span>
            <span aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-rl-muted">🔍</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search…"
              className={cn('w-[260px] rounded-md border border-rl-line bg-rl-ink-2 py-1.5 pl-8 pr-2.5 text-sm placeholder:text-rl-muted', focusRing)}
            />
          </label>
          <CopyMenu
            label={checked.size ? `Copy ${checked.size} page${checked.size === 1 ? '' : 's'}` : 'Copy'}
            scopes={scopes}
            defaultScope={checked.size ? 'checked' : 'all'}
            defaultFormat={settings.copyFormat}
            resolve={resolve}
            onToast={(m, kind) => push(m, { kind })}
            disabled={!pages || pages.length === 0}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav aria-label="Pages" className="w-[min(520px,48%)] shrink-0 overflow-y-auto border-r border-rl-line">
          {pages === null && <p className="p-6 text-center text-rl-muted">Loading…</p>}
          {error && <p className="p-4 text-rl-accent-2">Couldn&apos;t load reviews: {error}</p>}
          {pages && pages.length === 0 && !error && (
            <div className="p-10 text-center">
              <p className="text-base font-medium">No reviews yet</p>
              <p className="mt-1 text-rl-muted">Turn Redline on for a page and drop a pin. Comments from every page show up here.</p>
            </div>
          )}
          {pages && pages.length > 0 && groups.length === 0 && (
            <p className="p-6 text-center text-rl-muted">
              {annotations === undefined && searching ? 'Searching…' : `Nothing matches “${query}”.`}
            </p>
          )}
          {groups.map((g) => (
            <OriginBlock
              key={g.origin}
              group={g}
              checked={checked}
              openKey={openKey}
              now={now}
              searching={searching}
              matchCount={matchCount}
              onToggleOrigin={() => setChecked(toggleOrigin(g, checked))}
              onTogglePage={(k) => setChecked(togglePage(checked, k))}
              onSelect={selectPage}
            />
          ))}
        </nav>

        <main className="min-w-0 flex-1">
          {openKey && openPage ? (
            <div className="flex h-full flex-col">
              <div className="border-b border-rl-line px-4 py-3">
                <p className="truncate font-medium">{openPage.title || openPage.path}</p>
                <a
                  href={openPage.url}
                  onClick={(e) => {
                    e.preventDefault();
                    openUrl(openPage.url);
                  }}
                  className={cn('block truncate text-xs text-rl-muted hover:underline', focusRing)}
                >
                  {openPage.url} ↗
                </a>
              </div>
              <div className="min-h-0 flex-1">
                <ReviewList variant="page" pageKeys={[openKey]} onFocus={(a) => openUrl(a.page.url)} />
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-10 text-center text-rl-muted">
              {openKey && pages ? 'That page has no comments any more.' : 'Pick a page to see its comments.'}
            </div>
          )}
        </main>
      </div>
      <ToastHost toasts={toasts} dismiss={dismiss} className="fixed bottom-4 left-1/2 w-[min(420px,calc(100vw-32px))] -translate-x-1/2" />
    </div>
  );
}

function OriginBlock({
  group,
  checked,
  openKey,
  now,
  searching,
  matchCount,
  onToggleOrigin,
  onTogglePage,
  onSelect,
}: {
  group: OriginGroup;
  checked: ReadonlySet<string>;
  openKey: string | null;
  now: number;
  searching: boolean;
  matchCount: Map<string, number>;
  onToggleOrigin: () => void;
  onTogglePage: (key: string) => void;
  onSelect: (key: string) => void;
}) {
  const state = originCheckState(group, checked);
  return (
    <section aria-label={group.host} className="border-b border-rl-line">
      <div className="flex items-center gap-3 bg-rl-ink-2 px-4 py-2">
        <input
          type="checkbox"
          className={cn('h-4 w-4 accent-rl-accent', focusRing)}
          aria-label={`Select all pages on ${group.host}`}
          checked={state === 'all'}
          ref={(el) => {
            if (el) el.indeterminate = state === 'some';
          }}
          onChange={onToggleOrigin}
        />
        <span className="min-w-0 flex-1 truncate font-medium">{group.host}</span>
        <span className="text-xs text-rl-muted">{group.count}</span>
      </div>
      <ul>
        {group.pages.map((p) => (
          <li
            key={p.pageKey}
            className={cn('flex items-center gap-3 border-t border-rl-line/60 py-1.5 pl-9 pr-3', openKey === p.pageKey && 'bg-rl-accent/10')}
          >
            <input
              type="checkbox"
              className={cn('h-4 w-4 shrink-0 accent-rl-accent', focusRing)}
              aria-label={`Select ${p.path}`}
              checked={checked.has(p.pageKey)}
              onChange={() => onTogglePage(p.pageKey)}
            />
            <button
              type="button"
              onClick={() => onSelect(p.pageKey)}
              aria-current={openKey === p.pageKey ? 'true' : undefined}
              className={cn('grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-sm px-1 py-1 text-left', focusRing)}
            >
              <span className="min-w-0">
                <span className="block truncate font-mono text-xs">{p.path || '/'}</span>
                <span className="block truncate text-xs text-rl-muted">
                  {p.title || 'Untitled'}
                  {searching && (matchCount.get(p.pageKey) ?? 0) > 0 ? ` · ${matchCount.get(p.pageKey)} matching` : ''}
                </span>
              </span>
              <span className="flex items-baseline gap-3 text-xs text-rl-muted">
                <span className="font-semibold text-rl-text">{p.count}</span>
                <span className="w-[72px] text-right">{formatRelativeTime(p.updatedAt, now)}</span>
              </span>
            </button>
            <button
              type="button"
              aria-label={`Open ${p.url} in a new tab`}
              title="Open this page with its pins"
              onClick={() => openUrl(p.url)}
              className={cn('shrink-0 rounded-md px-2 py-1 text-rl-muted hover:bg-rl-line/60 hover:text-rl-text', focusRing)}
            >
              ↗
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
