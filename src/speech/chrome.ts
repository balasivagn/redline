/** Chrome on-device Web Speech engine. Runs in the offscreen doc; this is the background proxy. */
import type { Settings } from '../core/settings';
import { toBcp47, type CapturingEngine, type SessionOptions } from './engine';
import type { SpeechEngineStatus } from './types';

export interface ChromeSpeechTransport {
  status(lang: string): Promise<SpeechEngineStatus>;
  start(lang: string): Promise<void>;
  stop(): Promise<string>;
  cancel(): Promise<void>;
}

export function createChromeEngine(deps: {
  transport: ChromeSpeechTransport;
  getSettings: () => Promise<Settings>;
  now?: () => number;
  ttlMs?: number;
}): CapturingEngine {
  const now = deps.now ?? Date.now;
  const ttl = deps.ttlMs ?? 30_000;
  let cache: { lang: string; at: number; value: SpeechEngineStatus } | null = null;

  return {
    id: 'chrome',
    async status() {
      const lang = toBcp47((await deps.getSettings()).voice.language);
      if (cache && cache.lang === lang && now() - cache.at < ttl) return cache.value;
      let value: SpeechEngineStatus;
      try {
        value = await deps.transport.status(lang);
      } catch (e) {
        value = { id: 'chrome', available: false, label: `Chrome on-device (${lang})`, detail: e instanceof Error ? e.message : String(e) };
      }
      cache = { lang, at: now(), value };
      return value;
    },
    async begin(opts: SessionOptions) {
      await deps.transport.start(toBcp47(opts.language));
    },
    finish: () => deps.transport.stop(),
    cancel: () => deps.transport.cancel(),
  };
}
