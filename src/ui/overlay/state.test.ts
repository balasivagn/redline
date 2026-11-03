import { describe, expect, it } from 'vitest';
import { initialState, isIntercepting, reducer, type Action, type UiState } from './state';

const run = (s: UiState, ...actions: Action[]) => actions.reduce(reducer, s);

describe('overlay mode reducer', () => {
  it('starts collapsed and visible', () => {
    expect(initialState).toMatchObject({ mode: 'collapsed', visible: true, drawerOpen: false });
  });

  it('expands and collapses', () => {
    expect(run(initialState, { type: 'expand' }).mode).toBe('toolbar');
    const s = run(initialState, { type: 'expand' }, { type: 'openDrawer' }, { type: 'collapse' });
    expect(s).toMatchObject({ mode: 'collapsed', drawerOpen: false });
  });

  it('toggles pin/area modes and back to toolbar when pressed again', () => {
    let s = run(initialState, { type: 'expand' }, { type: 'setMode', mode: 'pin' });
    expect(s.mode).toBe('pin');
    s = run(s, { type: 'setMode', mode: 'area' });
    expect(s.mode).toBe('area');
    s = run(s, { type: 'setMode', mode: 'area' });
    expect(s.mode).toBe('toolbar');
  });

  it('ignores setMode while collapsed', () => {
    expect(run(initialState, { type: 'setMode', mode: 'pin' })).toBe(initialState);
  });

  it('closes the drawer when entering a pick mode, and the drawer leaves pick modes', () => {
    let s = run(initialState, { type: 'expand' }, { type: 'openDrawer' });
    expect(s.drawerOpen).toBe(true);
    s = run(s, { type: 'setMode', mode: 'pin' });
    expect(s).toMatchObject({ mode: 'pin', drawerOpen: false });
    s = run(s, { type: 'openDrawer' });
    expect(s).toMatchObject({ mode: 'toolbar', drawerOpen: true });
  });

  it('new comment: pin -> editing -> back to pin (stay in mode for rapid pinning)', () => {
    let s = run(initialState, { type: 'expand' }, { type: 'setMode', mode: 'pin' }, { type: 'beginNew' });
    expect(s).toMatchObject({ mode: 'editing', resume: 'pin', editing: { kind: 'new' } });
    s = run(s, { type: 'endEdit' });
    expect(s).toMatchObject({ mode: 'pin', editing: null });
  });

  it('beginNew only works from pin/area', () => {
    const s = run(initialState, { type: 'expand' });
    expect(reducer(s, { type: 'beginNew' })).toBe(s);
  });

  it('editing an existing comment from a collapsed pill returns to collapsed', () => {
    let s = run(initialState, { type: 'beginEdit', id: 'a1' });
    expect(s).toMatchObject({ mode: 'editing', resume: 'collapsed', editing: { kind: 'existing', id: 'a1' } });
    s = run(s, { type: 'endEdit' });
    expect(s.mode).toBe('collapsed');
  });

  it('editing from the toolbar returns to the toolbar', () => {
    const s = run(initialState, { type: 'expand' }, { type: 'beginEdit', id: 'a1' }, { type: 'endEdit' });
    expect(s.mode).toBe('toolbar');
  });

  it('re-pin closes the drawer and reopens it afterwards', () => {
    let s = run(initialState, { type: 'expand' }, { type: 'openDrawer' }, { type: 'beginRepin', id: 'a1' });
    expect(s).toMatchObject({ mode: 'repin', repinId: 'a1', drawerOpen: false, reopenDrawer: true });
    s = run(s, { type: 'endRepin' });
    expect(s).toMatchObject({ mode: 'toolbar', repinId: null, drawerOpen: true });
  });

  it('Esc backs out one level at a time', () => {
    let s = run(initialState, { type: 'expand' }, { type: 'setMode', mode: 'area' }, { type: 'beginNew' });
    s = run(s, { type: 'escape' });
    expect(s.mode).toBe('area'); // comment cancelled, still in area mode
    s = run(s, { type: 'escape' });
    expect(s.mode).toBe('toolbar');
    s = run(s, { type: 'openDrawer' }, { type: 'escape' });
    expect(s).toMatchObject({ mode: 'toolbar', drawerOpen: false });
    s = run(s, { type: 'escape' });
    expect(s.mode).toBe('collapsed');
    expect(run(s, { type: 'escape' })).toBe(s);
  });

  it('Esc cancels re-pin back to toolbar (+ drawer)', () => {
    const s = run(initialState, { type: 'expand' }, { type: 'openDrawer' }, { type: 'beginRepin', id: 'x' }, { type: 'escape' });
    expect(s).toMatchObject({ mode: 'toolbar', drawerOpen: true });
  });

  it('ui/toggle hides everything and shows a collapsed pill again', () => {
    let s = run(initialState, { type: 'expand' }, { type: 'setMode', mode: 'pin' }, { type: 'toggleVisible' });
    expect(s).toMatchObject({ visible: false, mode: 'collapsed' });
    s = run(s, { type: 'toggleVisible' });
    expect(s).toMatchObject({ visible: true, mode: 'collapsed' });
  });

  it('ui/open shows the pill expanded, also when hidden', () => {
    expect(run(initialState, { type: 'open' }).mode).toBe('toolbar');
    const hidden = run(initialState, { type: 'toggleVisible' });
    expect(run(hidden, { type: 'open' })).toMatchObject({ visible: true, mode: 'toolbar' });
    const pin = run(initialState, { type: 'expand' }, { type: 'setMode', mode: 'pin' });
    expect(run(pin, { type: 'open' }).mode).toBe('pin');
  });

  it('route changes end edit / re-pin', () => {
    const e = run(initialState, { type: 'beginEdit', id: 'a' }, { type: 'routeChanged' });
    expect(e.mode).toBe('collapsed');
    const r = run(initialState, { type: 'expand' }, { type: 'beginRepin', id: 'a' }, { type: 'routeChanged' });
    expect(r.mode).toBe('toolbar');
  });

  it('only pick/edit modes intercept page events', () => {
    expect(['collapsed', 'toolbar'].some((m) => isIntercepting(m as never))).toBe(false);
    expect(['pin', 'area', 'editing', 'repin'].every((m) => isIntercepting(m as never))).toBe(true);
  });
});
