import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { CatalogEntry, HelperEvent } from '../protocol';
import { Downloader } from '../src/download';
import { HelperError } from '../src/util';
import { tempDir } from './helpers';

// A "model" the helper will accept: whisper magic + 21 MB of padding.
const PAYLOAD = Buffer.concat([Buffer.from('lmgg'), Buffer.alloc(21 * 1024 * 1024, 7)]);
const SHA = createHash('sha256').update(PAYLOAD).digest('hex');

let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === '/model.bin') {
        return new Response(PAYLOAD, { headers: { 'content-length': String(PAYLOAD.length) } });
      }
      if (path === '/slow.bin') {
        let sent = 0;
        const chunk = 512 * 1024;
        const stream = new ReadableStream({
          async pull(controller) {
            if (sent >= PAYLOAD.length) return controller.close();
            await Bun.sleep(30);
            controller.enqueue(PAYLOAD.subarray(sent, sent + chunk));
            sent += chunk;
          },
        });
        return new Response(stream, { headers: { 'content-length': String(PAYLOAD.length) } });
      }
      return new Response('nope', { status: 404 });
    },
  });
  base = `http://localhost:${server.port}`;
});
afterAll(() => server.stop(true));

function entry(over: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    catalogId: 'test-model',
    engine: 'whisper.cpp',
    label: 'whisper test',
    fileName: 'ggml-test.bin',
    url: `${base}/model.bin`,
    sizeBytes: PAYLOAD.length,
    sha256: SHA,
    note: 'test',
    ...over,
  };
}

describe('Downloader', () => {
  test('downloads, verifies the checksum, renames and returns ModelInfo', async () => {
    const modelsDir = join(await tempDir(), 'models');
    const dl = new Downloader({ modelsDir, catalog: [entry()] });
    const events: HelperEvent[] = [];
    const model = await dl.download('req-1', 'test-model', (e) => events.push(e));

    expect(model).toMatchObject({
      id: 'whisper.cpp:ggml-test.bin',
      engine: 'whisper.cpp',
      path: join(modelsDir, 'ggml-test.bin'),
      sizeBytes: PAYLOAD.length,
      source: 'redline',
      readOnly: false,
      tested: true,
    });
    expect((await stat(model.path)).size).toBe(PAYLOAD.length);
    expect(await readdir(modelsDir)).toEqual(['ggml-test.bin']); // no .part left

    expect(events.every((e) => e.id === 'req-1' && e.catalogId === 'test-model')).toBe(true);
    const phases = events.map((e) => e.phase);
    expect(phases).toContain('downloading');
    expect(phases[phases.length - 1]).toBe('verifying');
    expect(phases.indexOf('verifying')).toBeGreaterThan(phases.lastIndexOf('downloading'));
    expect(events[events.length - 1]!.receivedBytes).toBeLessThanOrEqual(PAYLOAD.length);

    // second call: already installed, no network
    const again = await dl.download('req-2', 'test-model', () => {});
    expect(again.path).toBe(model.path);
  });

  test('checksum mismatch fails with checksum-mismatch and leaves no files', async () => {
    const modelsDir = join(await tempDir(), 'models');
    const dl = new Downloader({ modelsDir, catalog: [entry({ sha256: 'a'.repeat(64) })] });
    const err = await dl.download('r', 'test-model', () => {}).catch((e) => e);
    expect(err).toBeInstanceOf(HelperError);
    expect(err.code).toBe('checksum-mismatch');
    expect(await readdir(modelsDir)).toEqual([]);
  });

  test('without a published checksum the download still succeeds', async () => {
    const modelsDir = join(await tempDir(), 'models');
    const dl = new Downloader({ modelsDir, catalog: [entry({ sha256: undefined })] });
    expect((await dl.download('r', 'test-model', () => {})).sizeBytes).toBe(PAYLOAD.length);
  });

  test('HTTP errors map to download-failed', async () => {
    const modelsDir = join(await tempDir(), 'models');
    const dl = new Downloader({ modelsDir, catalog: [entry({ url: `${base}/missing.bin` })] });
    const err = await dl.download('r', 'test-model', () => {}).catch((e) => e);
    expect(err.code).toBe('download-failed');
    expect(await readdir(modelsDir)).toEqual([]);
  });

  test('unknown catalog id', async () => {
    const dl = new Downloader({ modelsDir: await tempDir(), catalog: [] });
    expect(await dl.download('r', 'nope', () => {}).catch((e) => e.code)).toBe('unknown-catalog-id');
  });

  test('cancel aborts the transfer and deletes the .part file', async () => {
    const modelsDir = join(await tempDir(), 'models');
    const dl = new Downloader({ modelsDir, catalog: [entry({ url: `${base}/slow.bin` })] });
    let sawPart = false;
    const job = dl.download('r', 'test-model', () => {});
    const errP = job.catch((e) => e);
    // wait until bytes are flowing
    for (let i = 0; i < 100 && !sawPart; i++) {
      await Bun.sleep(20);
      sawPart = (await readdir(modelsDir).catch(() => [] as string[])).includes('ggml-test.bin.part');
    }
    expect(sawPart).toBe(true);
    await dl.cancel('test-model');
    const err = await errP;
    expect(err.code).toBe('cancelled');
    expect(await readdir(modelsDir)).toEqual([]);
  });

  test('progress events are throttled to at most 4 per second', async () => {
    const modelsDir = join(await tempDir(), 'models');
    const dl = new Downloader({ modelsDir, catalog: [entry({ url: `${base}/slow.bin` })] });
    const times: number[] = [];
    await dl.download('r', 'test-model', () => times.push(Date.now()));
    expect(times.length).toBeGreaterThan(3);
    // (the slow server takes ~1.5 s, so several throttled events are expected)
    for (let start = 0; start < times.length; start++) {
      const inWindow = times.filter((t) => t >= times[start]! && t < times[start]! + 1000).length;
      expect(inWindow).toBeLessThanOrEqual(4);
    }
  });

  test('a second download of the same id while one runs is rejected', async () => {
    const modelsDir = join(await tempDir(), 'models');
    const dl = new Downloader({ modelsDir, catalog: [entry({ url: `${base}/slow.bin` })] });
    const first = dl.download('a', 'test-model', () => {}).catch((e) => e);
    await Bun.sleep(50);
    expect(await dl.download('b', 'test-model', () => {}).catch((e) => e.code)).toBe('already-downloading');
    await dl.cancel('test-model');
    expect((await first).code).toBe('cancelled');
  });
});
