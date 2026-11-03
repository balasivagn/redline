import { useCallback, useId, useRef, useState } from 'react';
import type { Annotation } from '../../core/schema';
import { cn } from '../shared/cn';
import { copyAnnotations, downloadBundle, FORMAT_LABEL, type CopyFormat } from './copy';
import { useDismiss } from './useDismiss';

export interface CopyScopeOption {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface CopyMenuProps {
  /** Button text, e.g. "Copy" or "Copy 3". */
  label: string;
  scopes: CopyScopeOption[];
  /** Scope preselected whenever the menu opens (falls back to the first enabled scope). */
  defaultScope: string;
  defaultFormat: CopyFormat;
  /** Resolve a scope id to the annotations to export. */
  resolve: (scope: string) => Promise<Annotation[]>;
  onToast: (message: string, kind?: 'info' | 'error') => void;
  align?: 'left' | 'right';
  disabled?: boolean;
}

const itemCls =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-rl-text hover:bg-rl-line/60 focus-visible:bg-rl-line/60 focus-visible:outline-2 focus-visible:outline-rl-accent-2 disabled:opacity-50';

export function CopyMenu({
  label,
  scopes,
  defaultScope,
  defaultFormat,
  resolve,
  onToast,
  align = 'right',
  disabled,
}: CopyMenuProps) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(root, open, close);

  const enabled = (id: string) => scopes.find((s) => s.id === id && !s.disabled) !== undefined;
  const scope = chosen && enabled(chosen) ? chosen : enabled(defaultScope) ? defaultScope : (scopes.find((s) => !s.disabled)?.id ?? defaultScope);
  const formats: CopyFormat[] = defaultFormat === 'json' ? ['json', 'markdown'] : ['markdown', 'json'];

  const run = async (job: (annotations: Annotation[]) => Promise<string>) => {
    setBusy(true);
    try {
      const annotations = await resolve(scope);
      if (annotations.length === 0) {
        onToast('Nothing to copy', 'error');
      } else {
        onToast(await job(annotations));
      }
      setOpen(false);
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={root} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setChosen(null);
          setOpen((o) => !o);
        }}
        className="inline-flex items-center gap-1 rounded-md border border-rl-line bg-rl-ink-2 px-2.5 py-1 text-sm text-rl-text hover:border-rl-muted focus-visible:outline-2 focus-visible:outline-rl-accent-2 disabled:opacity-50"
      >
        <span>{label}</span>
        <span aria-hidden="true" className="text-xs text-rl-muted">▾</span>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Copy options"
          className={cn(
            'absolute top-full z-20 mt-1 w-[280px] max-w-[calc(100vw-24px)] rounded-lg border border-rl-line bg-rl-ink p-1.5 shadow-xl',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {formats.map((f, i) => (
            <button
              key={f}
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => void run((a) => copyAnnotations(a, f))}
              className={itemCls}
            >
              <span aria-hidden="true" className="w-5 text-center text-rl-muted">{f === 'json' ? '{ }' : '⧉'}</span>
              <span className="flex-1">
                Copy as {FORMAT_LABEL[f]}
                {f === 'markdown' ? ' (for agents)' : ''}
              </span>
              {i === 0 && <span className="text-xs text-rl-muted">default</span>}
            </button>
          ))}
          <div className="my-1.5 h-px bg-rl-line" />
          <fieldset className="px-2 py-1">
            <legend className="mb-1 text-xs uppercase tracking-wide text-rl-muted">Scope</legend>
            <div className="flex flex-col gap-1">
              {scopes.map((s) => (
                <label
                  key={s.id}
                  className={cn('flex items-center gap-2 text-sm', s.disabled ? 'text-rl-muted opacity-60' : 'cursor-pointer text-rl-text')}
                >
                  <input
                    type="radio"
                    name={`${menuId}-scope`}
                    className="accent-rl-accent"
                    checked={scope === s.id}
                    disabled={s.disabled}
                    onChange={() => setChosen(s.id)}
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="my-1.5 h-px bg-rl-line" />
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => void run(downloadBundle)}
            className={cn(itemCls, 'items-start')}
          >
            <span aria-hidden="true" className="w-5 text-center text-rl-muted">⬇</span>
            <span className="flex-1">
              Export .zip (for sharing)
              <span className="block text-xs text-rl-muted">review.md · annotations.json · shots/*.png</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
