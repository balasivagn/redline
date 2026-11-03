import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { CatalogEntry, HelperEvent, ModelInfo } from '../protocol';
import { modelInfoForFile } from './detect';
import { log } from './log';
import { HelperError, sha256File } from './util';

const PROGRESS_INTERVAL_MS = 260; // keeps us under 4 events per second

type Emit = (event: HelperEvent) => void;
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface Active {
  abort: AbortController;
  done: Promise<unknown>;
}

export class Downloader {
  private active = new Map<string, Active>();

  constructor(
    private opts: {
      modelsDir: string;
      catalog: CatalogEntry[];
      fetch?: FetchLike;
    },
  ) {}

  entry(catalogId: string): CatalogEntry {
    const e = this.opts.catalog.find((c) => c.catalogId === catalogId);
    if (!e) throw new HelperError('unknown-catalog-id', `no catalog entry "${catalogId}"`);
    return e;
  }

  async download(requestId: string, catalogId: string, emit: Emit): Promise<ModelInfo> {
    const entry = this.entry(catalogId);
    if (this.active.has(catalogId)) {
      throw new HelperError('already-downloading', `${catalogId} is already downloading`);
    }
    const abort = new AbortController();
    const job = this.run(requestId, entry, abort.signal, emit);
    this.active.set(catalogId, { abort, done: job.catch(() => {}) });
    try {
      return await job;
    } finally {
      this.active.delete(catalogId);
    }
  }

  /** Abort a running download and make sure its .part file is gone before returning. */
  async cancel(catalogId: string): Promise<void> {
    const entry = this.entry(catalogId);
    const a = this.active.get(catalogId);
    if (a) {
      a.abort.abort();
      await a.done;
    }
    await rm(join(this.opts.modelsDir, entry.fileName + '.part'), { force: true });
  }

  cancelAll(): void {
    for (const a of this.active.values()) a.abort.abort();
  }

  private async run(requestId: string, entry: CatalogEntry, signal: AbortSignal, emit: Emit): Promise<ModelInfo> {
    const finalPath = join(this.opts.modelsDir, entry.fileName);
    const partPath = finalPath + '.part';
    await mkdir(this.opts.modelsDir, { recursive: true });

    // Already installed (files only reach this name after verification).
    const existing = await stat(finalPath).catch(() => null);
    if (existing?.isFile() && existing.size === entry.sizeBytes) {
      const info = await modelInfoForFile(finalPath, 'redline', false);
      if (info) return info;
    }

    let lastEmit = 0;
    const progress = (phase: 'downloading' | 'verifying', receivedBytes: number, totalBytes: number) => {
      const now = Date.now();
      if (now - lastEmit < PROGRESS_INTERVAL_MS) return;
      lastEmit = now;
      emit({ id: requestId, event: 'download-progress', catalogId: entry.catalogId, receivedBytes, totalBytes, phase });
    };

    let fh;
    try {
      let res: Response;
      try {
        res = await (this.opts.fetch ?? fetch)(entry.url, { signal, headers: { 'user-agent': 'redline-helper' } });
      } catch (e) {
        throw wrapAbort(e, signal, 'could not reach download server');
      }
      if (!res.ok || !res.body) {
        throw new HelperError('download-failed', `server answered HTTP ${res.status}`);
      }
      const headerLen = Number(res.headers.get('content-length'));
      const total = Number.isFinite(headerLen) && headerLen > 0 ? headerLen : entry.sizeBytes;

      fh = await open(partPath, 'w');
      let received = 0;
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          await fh.write(chunk);
          received += chunk.length;
          progress('downloading', received, total);
        }
      } catch (e) {
        throw wrapAbort(e, signal, 'download interrupted');
      }
      await fh.close();
      fh = undefined;
      if (signal.aborted) throw new HelperError('cancelled', 'download cancelled');
      if (received !== total) {
        throw new HelperError('download-failed', `incomplete download (${received} of ${total} bytes)`);
      }

      // Verify: re-read the file and hash it (first event of the phase is always sent).
      const wait = lastEmit + PROGRESS_INTERVAL_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait)); // phase change is never dropped by the throttle
      progress('verifying', 0, received);
      const sha = await sha256File(partPath, (n) => {
        if (!signal.aborted) progress('verifying', n, received);
      });
      if (signal.aborted) throw new HelperError('cancelled', 'download cancelled');
      if (entry.sha256) {
        if (sha !== entry.sha256.toLowerCase()) {
          log(`checksum mismatch for ${entry.fileName}: expected ${entry.sha256} got ${sha}`);
          throw new HelperError('checksum-mismatch', `downloaded file failed its checksum (${entry.fileName})`);
        }
      } else {
        log(`no published checksum for ${entry.fileName}; computed sha256 ${sha}`);
      }

      await rename(partPath, finalPath);
      const info = await modelInfoForFile(finalPath, 'redline', false);
      if (!info) {
        await rm(finalPath, { force: true });
        throw new HelperError('download-failed', 'downloaded file is not a recognised speech model');
      }
      log(`downloaded ${entry.fileName} (${received} bytes, sha256 ${sha})`);
      return info;
    } catch (e) {
      await fh?.close().catch(() => {});
      await rm(partPath, { force: true });
      throw e;
    }
  }
}

function wrapAbort(e: unknown, signal: AbortSignal, msg: string): Error {
  if (e instanceof HelperError) return e;
  if (signal.aborted) return new HelperError('cancelled', 'download cancelled');
  return new HelperError('download-failed', `${msg}: ${(e as Error).message}`);
}
