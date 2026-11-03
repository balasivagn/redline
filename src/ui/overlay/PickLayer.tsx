import { useEffect, useMemo, useRef, useState } from 'react';
import { describeElement, detectFramework } from '../../core/capture';
import type { FrameworkInfo, Rect } from '../../core/schema';
import { eventInHost, useHost } from './context';
import { isBigEnough, normalizeRect, positionBox, toRect } from './geometry';
import { childToward, containingElement, parentOf, pickAt } from './pick';
import { useViewportTick } from './hooks';
import { isEditableTarget, deepTarget } from './shortcuts';

export type Pick = { kind: 'pin'; element: Element; point: { x: number; y: number } } | { kind: 'area'; rect: Rect };

interface Props {
  /** 'editing' only swallows page events; it never picks. */
  mode: 'pin' | 'area' | 'repin' | 'editing';
  onPick: (p: Pick) => void;
}

const BLOCKED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick'] as const;
const CURSOR_STYLE_ID = 'redline-cursor-style';

function safeDescribe(el: Element): string {
  try {
    return describeElement(el);
  } catch {
    return el.tagName.toLowerCase();
  }
}

/**
 * Captures pointer events on the window so the page never receives clicks while a Redline mode is
 * active, and draws the hover outline (pin/repin) or the drag box (area).
 */
export function PickLayer({ mode, onPick }: Props) {
  const host = useHost();
  const picks = mode === 'pin' || mode === 'repin';
  const area = mode === 'area';
  const [hover, setHover] = useState<Element | null>(null);
  const [drag, setDrag] = useState<{ start: { x: number; y: number }; rect: Rect } | null>(null);
  const hoverRef = useRef<Element | null>(null);
  const rawRef = useRef<Element | null>(null);
  const stackRef = useRef<Element[]>([]);
  const pointerRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{ start: { x: number; y: number }; rect: Rect } | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  useViewportTick();

  const setHoverEl = (el: Element | null) => {
    hoverRef.current = el;
    setHover(el);
  };

  useEffect(() => {
    if (mode === 'editing') return;
    const style = document.createElement('style');
    style.id = CURSOR_STYLE_ID;
    style.textContent = 'html, html * { cursor: crosshair !important; }';
    document.head.appendChild(style);
    return () => style.remove();
  }, [mode]);

  useEffect(() => {
    setHoverEl(null);
    rawRef.current = null;
    stackRef.current = [];
    dragRef.current = null;
    setDrag(null);

    const swallow = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    const onMove = (e: PointerEvent) => {
      if (eventInHost(e, host)) return;
      swallow(e);
      pointerRef.current = { x: e.clientX, y: e.clientY };
      if (picks) {
        const raw = pickAt(e.clientX, e.clientY, host);
        if (raw !== rawRef.current) {
          rawRef.current = raw;
          stackRef.current = [];
          setHoverEl(raw);
        }
      } else if (area && dragRef.current) {
        const next = { start: dragRef.current.start, rect: normalizeRect(dragRef.current.start, pointerRef.current) };
        dragRef.current = next;
        setDrag(next);
      }
    };

    const onDown = (e: Event) => {
      const pe = e as PointerEvent;
      if (eventInHost(e, host)) return;
      swallow(e);
      if (area && e.type === 'pointerdown' && pe.button === 0) {
        const start = { x: pe.clientX, y: pe.clientY };
        dragRef.current = { start, rect: { x: start.x, y: start.y, width: 0, height: 0 } };
        setDrag(dragRef.current);
      }
    };

    const onUp = (e: Event) => {
      const pe = e as PointerEvent;
      if (eventInHost(e, host)) return;
      swallow(e);
      if (area && e.type === 'pointerup' && dragRef.current) {
        const rect = normalizeRect(dragRef.current.start, { x: pe.clientX, y: pe.clientY });
        dragRef.current = null;
        setDrag(null);
        if (isBigEnough(rect)) onPickRef.current({ kind: 'area', rect });
      }
    };

    const onClick = (e: Event) => {
      const me = e as MouseEvent;
      if (eventInHost(e, host)) return;
      swallow(e);
      if (picks && e.type === 'click' && me.button === 0) {
        const el = hoverRef.current ?? pickAt(me.clientX, me.clientY, host);
        if (el) onPickRef.current({ kind: 'pin', element: el, point: { x: me.clientX, y: me.clientY } });
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (!picks || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (isEditableTarget(deepTarget(e))) return;
      const cur = hoverRef.current;
      if (!cur) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'ArrowUp') {
        const p = parentOf(cur);
        if (p) {
          stackRef.current.push(cur);
          setHoverEl(p);
        }
      } else {
        const below = stackRef.current.pop() ?? childToward(cur, pointerRef.current.x, pointerRef.current.y);
        if (below) setHoverEl(below);
      }
    };

    const opts = { capture: true } as const;
    window.addEventListener('pointermove', onMove, opts);
    window.addEventListener('pointerdown', onDown, opts);
    window.addEventListener('mousedown', onDown, opts);
    window.addEventListener('pointerup', onUp, opts);
    window.addEventListener('mouseup', onUp, opts);
    for (const t of ['click', 'dblclick', 'auxclick'] as const) window.addEventListener(t, onClick, opts);
    window.addEventListener('keydown', onKey, opts);
    return () => {
      window.removeEventListener('pointermove', onMove, opts);
      window.removeEventListener('pointerdown', onDown, opts);
      window.removeEventListener('mousedown', onDown, opts);
      window.removeEventListener('pointerup', onUp, opts);
      window.removeEventListener('mouseup', onUp, opts);
      for (const t of ['click', 'dblclick', 'auxclick'] as const) window.removeEventListener(t, onClick, opts);
      window.removeEventListener('keydown', onKey, opts);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, host]);

  if (mode === 'editing') return null;
  if (picks && hover) return <HoverOutline el={hover} />;
  if (area && drag && drag.rect.width > 0) return <DragBox rect={drag.rect} host={host} />;
  return area ? <Hint text="Drag to draw a box · Esc to exit" /> : <Hint text={picks ? '↑/↓ parent/child · Click to pin · Esc to exit' : ''} />;
}

function Hint({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="pointer-events-none fixed top-3 left-1/2 -translate-x-1/2 rounded-md border border-rl-line bg-rl-ink/90 px-3 py-1 text-xs text-rl-text shadow-lg">
      {text}
    </div>
  );
}

function HoverOutline({ el }: { el: Element }) {
  const rect = toRect(el.getBoundingClientRect());
  const [fw, setFw] = useState<{ el: Element; info: FrameworkInfo | undefined } | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => {
      detectFramework(el)
        .then((info) => setFw({ el, info }))
        .catch(() => setFw({ el, info: undefined }));
    }, 80);
    return () => window.clearTimeout(t);
  }, [el]);
  const info = fw?.el === el ? fw.info : undefined;
  const label = useMemo(() => safeDescribe(el), [el]);
  const vp = { width: window.innerWidth, height: window.innerHeight };
  const pos = positionBox(rect, { width: 260, height: info?.component ? 40 : 24 }, vp, { gap: 6 });
  return (
    <>
      <div
        className="pointer-events-none fixed rounded-sm border-2 border-rl-accent bg-rl-accent/10"
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      />
      <div
        className="pointer-events-none fixed max-w-[320px] rounded-md bg-rl-ink px-2 py-1 text-xs text-rl-text shadow-lg"
        style={{ left: pos.left, top: pos.top }}
      >
        <div className="truncate font-mono">
          {label} <span className="text-rl-muted">{Math.round(rect.width)}×{Math.round(rect.height)}</span>
        </div>
        {info?.component && (
          <div className="truncate text-rl-muted">
            {'<'}{info.component}{'>'}
            {info.source ? ` · ${info.source.file.split('/').pop()}` : ''}
          </div>
        )}
      </div>
    </>
  );
}

function DragBox({ rect, host }: { rect: Rect; host: HTMLElement | null }) {
  const anchorEl = useMemo(() => {
    const start = pickAt(rect.x + 1, rect.y + 1, host);
    return containingElement(start, rect);
  }, [rect, host]);
  const tooSmall = !isBigEnough(rect);
  return (
    <>
      <div
        className={`pointer-events-none fixed rounded-sm border-2 border-dashed ${tooSmall ? 'border-rl-muted' : 'border-rl-accent bg-rl-accent/10'}`}
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      />
      <div
        className="pointer-events-none fixed rounded-md bg-rl-ink px-2 py-1 text-xs text-rl-text shadow-lg"
        style={{ left: rect.x, top: rect.y + rect.height + 6 }}
      >
        anchored to: <span className="font-mono">{anchorEl ? safeDescribe(anchorEl) : 'body'}</span>
      </div>
    </>
  );
}
