import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { HelperRequest } from '../protocol';
import { CATALOG } from '../src/catalog';
import { createHandler, type Outbound } from '../src/handler';
import { fakeBinary, fakeWhisperModel, tempEnv, tinyWav } from './helpers';

async function call(h: ReturnType<typeof createHandler>, req: unknown): Promise<Outbound[]> {
  const out: Outbound[] = [];
  await h.handle(req, (m) => out.push(m));
  return out;
}

describe('handler', () => {
  test('hello', async () => {
    const { env } = await tempEnv();
    const [res] = await call(createHandler(env), { id: '1', type: 'hello' } satisfies HelperRequest);
    expect(res).toMatchObject({ id: '1', ok: true, type: 'hello', protocol: 1, platform: process.platform });
  });

  test('catalog entries are well-formed', async () => {
    const { env } = await tempEnv();
    const [res] = await call(createHandler(env), { id: '2', type: 'catalog' });
    expect(res).toMatchObject({ ok: true, type: 'catalog' });
    const entries = (res as { entries: typeof CATALOG }).entries;
    expect(entries.map((e) => e.catalogId)).toEqual(['whisper-base.en', 'whisper-small.en', 'whisper-large-v3-turbo', 'parakeet-tdt-0.6b-v3']);
    for (const e of entries) {
      expect(e.url.startsWith('https://huggingface.co/')).toBe(true);
      expect(e.url.endsWith(e.fileName)).toBe(true);
      expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(e.sizeBytes).toBeGreaterThan(100_000_000);
    }
  });

  test('unknown request and bad input produce error replies with the same id', async () => {
    const { env } = await tempEnv();
    const h = createHandler(env);
    expect(await call(h, { id: 'x', type: 'bogus' })).toEqual([
      { id: 'x', ok: false, error: { code: 'unknown-request', message: 'unknown request type "bogus"' } },
    ]);
    expect((await call(h, { id: 'y', type: 'download' }))[0]).toMatchObject({ id: 'y', ok: false, error: { code: 'bad-request' } });
    expect(await call(h, { type: 'hello' })).toEqual([]); // no id: cannot reply
    expect(await call(h, null)).toEqual([]);
  });

  test('transcribe error codes: no-model, no-binary; success path with fake engine', async () => {
    const { env, home } = await tempEnv();
    const h = createHandler(env);
    const req = { id: 't', type: 'transcribe', modelId: 'whisper.cpp:ggml-small.bin', language: 'en', wavBase64: tinyWav().toString('base64') };

    expect((await call(h, req))[0]).toMatchObject({ ok: false, error: { code: 'no-model' } });

    await fakeWhisperModel(join(env.modelsDir, 'ggml-small.bin'));
    expect((await call(h, req))[0]).toMatchObject({ ok: false, error: { code: 'no-binary' } });

    await fakeBinary(join(home, 'bin', 'whisper-cli'), 'echo " hello   world "');
    expect((await call(h, req))[0]).toMatchObject({ ok: true, type: 'transcribe', text: 'hello world', modelId: 'whisper.cpp:ggml-small.bin' });

    await fakeBinary(join(home, 'bin', 'whisper-cli'), 'exit 1');
    expect((await call(h, req))[0]).toMatchObject({ ok: false, error: { code: 'transcribe-failed' } });
  });

  test('concurrent requests are answered by id', async () => {
    const { env, home } = await tempEnv();
    await fakeWhisperModel(join(env.modelsDir, 'ggml-small.bin'));
    // slow first request, fast second: the second must not wait
    await fakeBinary(join(home, 'bin', 'whisper-cli'), 'sleep 0.5; echo done');
    const h = createHandler(env);
    const out: Outbound[] = [];
    const send = (m: Outbound) => out.push(m);
    const slow = h.handle({ id: 'slow', type: 'transcribe', modelId: 'whisper.cpp:ggml-small.bin', language: 'en', wavBase64: tinyWav().toString('base64') }, send);
    const fast = h.handle({ id: 'fast', type: 'hello' }, send);
    await Promise.all([slow, fast]);
    expect(out.map((m) => m.id)).toEqual(['fast', 'slow']);
  });
});
