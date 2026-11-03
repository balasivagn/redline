import { useCallback, useRef } from 'react';
import type { Annotation } from '../../core/schema';
import { ShotImage } from './ShotImage';
import { useDismiss } from './useDismiss';

export interface ShotLightboxProps {
  annotation: Annotation;
  onClose: () => void;
  onCopyImage: () => void;
  onCopyPath: (path: string) => void;
}

/**
 * Full-size screenshot overlay. Renders inline (absolute, filling the nearest positioned
 * ancestor) so it works inside a shadow root with no portal. Esc / click outside closes it.
 */
export function ShotLightbox({ annotation: a, onClose, onCopyImage, onCopyPath }: ShotLightboxProps) {
  const shot = a.screenshot;
  const panel = useRef<HTMLDivElement>(null);
  const pathField = useRef<HTMLInputElement>(null);
  useDismiss(panel, true, onClose);
  // The page-level Esc handler ignores focused text fields, so keep a (read-only) one focused:
  // Esc then closes only the lightbox, not the whole drawer.
  const refocus = useCallback(() => pathField.current?.focus(), []);
  if (!shot) return null;
  const path = shot.path;

  return (
    <div className="absolute inset-0 z-[25] flex items-center justify-center bg-black/75 p-3">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`Screenshot for comment ${a.number}`}
        data-testid="shot-lightbox"
        className="flex max-h-full w-full max-w-[1100px] flex-col overflow-hidden rounded-lg border border-rl-line bg-rl-ink shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-rl-line px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm text-rl-text">
            Comment {a.number} · {shot.width}×{shot.height}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close screenshot"
            title="Close (Esc)"
            className="rounded-md px-2 py-0.5 text-rl-muted hover:bg-rl-line/60 hover:text-rl-text focus-visible:outline-2 focus-visible:outline-rl-accent-2"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-black/40 p-2">
          <ShotImage shotId={shot.shotId} alt={`Screenshot for comment ${a.number}`} testId="shot-full" className="mx-auto block h-auto max-h-full w-auto max-w-full rounded-sm" />
        </div>
        <div className="flex flex-col gap-2 border-t border-rl-line px-3 py-2">
          <div className="flex items-center gap-1.5">
            <input
              ref={pathField}
              autoFocus
              readOnly
              aria-label="Screenshot file path"
              value={path ?? 'Not saved to a file (install the Redline helper to get a path)'}
              onFocus={(e) => path && e.currentTarget.select()}
              onKeyDown={(e) => e.stopPropagation()}
              onKeyUp={(e) => e.stopPropagation()}
              onKeyPress={(e) => e.stopPropagation()}
              className="min-w-0 flex-1 truncate rounded-md border border-rl-line bg-rl-ink-2 px-2 py-1 font-mono text-xs text-rl-muted focus:border-rl-accent focus:outline-none"
            />
            {path && (
              <button
                type="button"
                onClick={() => {
                  onCopyPath(path);
                  refocus();
                }}
                aria-label="Copy file path"
                title="Copy file path"
                className="shrink-0 rounded-md border border-rl-line px-2 py-1 text-rl-text hover:border-rl-muted focus-visible:outline-2 focus-visible:outline-rl-accent-2"
              >
                ⧉
              </button>
            )}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                onCopyImage();
                refocus();
              }}
              className="rounded-md bg-rl-accent px-2.5 py-1 text-sm font-medium text-white hover:bg-rl-accent-2 focus-visible:outline-2 focus-visible:outline-rl-accent-2"
            >
              Copy image
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
