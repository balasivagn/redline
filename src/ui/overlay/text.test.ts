import { describe, expect, it } from 'vitest';
import { commentSource, excerpt, formatTimer, insertAtCursor } from './text';

describe('insertAtCursor', () => {
  it('inserts at the caret with separating spaces and never drops typed text', () => {
    const r = insertAtCursor('Make the price bigger.', 22, 22, 'Also align the button.');
    expect(r.value).toBe('Make the price bigger. Also align the button.');
    expect(r.highlight).toEqual({ start: 23, end: 45 });
    expect(r.caret).toBe(45);
  });
  it('does not add a space at the start or after whitespace', () => {
    expect(insertAtCursor('', 0, 0, 'hello').value).toBe('hello');
    expect(insertAtCursor('one ', 4, 4, 'two').value).toBe('one two');
    expect(insertAtCursor('one\n', 4, 4, 'two').value).toBe('one\ntwo');
  });
  it('inserts in the middle with spaces on both sides', () => {
    const r = insertAtCursor('abcdef', 3, 3, 'XY');
    expect(r.value).toBe('abc XY def');
    expect(r.value.slice(r.highlight!.start, r.highlight!.end)).toBe('XY');
    expect(r.caret).toBe(7);
  });
  it('keeps a selection and inserts after it', () => {
    expect(insertAtCursor('select me', 0, 6, 'new').value).toBe('select new me');
  });
  it('trims the dictated text and ignores empty results', () => {
    expect(insertAtCursor('a', 1, 1, '  b  ').value).toBe('a b');
    const r = insertAtCursor('a', 1, 1, '   ');
    expect(r).toEqual({ value: 'a', caret: 1, highlight: null });
  });
  it('clamps out-of-range cursors', () => {
    expect(insertAtCursor('abc', 99, 99, 'x').value).toBe('abc x');
  });
});

describe('commentSource', () => {
  it('is typed without dictation, voice when only dictated text remains, otherwise mixed', () => {
    expect(commentSource('hello', [])).toBe('typed');
    expect(commentSource('make it bigger', ['make it bigger'])).toBe('voice');
    expect(commentSource('Typed first. make it bigger', ['make it bigger'])).toBe('mixed');
    expect(commentSource('edited by hand', ['make it bigger'])).toBe('mixed');
  });
});

describe('misc', () => {
  it('formats the recording timer', () => {
    expect(formatTimer(0)).toBe('0:00');
    expect(formatTimer(7400)).toBe('0:07');
    expect(formatTimer(65000)).toBe('1:05');
  });
  it('shortens long text', () => {
    expect(excerpt('a  b\n c')).toBe('a b c');
    expect(excerpt('x'.repeat(100), 10)).toBe('xxxxxxxxx…');
  });
});
