import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../shared/cn';

export interface ToastItem {
  id: number;
  message: string;
  kind: 'info' | 'error';
  action?: { label: string; run: () => void };
}

export interface ToastOptions {
  kind?: 'info' | 'error';
  action?: ToastItem['action'];
  /** Default 5000 (matches the "Deleted · Undo" window). */
  durationMs?: number;
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setToasts((all) => all.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (message: string, opts: ToastOptions = {}) => {
      const id = ++seq.current;
      setToasts((all) => [...all.slice(-2), { id, message, kind: opts.kind ?? 'info', action: opts.action }]);
      timers.current.set(id, setTimeout(() => dismiss(id), opts.durationMs ?? 5000));
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  return { toasts, push, dismiss };
}

export function ToastHost({
  toasts,
  dismiss,
  className,
}: {
  toasts: ToastItem[];
  dismiss: (id: number) => void;
  /** Positioning is up to the host: `absolute` inside the list, `fixed` on a page. */
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('pointer-events-none z-30 flex flex-col items-stretch gap-2', className)}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex items-center gap-3 rounded-lg border px-3 py-2 text-sm shadow-lg',
            t.kind === 'error'
              ? 'border-rl-accent/50 bg-rl-ink-2 text-rl-accent-2'
              : 'border-rl-line bg-rl-ink-2 text-rl-text',
          )}
        >
          <span className="min-w-0 flex-1 break-words">{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action?.run();
                dismiss(t.id);
              }}
              className="shrink-0 rounded-sm px-1 font-medium text-rl-accent-2 hover:underline focus-visible:outline-2 focus-visible:outline-rl-accent-2"
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
            className="shrink-0 rounded-sm px-1 text-rl-muted hover:text-rl-text focus-visible:outline-2 focus-visible:outline-rl-accent-2"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
