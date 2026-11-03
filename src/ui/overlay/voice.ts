import type { SpeechErrorCode } from '../../speech/types';

const CODES: SpeechErrorCode[] = [
  'no-engine',
  'helper-missing',
  'no-model',
  'mic-permission',
  'mic-unavailable',
  'too-long',
  'transcribe-failed',
  'cancelled',
];

/** rpc() rejects with a plain message; recover the speech error code from it when possible. */
export function errorCodeFromMessage(message: string): SpeechErrorCode {
  const m = message.toLowerCase();
  return CODES.find((c) => m.includes(c)) ?? 'transcribe-failed';
}

export function isNotSetUp(code: SpeechErrorCode): boolean {
  return code === 'no-engine' || code === 'helper-missing' || code === 'no-model';
}

/** Append a level sample, keeping the newest `max` values. */
export function pushLevel(levels: number[], level: number, max = 14): number[] {
  const v = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
  const next = [...levels, v];
  return next.length > max ? next.slice(next.length - max) : next;
}
