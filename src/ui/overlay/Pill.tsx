import { useRef, useState, type ReactNode } from 'react';
import { formatShortcut, type Corner, type Settings } from '../../core/settings';
import { cornerStyle, snapCorner } from './geometry';
import { AreaIcon, CameraIcon, CloseIcon, GearIcon, ListIcon, PinIcon } from './icons';
import type { Mode } from './state';

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);
export const DRAWER_WIDTH = 380;

interface Props {
  mode: Mode;
  resume: string;
  drawerOpen: boolean;
  count: number;
  settings: Settings;
  onExpand: () => void;
  onCollapse: () => void;
  onSetMode: (m: 'pin' | 'area') => void;
  onToggleShot: () => void;
  onToggleList: () => void;
  onSettings: () => void;
  onClose: () => void;
  onMoveCorner: (c: Corner) => void;
}

export function Pill(props: Props) {
  const { mode, settings, drawerOpen, count } = props;
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const dragState = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const draggedRef = useRef(false);
  const consumeDrag = () => {
    const was = draggedRef.current;
    draggedRef.current = false;
    return was;
  };
  const corner = settings.pillCorner;
  const extraRight = drawerOpen ? DRAWER_WIDTH : 0;
  const expanded = mode !== 'collapsed';
  const activeMode = mode === 'editing' ? props.resume : mode;
  const sc = settings.shortcuts;
  const fmt = (s: string) => formatShortcut(s, isMac);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    dragState.current = { sx: e.clientX, sy: e.clientY, ox: e.clientX - box.left, oy: e.clientY - box.top, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragState.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
    d.moved = true;
    setDrag({ x: e.clientX - d.ox, y: e.clientY - d.oy });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragState.current;
    dragState.current = null;
    if (!d) return;
    if (d.moved) {
      draggedRef.current = true;
      window.setTimeout(() => (draggedRef.current = false), 0);
      const box = ref.current?.getBoundingClientRect();
      const cx = box ? box.left + box.width / 2 : e.clientX;
      const cy = box ? box.top + box.height / 2 : e.clientY;
      setDrag(null);
      const next = snapCorner({ x: cx, y: cy }, { width: window.innerWidth, height: window.innerHeight });
      if (next !== corner) props.onMoveCorner(next);
    }
  };

  const style = drag ? { left: drag.x, top: drag.y } : cornerStyle(corner, 16, extraRight);

  return (
    <div
      ref={ref}
      className="pointer-events-auto fixed select-none"
      style={{ ...style, transition: drag ? 'none' : 'right 150ms ease, left 150ms ease' }}
    >
      {!expanded ? (
        <button
          type="button"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onClick={() => {
            if (!consumeDrag()) props.onExpand();
          }}
          onPointerCancel={() => {
            dragState.current = null;
            setDrag(null);
          }}
          aria-label={`Redline: ${count} comment${count === 1 ? '' : 's'}. Click to open, drag to move.`}
          title="Redline: click to open, drag to move"
          className={`flex cursor-grab items-center gap-2 rounded-full border border-rl-line bg-rl-ink px-3 py-2 text-sm text-rl-text shadow-lg transition-colors duration-150 hover:bg-rl-ink-2 focus-visible:ring-2 focus-visible:ring-rl-accent focus-visible:outline-none ${drag ? 'cursor-grabbing' : ''}`}
          data-pill
        >
          <span className="text-rl-accent-2">✎</span>
          <span className="font-medium">Redline</span>
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rl-accent px-1 text-xs font-semibold text-white">{count}</span>
          <span className="text-xs text-rl-muted" aria-hidden="true">▴</span>
        </button>
      ) : (
        <div
          role="toolbar"
          aria-label="Redline toolbar"
          className="flex items-center gap-1 rounded-xl border border-rl-line bg-rl-ink p-1 text-sm text-rl-text shadow-lg"
        >
          <button
            type="button"
            className={`${btn} cursor-grab px-2`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onClick={() => {
              if (!consumeDrag()) props.onCollapse();
            }}
            title="Collapse (Esc) · drag to move"
            aria-label="Collapse toolbar"
          >
            <span className="text-rl-accent-2">✎</span>
          </button>
          <ToolButton active={activeMode === 'pin'} onClick={() => props.onSetMode('pin')} label="Pin" hint={fmt(sc.pin)} icon={<PinIcon />} />
          <ToolButton active={activeMode === 'area'} onClick={() => props.onSetMode('area')} label="Area" hint={fmt(sc.area)} icon={<AreaIcon />} />
          <Sep />
          <ToolButton
            active={settings.screenshotByDefault}
            onClick={props.onToggleShot}
            label={settings.screenshotByDefault ? 'on' : 'off'}
            title={`Screenshot with each comment: ${settings.screenshotByDefault ? 'on' : 'off'} (${fmt(sc.screenshot)})`}
            aria={`Screenshot with each comment, currently ${settings.screenshotByDefault ? 'on' : 'off'}`}
            icon={<CameraIcon />}
            subtle
          />
          <Sep />
          <ToolButton active={drawerOpen} onClick={props.onToggleList} label={`List ${count}`} hint={fmt(sc.list)} icon={<ListIcon />} />
          <Sep />
          <ToolButton onClick={props.onSettings} label="" title="Settings" aria="Settings" icon={<GearIcon />} />
          <ToolButton onClick={props.onClose} label="" title="Turn Redline off for this site" aria="Turn Redline off for this site" icon={<CloseIcon />} />
        </div>
      )}
    </div>
  );
}

const btn =
  'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-colors duration-150 hover:bg-rl-ink-2 focus-visible:ring-2 focus-visible:ring-rl-accent focus-visible:outline-none';

function Sep() {
  return <span className="mx-0.5 h-5 w-px bg-rl-line" aria-hidden="true" />;
}

function ToolButton(p: {
  active?: boolean;
  onClick: () => void;
  label: string;
  hint?: string;
  title?: string;
  aria?: string;
  icon: ReactNode;
  subtle?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={p.onClick}
      aria-pressed={p.active === undefined ? undefined : p.active}
      aria-label={p.aria ?? (p.label || undefined)}
      title={p.title ?? (p.hint ? `${p.label} (${p.hint})` : p.label)}
      className={`${btn} ${p.active ? (p.subtle ? 'text-rl-accent-2' : 'bg-rl-accent text-white hover:bg-rl-accent-2') : 'text-rl-text'}`}
    >
      {p.icon}
      {p.label && <span className="text-xs">{p.label}</span>}
    </button>
  );
}
