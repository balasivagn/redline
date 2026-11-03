import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildArgs, parseTranscript, transcribe, whisperLanguage } from '../src/transcribe';
import { HelperError } from '../src/util';
import { fakeBinary, tempEnv, tinyWav } from './helpers';

describe('parseTranscript', () => {
  test('collapses whitespace, timestamps and blank-audio markers', () => {
    expect(parseTranscript('\n And so my fellow  Americans,\n ask not what\n')).toBe('And so my fellow Americans, ask not what');
    expect(parseTranscript('[00:00:00.000 --> 00:00:02.000]   Hello there\n[00:00:02.000 --> 00:00:03.500]  world')).toBe('Hello there world');
    expect(parseTranscript(' [BLANK_AUDIO]\n')).toBe('');
  });
});

describe('buildArgs', () => {
  test('whisper.cpp args', () => {
    const a = buildArgs('whisper.cpp', '/m/ggml-small.bin', '/t/a.wav', 'fr-FR');
    expect(a.slice(0, 9)).toEqual(['-m', '/m/ggml-small.bin', '-f', '/t/a.wav', '-l', 'fr', '-nt', '-np', '-t']);
  });
  test('english-only models force -l en; auto/garbage languages become auto', () => {
    expect(whisperLanguage('fr', '/m/ggml-base.en.bin')).toBe('en');
    expect(whisperLanguage('', '/m/ggml-small.bin')).toBe('auto');
    expect(whisperLanguage('--evil', '/m/ggml-small.bin')).toBe('auto');
    expect(whisperLanguage('en-US', '/m/ggml-large-v3-turbo-q5_0.bin')).toBe('en');
  });
  test('parakeet args have no language flag', () => {
    const a = buildArgs('parakeet', '/m/p.bin', '/t/a.wav', 'en');
    expect(a).not.toContain('-l');
    expect(a.slice(0, 5)).toEqual(['-m', '/m/p.bin', '-f', '/t/a.wav', '-np']);
  });
});

describe('transcribe with a fake binary', () => {
  test('passes the right args, returns parsed stdout, cleans up temp files', async () => {
    const { env, home } = await tempEnv();
    const argsFile = join(home, 'args.txt');
    const bin = join(home, 'bin', 'whisper-cli');
    await fakeBinary(
      bin,
      `printf '%s\\n' "$@" > "${argsFile}"
# find the -f argument and prove the wav exists while we run
while [ $# -gt 0 ]; do [ "$1" = "-f" ] && { head -c 4 "$2" > "${home}/wav-head.txt"; }; shift; done
echo "ggml_metal noise" >&2
printf '\\n Pin the   pricing card.\\n'`,
    );
    const res = await transcribe({
      engine: 'whisper.cpp',
      binaryPath: bin,
      modelPath: '/models/ggml-small.bin',
      language: 'en',
      wav: tinyWav(),
      tmpDir: env.tmpDir,
    });
    expect(res.text).toBe('Pin the pricing card.');
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
    const args = (await readFile(argsFile, 'utf8')).trim().split('\n');
    expect(args.slice(0, 2)).toEqual(['-m', '/models/ggml-small.bin']);
    expect(args[2]).toBe('-f');
    expect(args[3]).toMatch(/audio\.wav$/);
    expect(args.slice(4, 8)).toEqual(['-l', 'en', '-nt', '-np']);
    expect(await readFile(join(home, 'wav-head.txt'), 'utf8')).toBe('RIFF');
    expect(await readdir(env.tmpDir)).toEqual([]); // temp dir removed
  });

  test('non-zero exit maps to transcribe-failed with the useful stderr', async () => {
    const { env, home } = await tempEnv();
    const bin = join(home, 'bin', 'whisper-cli');
    await fakeBinary(bin, 'echo "ggml_init noise" >&2; echo "error: failed to load model" >&2; exit 3');
    const err = await transcribe({
      engine: 'whisper.cpp', binaryPath: bin, modelPath: '/x.bin', language: 'en', wav: tinyWav(), tmpDir: env.tmpDir,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(HelperError);
    expect(err.code).toBe('transcribe-failed');
    expect(err.message).toContain('failed to load model');
    expect(err.message).not.toContain('ggml_init');
    expect(await readdir(env.tmpDir)).toEqual([]);
  });

  test('a hung process is killed and reported as timeout', async () => {
    const { env, home } = await tempEnv();
    const bin = join(home, 'bin', 'whisper-cli');
    await fakeBinary(bin, 'exec sleep 30');
    const t0 = Date.now();
    const err = await transcribe({
      engine: 'whisper.cpp', binaryPath: bin, modelPath: '/x.bin', language: 'en', wav: tinyWav(), tmpDir: env.tmpDir, timeoutMs: 300,
    }).catch((e) => e);
    expect(err.code).toBe('timeout');
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(await readdir(env.tmpDir)).toEqual([]);
  });

  test('rejects audio that is not a WAV', async () => {
    const { env, home } = await tempEnv();
    const err = await transcribe({
      engine: 'whisper.cpp', binaryPath: join(home, 'nope'), modelPath: '/x.bin', language: 'en', wav: Buffer.from('hello'), tmpDir: env.tmpDir,
    }).catch((e) => e);
    expect(err.code).toBe('bad-audio');
  });
});
