import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectModels, findBinary } from '../src/detect';
import { makeEnv } from '../src/env';
import { transcribe } from '../src/transcribe';

// Real-engine smoke test: skipped automatically when the binary, model, `say` or ffmpeg is missing.
const env = makeEnv();
const MODEL = join(homedir(), 'Codes/personal-projects/desynex-poc/.data/models/ggml-base.en.bin');
const whisper = await findBinary('whisper.cpp', env.binDirs);
const ffmpeg = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find((p) => existsSync(p));
const ready = Boolean(whisper) && existsSync(MODEL) && existsSync('/usr/bin/say') && Boolean(ffmpeg);

describe.skipIf(!ready)('real whisper-cli smoke test', () => {
  test('speech -> wav -> whisper-cli returns text containing "pricing"', async () => {
    const aiff = join(tmpdir(), `redline-smoke-${process.pid}.aiff`);
    const wav = join(tmpdir(), `redline-smoke-${process.pid}.wav`);
    try {
      expect(Bun.spawnSync(['/usr/bin/say', '-o', aiff, 'pin the pricing card']).exitCode).toBe(0);
      expect(
        Bun.spawnSync([ffmpeg!, '-y', '-loglevel', 'error', '-i', aiff, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav]).exitCode,
      ).toBe(0);
      const res = await transcribe({
        engine: 'whisper.cpp',
        binaryPath: whisper!.path,
        modelPath: MODEL,
        language: 'en',
        wav: await readFile(wav),
        tmpDir: tmpdir(),
      });
      console.info('smoke transcript:', res.text);
      expect(res.text.toLowerCase()).toContain('pricing');
    } finally {
      await rm(aiff, { force: true });
      await rm(wav, { force: true });
    }
  }, 60_000);
});

const parakeet = await findBinary('parakeet', env.binDirs);
const parakeetModels = (await detectModels(env)).filter((m) => m.engine === 'parakeet');
const ggmlParakeet = parakeetModels.find((m) => m.tested);
const hexGguf = parakeetModels.find((m) => m.path.endsWith('.gguf'));

describe.skipIf(!parakeet || !ggmlParakeet || !ffmpeg || !existsSync('/usr/bin/say'))('real parakeet-cli smoke test', () => {
  test('ggml parakeet model transcribes', async () => {
    const aiff = join(tmpdir(), `redline-pk-${process.pid}.aiff`);
    const wav = join(tmpdir(), `redline-pk-${process.pid}.wav`);
    try {
      Bun.spawnSync(['/usr/bin/say', '-o', aiff, 'pin the pricing card']);
      Bun.spawnSync([ffmpeg!, '-y', '-loglevel', 'error', '-i', aiff, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
      const res = await transcribe({
        engine: 'parakeet', binaryPath: parakeet!.path, modelPath: ggmlParakeet!.path, language: 'en', wav: await readFile(wav), tmpDir: tmpdir(),
      });
      expect(res.text.toLowerCase()).toContain('pricing');
    } finally {
      await rm(aiff, { force: true });
      await rm(wav, { force: true });
    }
  }, 60_000);
});

describe.skipIf(!parakeet || !hexGguf)('parakeet gguf (hex) is not loadable, hence tested=false', () => {
  test('parakeet-cli rejects the gguf container', async () => {
    expect(hexGguf!.tested).toBe(false);
    const err = await transcribe({
      engine: 'parakeet', binaryPath: parakeet!.path, modelPath: hexGguf!.path, language: 'en', wav: Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(100)]), tmpDir: tmpdir(),
    }).catch((e) => e);
    expect(err.code).toBe('transcribe-failed');
  });
});
