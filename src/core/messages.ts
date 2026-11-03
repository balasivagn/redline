/**
 * Message contract. The service worker is the only writer of storage and the only caller
 * of privileged APIs (captureVisibleTab, offscreen, native messaging). Content scripts and
 * extension pages talk to it with `rpc()`; it pushes `RedlineEvent`s back.
 */
import type { Annotation, PageSummary, Rect } from './schema';
import type { Settings } from './settings';
import type { SpeechEngineStatus, SpeechState } from '../speech/types';
import type { BinaryInfo, CatalogEntry, ModelInfo } from '../../helper/protocol';

export interface HelperStatus {
  installed: boolean; // native host reachable
  version?: string;
  binaries: BinaryInfo[];
  models: ModelInfo[];
  error?: string;
}

/** Request → response map. Add a key here, then handle it in src/background/router.ts. */
export interface RpcMap {
  'ann/list': { req: { pageKey: string }; res: Annotation[] };
  'ann/listAll': { req: Record<string, never>; res: PageSummary[] };
  'ann/listPages': { req: { pageKeys: string[] }; res: Annotation[] };
  /** Create or update. For creates, pass number: 0 and the background assigns the next number. */
  'ann/save': { req: { annotation: Annotation }; res: Annotation };
  'ann/delete': { req: { ids: string[] }; res: { deleted: Annotation[] } };
  /** Undo a delete: re-insert exactly these annotations. */
  'ann/restore': { req: { annotations: Annotation[] }; res: { restored: number } };

  /** Capture the visible tab and crop to `rect` (viewport CSS px). Sender tab is used. */
  'shot/capture': { req: { rect: Rect; dpr: number }; res: { shotId: string; width: number; height: number; /** Absolute PNG path, when the helper saved the file. */ path?: string } };
  'shot/get': { req: { shotId: string }; res: { dataUrl: string } | null };

  'settings/get': { req: Record<string, never>; res: Settings };
  'settings/set': { req: { patch: Partial<Settings> }; res: Settings };

  /** Enable/disable auto-mount for an origin. */
  'site/setEnabled': { req: { origin: string; enabled: boolean }; res: { enabledOrigins: string[] } };

  'speech/status': { req: Record<string, never>; res: { active: SpeechEngineStatus; engines: SpeechEngineStatus[] } };
  'speech/start': { req: Record<string, never>; res: { ok: true } };
  /** Stop recording and transcribe. Resolves with the final text (may be ''). */
  'speech/stop': { req: Record<string, never>; res: { text: string } };
  'speech/cancel': { req: Record<string, never>; res: { ok: true } };

  'helper/status': { req: { refresh?: boolean }; res: HelperStatus };
  'helper/catalog': { req: Record<string, never>; res: CatalogEntry[] };
  'helper/download': { req: { catalogId: string }; res: ModelInfo };
  'helper/cancelDownload': { req: { catalogId: string }; res: { ok: true } };

  /** Open extension pages. */
  'open/reviews': { req: { pageKey?: string }; res: { ok: true } };
  'open/settings': { req: { section?: 'voice' | 'shortcuts' | 'general' }; res: { ok: true } };
}

export type RpcType = keyof RpcMap;
export type RpcRequest<T extends RpcType = RpcType> = { channel: 'redline/rpc'; type: T; payload: RpcMap[T]['req'] };
export type RpcResult<T extends RpcType> = { ok: true; data: RpcMap[T]['res'] } | { ok: false; error: string };

/** Background → content scripts / extension pages. */
export type RedlineEvent =
  | { channel: 'redline/event'; type: 'ui/toggle' }
  | { channel: 'redline/event'; type: 'ui/open' }
  | { channel: 'redline/event'; type: 'ann/changed'; pageKeys: string[] }
  | { channel: 'redline/event'; type: 'settings/changed'; settings: Settings }
  | { channel: 'redline/event'; type: 'speech/state'; state: SpeechState }
  /** 0..1 mic level, ~15 Hz while listening. */
  | { channel: 'redline/event'; type: 'speech/level'; level: number }
  | { channel: 'redline/event'; type: 'helper/downloadProgress'; catalogId: string; receivedBytes: number; totalBytes: number; phase: 'downloading' | 'verifying' };

/** Background ↔ offscreen document (internal). */
export type OffscreenMessage =
  | { channel: 'redline/offscreen'; type: 'record/start'; maxSeconds: number }
  | { channel: 'redline/offscreen'; type: 'record/stop' } // → { wavBase64 }
  | { channel: 'redline/offscreen'; type: 'record/cancel' }
  | { channel: 'redline/offscreen'; type: 'chrome-speech/start'; lang: string }
  | { channel: 'redline/offscreen'; type: 'chrome-speech/stop' } // → { text }
  | { channel: 'redline/offscreen'; type: 'chrome-speech/status'; lang: string } // → SpeechEngineStatus
  | { channel: 'redline/offscreen'; type: 'shot/crop'; dataUrl: string; rect: Rect; dpr: number }; // → { blobBase64, width, height }

export function isRpcRequest(m: unknown): m is RpcRequest {
  return typeof m === 'object' && m !== null && (m as { channel?: unknown }).channel === 'redline/rpc';
}
export function isRedlineEvent(m: unknown): m is RedlineEvent {
  return typeof m === 'object' && m !== null && (m as { channel?: unknown }).channel === 'redline/event';
}
