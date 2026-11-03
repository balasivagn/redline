import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Run a command to completion with a timeout (kills the process on expiry). */
export async function runCommand(
  cmd: string[],
  opts: { timeoutMs: number; signal?: AbortSignal },
): Promise<SpawnResult> {
  const proc = Bun.spawn(cmd, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill('SIGKILL');
  }, opts.timeoutMs);
  const onAbort = (): void => {
    proc.kill('SIGKILL');
  };
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code: timedOut ? null : code, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

/** Streaming sha256 of a file; reports bytes hashed so far. */
export async function sha256File(path: string, onProgress?: (bytes: number) => void): Promise<string> {
  const hash = createHash('sha256');
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    let total = 0;
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      hash.update(buf.subarray(0, bytesRead));
      total += bytesRead;
      onProgress?.(total);
    }
  } finally {
    await fh.close();
  }
  return hash.digest('hex');
}

/** Error carrying a protocol error code. */
export class HelperError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
