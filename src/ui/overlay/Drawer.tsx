import { useEffect, useState } from 'react';
import type { Annotation } from '../../core/schema';
import { ReviewList } from '../list/ReviewList';
import { CloseIcon } from './icons';
import { DRAWER_WIDTH } from './Pill';

interface Props {
  open: boolean;
  pageKey: string;
  count: number;
  detachedIds: ReadonlySet<string>;
  onClose: () => void;
  onFocus: (a: Annotation) => void;
  onRepin: (a: Annotation) => void;
  onEditInPage: (a: Annotation) => void;
}

/** W8: right-hand drawer shell (header here, list body is the shared <ReviewList>). */
export function Drawer({ open, pageKey, count, detachedIds, onClose, onFocus, onRepin, onEditInPage }: Props) {
  // Mount the list on first open and keep it so reopening is instant.
  const [everOpened, setEverOpened] = useState(open);
  useEffect(() => {
    if (open) setEverOpened(true);
  }, [open]);

  return (
    <aside
      aria-label="Redline comments"
      aria-hidden={!open}
      inert={!open}
      className="pointer-events-auto fixed top-0 right-0 bottom-0 flex flex-col border-l border-rl-line bg-rl-ink text-rl-text shadow-2xl"
      style={{
        width: DRAWER_WIDTH,
        maxWidth: '100vw',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        visibility: open ? 'visible' : 'hidden',
        transition: `transform 150ms ease, visibility 0s linear ${open ? '0s' : '150ms'}`,
      }}
    >
      <header className="flex items-start gap-2 border-b border-rl-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">Redline · {location.pathname || '/'}</h2>
          <p className="truncate text-xs text-rl-muted">
            {location.host || location.origin} · {count} comment{count === 1 ? '' : 's'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close list"
          title="Close (Esc)"
          className="rounded-md p-1.5 text-rl-muted transition-colors duration-150 hover:bg-rl-ink-2 hover:text-rl-text focus-visible:ring-2 focus-visible:ring-rl-accent focus-visible:outline-none"
        >
          <CloseIcon />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {everOpened && (
          <ReviewList
            variant="drawer"
            pageKeys={[pageKey]}
            detachedIds={detachedIds}
            onFocus={onFocus}
            onRepin={onRepin}
            onEditInPage={onEditInPage}
          />
        )}
      </div>
    </aside>
  );
}
