import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../core/settings';
import { isEditableTarget, resolveShortcut } from './shortcuts';

const sc = DEFAULT_SETTINGS.shortcuts;

/** Dispatch on `target`, capturing the event so composedPath() is populated while handling. */
function fire(target: Element, init: KeyboardEventInit & { key: string }, mode: Parameters<typeof resolveShortcut>[2]['mode'], inCommentBox = false) {
  document.body.appendChild(target);
  let result: ReturnType<typeof resolveShortcut> = null;
  const h = (e: Event) => {
    result = resolveShortcut(e as KeyboardEvent, sc, { mode, inCommentBox });
  };
  window.addEventListener('keydown', h, true);
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, composed: true, cancelable: true, ...init }));
  window.removeEventListener('keydown', h, true);
  target.remove();
  return result;
}

describe('isEditableTarget', () => {
  it('detects form fields and contenteditable', () => {
    expect(isEditableTarget(document.createElement('input'))).toBe(true);
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
    expect(isEditableTarget(document.createElement('select'))).toBe(true);
    const ce = document.createElement('div');
    ce.setAttribute('contenteditable', 'true');
    expect(isEditableTarget(ce)).toBe(true);
    expect(isEditableTarget(document.createElement('div'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('resolveShortcut gating', () => {
  const div = () => document.createElement('div');

  it('maps default shortcuts when focus is not in a field', () => {
    expect(fire(div(), { key: 'p', code: 'KeyP' }, 'toolbar')).toBe('pin');
    expect(fire(div(), { key: 'a', code: 'KeyA' }, 'pin')).toBe('area');
    expect(fire(div(), { key: 's', code: 'KeyS' }, 'toolbar')).toBe('screenshot');
    expect(fire(div(), { key: 'l', code: 'KeyL' }, 'area')).toBe('list');
  });

  it('ignores letters typed into page inputs, textareas and contenteditable', () => {
    expect(fire(document.createElement('input'), { key: 'p', code: 'KeyP' }, 'toolbar')).toBeNull();
    expect(fire(document.createElement('textarea'), { key: 'l', code: 'KeyL' }, 'pin')).toBeNull();
    const ce = div();
    ce.setAttribute('contenteditable', 'true');
    expect(fire(ce, { key: 'a', code: 'KeyA' }, 'toolbar')).toBeNull();
  });

  it('does not steal modified keys (Cmd+P prints)', () => {
    expect(fire(div(), { key: 'p', code: 'KeyP', metaKey: true }, 'toolbar')).toBeNull();
  });

  it('is inactive while collapsed or editing', () => {
    expect(fire(div(), { key: 'p', code: 'KeyP' }, 'collapsed')).toBeNull();
    expect(fire(div(), { key: 'p', code: 'KeyP' }, 'editing')).toBeNull();
  });

  it('Escape always counts, even inside inputs', () => {
    expect(fire(document.createElement('input'), { key: 'Escape', code: 'Escape' }, 'pin')).toBe('escape');
    expect(fire(div(), { key: 'Escape', code: 'Escape' }, 'toolbar')).toBe('escape');
  });

  it('dictate works inside our comment box only', () => {
    const ta = document.createElement('textarea');
    expect(fire(ta, { key: ' ', code: 'Space', altKey: true }, 'editing', true)).toBe('dictate');
    expect(fire(document.createElement('textarea'), { key: ' ', code: 'Space', altKey: true }, 'editing', false)).toBeNull();
    expect(fire(document.createElement('textarea'), { key: ' ', code: 'Space', altKey: true }, 'toolbar', false)).toBeNull();
  });

  it('ignores key repeat', () => {
    expect(fire(div(), { key: 'p', code: 'KeyP', repeat: true }, 'toolbar')).toBeNull();
  });

  it('honours custom shortcuts', () => {
    const custom = { ...sc, pin: 'Shift+X' };
    const e = new KeyboardEvent('keydown', { key: 'X', code: 'KeyX', shiftKey: true });
    expect(resolveShortcut(e, custom, { mode: 'toolbar', inCommentBox: false })).toBe('pin');
  });
});
