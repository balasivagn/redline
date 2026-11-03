export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-center gap-3 rounded-lg border border-rl-line bg-rl-ink px-3 py-2 text-sm text-rl-text shadow-xl"
        >
          <span>{t.text}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action?.run();
                dismiss(t.id);
              }}
              className="rounded-md px-2 py-0.5 text-xs font-semibold text-rl-accent-2 hover:bg-rl-ink-2 focus-visible:ring-2 focus-visible:ring-rl-accent focus-visible:outline-none"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
