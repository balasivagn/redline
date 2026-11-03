/**
 * Native messaging protocol between the extension (service worker) and the local voice
 * helper (`com.redline.helper`). Chrome frames each JSON message with a 4-byte little-endian
 * length. Helper → Chrome messages must stay under 1 MB.
 *
 * Every request carries `id`; the helper replies with the same `id`. Long jobs (download)
 * also emit `event` messages that carry the request `id`.
 */
export const HOST_NAME = 'com.redline.helper';
export const HELPER_PROTOCOL_VERSION = 1;

export type EngineKind = 'whisper.cpp' | 'parakeet';

export interface BinaryInfo { engine: EngineKind; name: string; path: string; version?: string }

export interface ModelInfo {
  /** Stable id: `<engine>:<file name>` e.g. "whisper.cpp:ggml-base.en.bin". */
  id: string;
  engine: EngineKind;
  label: string; // "whisper base.en"
  path: string;
  sizeBytes: number;
  /** Where it was found: "redline" (~/.redline/models), or another app/project name. */
  source: string;
  readOnly: boolean; // true when it lives in another app's folder (never moved/deleted)
  /** false when the engine binary may not support this file (e.g. untested gguf). */
  tested: boolean;
}

export interface CatalogEntry {
  catalogId: string; // "whisper-small.en"
  engine: EngineKind;
  label: string;
  fileName: string;
  url: string;
  sizeBytes: number;
  sha1?: string;
  sha256?: string;
  note: string; // "fast · good"
}

export type HelperRequest =
  | { id: string; type: 'hello' }
  | { id: string; type: 'detect'; fresh?: boolean }
  | { id: string; type: 'catalog' }
  | { id: string; type: 'download'; catalogId: string }
  | { id: string; type: 'cancel-download'; catalogId: string }
  | { id: string; type: 'transcribe'; modelId: string; language: string; wavBase64: string }
  /** Write a PNG under ~/.redline/shots/<relPath> (relPath is sanitised; no `..`, no absolute). */
  | { id: string; type: 'save-shot'; relPath: string; pngBase64: string }
  /** Delete files previously returned by save-shot (paths outside ~/.redline/shots are ignored). */
  | { id: string; type: 'delete-shots'; paths: string[] };

export type HelperResponse =
  | { id: string; ok: true; type: 'hello'; version: string; protocol: number; platform: string }
  | { id: string; ok: true; type: 'detect'; binaries: BinaryInfo[]; models: ModelInfo[] }
  | { id: string; ok: true; type: 'catalog'; entries: CatalogEntry[] }
  | { id: string; ok: true; type: 'download'; model: ModelInfo }
  | { id: string; ok: true; type: 'cancel-download' }
  | { id: string; ok: true; type: 'transcribe'; text: string; durationMs: number; modelId: string }
  | { id: string; ok: true; type: 'save-shot'; path: string }
  | { id: string; ok: true; type: 'delete-shots'; deleted: number }
  | { id: string; ok: false; error: { code: string; message: string } };

export type HelperEvent = {
  id: string;
  event: 'download-progress';
  catalogId: string;
  receivedBytes: number;
  totalBytes: number;
  phase: 'downloading' | 'verifying';
};
