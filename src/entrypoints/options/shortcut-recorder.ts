import type { Shortcuts } from '../../core/settings';

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey'>;

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'OS', 'CapsLock', 'Fn', 'FnLock']);
/** Keys we refuse to record: Esc cancels recording, Tab breaks navigation, '+' is the separator. */
const REJECTED_KEYS = new Set(['Escape', 'Tab', '+', 'Dead', 'Unidentified', 'Process', 'Compose']);

export type RecordResult =
  | { kind: 'shortcut'; value: string }
  | { kind: 'cancel' }
  | { kind: 'ignore' }; // modifier-only press, keep waiting

/**
 * Build a shortcut string such as "Alt+Space" or "Shift+L" from a keydown, in the format that
 * `matchesShortcut` (src/core/settings.ts) understands: letters/digits are matched by physical
 * key (code), everything else by `key` — so we record the same thing we later compare against.
 */
export function recordShortcut(e: KeyLike): RecordResult {
  if (e.key === 'Escape' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) return { kind: 'cancel' };
  if (MODIFIER_KEYS.has(e.key) || REJECTED_KEYS.has(e.key)) return { kind: 'ignore' };

  let main: string;
  const code = e.code ?? '';
  if (code === 'Space') main = 'Space';
  else if (/^Key[A-Z]$/.test(code)) main = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) main = code.slice(5);
  else if (e.key.length === 1) main = e.key.toUpperCase();
  else main = e.key; // ArrowUp, Enter, F2, …
  if (!main) return { kind: 'ignore' };

  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  parts.push(main);
  return { kind: 'shortcut', value: parts.join('+') };
}

/** Canonical form for comparing shortcuts (case/order/alias-insensitive). */
export function normalizeShortcut(shortcut: string): string {
  const parts = shortcut.split('+').map((p) => p.trim().toLowerCase()).filter(Boolean);
  const key = parts.pop() ?? '';
  const mods = new Set(parts.map((p) => (p === 'cmd' ? 'meta' : p)));
  return [...['ctrl', 'alt', 'shift', 'meta'].filter((m) => mods.has(m)), key].join('+');
}

export type ShortcutName = keyof Shortcuts;
export const SHORTCUT_NAMES: ShortcutName[] = ['pin', 'area', 'screenshot', 'list', 'dictate'];

/** For each shortcut, the other shortcuts that use the same combination. */
export function findConflicts(shortcuts: Shortcuts): Partial<Record<ShortcutName, ShortcutName[]>> {
  const out: Partial<Record<ShortcutName, ShortcutName[]>> = {};
  for (const a of SHORTCUT_NAMES) {
    const same = SHORTCUT_NAMES.filter((b) => b !== a && normalizeShortcut(shortcuts[b]) === normalizeShortcut(shortcuts[a]));
    if (same.length) out[a] = same;
  }
  return out;
}

/** Dictate also fires inside the comment box, so without a modifier it would eat typed characters. */
export function dictateNeedsModifier(shortcut: string): boolean {
  const parts = normalizeShortcut(shortcut).split('+');
  const key = parts[parts.length - 1] ?? '';
  const isTypable = key.length === 1 || key === 'space';
  return isTypable && parts.length === 1;
}
