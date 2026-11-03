/** Replies and port events for the offscreen document (extends OffscreenMessage in core/messages). */
import type { SpeechErrorCode } from './types';

export const OFFSCREEN_PORT = 'redline-offscreen';

export type OffscreenReply<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; code: SpeechErrorCode; message: string };

/** Offscreen → background over a runtime port. */
export type OffscreenPortEvent =
  | { type: 'level'; level: number }
  /** The recording reached MAX_RECORDING_SECONDS; the background should finish the session. */
  | { type: 'record-max' };
