import { describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { classifyFileName, detectBinaries, detectModels } from '../src/detect';
import { fakeBinary, fakeFile, fakeWhisperModel, tempEnv } from './helpers';

describe('classifyFileName', () => {
  test('engines, labels and tested flags', () => {
    expect(classifyFileName('ggml-base.en.bin')).toEqual({ engine: 'whisper.cpp', label: 'whisper base.en', tested: true });
    expect(classifyFileName('ggml-small.bin')?.label).toBe('whisper small');
    expect(classifyFileName('ggml-large-v3-turbo-q5_0.bin')?.label).toBe('whisper large-v3-turbo q5_0');
    expect(classifyFileName('ggml-parakeet-tdt-0.6b-v3-q8_0.bin')).toEqual({
      engine: 'parakeet',
      label: 'parakeet tdt-0.6b-v3 q8_0',
      tested: true,
    });
    expect(classifyFileName('parakeet-unified-en-0.6b-Q8_0.gguf')).toEqual({
      engine: 'parakeet',
      label: 'parakeet unified-en-0.6b Q8_0',
      tested: false,
    });
    expect(classifyFileName('silero-vad-v6.2-F32.gguf')).toBeNull();
    expect(classifyFileName('llama-3-8b.gguf')).toBeNull();
    expect(classifyFileName('ggml-base.en-encoder.mlmodelc')).toBeNull();
  });
});

describe('detectModels', () => {
  test('finds models across known dirs, config dirs and ~/Codes, with flags and sources', async () => {
    const { env, home } = await tempEnv();
    const app = join(home, 'Library', 'Application Support');
    await fakeWhisperModel(join(env.modelsDir, 'ggml-small.en.bin'));
    await fakeWhisperModel(join(app, 'superwhisper', 'ggml-small.bin'));
    await fakeFile(join(app, 'hex', 'models', 'parakeet-unified-en-0.6b-Q8_0.gguf'), 25 * 1024 * 1024, 'GGUF');
    await fakeFile(join(app, 'hex', 'models', 'silero-vad-v6.2-F32.gguf'));
    await fakeWhisperModel(join(app, 'MacWhisper Pro', 'Models', 'ggml-tiny.en.bin'));
    // project under ~/Codes/<group>/<project>/.data/models
    const proj = join(home, 'Codes', 'group', 'desynex-poc');
    await mkdir(proj, { recursive: true });
    await writeFile(join(proj, 'package.json'), '{}');
    await fakeWhisperModel(join(proj, '.data', 'models', 'ggml-base.en.bin'));
    // must be ignored
    await fakeWhisperModel(join(proj, 'node_modules', 'x', 'ggml-ignored.bin'));
    await fakeWhisperModel(join(home, 'Codes', 'a', 'b', 'c', 'd', 'e', 'f', 'ggml-too-deep.bin'));
    await fakeFile(join(home, 'Codes', 'llama', 'ggml-model-q4_0.bin')); // wrong magic
    await fakeFile(join(home, 'Codes', 'tiny', 'ggml-tiny-stub.bin'), 1024); // too small
    // config dir
    const extra = join(home, 'elsewhere', 'models');
    await fakeWhisperModel(join(extra, 'ggml-medium.bin'));
    await mkdir(env.redlineDir, { recursive: true });
    await writeFile(env.configFile, JSON.stringify({ modelDirs: [extra] }));

    const models = await detectModels(env);
    const byId = Object.fromEntries(models.map((m) => [m.id, m]));
    expect(Object.keys(byId).sort()).toEqual([
      'parakeet:parakeet-unified-en-0.6b-Q8_0.gguf',
      'whisper.cpp:ggml-base.en.bin',
      'whisper.cpp:ggml-medium.bin',
      'whisper.cpp:ggml-small.bin',
      'whisper.cpp:ggml-small.en.bin',
      'whisper.cpp:ggml-tiny.en.bin',
    ]);
    expect(byId['whisper.cpp:ggml-small.en.bin']).toMatchObject({ source: 'redline', readOnly: false, tested: true });
    expect(byId['whisper.cpp:ggml-small.bin']).toMatchObject({ source: 'superwhisper', readOnly: true, tested: true });
    expect(byId['parakeet:parakeet-unified-en-0.6b-Q8_0.gguf']).toMatchObject({ source: 'hex', readOnly: true, tested: false });
    expect(byId['whisper.cpp:ggml-tiny.en.bin']).toMatchObject({ source: 'MacWhisper', readOnly: true });
    expect(byId['whisper.cpp:ggml-base.en.bin']).toMatchObject({ source: 'desynex-poc', readOnly: true, sizeBytes: 25 * 1024 * 1024 });
    expect(byId['whisper.cpp:ggml-medium.bin']).toMatchObject({ source: 'models', readOnly: true });
  });

  test('~/Codes results are cached for 10 minutes and a fresh scan bypasses the cache', async () => {
    const { env, home } = await tempEnv();
    await fakeWhisperModel(join(home, 'Codes', 'p1', 'ggml-base.bin'));
    expect((await detectModels(env)).map((m) => m.id)).toEqual(['whisper.cpp:ggml-base.bin']);

    await fakeWhisperModel(join(home, 'Codes', 'p2', 'ggml-small.bin'));
    expect((await detectModels(env)).map((m) => m.id)).toEqual(['whisper.cpp:ggml-base.bin']); // cached
    expect((await detectModels(env, { fresh: true })).map((m) => m.id).sort()).toEqual([
      'whisper.cpp:ggml-base.bin',
      'whisper.cpp:ggml-small.bin',
    ]);

    // an expired cache is rescanned
    const expired = { ...env, cacheTtlMs: -1 };
    await fakeWhisperModel(join(home, 'Codes', 'p3', 'ggml-tiny.bin'));
    expect((await detectModels(expired)).map((m) => m.id)).toContain('whisper.cpp:ggml-tiny.bin');
  });

  test('cached entries that vanished from disk are dropped', async () => {
    const { env, home } = await tempEnv();
    const f = join(home, 'Codes', 'p1', 'ggml-base.bin');
    await fakeWhisperModel(f);
    expect(await detectModels(env)).toHaveLength(1);
    await Bun.file(f).delete();
    expect(await detectModels(env)).toHaveLength(0);
  });
});

describe('detectBinaries', () => {
  test('finds engine binaries in the search dirs', async () => {
    const { env, home } = await tempEnv();
    await fakeBinary(join(home, 'bin', 'whisper-cli'), 'echo "whisper.cpp version: 9.9.9" >&2');
    await fakeBinary(join(home, 'bin', 'parakeet-cli'), 'exit 0');
    const bins = await detectBinaries(env);
    expect(bins.map((b) => [b.engine, b.name, b.path])).toEqual([
      ['whisper.cpp', 'whisper-cli', join(home, 'bin', 'whisper-cli')],
      ['parakeet', 'parakeet-cli', join(home, 'bin', 'parakeet-cli')],
    ]);
    expect(bins[0]!.version).toBe('9.9.9');
  });

  test('returns nothing when no engine is installed', async () => {
    const { env } = await tempEnv();
    expect(await detectBinaries(env)).toEqual([]);
  });
});
