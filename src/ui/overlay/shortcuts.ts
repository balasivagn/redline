import { matchesShortcut, type Shortcuts } from '../../core/settings';
import type { Mode } from './state';

export type ShortcutAction = 'pin' | 'area' | 'screenshot' | 'list' | 'dictate' | 'escape';

/** The innermost target of an event, piercing open shadow roots. */
export function deepTarget(e: Event): EventTarget | null {
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
  return path[0] ?? e.target;
}

export function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el !== 'object' || !('tagName' in el)) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  const ce = el.getAttribute?.('contenteditable');
  if (ce !== null && ce !== undefined && ce !== 'false') return true;
  return el.getAttribute?.('role') === 'textbox';
}

export interface ShortcutContext {
  mode: Mode;
  /** The event happened inside our own comment box. */
  inCommentBox: boolean;
}

/**
 * Map a keydown to a Redline action. Escape always counts. Everything else is ignored while focus
 * is in a text field (ours or the page's), except dictate inside our comment box.
 */
export function resolveShortcut(e: KeyboardEvent, shortcuts: Shortcuts, ctx: ShortcutContext): ShortcutAction | null {
  if (e.key === 'Escape') return 'escape';
  if (e.repeat || e.isComposing) return null;
  if (isEditableTarget(deepTarget(e))) {
    return ctx.inCommentBox && ctx.mode === 'editing' && matchesShortcut(e, shortcuts.dictate) ? 'dictate' : null;
  }
  if (ctx.mode === 'editing' && ctx.inCommentBox && matchesShortcut(e, shortcuts.dictate)) return 'dictate';
  if (ctx.mode !== 'toolbar' && ctx.mode !== 'pin' && ctx.mode !== 'area') return null;
  if (matchesShortcut(e, shortcuts.pin)) return 'pin';
  if (matchesShortcut(e, shortcuts.area)) return 'area';
  if (matchesShortcut(e, shortcuts.screenshot)) return 'screenshot';
  if (matchesShortcut(e, shortcuts.list)) return 'list';
  return null;
}
