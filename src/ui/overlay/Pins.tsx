import { useRef, useState } from 'react';
import type { ResolvedAnchor } from '../../core/anchor';
import type { Annotation } from '../../core/schema';
import { ShotImage } from '../list/ShotImage';
import { positionBox } from './geometry';
import { EditIcon, TrashIcon, WarnIcon } from './icons';
import { excerpt } from './text';

interface Props {
  annotations: Annotation[];
  resolved: Map<string, ResolvedAnchor>;
  flashId: string | null;
  /** Annotation currently open in the comment box (its pin is drawn by the box). */
  hideId: string | null;
  onEdit: (a: Annotation) => void;
  onDelete: (a: Annotation) => void;
}

export function PinsLayer({ annotations, resolved, flashId, hideId, onEdit, onDelete }: Props) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const leaveTimer = useRef(0);
  const enter = (id: string) => {
    window.clearTimeout(leaveTimer.current);
    setHoverId(id);
  };
  const leave = () => {
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setHoverId(null), 160);
  };
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  return (
    <>
      {annotations.map((a) => {
        const r = resolved.get(a.id);
        if (!r || a.id === hideId) return null;
        const detached = r.status === 'detached';
        const isArea = a.anchor.kind === 'area';
        const rect = r.clientRect;
        const p = r.clientPoint;
        const flash = flashId === a.id;
        const showBox = isArea && rect && !detached;
        const anchorPt = showBox ? { x: rect.x + rect.width, y: rect.y } : p;
        if (anchorPt.x < -40 || anchorPt.y < -40 || anchorPt.x > vw + 40 || anchorPt.y > vh + 40) {
          if (!(showBox && rect && rect.x < vw && rect.y < vh && rect.x + rect.width > 0 && rect.y + rect.height > 0)) return null;
        }
        const label = `Comment ${a.number}${detached ? ' (detached)' : ''}: ${excerpt(a.comment.text, 60)}`;
        return (
          <div key={a.id}>
            {showBox && (
              <div
                className={`pointer-events-none fixed rounded-sm border-2 border-dashed border-rl-accent/80 bg-rl-accent/5 ${flash ? 'rl-flash' : ''}`}
                style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
              />
            )}
            <button
              type="button"
              aria-label={label}
              title={label}
              onClick={() => onEdit(a)}
              onMouseEnter={() => enter(a.id)}
              onMouseLeave={leave}
              onFocus={() => enter(a.id)}
              onBlur={leave}
              className={`pointer-events-auto fixed flex h-[22px] min-w-[22px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white px-1 text-xs font-semibold text-white shadow-md transition-transform duration-150 hover:scale-110 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none ${
                detached ? 'bg-rl-warn text-black' : 'bg-rl-accent'
              } ${flash ? 'rl-flash' : ''}`}
              style={{ left: anchorPt.x, top: anchorPt.y }}
            >
              {detached ? <WarnIcon size={12} /> : a.number}
            </button>
            {hoverId === a.id && (
              <PreviewCard
                a={a}
                at={anchorPt}
                detached={detached}
                onEnter={() => enter(a.id)}
                onLeave={leave}
                onEdit={() => {
                  setHoverId(null);
                  onEdit(a);
                }}
                onDelete={() => {
                  setHoverId(null);
                  onDelete(a);
                }}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function PreviewCard(props: {
  a: Annotation;
  at: { x: number; y: number };
  detached: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { a, at, detached } = props;
  const pos = positionBox({ x: at.x - 11, y: at.y - 11, width: 22, height: 22 }, { width: 280, height: 84 }, { width: window.innerWidth, height: window.innerHeight }, { gap: 6 });
  return (
    <div
      role="group"
      aria-label={`Comment ${a.number} preview`}
      onMouseEnter={props.onEnter}
      onMouseLeave={props.onLeave}
      className="pointer-events-auto fixed w-[280px] rounded-lg border border-rl-line bg-rl-ink p-3 text-sm text-rl-text shadow-xl"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="mb-1 flex items-center gap-1.5 text-xs text-rl-muted">
        <span className="font-semibold text-rl-accent-2">#{a.number}</span>
        {detached && (
          <span className="flex items-center gap-1 text-rl-warn">
            <WarnIcon size={12} /> detached
          </span>
        )}
      </div>
      <div className="mb-2 flex items-start gap-2">
        <p className="min-w-0 flex-1 break-words text-rl-text">{excerpt(a.comment.text, 140)}</p>
        {a.screenshot && (
          <div className="h-10 w-14 shrink-0 overflow-hidden rounded-md border border-rl-line bg-rl-ink-2" data-testid="pin-shot">
            <ShotImage shotId={a.screenshot.shotId} alt={`Screenshot for comment ${a.number}`} className="h-full w-full object-cover" />
          </div>
        )}
      </div>
      <div className="flex justify-end gap-1">
        <button type="button" className={cardBtn} onClick={props.onEdit} aria-label="Edit comment" title="Edit">
          <EditIcon size={14} /> Edit
        </button>
        <button type="button" className={`${cardBtn} hover:text-rl-accent-2`} onClick={props.onDelete} aria-label="Delete comment" title="Delete">
          <TrashIcon size={14} />
        </button>
      </div>
    </div>
  );
}

const cardBtn =
  'flex items-center gap-1 rounded-md px-2 py-1 text-xs text-rl-muted transition-colors duration-150 hover:bg-rl-ink-2 hover:text-rl-text focus-visible:ring-2 focus-visible:ring-rl-accent focus-visible:outline-none';
