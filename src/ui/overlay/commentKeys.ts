import { DEFAULT_SETTINGS, formatShortcut, matchesShortcut, type Settings, type Shortcuts } from '../../core/settings';

export type CommentBoxKeyAction = 'save' | 'newline' | 'cancel-voice' | 'cancel' | 'close-details' | 'dictate' | 'toggle-shot' | null;

export type VoicePhaseName = 'idle' | 'starting' | 'listening' | 'transcribing' | 'error' | string;

export interface CommentBoxKeyContext {
  enterToSave: boolean;
  /** Dictation is starting, listening or transcribing. */
  voiceBusy: boolean;
  /** Only `starting` / `listening` are cancelled by Esc; defaults to "listening" when voiceBusy. */
  voicePhase?: VoicePhaseName;
  hasText: boolean;
  /** IME composition in progress (also inferred from the event). */
  composing?: boolean;
  /** The event originated in the comment textarea (plain Enter only means save/newline there). Default true. */
  inTextarea?: boolean;
  /** Focus is inside the DOM details panel. */
  detailsFocused?: boolean;
  /** The 📷 toggle exists (hidden when editing an existing comment). Default true. */
  canToggleShot?: boolean;
  shortcuts?: Pick<Shortcuts, 'dictate' | 'screenshot'>;
}

/**
 * Map a keydown inside the comment box to an action. `newline` means "let the browser insert it";
 * every other non-null action is handled by the caller, which should preventDefault.
 */
export function commentBoxKeyAction(e: KeyboardEvent, ctx: CommentBoxKeyContext): CommentBoxKeyAction {
  const composing = ctx.composing || e.isComposing || e.keyCode === 229;
  const inTextarea = ctx.inTextarea ?? true;
  const sc = ctx.shortcuts ?? DEFAULT_SETTINGS.shortcuts;

  if (e.key === 'Escape') {
    if (composing) return null;
    const phase = ctx.voicePhase ?? (ctx.voiceBusy ? 'listening' : 'idle');
    if (phase === 'starting' || phase === 'listening') return 'cancel-voice';
    if (ctx.detailsFocused) return 'close-details';
    return 'cancel';
  }

  if (e.key === 'Enter') {
    if (composing) return null;
    if (e.metaKey || e.ctrlKey) return 'save';
    if (e.altKey || !inTextarea) return null;
    if (e.shiftKey) return 'newline';
    if (!ctx.enterToSave) return 'newline';
    if (ctx.voiceBusy) return null;
    return ctx.hasText ? 'save' : null;
  }

  if (e.repeat) return null;
  if (matchesShortcut(e, sc.dictate)) return 'dictate';
  if (ctx.canToggleShot !== false && /^[a-z]$/i.test(sc.screenshot.trim()) && matchesShortcut(e, `Alt+${sc.screenshot.trim()}`)) return 'toggle-shot';
  return null;
}

/** Footer hint, e.g. "↵ save · ⇧↵ new line · ⌥ Space dictate". */
export function commentHint(settings: Pick<Settings, 'enterToSave' | 'shortcuts'>, mac = true): string {
  const dictate = formatShortcut(settings.shortcuts.dictate, mac);
  const mod = mac ? '⌘' : 'Ctrl+';
  return settings.enterToSave ? `↵ save · ⇧↵ new line · ${dictate} dictate` : `${mod}↵ save · ${dictate} dictate`;
}

/** Title for the 📷 toggle's shortcut, or '' when the configured key is not a single letter. */
export function screenshotBoxShortcut(shortcuts: Pick<Shortcuts, 'screenshot'>, mac = true): string {
  const k = shortcuts.screenshot.trim();
  return /^[a-z]$/i.test(k) ? formatShortcut(`Alt+${k}`, mac).replace(/\s/g, '') : '';
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]';

/** Tabbable elements inside `root`, in DOM order (skips disabled, hidden and tabindex=-1). */
export function focusableElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.hasAttribute('disabled') || el.hasAttribute('hidden') || el.closest('[hidden],[inert]')) return false;
    const ti = el.getAttribute('tabindex');
    if (ti !== null && Number(ti) < 0) return false;
    if (el instanceof HTMLInputElement && el.type === 'hidden') return false;
    return true;
  });
}

/**
 * Focus trap: the element to focus when Tab / Shift+Tab would leave the list, else null (let the
 * browser move focus naturally).
 */
export function trapTarget(list: HTMLElement[], active: Element | null, shift: boolean): HTMLElement | null {
  const first = list[0];
  const last = list[list.length - 1];
  if (!first || !last) return null;
  const i = active ? list.indexOf(active as HTMLElement) : -1;
  if (i === -1) return shift ? last : first;
  if (shift && i === 0) return last;
  if (!shift && i === list.length - 1) return first;
  return null;
}
