import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings, type SpeechEngineId } from '../core/settings';
import { SpeechError, type CapturingEngine } from '../speech/engine';
import type { SpeechEngineStatus, SpeechState } from '../speech/types';
import { createSpeechController, type SpeechTarget } from './speech';

function fakeEngine(id: SpeechEngineId, over: Partial<{ available: boolean; detail: string; beginError: Error; text: string; finishError: Error; finishGate: Promise<void> }> = {}) {
  const calls: string[] = [];
  const engine: CapturingEngine = {
    id,
    async status(): Promise<SpeechEngineStatus> {
      return { id, available: over.available ?? true, label: `${id}-label`, detail: over.detail };
    },
    async begin() {
      calls.push('begin');
      if (over.beginError) throw over.beginError;
    },
    async finish() {
      calls.push('finish');
      if (over.finishGate) await over.finishGate;
      if (over.finishError) throw over.finishError;
      return over.text ?? `${id}-text`;
    },
    async cancel() { calls.push('cancel'); },
  };
  return { engine, calls };
}

function setup(opts: { engine?: SpeechEngineId; native?: Parameters<typeof fakeEngine>[1]; chrome?: Parameters<typeof fakeEngine>[1] } = {}) {
  const native = fakeEngine('native', opts.native);
  const chrome = fakeEngine('chrome', opts.chrome);
  const states: Array<[SpeechTarget, SpeechState]> = [];
  const levels: Array<[SpeechTarget, number]> = [];
  const settings: Settings = { ...DEFAULT_SETTINGS, voice: { ...DEFAULT_SETTINGS.voice, engine: opts.engine ?? 'native' } };
  const ctl = createSpeechController({
    getSettings: async () => settings,
    engines: { native: native.engine, chrome: chrome.engine },
    emit: (t, s) => states.push([t, s]),
    emitLevel: (t, l) => levels.push([t, l]),
    now: () => 1000,
  });
  return { ctl, native, chrome, states, levels };
}

const names = (states: Array<[SpeechTarget, SpeechState]>) => states.map(([, s]) => s.state);

describe('speech controller', () => {
  it('listening → transcribing(label) → done(text)', async () => {
    const { ctl, states, native } = setup();
    await ctl.start(1);
    expect(states[0]).toEqual([1, { state: 'listening', startedAt: 1000 }]);
    const r = await ctl.stop(1);
    expect(r).toEqual({ text: 'native-text' });
    expect(states.map(([, s]) => s)).toEqual([
      { state: 'listening', startedAt: 1000 },
      { state: 'transcribing', engineLabel: 'native-label' },
      { state: 'done', text: 'native-text' },
    ]);
    expect(native.calls).toEqual(['begin', 'finish']);
  });

  it('falls back to the other engine when the configured one is unavailable', async () => {
    const { ctl, states, chrome, native } = setup({ native: { available: false, detail: 'no helper' } });
    await ctl.start(1);
    expect(native.calls).toEqual([]);
    expect(chrome.calls).toEqual(['begin']);
    expect(names(states)).toEqual(['listening']);
    expect((await ctl.stop(1)).text).toBe('chrome-text');
  });

  it('falls back when begin fails for a non-mic reason', async () => {
    const { ctl, states, chrome } = setup({ native: { beginError: new SpeechError('helper-missing', 'gone') } });
    await ctl.start(1);
    expect(chrome.calls).toEqual(['begin']);
    expect(names(states)).toEqual(['listening']);
  });

  it('reports no-engine when neither is available', async () => {
    const { ctl, states } = setup({ native: { available: false, detail: 'not installed' }, chrome: { available: false, detail: 'unsupported' } });
    await ctl.start(7);
    expect(states).toHaveLength(1);
    const [target, st] = states[0]!;
    expect(target).toBe(7);
    expect(st).toMatchObject({ state: 'error', code: 'no-engine' });
    expect((st as { message: string }).message).toContain('not installed');
    expect(await ctl.stop(7)).toEqual({ text: '' });
  });

  it('mic permission errors do not fall back', async () => {
    const { ctl, states, chrome } = setup({ native: { beginError: new SpeechError('mic-permission', 'denied') } });
    await ctl.start(1);
    expect(chrome.calls).toEqual([]);
    expect(states[0]![1]).toMatchObject({ state: 'error', code: 'mic-permission' });
  });

  it('honours settings.voice.engine = chrome first', async () => {
    const { ctl, chrome, native } = setup({ engine: 'chrome' });
    await ctl.start(1);
    expect(chrome.calls).toEqual(['begin']);
    expect(native.calls).toEqual([]);
  });

  it('cancel returns to idle and discards', async () => {
    const { ctl, states, native } = setup();
    await ctl.start(1);
    await ctl.cancel(1);
    expect(names(states)).toEqual(['listening', 'idle']);
    expect(native.calls).toEqual(['begin', 'cancel']);
    expect(await ctl.stop(1)).toEqual({ text: '' });
  });

  it("cancel from another tab does not touch someone else's session", async () => {
    const { ctl, states } = setup();
    await ctl.start(1);
    await ctl.cancel(2);
    expect(names(states)).toEqual(['listening']);
    expect((await ctl.stop(1)).text).toBe('native-text');
  });

  it('a second start from another tab cancels the first', async () => {
    const { ctl, states, native } = setup();
    await ctl.start(1);
    await ctl.start(2);
    expect(states.map(([t, s]) => [t, s.state])).toEqual([[1, 'listening'], [1, 'error'], [2, 'listening']]);
    expect(states[1]![1]).toMatchObject({ code: 'cancelled' });
    expect(native.calls).toEqual(['begin', 'cancel', 'begin']);
    expect(await ctl.stop(1)).toEqual({ text: '' });
    expect((await ctl.stop(2)).text).toBe('native-text');
  });

  it('cancelling while transcribing discards the result', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { ctl, states } = setup({ native: { finishGate: gate } });
    await ctl.start(1);
    const stopping = ctl.stop(1);
    await Promise.resolve();
    await ctl.cancel(1);
    release();
    expect(await stopping).toEqual({ text: '' });
    expect(names(states)).toEqual(['listening', 'transcribing', 'idle']);
  });

  it('transcription failures become error states', async () => {
    const { ctl, states } = setup({ native: { finishError: new SpeechError('transcribe-failed', 'whisper crashed') } });
    await ctl.start(1);
    expect(await ctl.stop(1)).toEqual({ text: '' });
    expect(states.at(-1)![1]).toEqual({ state: 'error', code: 'transcribe-failed', message: 'whisper crashed' });
  });

  it('relays levels only for the live session and auto-finishes on record-max', async () => {
    const { ctl, states, levels } = setup();
    ctl.handleOffscreenEvent({ type: 'level', level: 0.5 }); // no session
    await ctl.start(3);
    ctl.handleOffscreenEvent({ type: 'level', level: 0.4 });
    expect(levels).toEqual([[3, 0.4]]);
    ctl.handleOffscreenEvent({ type: 'record-max' });
    await new Promise((r) => setTimeout(r, 0));
    expect(names(states)).toEqual(['listening', 'transcribing', 'done']);
    expect(levels).toHaveLength(1);
  });

  it('status picks the first available engine as active', async () => {
    const { ctl } = setup({ native: { available: false, detail: 'x' } });
    const st = await ctl.status();
    expect(st.active.id).toBe('chrome');
    expect(st.engines.map((e) => e.id)).toEqual(['native', 'chrome']);
    const none = await setup({ native: { available: false }, chrome: { available: false } }).ctl.status();
    expect(none.active.id).toBe('native');
    expect(none.active.available).toBe(false);
  });
});
