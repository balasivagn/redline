/** Runtime-side engine interface used by the background speech session controller. */
import type { SpeechEngine, SpeechErrorCode } from './types';

export class SpeechError extends Error {
  constructor(readonly code: SpeechErrorCode, message: string) {
    super(message);
    this.name = 'SpeechError';
  }
}

export interface SessionOptions {
  language: string;
  modelId?: string;
  maxSeconds: number;
}

export interface CapturingEngine extends SpeechEngine {
  /** Start capturing the mic. Throws SpeechError (mic-permission / mic-unavailable / …). */
  begin(opts: SessionOptions): Promise<void>;
  /** Stop capturing and resolve with the transcript. */
  finish(): Promise<string>;
  /** Abort without a transcript; must be safe to call when idle. */
  cancel(): Promise<void>;
}

export function toSpeechError(e: unknown, fallback: SpeechErrorCode = 'transcribe-failed'): SpeechError {
  if (e instanceof SpeechError) return e;
  return new SpeechError(fallback, e instanceof Error ? e.message : String(e));
}

/** "en" → "en-US" for Web Speech; region-qualified tags pass through. */
export function toBcp47(language: string): string {
  if (language.includes('-')) return language;
  const regions: Record<string, string> = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-BR', ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN', hi: 'hi-IN', nl: 'nl-NL', ru: 'ru-RU' };
  return regions[language.toLowerCase()] ?? language;
}
