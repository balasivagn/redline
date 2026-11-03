/** Pure UI state machine for the overlay (no DOM, no React). */

export type Mode = 'collapsed' | 'toolbar' | 'pin' | 'area' | 'editing' | 'repin';
export type ResumeMode = 'collapsed' | 'toolbar' | 'pin' | 'area';
export type EditTarget = { kind: 'new' } | { kind: 'existing'; id: string };

export interface UiState {
  /** false after `ui/toggle` hid everything (the content script stays alive). */
  visible: boolean;
  mode: Mode;
  drawerOpen: boolean;
  /** Where to go when the comment box / re-pin ends. */
  resume: ResumeMode;
  editing: EditTarget | null;
  repinId: string | null;
  /** Drawer is closed while re-pinning; reopen it afterwards. */
  reopenDrawer: boolean;
}

export const initialState: UiState = {
  visible: true,
  mode: 'collapsed',
  drawerOpen: false,
  resume: 'toolbar',
  editing: null,
  repinId: null,
  reopenDrawer: false,
};

export type Action =
  | { type: 'toggleVisible' }
  | { type: 'open' }
  | { type: 'expand' }
  | { type: 'collapse' }
  | { type: 'setMode'; mode: 'pin' | 'area' }
  | { type: 'toggleDrawer' }
  | { type: 'openDrawer' }
  | { type: 'closeDrawer' }
  | { type: 'beginNew' }
  | { type: 'beginEdit'; id: string }
  | { type: 'endEdit' }
  | { type: 'beginRepin'; id: string }
  | { type: 'endRepin' }
  | { type: 'escape' }
  | { type: 'routeChanged' };

const COLLAPSED: Partial<UiState> = {
  mode: 'collapsed',
  drawerOpen: false,
  resume: 'toolbar',
  editing: null,
  repinId: null,
  reopenDrawer: false,
};

export function isIntercepting(mode: Mode): boolean {
  return mode === 'pin' || mode === 'area' || mode === 'editing' || mode === 'repin';
}

export function reducer(s: UiState, a: Action): UiState {
  switch (a.type) {
    case 'toggleVisible':
      return s.visible ? { ...initialState, visible: false } : { ...initialState, visible: true };
    case 'open':
      if (!s.visible) return { ...initialState, visible: true, mode: 'toolbar' };
      return s.mode === 'collapsed' ? { ...s, mode: 'toolbar' } : s;
    case 'expand':
      return s.mode === 'collapsed' ? { ...s, mode: 'toolbar' } : s;
    case 'collapse':
      return { ...s, ...COLLAPSED } as UiState;
    case 'setMode': {
      if (s.mode !== 'toolbar' && s.mode !== 'pin' && s.mode !== 'area') return s;
      const next = s.mode === a.mode ? 'toolbar' : a.mode;
      return { ...s, mode: next, resume: next, drawerOpen: false };
    }
    case 'openDrawer':
      if (s.mode === 'editing' || s.mode === 'repin') return s;
      return { ...s, mode: 'toolbar', resume: 'toolbar', drawerOpen: true };
    case 'closeDrawer':
      return s.drawerOpen ? { ...s, drawerOpen: false } : s;
    case 'toggleDrawer':
      return reducer(s, { type: s.drawerOpen ? 'closeDrawer' : 'openDrawer' });
    case 'beginNew':
      if (s.mode !== 'pin' && s.mode !== 'area') return s;
      return { ...s, mode: 'editing', resume: s.mode, editing: { kind: 'new' } };
    case 'beginEdit': {
      if (s.mode === 'repin') return s;
      if (s.mode === 'editing') return { ...s, editing: { kind: 'existing', id: a.id } };
      const resume: ResumeMode = s.mode;
      return { ...s, mode: 'editing', resume, editing: { kind: 'existing', id: a.id } };
    }
    case 'endEdit':
      if (s.mode !== 'editing') return s;
      return { ...s, mode: s.resume, editing: null };
    case 'beginRepin':
      if (s.mode === 'editing') return s;
      return { ...s, mode: 'repin', repinId: a.id, reopenDrawer: s.drawerOpen, drawerOpen: false, resume: 'toolbar' };
    case 'endRepin':
      if (s.mode !== 'repin') return s;
      return { ...s, mode: 'toolbar', repinId: null, drawerOpen: s.reopenDrawer, reopenDrawer: false };
    case 'routeChanged':
      if (s.mode === 'editing') return reducer(s, { type: 'endEdit' });
      if (s.mode === 'repin') return reducer(s, { type: 'endRepin' });
      return s;
    case 'escape':
      if (s.mode === 'editing') return reducer(s, { type: 'endEdit' });
      if (s.mode === 'repin') return reducer(s, { type: 'endRepin' });
      if (s.mode === 'pin' || s.mode === 'area') return { ...s, mode: 'toolbar', resume: 'toolbar' };
      if (s.drawerOpen) return { ...s, drawerOpen: false };
      if (s.mode === 'toolbar') return { ...s, mode: 'collapsed' };
      return s;
  }
}
