import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, matchesShortcut } from '../../core/settings';
import { dictateNeedsModifier, findConflicts, normalizeShortcut, recordShortcut } from './shortcut-recorder';

const init = (o: KeyboardEventInit) => o;
function record(o: KeyboardEventInit) {
  const e = new KeyboardEvent('keydown', init(o));
  return { e, r: recordShortcut(e) };
}

describe('recordShortcut', () => {
  it('builds Alt+Space', () => {
    const { r } = record({ key: ' ', code: 'Space', altKey: true });
    expect(r).toEqual({ kind: 'shortcut', value: 'Alt+Space' });
  });

  it('uses the physical key for letters even when Alt changes e.key (macOS)', () => {
    const { r } = record({ key: '¬', code: 'KeyL', altKey: true });
    expect(r).toEqual({ kind: 'shortcut', value: 'Alt+L' });
  });

  it('orders modifiers Ctrl, Alt, Shift, Meta', () => {
    const { r } = record({ key: 'k', code: 'KeyK', metaKey: true, shiftKey: true, ctrlKey: true, altKey: true });
    expect(r).toEqual({ kind: 'shortcut', value: 'Ctrl+Alt+Shift+Meta+K' });
  });

  it('records bare keys, digits and named keys', () => {
    expect(record({ key: 'p', code: 'KeyP' }).r).toEqual({ kind: 'shortcut', value: 'P' });
    expect(record({ key: '3', code: 'Digit3' }).r).toEqual({ kind: 'shortcut', value: '3' });
    expect(record({ key: 'F2', code: 'F2' }).r).toEqual({ kind: 'shortcut', value: 'F2' });
    expect(record({ key: '/', code: 'Slash' }).r).toEqual({ kind: 'shortcut', value: '/' });
  });

  it('ignores modifier-only presses, cancels on Esc, rejects the + separator', () => {
    expect(record({ key: 'Alt', code: 'AltLeft', altKey: true }).r.kind).toBe('ignore');
    expect(record({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }).r.kind).toBe('ignore');
    expect(record({ key: 'Escape', code: 'Escape' }).r.kind).toBe('cancel');
    expect(record({ key: '+', code: 'Equal', shiftKey: true }).r.kind).toBe('ignore');
    expect(record({ key: 'Tab', code: 'Tab' }).r.kind).toBe('ignore');
  });

  it('every recorded string matches the event that produced it (matchesShortcut)', () => {
    const cases: KeyboardEventInit[] = [
      { key: ' ', code: 'Space', altKey: true },
      { key: 'p', code: 'KeyP' },
      { key: 'L', code: 'KeyL', shiftKey: true },
      { key: '¬', code: 'KeyL', altKey: true },
      { key: '7', code: 'Digit7', ctrlKey: true },
      { key: 'ArrowUp', code: 'ArrowUp', metaKey: true },
      { key: 'F2', code: 'F2' },
      { key: '.', code: 'Period', metaKey: true, shiftKey: true },
    ];
    for (const c of cases) {
      const { e, r } = record(c);
      expect(r.kind).toBe('shortcut');
      if (r.kind === 'shortcut') expect(matchesShortcut(e, r.value), r.value).toBe(true);
    }
  });
});

describe('conflicts', () => {
  it('has none for the defaults', () => {
    expect(findConflicts(DEFAULT_SETTINGS.shortcuts)).toEqual({});
  });

  it('flags equal shortcuts regardless of case, order and cmd/meta alias', () => {
    const c = findConflicts({ ...DEFAULT_SETTINGS.shortcuts, area: 'p', list: 'Shift+cmd+L', screenshot: 'meta+Shift+l' });
    expect(c.pin).toEqual(['area']);
    expect(c.area).toEqual(['pin']);
    expect(c.list).toEqual(['screenshot']);
    expect(c.screenshot).toEqual(['list']);
    expect(c.dictate).toBeUndefined();
  });

  it('normalizes', () => {
    expect(normalizeShortcut('Shift+Alt+Space')).toBe('alt+shift+space');
  });
});

describe('dictateNeedsModifier', () => {
  it('warns for typable bare keys only', () => {
    expect(dictateNeedsModifier('D')).toBe(true);
    expect(dictateNeedsModifier('Space')).toBe(true);
    expect(dictateNeedsModifier('Alt+Space')).toBe(false);
    expect(dictateNeedsModifier('F9')).toBe(false);
  });
});
