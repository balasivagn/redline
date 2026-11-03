import { useEffect, type RefObject } from 'react';

/**
 * Close an inline popover on outside pointer-down, Esc, or focus leaving it.
 * Uses composedPath() so it also works when the component lives in a shadow root.
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const inside = (e: Event) => {
      const el = ref.current;
      if (!el) return false;
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      return path.includes(el) || (e.target instanceof Node && el.contains(e.target));
    };
    const onPointer = (e: Event) => {
      if (!inside(e)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [ref, open, onClose]);
}
