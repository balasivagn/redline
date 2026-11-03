import { chmod, mkdir, mkdtemp, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { makeEnv, type HelperEnv } from '../src/env';

export async function tempDir(prefix = 'rl-test-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** Sparse fake whisper model: correct magic, padded to `size` bytes. */
export async function fakeWhisperModel(path: string, size = 25 * 1024 * 1024): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from('lmggFAKE'));
  await truncate(path, size);
}

export async function fakeFile(path: string, size = 25 * 1024 * 1024, head = 'xxxx'): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(head));
  await truncate(path, size);
}

export async function fakeBinary(path: string, script: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `#!/bin/bash\n${script}\n`);
  await chmod(path, 0o755);
}

/** An isolated HelperEnv rooted in a fresh temp "home". */
export async function tempEnv(overrides: Partial<HelperEnv> = {}): Promise<{ env: HelperEnv; home: string }> {
  const home = await tempDir();
  const env = makeEnv({
    home,
    redlineDir: join(home, '.redline'),
    appSupportDir: join(home, 'Library', 'Application Support'),
    codesDir: join(home, 'Codes'),
    tmpDir: join(home, 'tmp'),
    binDirs: [join(home, 'bin')],
    knownModelDirs: [
      { dir: join(home, 'Library', 'Application Support', 'superwhisper'), source: 'superwhisper' },
      { dir: join(home, 'Library', 'Application Support', 'hex', 'models'), source: 'hex' },
      { dir: join(home, '.cache', 'whisper'), source: 'whisper' },
    ],
    ...overrides,
  });
  await mkdir(env.tmpDir, { recursive: true });
  return { env, home };
}

/** Minimal valid-looking WAV (RIFF header + silence). */
export function tinyWav(): Buffer {
  const b = Buffer.alloc(44 + 3200);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8, 'latin1');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'latin1');
  b.writeUInt32LE(3200, 40);
  return b;
}
