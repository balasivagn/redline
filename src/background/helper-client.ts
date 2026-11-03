/**
 * Native messaging client for the local voice helper. One port at a time, opened lazily and
 * closed when idle (so the helper only runs while it is needed); requests are correlated by id.
 */
import { HOST_NAME } from '../../helper/protocol';
import type { CatalogEntry, HelperEvent, HelperRequest, HelperResponse, ModelInfo } from '../../helper/protocol';
import type { HelperStatus } from '../core/messages';

export interface NativePort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(cb: (message: any) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type HelperReq<T extends HelperRequest['type'] = HelperRequest['type']> = DistributiveOmit<Extract<HelperRequest, { type: T }>, 'id'>;
export type HelperRes<T extends HelperRequest['type']> = Extract<HelperResponse, { ok: true; type: T }>;

export class HelperError extends Error {
  constructor(message: string, readonly code: string = 'helper-error') {
    super(message);
    this.name = 'HelperError';
  }
}

export interface HelperClientOptions {
  connect?: () => NativePort;
  /** Read (and thereby clear) chrome.runtime.lastError inside an onDisconnect callback. */
  lastError?: () => string | undefined;
  onEvent?: (e: HelperEvent) => void;
  now?: () => number;
  idleMs?: number;
  statusTtlMs?: number;
  /** Failed status results are only cached briefly so a fresh install is noticed quickly. */
  failedStatusTtlMs?: number;
  timeouts?: Partial<Record<HelperRequest['type'], number>>;
}

const DEFAULT_TIMEOUTS: Record<HelperRequest['type'], number> = {
  hello: 8_000,
  detect: 20_000,
  catalog: 8_000,
  download: 30 * 60_000, // reset by every progress event
  'cancel-download': 8_000,
  transcribe: 5 * 60_000,
  'save-shot': 15_000,
  'delete-shots': 8_000,
};

interface Pending {
  resolve(r: HelperResponse): void;
  reject(e: Error): void;
  timer: ReturnType<typeof setTimeout>;
  timeoutMs: number;
  type: HelperRequest['type'];
}

export interface HelperClient {
  request<T extends HelperRequest['type']>(req: HelperReq<T> & { type: T }, timeoutMs?: number): Promise<HelperRes<T>>;
  status(refresh?: boolean): Promise<HelperStatus>;
  catalog(): Promise<CatalogEntry[]>;
  download(catalogId: string): Promise<ModelInfo>;
  cancelDownload(catalogId: string): Promise<void>;
  transcribe(args: { modelId: string; language: string; wavBase64: string }): Promise<string>;
  invalidateStatus(): void;
}

export function createHelperClient(opts: HelperClientOptions = {}): HelperClient {
  const connect = opts.connect ?? (() => chrome.runtime.connectNative(HOST_NAME) as unknown as NativePort);
  const lastError = opts.lastError ?? (() => chrome.runtime.lastError?.message);
  const now = opts.now ?? Date.now;
  const idleMs = opts.idleMs ?? 10_000;
  const statusTtl = opts.statusTtlMs ?? 30_000;
  const failedTtl = opts.failedStatusTtlMs ?? 2_000;
  const timeouts = { ...DEFAULT_TIMEOUTS, ...opts.timeouts };

  let port: NativePort | null = null;
  let seq = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<string, Pending>();
  let cache: { at: number; value: HelperStatus } | null = null;
  let inflightStatus: Promise<HelperStatus> | null = null;

  function arm(id: string, p: Pending): void {
    clearTimeout(p.timer);
    p.timer = setTimeout(() => {
      if (pending.delete(id)) {
        p.reject(new HelperError(`Helper did not answer '${p.type}' in time`, 'timeout'));
        scheduleIdle();
      }
    }, p.timeoutMs);
  }

  function scheduleIdle(): void {
    clearTimeout(idleTimer);
    if (pending.size > 0 || !port) return;
    idleTimer = setTimeout(() => {
      if (pending.size === 0 && port) {
        const p = port;
        port = null;
        try { p.disconnect(); } catch { /* already gone */ }
      }
    }, idleMs);
  }

  function failAll(message: string): void {
    const all = [...pending.values()];
    pending.clear();
    for (const p of all) {
      clearTimeout(p.timer);
      p.reject(new HelperError(message, 'disconnected'));
    }
  }

  function ensurePort(): NativePort {
    if (port) return port;
    const p = connect();
    port = p;
    p.onMessage.addListener((msg) => {
      if (!msg || typeof msg !== 'object') return;
      if ('event' in msg) {
        const ev = msg as HelperEvent;
        const entry = pending.get(ev.id);
        if (entry) arm(ev.id, entry); // progress keeps a long job alive
        opts.onEvent?.(ev);
        return;
      }
      const res = msg as HelperResponse;
      const entry = pending.get(res.id);
      if (!entry) return;
      pending.delete(res.id);
      clearTimeout(entry.timer);
      entry.resolve(res);
      scheduleIdle();
    });
    p.onDisconnect.addListener(() => {
      const message = lastError() || 'Native helper disconnected';
      if (port === p) port = null;
      failAll(message);
    });
    return p;
  }

  async function request<T extends HelperRequest['type']>(req: HelperReq<T> & { type: T }, timeoutMs?: number): Promise<HelperRes<T>> {
    clearTimeout(idleTimer);
    const id = `h${++seq}`;
    const res = await new Promise<HelperResponse>((resolve, reject) => {
      const entry: Pending = { resolve, reject, timer: undefined as never, timeoutMs: timeoutMs ?? timeouts[req.type], type: req.type };
      pending.set(id, entry);
      arm(id, entry);
      try {
        ensurePort().postMessage({ ...req, id });
      } catch (e) {
        pending.delete(id);
        clearTimeout(entry.timer);
        port = null;
        reject(new HelperError(e instanceof Error ? e.message : String(e), 'disconnected'));
      }
    });
    if (!res.ok) throw new HelperError(res.error.message, res.error.code);
    return res as HelperRes<T>;
  }

  async function probe(fresh = false): Promise<HelperStatus> {
    try {
      const hello = await request({ type: 'hello' });
      const detect = await request({ type: 'detect', ...(fresh ? { fresh: true } : {}) });
      return { installed: true, version: hello.version, binaries: detect.binaries, models: detect.models };
    } catch (e) {
      return { installed: false, binaries: [], models: [], error: e instanceof Error ? e.message : String(e) };
    }
  }

  return {
    request: request as unknown as HelperClient['request'],
    async status(refresh = false) {
      if (!refresh && cache) {
        const ttl = cache.value.installed ? statusTtl : failedTtl;
        if (now() - cache.at < ttl) return cache.value;
      }
      if (!inflightStatus) {
        inflightStatus = probe(refresh)
          .then((value) => {
            cache = { at: now(), value };
            return value;
          })
          .finally(() => { inflightStatus = null; });
      }
      return inflightStatus;
    },
    async catalog() {
      return (await request({ type: 'catalog' })).entries;
    },
    async download(catalogId) {
      const res = await request({ type: 'download', catalogId });
      cache = null; // models changed
      return res.model;
    },
    async cancelDownload(catalogId) {
      await request({ type: 'cancel-download', catalogId });
    },
    async transcribe(args) {
      return (await request({ type: 'transcribe', ...args })).text;
    },
    invalidateStatus() {
      cache = null;
    },
  };
}
