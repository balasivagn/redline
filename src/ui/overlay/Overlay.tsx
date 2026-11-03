import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { buildAnchor, type ResolvedAnchor } from '../../core/anchor';
import { captureDom, capturePage, detectFramework } from '../../core/capture';
import { onRedlineEvent, rpc } from '../../core/rpc';
import type { Annotation, Rect } from '../../core/schema';
import { createAnnotation, captureShot, withEditedText, withNewAnchor, withTimeout } from './annotation';
import { CommentBox } from './CommentBox';
import { HostContext, eventInHost } from './context';
import { Drawer } from './Drawer';
import { toRect } from './geometry';
import { usePageKey, usePins, useSettings } from './hooks';
import { Pill } from './Pill';
import { PinsLayer } from './Pins';
import { PickLayer, type Pick } from './PickLayer';
import { resolveShortcut, deepTarget, isEditableTarget } from './shortcuts';
import { initialState, isIntercepting, reducer } from './state';
import { Toasts, type Toast } from './Toasts';
import type { Draft, SaveRequest } from './types';

interface Props {
  /** Our shadow host element. */
  host: HTMLElement;
  /** Unmount the UI (✕). */
  onClose: () => void;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function pinRect(r: ResolvedAnchor | undefined): Rect {
  if (!r) return { x: 0, y: 0, width: 0, height: 0 };
  return r.clientRect ?? { x: r.clientPoint.x - 11, y: r.clientPoint.y - 11, width: 22, height: 22 };
}

export function Overlay({ host, onClose }: Props) {
  const [settings, updateSettings] = useSettings();
  const pageKey = usePageKey();
  const [state, dispatch] = useReducer(reducer, initialState);
  const pins = usePins(pageKey, host, state.visible);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftKey, setDraftKey] = useState(0);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const stateRef = useRef(state);
  stateRef.current = state;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const toastId = useRef(0);

  const pushToast = useCallback((text: string, action?: Toast['action'], ms = 4000) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, action }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  // Background events: show/hide, open.
  useEffect(
    () =>
      onRedlineEvent((e) => {
        if (e.type === 'ui/toggle') dispatch({ type: 'toggleVisible' });
        else if (e.type === 'ui/open') dispatch({ type: 'open' });
      }),
    [],
  );

  // SPA route change: drop transient state.
  const lastKey = useRef(pageKey);
  useEffect(() => {
    if (lastKey.current !== pageKey) {
      lastKey.current = pageKey;
      setDraft(null);
      dispatch({ type: 'routeChanged' });
    }
  }, [pageKey]);

  // Keep draft and mode consistent.
  useEffect(() => {
    if (state.mode !== 'editing' && draft) setDraft(null);
    else if (state.mode === 'editing' && !draft) dispatch({ type: 'endEdit' });
  }, [state.mode, draft]);

  // Shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (!s.visible) return;
      const path = e.composedPath?.() ?? [];
      const inCommentBox = path.some((n) => n instanceof Element && n.hasAttribute('data-rl-comment'));
      const act = resolveShortcut(e, settingsRef.current.shortcuts, { mode: s.mode, inCommentBox });
      if (!act || act === 'dictate') return; // dictate is handled by the comment box itself
      if (act === 'escape') {
        if (s.mode === 'collapsed' || s.mode === 'editing') return;
        if (isEditableTarget(deepTarget(e)) && eventInHost(e, host)) return; // inline editors handle their own Esc
        e.preventDefault();
        if (s.mode !== 'toolbar' || s.drawerOpen) e.stopPropagation();
        dispatch({ type: 'escape' });
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (act === 'pin' || act === 'area') dispatch({ type: 'setMode', mode: act });
      else if (act === 'list') dispatch({ type: 'toggleDrawer' });
      else if (act === 'screenshot') void updateSettings({ screenshotByDefault: !settingsRef.current.screenshotByDefault });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [host, updateSettings]);

  const openEdit = useCallback((a: Annotation) => {
    setDraft({ kind: 'existing', annotation: a, getRect: () => pinRect(pinsRef.current.resolved.get(a.id)) });
    setDraftKey((k) => k + 1);
    dispatch({ type: 'beginEdit', id: a.id });
  }, []);

  const onPick = useCallback(
    async (pick: Pick) => {
      const s = stateRef.current;
      try {
        if (s.mode === 'repin') {
          if (pick.kind !== 'pin') return;
          const prev = pinsRef.current.annotations.find((a) => a.id === s.repinId);
          if (!prev) {
            dispatch({ type: 'endRepin' });
            return;
          }
          const el = pick.element;
          const { anchor, element } =
            prev.anchor.kind === 'area'
              ? buildAnchor({ kind: 'area', clientRect: toRect(el.getBoundingClientRect()) })
              : buildAnchor({ kind: 'pin', element: el, clientPoint: pick.point });
          const framework = await detectFramework(element).catch(() => undefined);
          const next = withNewAnchor(prev, { anchor, dom: captureDom(element), framework, page: capturePage() });
          await rpc('ann/save', { annotation: next });
          dispatch({ type: 'endRepin' });
          void pinsRef.current.reload();
          pushToast(`Re-pinned #${prev.number}`);
        } else if (pick.kind === 'pin' && s.mode === 'pin') {
          const { anchor, element } = buildAnchor({ kind: 'pin', element: pick.element, clientPoint: pick.point });
          setDraft({
            kind: 'new',
            anchorKind: 'pin',
            anchor,
            element,
            dom: captureDom(element),
            framework: detectFramework(element).catch(() => undefined),
            getRect: () => toRect(element.getBoundingClientRect()),
          });
          setDraftKey((k) => k + 1);
          dispatch({ type: 'beginNew' });
        } else if (pick.kind === 'area' && s.mode === 'area') {
          const { anchor, element } = buildAnchor({ kind: 'area', clientRect: pick.rect });
          const sx = window.scrollX;
          const sy = window.scrollY;
          const r0 = pick.rect;
          setDraft({
            kind: 'new',
            anchorKind: 'area',
            anchor,
            element,
            dom: captureDom(element),
            framework: detectFramework(element).catch(() => undefined),
            getRect: () => ({ ...r0, x: r0.x - (window.scrollX - sx), y: r0.y - (window.scrollY - sy) }),
          });
          setDraftKey((k) => k + 1);
          dispatch({ type: 'beginNew' });
        }
      } catch (err) {
        pushToast(`Couldn't select that: ${msg(err)}`);
      }
    },
    [pushToast],
  );

  const save = useCallback(
    async (req: SaveRequest) => {
      const d = draftRef.current;
      if (!d) return;
      if (d.kind === 'existing') {
        await withTimeout(rpc('ann/save', { annotation: withEditedText(d.annotation, req.text, req.dictated) }), 10_000, 'Saving took too long. Try again.');
      } else {
        let screenshot;
        if (req.withShot) {
          try {
            screenshot = await captureShot(host, d.getRect());
            if (!screenshot) pushToast('Saved without a screenshot (target is off-screen)');
          } catch (err) {
            pushToast(`Saved without a screenshot: ${msg(err)}`);
          }
        }
        const annotation = await createAnnotation({
          element: d.element,
          anchor: d.anchor,
          text: req.text,
          source: req.source,
          dom: d.dom,
          framework: d.framework,
          screenshot,
        });
        await withTimeout(rpc('ann/save', { annotation }), 10_000, 'Saving took too long. Try again.');
      }
      setDraft(null);
      dispatch({ type: 'endEdit' });
      void pinsRef.current.reload();
    },
    [host, pushToast],
  );

  const cancelEdit = useCallback(() => {
    setDraft(null);
    dispatch({ type: 'endEdit' });
  }, []);

  const remove = useCallback(
    async (a: Annotation) => {
      try {
        const { deleted } = await rpc('ann/delete', { ids: [a.id] });
        void pinsRef.current.reload();
        pushToast(
          'Deleted ·',
          {
            label: 'Undo',
            run: () => {
              rpc('ann/restore', { annotations: deleted })
                .then(() => pinsRef.current.reload())
                .catch((err) => pushToast(`Couldn't undo: ${msg(err)}`));
            },
          },
          5000,
        );
      } catch (err) {
        pushToast(`Couldn't delete: ${msg(err)}`);
      }
    },
    [pushToast],
  );

  const focusPin = useCallback((a: Annotation) => {
    const r = pinsRef.current.resolved.get(a.id);
    if (r?.status === 'attached') {
      r.element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    } else {
      window.scrollTo({ top: Math.max(0, a.anchor.pagePoint.y - window.innerHeight / 2), behavior: 'smooth' });
    }
    setFlashId(a.id);
    window.setTimeout(() => setFlashId((cur) => (cur === a.id ? null : cur)), 1600);
  }, []);

  const openSettings = useCallback(
    (section?: 'voice' | 'shortcuts' | 'general') => {
      rpc('open/settings', section ? { section } : {}).catch((err) => pushToast(`Couldn't open settings: ${msg(err)}`));
    },
    [pushToast],
  );

  const closeAll = useCallback(() => {
    rpc('site/setEnabled', { origin: location.origin, enabled: false }).catch(() => {});
    onClose();
  }, [onClose]);

  if (!state.visible) return null;

  const nextNumber = pins.annotations.reduce((m, a) => Math.max(m, a.number), 0) + 1;
  const editingId = draft?.kind === 'existing' ? draft.annotation.id : null;

  return (
    <HostContext.Provider value={host}>
      <PinsLayer
        annotations={pins.annotations}
        resolved={pins.resolved}
        flashId={flashId}
        hideId={state.mode === 'editing' ? editingId : null}
        onEdit={openEdit}
        onDelete={remove}
      />
      {isIntercepting(state.mode) && (
        <PickLayer mode={state.mode as 'pin' | 'area' | 'repin' | 'editing'} onPick={onPick} />
      )}
      <Drawer
        open={state.drawerOpen}
        pageKey={pageKey}
        count={pins.annotations.length}
        detachedIds={pins.detachedIds}
        onClose={() => dispatch({ type: 'closeDrawer' })}
        onFocus={focusPin}
        onRepin={(a) => dispatch({ type: 'beginRepin', id: a.id })}
        onEditInPage={openEdit}
      />
      {state.mode === 'editing' && draft && (
        <div data-rl-comment="">
          <CommentBox
            key={draftKey}
            draft={draft}
            nextNumber={nextNumber}
            settings={settings}
            onCancel={cancelEdit}
            onSave={save}
            onOpenVoiceSettings={() => openSettings('voice')}
            onUseChromeSpeech={() => updateSettings({ voice: { ...settings.voice, engine: 'chrome' } })}
          />
        </div>
      )}
      <Pill
        mode={state.mode}
        resume={state.resume}
        drawerOpen={state.drawerOpen}
        count={pins.annotations.length}
        settings={settings}
        onExpand={() => dispatch({ type: 'expand' })}
        onCollapse={() => dispatch({ type: 'collapse' })}
        onSetMode={(m) => dispatch({ type: 'setMode', mode: m })}
        onToggleShot={() => void updateSettings({ screenshotByDefault: !settings.screenshotByDefault })}
        onToggleList={() => dispatch({ type: 'toggleDrawer' })}
        onSettings={() => openSettings()}
        onClose={closeAll}
        onMoveCorner={(pillCorner) => void updateSettings({ pillCorner })}
      />
      {state.mode === 'repin' && (
        <div className="pointer-events-none fixed top-3 left-1/2 -translate-x-1/2 rounded-md bg-rl-accent px-3 py-1 text-xs font-medium text-white shadow-lg">
          Click an element to re-pin · Esc to cancel
        </div>
      )}
      <Toasts toasts={toasts} dismiss={dismissToast} />
    </HostContext.Provider>
  );
}
