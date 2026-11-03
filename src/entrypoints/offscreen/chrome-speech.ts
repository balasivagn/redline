/** Chrome on-device Web Speech (processLocally) inside the offscreen document. */
import { SpeechError } from '../../speech/engine';
import type { SpeechEngineStatus } from '../../speech/types';

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  onstart: (() => void) | null;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface RecognitionCtor {
  new (): RecognitionLike;
  available?: (opts: { langs: string[]; processLocally: boolean }) => Promise<string>;
  prototype: object;
}

function getCtor(): RecognitionCtor | undefined {
  const g = globalThis as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition;
}

export async function chromeSpeechStatus(lang: string): Promise<SpeechEngineStatus> {
  const label = `Chrome on-device (${lang})`;
  const unavailable = (detail: string): SpeechEngineStatus => ({ id: 'chrome', available: false, label, detail });
  const Ctor = getCtor();
  if (!Ctor) return unavailable('Web Speech recognition is not available in this Chrome.');
  if (!('processLocally' in Ctor.prototype)) return unavailable('This Chrome version has no on-device speech recognition (needs Chrome 139+).');
  if (typeof Ctor.available !== 'function') return unavailable('Cannot check on-device speech support in this Chrome.');
  try {
    const availability = await Ctor.available({ langs: [lang], processLocally: true });
    if (availability === 'available') return { id: 'chrome', available: true, label };
    if (availability === 'downloadable' || availability === 'downloading') {
      return unavailable(`The on-device speech model for ${lang} is not installed yet (${availability}).`);
    }
    return unavailable(`On-device speech is not available for ${lang}.`);
  } catch (e) {
    return unavailable(`On-device speech check failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function createChromeSpeech() {
  let rec: RecognitionLike | null = null;
  let finals: string[] = [];
  let interim = '';
  let ended: Promise<void> = Promise.resolve();

  function mapError(code: string, message?: string): SpeechError {
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      return new SpeechError('mic-permission', 'Microphone access has not been granted. Allow it once in Redline settings.');
    }
    if (code === 'audio-capture') return new SpeechError('mic-unavailable', 'No usable microphone found.');
    return new SpeechError('transcribe-failed', `Chrome speech error: ${code}${message ? ` (${message})` : ''}`);
  }

  async function start(lang: string): Promise<void> {
    cancel();
    const Ctor = getCtor();
    if (!Ctor) throw new SpeechError('no-engine', 'Web Speech recognition is not available.');
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.processLocally = true;
    finals = [];
    interim = '';
    rec = r;
    let resolveEnded!: () => void;
    ended = new Promise<void>((res) => { resolveEnded = res; });

    await new Promise<void>((resolve, reject) => {
      let started = false;
      r.onstart = () => { started = true; resolve(); };
      r.onresult = (e) => {
        interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i]!;
          const t = res[0]?.transcript ?? '';
          if (res.isFinal) finals.push(t);
          else interim += t;
        }
      };
      r.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        if (!started) reject(mapError(e.error, e.message));
      };
      r.onend = () => { resolveEnded(); if (!started) reject(new SpeechError('transcribe-failed', 'Speech recognition ended before it started.')); };
      try { r.start(); } catch (e) { reject(new SpeechError('transcribe-failed', e instanceof Error ? e.message : String(e))); }
    }).catch((e) => { cancel(); throw e; });
  }

  async function stop(): Promise<string> {
    const r = rec;
    if (!r) throw new SpeechError('transcribe-failed', 'Not listening.');
    r.stop();
    await Promise.race([ended, new Promise((res) => setTimeout(res, 4000))]);
    const text = [...finals, interim].join(' ').replace(/\s+/g, ' ').trim();
    rec = null;
    return text;
  }

  function cancel(): void {
    const r = rec;
    rec = null;
    if (r) { r.onend = null; r.onresult = null; r.onerror = null; try { r.abort(); } catch { /* ignore */ } }
  }

  return { start, stop, cancel, get active() { return rec !== null; } };
}
