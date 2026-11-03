/** Speech engines are pluggable. The background routes to the engine chosen in Settings. */
import type { SpeechEngineId } from '../core/settings';

export type SpeechState =
  | { state: 'idle' }
  | { state: 'listening'; startedAt: number }
  | { state: 'transcribing'; engineLabel: string }
  | { state: 'done'; text: string }
  | { state: 'error'; code: SpeechErrorCode; message: string };

export type SpeechErrorCode =
  | 'no-engine' // native helper not installed and chrome engine unavailable
  | 'helper-missing'
  | 'no-model'
  | 'mic-permission' // user must grant mic in the options page (offscreen docs cannot prompt)
  | 'mic-unavailable'
  | 'too-long'
  | 'transcribe-failed'
  | 'cancelled';

export interface SpeechEngineStatus {
  id: SpeechEngineId;
  available: boolean;
  label: string; // e.g. "whisper.cpp base.en" or "Chrome on-device (en-US)"
  detail?: string; // why unavailable
}

export interface SpeechEngine {
  readonly id: SpeechEngineId;
  status(): Promise<SpeechEngineStatus>;
  /** Transcribe a 16 kHz mono 16-bit PCM WAV. (The chrome engine instead streams in the offscreen doc.) */
  transcribe?(wav: ArrayBuffer, opts: { language: string; modelId?: string }): Promise<string>;
}

export const MAX_RECORDING_SECONDS = 120;
