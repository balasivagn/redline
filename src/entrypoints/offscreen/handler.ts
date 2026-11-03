import type { OffscreenMessage } from '../../core/messages';
import { toSpeechError } from '../../speech/engine';
import type { OffscreenReply } from '../../speech/offscreen-protocol';
import { bytesToBase64 } from '../../speech/wav';
import { chromeSpeechStatus } from './chrome-speech';

export interface OffscreenHandlerDeps {
  recorder: { start(maxSeconds: number): Promise<void>; stop(): ArrayBuffer; cancel(): void };
  speech: { start(lang: string): Promise<void>; stop(): Promise<string>; cancel(): void };
  status?: typeof chromeSpeechStatus;
}

export function createOffscreenHandler(deps: OffscreenHandlerDeps) {
  return async function handle(msg: OffscreenMessage): Promise<OffscreenReply<Record<string, unknown>>> {
    try {
      switch (msg.type) {
        case 'record/start':
          await deps.recorder.start(msg.maxSeconds);
          return { ok: true };
        case 'record/stop':
          return { ok: true, wavBase64: bytesToBase64(new Uint8Array(deps.recorder.stop())) };
        case 'record/cancel':
          deps.recorder.cancel();
          deps.speech.cancel();
          return { ok: true };
        case 'chrome-speech/start':
          await deps.speech.start(msg.lang);
          return { ok: true };
        case 'chrome-speech/stop':
          return { ok: true, text: await deps.speech.stop() };
        case 'chrome-speech/status':
          return { ok: true, status: await (deps.status ?? chromeSpeechStatus)(msg.lang) };
        case 'shot/crop':
          return { ok: false, code: 'transcribe-failed', message: 'shot/crop is handled in the service worker.' };
      }
    } catch (e) {
      const err = toSpeechError(e);
      return { ok: false, code: err.code, message: err.message };
    }
  };
}
