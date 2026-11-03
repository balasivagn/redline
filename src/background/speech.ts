/**
 * Speech session state machine. One recording at a time:
 *   idle → listening → transcribing(engineLabel) → done(text) | error(code, message)
 * A second start (from any tab) cancels the first. If the configured engine is unavailable the
 * other one is used; if neither is, the session ends with error 'no-engine'.
 */
import type { Settings, SpeechEngineId } from '../core/settings';
import { SpeechError, toSpeechError, type CapturingEngine } from '../speech/engine';
import type { OffscreenPortEvent } from '../speech/offscreen-protocol';
import { MAX_RECORDING_SECONDS, type SpeechEngineStatus, type SpeechState } from '../speech/types';

/** A tab id, or 'extension' for extension pages (options "Test mic"). */
export type SpeechTarget = number | 'extension';

export interface SpeechControllerDeps {
  getSettings(): Promise<Settings>;
  engines: Record<SpeechEngineId, CapturingEngine>;
  emit(target: SpeechTarget, state: SpeechState): void;
  emitLevel(target: SpeechTarget, level: number): void;
  now?(): number;
}

export interface SpeechController {
  start(target: SpeechTarget): Promise<void>;
  stop(target: SpeechTarget): Promise<{ text: string }>;
  cancel(target: SpeechTarget): Promise<void>;
  status(): Promise<{ active: SpeechEngineStatus; engines: SpeechEngineStatus[] }>;
  handleOffscreenEvent(e: OffscreenPortEvent): void;
}

interface Session {
  target: SpeechTarget;
  cancelled: boolean;
  engine?: CapturingEngine;
  label: string;
  finishing?: Promise<string>;
}

function engineOrder(preferred: SpeechEngineId): SpeechEngineId[] {
  return preferred === 'chrome' ? ['chrome', 'native'] : ['native', 'chrome'];
}

export function createSpeechController(deps: SpeechControllerDeps): SpeechController {
  const now = deps.now ?? Date.now;
  let current: Session | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn);
    chain = run.catch(() => undefined);
    return run;
  };

  async function statusOf(id: SpeechEngineId): Promise<SpeechEngineStatus> {
    try {
      return await deps.engines[id].status();
    } catch (e) {
      return { id, available: false, label: id, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  function retire(s: Session, state: SpeechState): void {
    s.cancelled = true;
    if (current === s) current = null;
    deps.emit(s.target, state);
    const engine = s.engine;
    if (engine) void enqueue(() => engine.cancel().catch(() => undefined));
  }

  function fail(s: Session, e: unknown): void {
    const err = toSpeechError(e);
    s.cancelled = true;
    if (current === s) current = null;
    deps.emit(s.target, { state: 'error', code: err.code, message: err.message });
    if (s.engine) void enqueue(() => s.engine!.cancel().catch(() => undefined));
  }

  function noEngineError(statuses: SpeechEngineStatus[]): SpeechError {
    const native = statuses.find((s) => s.id === 'native');
    const details = statuses.map((s) => `${s.label}: ${s.detail ?? 'unavailable'}`).join(' · ');
    const noModel = native && /no speech model/i.test(native.detail ?? '');
    return new SpeechError(noModel ? 'no-model' : 'no-engine', `No speech engine is available. ${details}`);
  }

  async function doStart(s: Session): Promise<void> {
    try {
      const settings = await deps.getSettings();
      if (s.cancelled) return;
      const unavailable: SpeechEngineStatus[] = [];
      let lastFailure: unknown;
      for (const id of engineOrder(settings.voice.engine)) {
        const engine = deps.engines[id];
        const st = await statusOf(id);
        if (s.cancelled) return;
        if (!st.available) {
          unavailable.push(st);
          continue;
        }
        try {
          await engine.begin({ language: settings.voice.language, modelId: settings.voice.modelId, maxSeconds: MAX_RECORDING_SECONDS });
        } catch (e) {
          if (s.cancelled) return;
          const err = toSpeechError(e);
          // A mic problem would hit the other engine too: report it instead of falling back.
          if (err.code === 'mic-permission' || err.code === 'mic-unavailable') return fail(s, err);
          lastFailure = err;
          unavailable.push({ id, available: false, label: st.label, detail: err.message });
          continue;
        }
        if (s.cancelled) {
          await engine.cancel().catch(() => undefined);
          return;
        }
        s.engine = engine;
        s.label = st.label;
        deps.emit(s.target, { state: 'listening', startedAt: now() });
        return;
      }
      fail(s, lastFailure ?? noEngineError(unavailable));
    } catch (e) {
      fail(s, e);
    }
  }

  function runFinish(s: Session): Promise<string> {
    if (s.finishing) return s.finishing;
    const engine = s.engine;
    if (!engine) return Promise.resolve('');
    deps.emit(s.target, { state: 'transcribing', engineLabel: s.label });
    s.finishing = (async () => {
      try {
        const text = await engine.finish();
        if (s.cancelled) return '';
        if (current === s) current = null;
        deps.emit(s.target, { state: 'done', text });
        return text;
      } catch (e) {
        if (!s.cancelled) fail(s, e);
        return '';
      }
    })();
    return s.finishing;
  }

  return {
    start(target) {
      if (current) {
        const old = current;
        retire(old, old.target === target
          ? { state: 'idle' }
          : { state: 'error', code: 'cancelled', message: 'Another tab started recording.' });
      }
      const s: Session = { target, cancelled: false, label: '' };
      current = s;
      return enqueue(() => doStart(s));
    },

    async stop(target) {
      const s = current;
      if (!s || s.target !== target) return { text: '' };
      if (!s.engine) {
        // Still starting: nothing recorded yet.
        retire(s, { state: 'idle' });
        return { text: '' };
      }
      return { text: await runFinish(s) };
    },

    async cancel(target) {
      const s = current;
      if (!s || s.target !== target) return;
      retire(s, { state: 'idle' });
      await chain;
    },

    async status() {
      const settings = await deps.getSettings();
      const [native, chrome] = await Promise.all([statusOf('native'), statusOf('chrome')]);
      const byId = { native, chrome };
      const [first, second] = engineOrder(settings.voice.engine);
      const active = byId[first!].available ? byId[first!] : byId[second!].available ? byId[second!] : byId[first!];
      return { active, engines: [native, chrome] };
    },

    handleOffscreenEvent(e) {
      const s = current;
      if (!s) return;
      if (e.type === 'level') {
        if (!s.finishing) deps.emitLevel(s.target, e.level);
      } else if (e.type === 'record-max') {
        if (s.engine && !s.finishing) void runFinish(s);
      }
    },
  };
}
