import { availableParallelism } from 'node:os';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { EngineKind } from '../protocol';
import { HelperError, runCommand } from './util';

export const TRANSCRIBE_TIMEOUT_MS = 120_000;

export interface TranscribeInput {
  engine: EngineKind;
  binaryPath: string;
  modelPath: string;
  language: string;
  wav: Buffer;
  tmpDir: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Normalise the language sent by the extension into a whisper `-l` value. */
export function whisperLanguage(language: string, modelPath: string): string {
  // English-only models reject anything else.
  if (/\.en[.\-_]|\.en$/i.test(basename(modelPath))) return 'en';
  const l = language.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  if (!l || l === 'auto') return 'auto';
  return /^[a-z]{2,3}$/.test(l) ? l : 'auto';
}

export function buildArgs(engine: EngineKind, modelPath: string, wavPath: string, language: string): string[] {
  const threads = String(Math.max(2, Math.min(8, availableParallelism())));
  if (engine === 'whisper.cpp') {
    return ['-m', modelPath, '-f', wavPath, '-l', whisperLanguage(language, modelPath), '-nt', '-np', '-t', threads];
  }
  // parakeet-cli has no language switch (the v3 model is multilingual and detects it).
  return ['-m', modelPath, '-f', wavPath, '-np', '-t', threads];
}

/** Plain text from CLI stdout: drop timestamps/markers, collapse whitespace. */
export function parseTranscript(stdout: string): string {
  return stdout
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*\[\d{1,2}:\d{2}:\d{2}[.,]\d+\s*-->\s*\d{1,2}:\d{2}:\d{2}[.,]\d+\]\s*/, '')
        .replace(/\[(BLANK_AUDIO|_BEG_|_EOT_|_TT_\d+|SOT)\]/gi, '')
        .trim(),
    )
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function usefulStderr(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^(ggml_|load_backend|whisper_|parakeet_init|parakeet_model_load: (loading|n_))/.test(l));
  return lines.slice(-4).join(' | ').slice(0, 400);
}

export async function transcribe(input: TranscribeInput): Promise<{ text: string; durationMs: number }> {
  if (input.wav.length < 44 || input.wav.subarray(0, 4).toString('latin1') !== 'RIFF') {
    throw new HelperError('bad-audio', 'audio is not a WAV file');
  }
  const dir = await mkdtemp(join(input.tmpDir, 'redline-'));
  const started = Date.now();
  try {
    const wavPath = join(dir, 'audio.wav');
    await writeFile(wavPath, input.wav);
    const args = buildArgs(input.engine, input.modelPath, wavPath, input.language);
    let res;
    try {
      res = await runCommand([input.binaryPath, ...args], {
        timeoutMs: input.timeoutMs ?? TRANSCRIBE_TIMEOUT_MS,
        signal: input.signal,
      });
    } catch (e) {
      throw new HelperError('transcribe-failed', `could not start ${basename(input.binaryPath)}: ${(e as Error).message}`);
    }
    if (input.signal?.aborted) throw new HelperError('cancelled', 'transcription cancelled');
    if (res.timedOut) {
      throw new HelperError('timeout', `transcription timed out after ${(input.timeoutMs ?? TRANSCRIBE_TIMEOUT_MS) / 1000}s`);
    }
    if (res.code !== 0) {
      throw new HelperError(
        'transcribe-failed',
        `${basename(input.binaryPath)} exited with ${res.code}: ${usefulStderr(res.stderr) || 'no output'}`,
      );
    }
    return { text: parseTranscript(res.stdout), durationMs: Date.now() - started };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
