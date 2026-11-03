import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { describeElement } from '../../core/capture';
import type { FrameworkInfo } from '../../core/schema';
import { formatShortcut, type Settings } from '../../core/settings';
import { describeDom } from './annotation';
import { positionBox } from './geometry';
import { useViewportTick } from './hooks';
import { commentBoxKeyAction, commentHint, focusableElements, screenshotBoxShortcut, trapTarget } from './commentKeys';
import { CameraIcon, CloseIcon, MicIcon, StopIcon, WarnIcon } from './icons';
import { deepTarget } from './shortcuts';
import { commentSource, formatTimer, insertAtCursor } from './text';
import type { Draft, SaveRequest } from './types';
import { useVoice } from './useVoice';
import { isNotSetUp } from './voice';

interface Props {
  draft: Draft;
  nextNumber: number;
  settings: Settings;
  onCancel: () => void;
  onSave: (r: SaveRequest) => Promise<void>;
  onOpenVoiceSettings: () => void;
  onUseChromeSpeech: () => Promise<void>;
}

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);

function safeDescribe(draft: Draft): string {
  if (draft.kind === 'existing') return describeDom(draft.annotation.dom);
  try {
    return describeElement(draft.element);
  } catch {
    return describeDom(draft.dom);
  }
}

function useNow(active: boolean, every = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(t);
  }, [active, every]);
  return now;
}

export function CommentBox({ draft, nextNumber, settings, onCancel, onSave, onOpenVoiceSettings, onUseChromeSpeech }: Props) {
  const existing = draft.kind === 'existing' ? draft.annotation : null;
  const [text, setText] = useState(existing?.comment.text ?? '');
  const [withShot, setWithShot] = useState(settings.screenshotByDefault);
  const [details, setDetails] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<{ start: number; end: number } | null>(null);
  const [framework, setFramework] = useState<FrameworkInfo | undefined>(existing?.dom.framework);
  const [size, setSize] = useState({ width: 400, height: 190 });

  const rootRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDListElement>(null);
  const detailsBtnRef = useRef<HTMLButtonElement>(null);
  const detailsId = useId();
  const textRef = useRef(text);
  textRef.current = text;
  const dictatedRef = useRef<string[]>([]);
  const caretRef = useRef<number | null>(null);
  useViewportTick();

  const dom = draft.kind === 'new' ? draft.dom : draft.annotation.dom;
  const anchor = draft.kind === 'new' ? draft.anchor : draft.annotation.anchor;
  const number = existing ? existing.number : nextNumber;

  useEffect(() => {
    if (draft.kind !== 'new') return;
    let alive = true;
    draft.framework.then((f) => alive && setFramework(f)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [draft]);

  const handleVoiceText = useCallback((spoken: string) => {
    const ta = taRef.current;
    const value = textRef.current;
    const res = insertAtCursor(value, ta?.selectionStart ?? value.length, ta?.selectionEnd ?? value.length, spoken);
    if (!res.highlight) {
      setNote('No speech detected');
      ta?.focus();
      return;
    }
    dictatedRef.current.push(spoken.trim());
    caretRef.current = res.caret;
    setText(res.value);
    setHighlight(res.highlight);
  }, []);

  const voice = useVoice(handleVoiceText);
  const phase = voice.status.phase;
  const voiceBusy = phase === 'starting' || phase === 'listening' || phase === 'transcribing';
  const now = useNow(phase === 'listening');

  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 3000);
    return () => window.clearTimeout(t);
  }, [note]);

  useEffect(() => {
    if (!highlight) return;
    const t = window.setTimeout(() => setHighlight(null), 1800);
    return () => window.clearTimeout(t);
  }, [highlight]);

  // Autofocus; place the caret at the end.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, []);

  // Auto-grow, sync backdrop, apply pending caret after a programmatic insert.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
    if (caretRef.current !== null) {
      ta.focus();
      ta.setSelectionRange(caretRef.current, caretRef.current);
      caretRef.current = null;
    }
    if (backdropRef.current) backdropRef.current.scrollTop = ta.scrollTop;
  }, [text]);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (Math.abs(s.width - r.width) < 1 && Math.abs(s.height - r.height) < 1 ? s : { width: r.width, height: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const source = commentSource(text, dictatedRef.current);
  const canSave = text.trim().length > 0 && !saving && !voiceBusy;

  const doSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ text: text.trim(), source, dictated: dictatedRef.current, withShot });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }, [canSave, onSave, text, source, withShot]);

  // Keys (window capture, so they work even if focus slipped out of the box): Tab focus trap, Esc,
  // Enter / ⌘Enter, dictate and the 📷 shortcut. The pure decisions live in commentKeys.ts.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    const root = rootRef.current;
    if (!root) return;
    const active = (root.getRootNode() as Document | ShadowRoot).activeElement;
    if (e.key === 'Tab') {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const next = trapTarget(focusableElements(root), active, e.shiftKey);
      if (next) {
        e.preventDefault();
        e.stopPropagation();
        next.focus();
      }
      return;
    }
    const act = commentBoxKeyAction(e, {
      enterToSave: settings.enterToSave,
      voiceBusy,
      voicePhase: phase,
      hasText: text.trim().length > 0,
      inTextarea: deepTarget(e) === taRef.current,
      detailsFocused: !!detailsRef.current && !!active && detailsRef.current.contains(active),
      canToggleShot: draft.kind === 'new',
      shortcuts: settings.shortcuts,
    });
    if (!act || act === 'newline') return;
    e.preventDefault();
    e.stopPropagation();
    if (act === 'cancel-voice') void voice.cancel();
    else if (act === 'close-details') {
      setDetails(false);
      detailsBtnRef.current?.focus();
    } else if (act === 'cancel') onCancel();
    else if (act === 'save') void doSave();
    else if (act === 'toggle-shot') setWithShot((v) => !v);
    else if (act === 'dictate' && phase !== 'transcribing' && phase !== 'starting') voice.toggle();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);

  const onMic = () => {
    if (phase === 'transcribing') return;
    if (phase === 'starting') void voice.cancel();
    else if (phase === 'listening') void voice.stop();
    else void voice.start();
  };

  const vp = { width: window.innerWidth, height: window.innerHeight };
  const rect = draft.getRect();
  const pos = positionBox(rect, size, vp);
  const dictateLabel = formatShortcut(settings.shortcuts.dictate, isMac);
  const component = framework?.component;
  const descriptor = safeDescribe(draft);
  const headerTitle = component ? `${descriptor} · <${component}>` : descriptor;
  const shotKey = screenshotBoxShortcut(settings.shortcuts, isMac);
  const hint = commentHint(settings, isMac);
  const err = voice.status.phase === 'error' ? voice.status : null;

  return (
    <>
      <div
        className={`pointer-events-none fixed rounded-sm border-2 border-rl-accent bg-rl-accent/10 ${anchor.kind === 'area' ? 'border-dashed' : ''}`}
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      >
        <span className="absolute -top-3 -left-3 flex h-6 w-6 items-center justify-center rounded-full bg-rl-accent text-xs font-semibold text-white shadow">
          {number}
        </span>
      </div>
      <div
        ref={rootRef}
        role="dialog"
        aria-label={`Comment ${number}`}
        className="pointer-events-auto fixed w-[400px] max-w-[calc(100vw-16px)] overflow-hidden rounded-lg bg-rl-paper text-sm text-rl-paper-text shadow-2xl ring-1 ring-black/10 transition-opacity duration-150"
        style={{ left: pos.left, top: pos.top }}
      >
        <div className="flex items-center gap-1 border-b border-black/10 py-1.5 pr-1.5 pl-3">
          <span className="mr-1 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-rl-accent px-1 text-xs font-semibold text-white">{number}</span>
          <div className="flex min-w-0 flex-1 items-baseline gap-1.5" title={headerTitle}>
            <span className="truncate font-mono text-xs">{descriptor}</span>
            {component && (
              <span className="truncate text-xs text-black/50">
                · {'<'}{component}{'>'}
              </span>
            )}
          </div>
          <button
            type="button"
            className={`${iconBtn} ${phase === 'listening' ? 'bg-rl-accent/10 text-rl-accent' : ''}`}
            onClick={onMic}
            aria-label="Dictate"
            aria-pressed={phase === 'listening' || phase === 'starting'}
            aria-disabled={phase === 'transcribing' || undefined}
            title={`Dictate (${dictateLabel})`}
          >
            <MicIcon />
          </button>
          {draft.kind === 'new' && (
            <button
              type="button"
              className={`${iconBtn} ${withShot ? 'text-rl-accent' : 'text-black/40'}`}
              onClick={() => setWithShot((v) => !v)}
              aria-pressed={withShot}
              aria-label={withShot ? 'Screenshot will be attached' : 'No screenshot'}
              title={`${withShot ? 'Screenshot will be attached (click to turn off)' : 'Attach a screenshot'}${shotKey ? ` · ${shotKey}` : ''}`}
            >
              <CameraIcon />
              <span className="text-xs">{withShot ? '✓' : 'off'}</span>
            </button>
          )}
          <button
            ref={detailsBtnRef}
            type="button"
            className={`${iconBtn} ${details ? 'bg-black/5 text-rl-accent' : 'text-black/60'}`}
            onClick={() => setDetails((v) => !v)}
            aria-expanded={details}
            aria-controls={detailsId}
            aria-label="DOM details"
            title="DOM details"
          >
            <InfoIcon />
          </button>
          <button type="button" className={`${iconBtn} text-black/60`} onClick={onCancel} aria-label="Cancel" title="Cancel (Esc)">
            <CloseIcon />
          </button>
        </div>

        {details && (
          <dl
            ref={detailsRef}
            id={detailsId}
            tabIndex={-1}
            aria-label="DOM details"
            className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 border-b border-black/10 bg-black/[0.03] px-3 py-2 text-xs outline-none"
          >
            <DomRow k="selector" v={anchor.selector} mono />
            {framework?.componentStack?.length ? <DomRow k="component" v={framework.componentStack.join(' ← ')} /> : null}
            {framework?.source && (
              <DomRow k="source" v={`${framework.source.file}${framework.source.line ? `:${framework.source.line}` : ''}`} mono />
            )}
            <DomRow
              k="size"
              v={`${Math.round(dom.rect.width)} × ${Math.round(dom.rect.height)} @ (${Math.round(dom.rect.x)}, ${Math.round(dom.rect.y)})`}
            />
            {dom.text && <DomRow k="text" v={`"${dom.text}"`} />}
            {Object.keys(dom.styles).length > 0 && (
              <DomRow
                k="styles"
                v={Object.entries(dom.styles)
                  .slice(0, 8)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(' · ')}
              />
            )}
          </dl>
        )}

        <div className="px-3 py-2">
          <div className="relative">
            <div
              ref={backdropRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 overflow-hidden text-sm leading-[18px] break-words whitespace-pre-wrap text-transparent"
            >
              {highlight ? (
                <>
                  {text.slice(0, highlight.start)}
                  <mark className="rounded-sm bg-amber-200 text-transparent">{text.slice(highlight.start, highlight.end)}</mark>
                  {text.slice(highlight.end)}
                </>
              ) : (
                text
              )}
              {'​'}
            </div>
            <textarea
              ref={taRef}
              value={text}
              rows={3}
              placeholder="What should change here?"
              aria-label="Comment text"
              className="relative block w-full resize-none bg-transparent text-sm leading-[18px] text-rl-paper-text outline-none placeholder:text-black/35"
              onChange={(e) => {
                setHighlight(null);
                setText(e.target.value);
              }}
              onScroll={(e) => {
                if (backdropRef.current) backdropRef.current.scrollTop = e.currentTarget.scrollTop;
              }}
            />
          </div>
        </div>

        {(saveError || note) && (
          <div className={`px-3 pb-1 text-xs ${saveError ? 'text-rl-accent' : 'text-black/50'}`} role={saveError ? 'alert' : 'status'}>
            {saveError ? `Couldn't save: ${saveError}` : note}
          </div>
        )}

        <div className="flex min-h-11 items-center gap-2 border-t border-black/10 px-3 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {phase === 'listening' || phase === 'starting' ? (
              <>
                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-rl-accent" aria-hidden="true" />
                <span className="w-8 shrink-0 font-mono text-xs tabular-nums" aria-label="Recording time">
                  {voice.status.phase === 'listening' ? formatTimer(now - voice.status.startedAt) : '0:00'}
                </span>
                <LevelBars levels={voice.levels} />
                <span className="min-w-0 flex-1 truncate text-xs text-black/60">{phase === 'starting' ? 'Starting…' : 'Listening…'}</span>
                <button type="button" className={stopBtn} onClick={() => void (phase === 'starting' ? voice.cancel() : voice.stop())} title={phase === 'starting' ? 'Cancel (Esc)' : `Stop (${dictateLabel})`}>
                  <StopIcon size={12} /> Stop
                </button>
              </>
            ) : phase === 'transcribing' ? (
              <>
                <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-black/20 border-t-rl-accent" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-xs text-black/60">
                  Transcribing locally{voice.status.phase === 'transcribing' && voice.status.engineLabel ? ` · ${voice.status.engineLabel}` : ''}
                </span>
              </>
            ) : err ? (
              <div role="alert" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-amber-900">
                <WarnIcon size={14} />
                {isNotSetUp(err.code) ? (
                  <>
                    <span>Voice isn't set up.</span>
                    <button type="button" className={linkBtn} onClick={onOpenVoiceSettings}>Set up voice</button>
                    <button
                      type="button"
                      className={linkBtn}
                      onClick={async () => {
                        voice.dismiss();
                        await onUseChromeSpeech();
                        void voice.start();
                      }}
                    >
                      Use Chrome speech
                    </button>
                  </>
                ) : err.code === 'mic-permission' ? (
                  <>
                    <span>Allow the microphone once.</span>
                    <button type="button" className={linkBtn} onClick={onOpenVoiceSettings}>Grant mic access</button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate" title={err.message}>{err.message || 'Voice failed.'}</span>
                    <button type="button" className={linkBtn} onClick={voice.dismiss}>Dismiss</button>
                  </>
                )}
              </div>
            ) : (
              <span className="min-w-0 truncate text-xs text-black/50" data-testid="comment-hint">{hint}</span>
            )}
          </div>
          <button type="button" className={saveBtn} onClick={() => void doSave()} disabled={!canSave} title={`Save (${settings.enterToSave ? '↵' : `${isMac ? '⌘' : 'Ctrl+'}↵`})`}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </>
  );
}

const InfoIcon = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4M12 8h.01" />
  </svg>
);

const iconBtn =
  'flex items-center gap-1 rounded-md p-1.5 transition-colors duration-150 hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-rl-accent focus-visible:outline-none';
const linkBtn =
  'rounded px-1.5 py-0.5 font-medium text-amber-950 underline underline-offset-2 hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-rl-accent focus-visible:outline-none';
const saveBtn =
  'rounded-md bg-rl-accent px-3 py-1 text-xs font-medium text-white transition-colors duration-150 hover:bg-rl-accent-2 focus-visible:ring-2 focus-visible:ring-rl-accent focus-visible:ring-offset-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';
const stopBtn =
  'flex items-center gap-1 rounded-md bg-rl-accent px-2.5 py-1 text-xs font-medium text-white transition-colors duration-150 hover:bg-rl-accent-2 focus-visible:ring-2 focus-visible:ring-rl-accent focus-visible:ring-offset-1 focus-visible:outline-none disabled:opacity-40';

function DomRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-black/45">{k}</dt>
      <dd className={`min-w-0 break-words ${mono ? 'font-mono' : ''}`}>{v}</dd>
    </>
  );
}

function LevelBars({ levels }: { levels: number[] }) {
  const bars = Array.from({ length: 14 }, (_, i) => levels[levels.length - 14 + i] ?? 0);
  return (
    <div className="flex h-5 items-center gap-[2px]" aria-hidden="true">
      {bars.map((l, i) => (
        <span key={i} className="w-[3px] rounded-full bg-rl-accent transition-[height] duration-100" style={{ height: `${Math.max(3, Math.round(l * 20))}px` }} />
      ))}
    </div>
  );
}
