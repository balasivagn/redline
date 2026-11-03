import type { CatalogEntry, HelperEvent, HelperRequest, HelperResponse, ModelInfo } from '../protocol';
import { HELPER_PROTOCOL_VERSION } from '../protocol';
import { CATALOG } from './catalog';
import { detectBinaries, detectModels, findBinary } from './detect';
import { Downloader } from './download';
import { HELPER_VERSION, type HelperEnv } from './env';
import { log } from './log';
import { deleteShots, saveShot } from './shots';
import { transcribe } from './transcribe';
import { HelperError } from './util';

export type Outbound = HelperResponse | HelperEvent;
export type Send = (message: Outbound) => void;

export interface Handler {
  /** Handle one decoded request. Never throws: every outcome is delivered through `send`. */
  handle(raw: unknown, send: Send): Promise<void>;
  /** Abort everything in flight (stdin closed). */
  shutdown(): void;
}

export function createHandler(
  env: HelperEnv,
  deps: { catalog?: CatalogEntry[]; fetch?: (url: string, init?: RequestInit) => Promise<Response> } = {},
): Handler {
  const catalog = deps.catalog ?? CATALOG;
  const downloader = new Downloader({ modelsDir: env.modelsDir, catalog, fetch: deps.fetch });
  const inflight = new Set<AbortController>();

  async function findModel(modelId: string): Promise<ModelInfo | undefined> {
    let found = (await detectModels(env)).find((m) => m.id === modelId);
    if (!found) found = (await detectModels(env, { fresh: true })).find((m) => m.id === modelId);
    return found;
  }

  async function dispatch(req: HelperRequest, send: Send): Promise<HelperResponse> {
    const id = req.id;
    switch (req.type) {
      case 'hello':
        return { id, ok: true, type: 'hello', version: HELPER_VERSION, protocol: HELPER_PROTOCOL_VERSION, platform: process.platform };

      case 'detect': {
        // `fresh` is an optional extension of the protocol: the Rescan button bypasses the 10 min cache.
        const fresh = req.fresh === true;
        const [binaries, models] = await Promise.all([detectBinaries(env), detectModels(env, { fresh })]);
        return { id, ok: true, type: 'detect', binaries, models };
      }

      case 'catalog':
        return { id, ok: true, type: 'catalog', entries: catalog };

      case 'download': {
        if (typeof req.catalogId !== 'string') throw new HelperError('bad-request', 'catalogId required');
        const model = await downloader.download(id, req.catalogId, send);
        return { id, ok: true, type: 'download', model };
      }

      case 'cancel-download': {
        if (typeof req.catalogId !== 'string') throw new HelperError('bad-request', 'catalogId required');
        await downloader.cancel(req.catalogId);
        return { id, ok: true, type: 'cancel-download' };
      }

      case 'transcribe': {
        if (typeof req.modelId !== 'string' || typeof req.wavBase64 !== 'string') {
          throw new HelperError('bad-request', 'modelId and wavBase64 required');
        }
        const model = await findModel(req.modelId);
        if (!model) throw new HelperError('no-model', `model "${req.modelId}" was not found on this machine`);
        const binary = await findBinary(model.engine, env.binDirs);
        if (!binary) {
          throw new HelperError('no-binary', `${model.engine === 'parakeet' ? 'parakeet-cli' : 'whisper-cli'} was not found (try: brew install whisper-cpp)`);
        }
        const abort = new AbortController();
        inflight.add(abort);
        try {
          const { text, durationMs } = await transcribe({
            engine: model.engine,
            binaryPath: binary.path,
            modelPath: model.path,
            language: typeof req.language === 'string' ? req.language : 'en',
            wav: Buffer.from(req.wavBase64, 'base64'),
            tmpDir: env.tmpDir,
            signal: abort.signal,
          });
          return { id, ok: true, type: 'transcribe', text, durationMs, modelId: model.id };
        } finally {
          inflight.delete(abort);
        }
      }

      case 'save-shot': {
        if (typeof req.relPath !== 'string' || typeof req.pngBase64 !== 'string') {
          throw new HelperError('bad-request', 'relPath and pngBase64 required');
        }
        const path = await saveShot(env.shotsDir, req.relPath, req.pngBase64);
        return { id, ok: true, type: 'save-shot', path };
      }

      case 'delete-shots': {
        if (!Array.isArray(req.paths)) throw new HelperError('bad-request', 'paths required');
        const deleted = await deleteShots(env.shotsDir, req.paths);
        return { id, ok: true, type: 'delete-shots', deleted };
      }

      default:
        throw new HelperError('unknown-request', `unknown request type "${String((req as { type?: unknown }).type)}"`);
    }
  }

  return {
    async handle(raw, send) {
      const req = raw as Partial<HelperRequest> | null;
      if (!req || typeof req !== 'object' || typeof req.id !== 'string') {
        log('dropping request without id', raw);
        return;
      }
      const t0 = Date.now();
      try {
        const res = await dispatch(req as HelperRequest, send);
        log(`${req.type} ${req.id} ok ${Date.now() - t0}ms`);
        send(res);
      } catch (e) {
        const code = e instanceof HelperError ? e.code : 'internal';
        const message = e instanceof Error ? e.message : String(e);
        if (!(e instanceof HelperError)) log(`${req.type} ${req.id} crashed`, e);
        else log(`${req.type} ${req.id} failed: ${code} ${message}`);
        send({ id: req.id, ok: false, error: { code, message } });
      }
    },
    shutdown() {
      downloader.cancelAll();
      for (const a of inflight) a.abort();
    },
  };
}
