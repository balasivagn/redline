import { useEffect, useRef, useState } from 'react';
import type { Annotation } from '../../core/schema';
import { cn } from '../shared/cn';
import { describeDom } from './describe';
import { ShotThumb } from './ShotImage';
import { formatRelativeTime } from './time';

export interface ReviewRowProps {
  annotation: Annotation;
  variant: 'drawer' | 'page';
  selected: boolean;
  detached: boolean;
  /** Show the page path (when the list spans several pages). */
  showPath: boolean;
  editing: boolean;
  now: number;
  canRepin: boolean;
  onToggle: () => void;
  onFocus: () => void;
  onRepin: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (text: string) => Promise<void>;
  onCopy: () => void;
  /** Open the screenshot lightbox (rows with a screenshot). */
  onOpenShot: () => void;
  /** Copy the screenshot image to the clipboard. */
  onCopyShot: () => void;
  onDelete: () => void;
}

const iconBtn =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-rl-muted hover:bg-rl-line/60 hover:text-rl-text focus-visible:outline-2 focus-visible:outline-rl-accent-2';

export function ReviewRow(p: ReviewRowProps) {
  const a = p.annotation;
  const isArea = a.anchor.kind === 'area';
  const when = formatRelativeTime(a.updatedAt || a.createdAt, p.now);
  const descriptor = describeDom(a.dom);

  return (
    <li
      data-testid="review-row"
      data-id={a.id}
      className={cn(
        'group border-b border-rl-line px-3 py-2.5',
        p.selected && 'bg-rl-accent/10',
        p.variant === 'page' && 'px-4',
      )}
      onClick={(e) => {
        // Only blank areas of the row trigger focus; controls/body button handle themselves.
        if ((e.target as HTMLElement).closest('button,input,textarea,a,label')) return;
        p.onFocus();
      }}
    >
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0 accent-rl-accent"
          checked={p.selected}
          onChange={p.onToggle}
          aria-label={`Select comment ${a.number}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              aria-label={`Comment ${a.number}`}
              className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-rl-accent px-1 text-xs font-semibold text-white"
            >
              {a.number}
            </span>
            {isArea && (
              <span role="img" aria-label="Area comment" title="Area" className="shrink-0 text-rl-muted">
                ▭
              </span>
            )}
            {p.detached && (
              <span className="shrink-0 rounded-sm bg-rl-warn/15 px-1.5 text-xs font-medium text-rl-warn">⚠ detached</span>
            )}
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-rl-muted" title={a.anchor.selector}>
              {descriptor}
            </span>
            {a.screenshot && (
              <span role="img" aria-label="Has screenshot" title="Has screenshot" className="shrink-0 text-xs">
                📷
              </span>
            )}
            {a.comment.source !== 'typed' && (
              <span role="img" aria-label="Dictated" title="Dictated" className="shrink-0 text-xs">
                🎤
              </span>
            )}
          </div>

          {p.editing ? (
            <EditBox initial={a.comment.text} onCancel={p.onCancelEdit} onSave={p.onSaveEdit} />
          ) : (
            <>
              <div className="mt-1 flex items-start gap-2">
                <button
                  type="button"
                  onClick={p.onFocus}
                  title={p.variant === 'drawer' ? 'Scroll to this pin' : 'Open this page'}
                  className="block min-w-0 flex-1 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-rl-accent-2"
                >
                  <span className="line-clamp-3 block whitespace-pre-wrap break-words text-sm text-rl-text">
                    {a.comment.text || <em className="text-rl-muted">(empty)</em>}
                  </span>
                  {p.showPath && <span className="mt-0.5 block truncate text-xs text-rl-muted">{a.page.path}</span>}
                </button>
                {a.screenshot && (
                  <ShotThumb shotId={a.screenshot.shotId} label={`Open screenshot for comment ${a.number}`} onOpen={p.onOpenShot} />
                )}
              </div>
              <div className="mt-1 flex items-center gap-1">
                <span className="flex-1 truncate text-xs text-rl-muted" title={new Date(a.updatedAt).toLocaleString()}>
                  {when}
                </span>
                {p.detached && p.canRepin && (
                  <button
                    type="button"
                    onClick={p.onRepin}
                    className="rounded-md px-1.5 py-1 text-xs font-medium text-rl-warn hover:bg-rl-warn/10 focus-visible:outline-2 focus-visible:outline-rl-accent-2"
                  >
                    ⌖ re-pin
                  </button>
                )}
                <button type="button" className={iconBtn} onClick={p.onStartEdit} aria-label={`Edit comment ${a.number}`} title="Edit">
                  ✎
                </button>
                <button type="button" className={iconBtn} onClick={p.onCopy} aria-label={`Copy comment ${a.number}`} title="Copy">
                  ⧉
                </button>
                {a.screenshot && (
                  <button type="button" className={iconBtn} onClick={p.onCopyShot} aria-label={`Copy image of comment ${a.number}`} title="Copy image">
                    🖼
                  </button>
                )}
                <button
                  type="button"
                  className={cn(iconBtn, 'hover:text-rl-accent-2')}
                  onClick={p.onDelete}
                  aria-label={`Delete comment ${a.number}`}
                  title="Delete"
                >
                  🗑
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function EditBox({
  initial,
  onCancel,
  onSave,
}: {
  initial: string;
  onCancel: () => void;
  onSave: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const canSave = !saving && text.trim().length > 0 && text !== initial;
  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(text.trim());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-1.5">
      <textarea
        ref={ref}
        value={text}
        rows={4}
        aria-label="Edit comment"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation(); // keep host-page key handlers out of the editor
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
        onKeyUp={(e) => e.stopPropagation()}
        onKeyPress={(e) => e.stopPropagation()}
        className="block w-full resize-y rounded-md border border-rl-line bg-rl-ink-2 px-2 py-1.5 text-sm text-rl-text focus:border-rl-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-rl-accent-2"
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-xs text-rl-muted">⌘↵ save · Esc cancel</span>
        <span className="flex gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-2 py-1 text-sm text-rl-muted hover:text-rl-text focus-visible:outline-2 focus-visible:outline-rl-accent-2"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => void save()}
            className="rounded-md bg-rl-accent px-2.5 py-1 text-sm font-medium text-white hover:bg-rl-accent-2 focus-visible:outline-2 focus-visible:outline-rl-accent-2 disabled:opacity-50"
          >
            Save
          </button>
        </span>
      </div>
    </div>
  );
}
