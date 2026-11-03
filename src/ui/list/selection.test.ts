import { describe, expect, it } from 'vitest';
import { pruneSelection, selectAllState, toggleAll, toggleOne } from './selection';

const ids = ['a', 'b', 'c'];

describe('selection', () => {
  it('reports none / some / all', () => {
    expect(selectAllState(new Set(), ids)).toBe('none');
    expect(selectAllState(new Set(['a']), ids)).toBe('some');
    expect(selectAllState(new Set(ids), ids)).toBe('all');
    expect(selectAllState(new Set(['x']), ids)).toBe('none'); // stale ids don't count
    expect(selectAllState(new Set(['a']), [])).toBe('none');
  });

  it('select all selects everything unless already all, then clears', () => {
    expect([...toggleAll(new Set(), ids)]).toEqual(ids);
    expect([...toggleAll(new Set(['b']), ids)]).toEqual(ids); // partial → all
    expect(toggleAll(new Set(ids), ids).size).toBe(0);
  });

  it('toggles one id without mutating the input', () => {
    const s = new Set(['a']);
    const added = toggleOne(s, 'b');
    expect([...added].sort()).toEqual(['a', 'b']);
    expect([...s]).toEqual(['a']);
    expect([...toggleOne(added, 'a')]).toEqual(['b']);
  });

  it('prunes deleted ids and keeps identity when nothing changed', () => {
    const s = new Set(['a', 'b']);
    expect(pruneSelection(s, ['a', 'b', 'c'])).toBe(s);
    expect([...pruneSelection(s, ['b', 'c'])]).toEqual(['b']);
    expect(pruneSelection(s, []).size).toBe(0);
  });

  it('select-all state after a delete of part of the selection', () => {
    let sel: ReadonlySet<string> = toggleAll(new Set(), ids);
    const remaining = ['b', 'c'];
    sel = pruneSelection(sel, remaining);
    expect(selectAllState(sel, remaining)).toBe('all');
    sel = toggleOne(sel, 'b');
    expect(selectAllState(sel, remaining)).toBe('some');
  });
});
