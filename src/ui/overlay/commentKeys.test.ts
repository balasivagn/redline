import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../core/settings';
import { commentBoxKeyAction, commentHint, focusableElements, screenshotBoxShortcut, trapTarget, type CommentBoxKeyContext } from './commentKeys';

const ctx = (o: Partial<CommentBoxKeyContext> = {}): CommentBoxKeyContext => ({ enterToSave: true, voiceBusy: false, hasText: true, ...o });
const key = (init: KeyboardEventInit & { key: string }) => new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });

describe('commentBoxKeyAction', () => {
  it('Enter saves when there is text and enterToSave is on', () => {
    expect(commentBoxKeyAction(key({ key: 'Enter' }), ctx())).toBe('save');
  });
  it('Enter does nothing without text', () => {
    expect(commentBoxKeyAction(key({ key: 'Enter' }), ctx({ hasText: false }))).toBeNull();
  });
  it('Shift+Enter is a newline', () => {
    expect(commentBoxKeyAction(key({ key: 'Enter', shiftKey: true }), ctx())).toBe('newline');
  });
  it('Enter is a newline when enterToSave is off', () => {
    expect(commentBoxKeyAction(key({ key: 'Enter' }), ctx({ enterToSave: false }))).toBe('newline');
  });
  it('Meta/Ctrl+Enter always saves', () => {
    expect(commentBoxKeyAction(key({ key: 'Enter', metaKey: true }), ctx({ enterToSave: false }))).toBe('save');
    expect(commentBoxKeyAction(key({ key: 'Enter', ctrlKey: true }), ctx())).toBe('save');
  });
  it('ignores Enter while composing (IME) or while voice is busy', () => {
    expect(commentBoxKeyAction(key({ key: 'Enter', isComposing: true }), ctx())).toBeNull();
    expect(commentBoxKeyAction(key({ key: 'Enter', keyCode: 229 }), ctx())).toBeNull();
    expect(commentBoxKeyAction(key({ key: 'Enter' }), ctx({ composing: true }))).toBeNull();
    expect(commentBoxKeyAction(key({ key: 'Enter' }), ctx({ voiceBusy: true, voicePhase: 'listening' }))).toBeNull();
    expect(commentBoxKeyAction(key({ key: 'Enter' }), ctx({ voiceBusy: true, voicePhase: 'transcribing' }))).toBeNull();
  });
  it('plain Enter outside the textarea is left to the focused button', () => {
    expect(commentBoxKeyAction(key({ key: 'Enter' }), ctx({ inTextarea: false }))).toBeNull();
    expect(commentBoxKeyAction(key({ key: 'Enter', metaKey: true }), ctx({ inTextarea: false }))).toBe('save');
  });
  it('Esc cancels dictation first, then closes focused details, else cancels the box', () => {
    expect(commentBoxKeyAction(key({ key: 'Escape' }), ctx({ voiceBusy: true, voicePhase: 'starting' }))).toBe('cancel-voice');
    expect(commentBoxKeyAction(key({ key: 'Escape' }), ctx({ voiceBusy: true, voicePhase: 'listening', detailsFocused: true }))).toBe('cancel-voice');
    expect(commentBoxKeyAction(key({ key: 'Escape' }), ctx({ detailsFocused: true }))).toBe('close-details');
    expect(commentBoxKeyAction(key({ key: 'Escape' }), ctx())).toBe('cancel');
    expect(commentBoxKeyAction(key({ key: 'Escape' }), ctx({ voiceBusy: true, voicePhase: 'transcribing' }))).toBe('cancel');
  });
  it('Esc is ignored while composing', () => {
    expect(commentBoxKeyAction(key({ key: 'Escape', isComposing: true }), ctx())).toBeNull();
  });
  it('dictate shortcut (default Alt+Space) and custom ones', () => {
    expect(commentBoxKeyAction(key({ key: ' ', code: 'Space', altKey: true }), ctx())).toBe('dictate');
    expect(commentBoxKeyAction(key({ key: ' ', code: 'Space', altKey: true, repeat: true }), ctx())).toBeNull();
    const shortcuts = { ...DEFAULT_SETTINGS.shortcuts, dictate: 'Alt+D' };
    expect(commentBoxKeyAction(key({ key: '∂', code: 'KeyD', altKey: true }), ctx({ shortcuts }))).toBe('dictate');
  });
  it('Alt + screenshot key toggles the screenshot, matched by code', () => {
    expect(commentBoxKeyAction(key({ key: 'ß', code: 'KeyS', altKey: true }), ctx())).toBe('toggle-shot');
    expect(commentBoxKeyAction(key({ key: 's', code: 'KeyS' }), ctx())).toBeNull();
    expect(commentBoxKeyAction(key({ key: 'ß', code: 'KeyS', altKey: true }), ctx({ canToggleShot: false }))).toBeNull();
    const shortcuts = { ...DEFAULT_SETTINGS.shortcuts, screenshot: 'Shift+S' };
    expect(commentBoxKeyAction(key({ key: 'ß', code: 'KeyS', altKey: true }), ctx({ shortcuts }))).toBeNull();
  });
  it('other keys are not handled', () => {
    expect(commentBoxKeyAction(key({ key: 'a', code: 'KeyA' }), ctx())).toBeNull();
  });
});

describe('commentHint / screenshotBoxShortcut', () => {
  it('enterToSave on', () => {
    expect(commentHint(DEFAULT_SETTINGS, true)).toBe('↵ save · ⇧↵ new line · ⌥ Space dictate');
  });
  it('enterToSave off: ⌘ on Mac, Ctrl elsewhere', () => {
    const s = { ...DEFAULT_SETTINGS, enterToSave: false };
    expect(commentHint(s, true)).toBe('⌘↵ save · ⌥ Space dictate');
    expect(commentHint(s, false)).toBe('Ctrl+↵ save · Alt + Space dictate');
  });
  it('screenshot shortcut label', () => {
    expect(screenshotBoxShortcut({ screenshot: 'S' }, true)).toBe('⌥S');
    expect(screenshotBoxShortcut({ screenshot: 'Shift+S' }, true)).toBe('');
  });
});

describe('focus trap', () => {
  const build = () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <button id="mic"></button><button id="shot"></button><button id="info"></button><button id="x"></button>
      <dl tabindex="-1" id="panel"></dl>
      <textarea id="ta"></textarea>
      <button id="stop" disabled></button><div hidden><button id="hid"></button></div>
      <button id="save"></button>`;
    document.body.appendChild(root);
    return root;
  };
  it('lists tabbable elements in DOM order, skipping disabled / hidden / tabindex=-1', () => {
    const root = build();
    expect(focusableElements(root).map((e) => e.id)).toEqual(['mic', 'shot', 'info', 'x', 'ta', 'save']);
    root.remove();
  });
  it('Tab from the last wraps to the first; Shift+Tab from the first wraps to the last', () => {
    const root = build();
    const list = focusableElements(root);
    const by = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
    expect(trapTarget(list, by('save'), false)?.id).toBe('mic');
    expect(trapTarget(list, by('mic'), true)?.id).toBe('save');
    expect(trapTarget(list, by('ta'), false)).toBeNull();
    expect(trapTarget(list, by('ta'), true)).toBeNull();
    root.remove();
  });
  it('pulls stray focus back into the box', () => {
    const root = build();
    const list = focusableElements(root);
    expect(trapTarget(list, document.body, false)?.id).toBe('mic');
    expect(trapTarget(list, null, true)?.id).toBe('save');
    expect(trapTarget([], null, false)).toBeNull();
    root.remove();
  });
});
