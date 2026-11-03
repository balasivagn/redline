/** Native engine: record WAV in the offscreen doc, transcribe with the local helper. */
import type { ModelInfo } from '../../helper/protocol';
import type { HelperClient } from '../background/helper-client';
import type { Settings } from '../core/settings';
import { SpeechError, type CapturingEngine, type SessionOptions } from './engine';
import type { SpeechEngineStatus } from './types';
import { base64ToBytes, bytesToBase64 } from './wav';

export interface RecorderClient {
  start(maxSeconds: number): Promise<void>;
  /** Stop recording; resolves with the 16 kHz mono WAV as base64. */
  stop(): Promise<string>;
  cancel(): Promise<void>;
}

/** settings.voice.modelId if it was detected, else the first tested whisper.cpp model. */
export function pickModel(models: ModelInfo[], preferredId?: string): ModelInfo | undefined {
  if (preferredId) {
    const m = models.find((x) => x.id === preferredId);
    if (m) return m;
  }
  return models.find((m) => m.tested && m.engine === 'whisper.cpp');
}

export function createNativeEngine(deps: {
  helper: HelperClient;
  recorder: RecorderClient;
  getSettings: () => Promise<Settings>;
}): CapturingEngine {
  let model: ModelInfo | undefined;
  let language = 'en';

  async function resolve(modelId?: string) {
    const st = await deps.helper.status();
    return { st, model: st.installed ? pickModel(st.models, modelId) : undefined };
  }

  return {
    id: 'native',
    async status(): Promise<SpeechEngineStatus> {
      const settings = await deps.getSettings();
      const { st, model: m } = await resolve(settings.voice.modelId);
      if (!st.installed) {
        return { id: 'native', available: false, label: 'Local helper', detail: st.error ?? 'Local voice helper is not installed.' };
      }
      if (!m) {
        return { id: 'native', available: false, label: 'Local helper', detail: 'No speech model found. Download one in Settings → Voice.' };
      }
      return { id: 'native', available: true, label: m.label };
    },
    async transcribe(wav, opts) {
      const { model: m } = await resolve(opts.modelId);
      if (!m) throw new SpeechError('no-model', 'No speech model available.');
      return deps.helper.transcribe({ modelId: m.id, language: opts.language.split('-')[0] ?? 'en', wavBase64: bytesToBase64(new Uint8Array(wav)) });
    },
    async begin(opts: SessionOptions) {
      const { st, model: m } = await resolve(opts.modelId);
      if (!st.installed) throw new SpeechError('helper-missing', st.error ?? 'Local voice helper is not installed.');
      if (!m) throw new SpeechError('no-model', 'No speech model found.');
      model = m;
      language = opts.language.split('-')[0] ?? 'en';
      await deps.recorder.start(opts.maxSeconds);
    },
    async finish() {
      if (!model) throw new SpeechError('transcribe-failed', 'Nothing was recorded.');
      const wavBase64 = await deps.recorder.stop();
      // Skip the helper for an empty recording (header only).
      if (base64ToBytes(wavBase64).length <= 44) return '';
      try {
        return (await deps.helper.transcribe({ modelId: model.id, language, wavBase64 })).trim();
      } catch (e) {
        throw new SpeechError('transcribe-failed', e instanceof Error ? e.message : String(e));
      }
    },
    async cancel() {
      model = undefined;
      await deps.recorder.cancel();
    },
  };
}
