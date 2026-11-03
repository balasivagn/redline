/**
 * Shared list used by the in-page drawer (W8/W8b/W9) and the All reviews page (W10).
 * Fetches via rpc('ann/listPages'), re-fetches on the 'ann/changed' event, and owns
 * select-all / inline edit / delete+undo / copy menu. Keep these props stable — the overlay (T5)
 * renders <ReviewList variant="drawer" …/>.
 *
 * Must work inside a Shadow DOM: no portals, popovers render inline (see CopyMenu).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onRedlineEvent, rpc } from '../../core/rpc';
import type { Annotation } from '../../core/schema';
import { cn } from '../shared/cn';
import { CopyMenu, type CopyScopeOption } from './CopyMenu';
import { copyAnnotations, defaultScope, resolveScope, writeClipboard, type ListScope } from './copy';
import { sortAnnotations } from './describe';
import { ReviewRow } from './ReviewRow';
import { ShotLightbox } from './ShotLightbox';
import { copyImageError, copyShotImage } from './shots';
import { pruneSelection, selectAllState, toggleAll, toggleOne } from './selection';
import { ToastHost, useToasts } from './Toast';
import { useSettings } from './useSettings';

export interface ReviewListProps {
  /** Pages whose comments are shown (one for the drawer, one or many on the reviews page). */
  pageKeys: string[];
  variant: 'drawer' | 'page';
  /** Drawer: scroll to and flash the pin. Reviews page: open the URL with pins. */
  onFocus?: (a: Annotation) => void;
  /** Drawer only: start re-pin mode for a detached comment. */
  onRepin?: (a: Annotation) => void;
  /** Drawer only: open the in-page editor (W4) instead of inline edit. Optional. */
  onEditInPage?: (a: Annotation) => void;
  /** Ids the overlay could not re-anchor; rendered with ⚠ detached. */
  detachedIds?: ReadonlySet<string>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ReviewList({ pageKeys, variant, onFocus, onRepin, onEditInPage, detachedIds }: ReviewListProps) {
  const { settings } = useSettings();
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { toasts, push, dismiss } = useToasts();

  const keysSig = pageKeys.join('\n');
  const keysRef = useRef(pageKeys);
  keysRef.current = pageKeys;
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const keys = keysRef.current;
    const seq = ++requestSeq.current;
    if (keys.length === 0) {
      setAnnotations([]);
      setStatus('ready');
      return;
    }
    try {
      const rows = await rpc('ann/listPages', { pageKeys: keys });
      if (seq !== requestSeq.current) return; // a newer request superseded this one
      const sorted = sortAnnotations(rows, keys);
      setAnnotations(sorted);
      setSelected((s) => pruneSelection(s, sorted.map((r) => r.id)));
      setEditingId((id) => (id && sorted.some((r) => r.id === id) ? id : null));
      setStatus('ready');
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    setStatus('loading');
    setSelected(new Set());
    setEditingId(null);
    setConfirming(false);
    setLightboxId(null);
    void load();
  }, [keysSig, load]);

  useEffect(() => {
    return onRedlineEvent((e) => {
      if (e.type !== 'ann/changed') return;
      if (e.pageKeys.some((k) => keysRef.current.includes(k))) void load();
    });
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const ids = useMemo(() => annotations.map((a) => a.id), [annotations]);
  const allState = selectAllState(selected, ids);
  const selectedCount = selected.size;

  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = allState === 'some';
  }, [allState]);

  const fail = useCallback((e: unknown) => push(e instanceof Error ? e.message : String(e), { kind: 'error' }), [push]);

  const deleteIds = async (toDelete: string[]) => {
    try {
      const { deleted } = await rpc('ann/delete', { ids: toDelete });
      const gone = new Set(deleted.map((d) => d.id));
      setAnnotations((all) => all.filter((a) => !gone.has(a.id)));
      setSelected((s) => pruneSelection(s, ids.filter((id) => !gone.has(id))));
      setConfirming(false);
      if (deleted.length === 0) return;
      push(deleted.length === 1 ? 'Deleted' : `Deleted ${deleted.length} comments`, {
        action: {
          label: 'Undo',
          run: () => {
            rpc('ann/restore', { annotations: deleted })
              .then(() => load())
              .catch(fail);
          },
        },
      });
    } catch (e) {
      fail(e);
    }
  };

  const saveEdit = async (a: Annotation, text: string) => {
    try {
      const saved = await rpc('ann/save', {
        annotation: {
          ...a,
          comment: { text, source: a.comment.source === 'voice' ? 'mixed' : a.comment.source },
          updatedAt: new Date().toISOString(),
        },
      });
      setAnnotations((all) => all.map((x) => (x.id === saved.id ? saved : x)));
      setEditingId(null);
    } catch (e) {
      fail(e);
    }
  };

  const copyOne = (a: Annotation) => {
    copyAnnotations([a], settings.copyFormat)
      .then((m) => push(m))
      .catch(fail);
  };

  const copyShot = (a: Annotation) => {
    if (!a.screenshot) return;
    copyShotImage(a.screenshot.shotId)
      .then(() => push('Image copied'))
      .catch((e) => push(copyImageError(e), { kind: 'error' }));
  };

  const copyPath = (path: string) => {
    writeClipboard(path)
      .then(() => push('Path copied'))
      .catch(fail);
  };

  const lightboxAnnotation = lightboxId ? annotations.find((a) => a.id === lightboxId && a.screenshot) : undefined;

  const scopes: CopyScopeOption[] = [
    { id: 'selected', label: `Selected${selectedCount ? ` (${selectedCount})` : ''}`, disabled: selectedCount === 0 },
    { id: 'page', label: pageKeys.length === 1 ? 'This page' : 'These pages' },
    { id: 'all', label: 'All pages' },
  ];

  return (
    <section
      aria-label="Review comments"
      className={cn(
        'relative flex h-full min-h-0 flex-col bg-rl-ink text-sm text-rl-text',
        variant === 'drawer' ? 'w-full' : 'w-full min-w-0',
      )}
    >
      <div className={cn('border-b border-rl-line py-2', variant === 'drawer' ? 'px-3' : 'px-4')}>
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              ref={selectAllRef}
              type="checkbox"
              className="h-4 w-4 accent-rl-accent"
              checked={allState === 'all'}
              disabled={annotations.length === 0}
              onChange={() => setSelected(toggleAll(selected, ids))}
            />
            <span>Select all</span>
          </label>
          <span className="flex-1 text-xs text-rl-muted" aria-live="polite">
            {selectedCount > 0 ? `${selectedCount} selected` : plural(annotations.length, 'comment')}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <CopyMenu
            label={selectedCount > 0 ? `Copy ${selectedCount}` : 'Copy'}
            scopes={scopes}
            defaultScope={defaultScope(selectedCount)}
            defaultFormat={settings.copyFormat}
            resolve={(scope) => resolveScope(scope as ListScope, { annotations, selectedIds: selected })}
            onToast={(m, kind) => push(m, { kind })}
            align="left"
            disabled={annotations.length === 0}
          />
          {selectedCount > 0 && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-rl-accent/50 px-2.5 py-1 text-rl-accent-2 hover:bg-rl-accent/10 focus-visible:outline-2 focus-visible:outline-rl-accent-2"
            >
              <span aria-hidden="true">🗑</span> Delete {selectedCount}
            </button>
          )}
        </div>
        {confirming && selectedCount > 0 && (
          <div role="alertdialog" aria-label="Confirm delete" className="mt-2 rounded-lg border border-rl-line bg-rl-ink-2 p-3">
            <p className="font-medium">Delete {plural(selectedCount, 'comment')}?</p>
            <p className="mt-0.5 text-xs text-rl-muted">This can&apos;t be undone.</p>
            <div className="mt-2.5 flex justify-end gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => setConfirming(false)}
                className="rounded-md border border-rl-line px-2.5 py-1 hover:border-rl-muted focus-visible:outline-2 focus-visible:outline-rl-accent-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteIds([...selected])}
                className="rounded-md bg-rl-accent px-2.5 py-1 font-medium text-white hover:bg-rl-accent-2 focus-visible:outline-2 focus-visible:outline-rl-accent-2"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {status === 'loading' && <p className="px-4 py-6 text-center text-rl-muted">Loading…</p>}
        {status === 'error' && (
          <div className="px-4 py-6 text-center">
            <p className="text-rl-accent-2">Couldn&apos;t load comments{error ? `: ${error}` : ''}</p>
            <button
              type="button"
              onClick={() => {
                setStatus('loading');
                void load();
              }}
              className="mt-2 rounded-md border border-rl-line px-2.5 py-1 hover:border-rl-muted focus-visible:outline-2 focus-visible:outline-rl-accent-2"
            >
              Retry
            </button>
          </div>
        )}
        {status === 'ready' && annotations.length === 0 && (
          <div className="px-6 py-10 text-center">
            <p className="text-base font-medium">No comments yet</p>
            <p className="mt-1 text-rl-muted">
              {variant === 'drawer'
                ? 'Pin an element or draw an area on the page to add the first one.'
                : 'This page has no comments.'}
            </p>
          </div>
        )}
        {status === 'ready' && annotations.length > 0 && (
          <ul aria-label="Comments">
            {annotations.map((a) => (
              <ReviewRow
                key={a.id}
                annotation={a}
                variant={variant}
                selected={selected.has(a.id)}
                detached={detachedIds?.has(a.id) ?? false}
                showPath={pageKeys.length > 1}
                editing={editingId === a.id}
                now={now}
                canRepin={!!onRepin}
                onToggle={() => setSelected(toggleOne(selected, a.id))}
                onFocus={() => onFocus?.(a)}
                onRepin={() => onRepin?.(a)}
                onStartEdit={() => (onEditInPage ? onEditInPage(a) : setEditingId(a.id))}
                onCancelEdit={() => setEditingId(null)}
                onSaveEdit={(text) => saveEdit(a, text)}
                onCopy={() => copyOne(a)}
                onOpenShot={() => setLightboxId(a.id)}
                onCopyShot={() => copyShot(a)}
                onDelete={() => void deleteIds([a.id])}
              />
            ))}
          </ul>
        )}
      </div>

      {lightboxAnnotation && (
        <ShotLightbox
          annotation={lightboxAnnotation}
          onClose={() => setLightboxId(null)}
          onCopyImage={() => copyShot(lightboxAnnotation)}
          onCopyPath={copyPath}
        />
      )}

      <ToastHost toasts={toasts} dismiss={dismiss} className="absolute inset-x-3 bottom-3" />
    </section>
  );
}
