/** User settings (chrome.storage.local key `settings`). */
export type Corner = 'br' | 'bl' | 'tr' | 'tl';
export type SpeechEngineId = 'native' | 'chrome';

export interface Shortcuts {
  /** Single keys (case-insensitive) or combos like "Alt+Space". Active only while Redline UI is open
   *  and focus is not in a text field (except `dictate`, which also works inside the comment box). */
  pin: string;
  area: string;
  screenshot: string;
  list: string;
  dictate: string;
}

export interface Settings {
  version: 1;
  shortcuts: Shortcuts;
  /** 📷 toggle state; also the default for each new comment. */
  screenshotByDefault: boolean;
  pillCorner: Corner;
  voice: { engine: SpeechEngineId; modelId?: string; language: string };
  /** Origins where Redline auto-mounts (in addition to pages that already have comments). */
  enabledOrigins: string[];
  copyFormat: 'markdown' | 'json';
  /** Comment box: true → Enter saves and Shift+Enter adds a line; false → Enter adds a line and ⌘/Ctrl+Enter saves.
   *  ⌘/Ctrl+Enter always saves. */
  enterToSave: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  shortcuts: { pin: 'P', area: 'A', screenshot: 'S', list: 'L', dictate: 'Alt+Space' },
  screenshotByDefault: false,
  pillCorner: 'br',
  voice: { engine: 'native', language: 'en' },
  enabledOrigins: [],
  copyFormat: 'markdown',
  enterToSave: true,
};

export function mergeSettings(stored: Partial<Settings> | undefined): Settings {
  const s = stored ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...(s.shortcuts ?? {}) },
    voice: { ...DEFAULT_SETTINGS.voice, ...(s.voice ?? {}) },
  };
}

/** Match a KeyboardEvent against a shortcut string like "P", "Alt+Space", "Shift+L". */
export function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split('+').map((p) => p.trim().toLowerCase()).filter(Boolean);
  const key = parts.pop();
  if (!key) return false;
  const want = { alt: parts.includes('alt'), shift: parts.includes('shift'), ctrl: parts.includes('ctrl'), meta: parts.includes('meta') || parts.includes('cmd') };
  if (e.altKey !== want.alt || e.shiftKey !== want.shift || e.ctrlKey !== want.ctrl || e.metaKey !== want.meta) return false;
  const code = e.code.toLowerCase();
  if (key === 'space') return code === 'space';
  if (key.length === 1 && /[a-z]/.test(key)) return code === `key${key}`;
  if (key.length === 1 && /[0-9]/.test(key)) return code === `digit${key}`;
  return e.key.toLowerCase() === key;
}

/** Human label for a shortcut, e.g. "⌥ Space". */
export function formatShortcut(shortcut: string, mac = true): string {
  if (!mac) return shortcut.replace(/\+/g, ' + ');
  return shortcut
    .split('+')
    .map((p) => ({ alt: '⌥', shift: '⇧', ctrl: '⌃', meta: '⌘', cmd: '⌘' })[p.trim().toLowerCase()] ?? p.trim())
    .join(' ');
}
