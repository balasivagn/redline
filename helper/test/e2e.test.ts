import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { encodeFrame, FrameDecoder } from '../src/framing';
import { tempDir } from './helpers';

const MAIN = join(import.meta.dir, '..', 'src', 'main.ts');
const COMPILED = join(import.meta.dir, '..', 'dist', 'redline-helper');

/** Spawn a host, send framed requests, close stdin, return every decoded reply. */
async function talk(cmd: string[], requests: unknown[], redlineHome: string) {
  const proc = Bun.spawn(cmd, {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, REDLINE_HOME: redlineHome },
  });
  // deliver the first request split across two writes to exercise chunked input
  const first = encodeFrame(requests[0]);
  proc.stdin.write(first.subarray(0, 3));
  proc.stdin.flush();
  await Bun.sleep(20);
  proc.stdin.write(first.subarray(3));
  for (const r of requests.slice(1)) proc.stdin.write(encodeFrame(r));
  proc.stdin.end();

  const decoder = new FrameDecoder();
  const replies: any[] = [];
  for await (const chunk of proc.stdout) {
    for (const item of decoder.push(chunk)) if ('message' in item) replies.push(item.message);
  }
  const code = await proc.exited;
  return { replies, code, trailing: decoder.pending };
}

describe('native messaging host process', () => {
  const requests = [
    { id: 'a', type: 'hello' },
    { id: 'b', type: 'detect' },
    { id: 'c', type: 'catalog' },
    { id: 'd', type: 'nonsense' },
  ];

  const check = async (cmd: string[]) => {
    const home = await tempDir();
    const { replies, code, trailing } = await talk(cmd, requests, home);
    expect(code).toBe(0); // exits cleanly when stdin closes
    expect(trailing).toBe(false); // stdout carried only whole frames
    const byId = Object.fromEntries(replies.map((r) => [r.id, r]));
    expect(byId['a']).toMatchObject({ ok: true, type: 'hello', protocol: 1 });
    expect(byId['b']).toMatchObject({ ok: true, type: 'detect' });
    expect(Array.isArray(byId['b'].binaries) && Array.isArray(byId['b'].models)).toBe(true);
    expect(byId['c'].entries).toHaveLength(4);
    expect(byId['d']).toMatchObject({ ok: false, error: { code: 'unknown-request' } });
    expect(await Bun.file(join(home, 'helper.log')).text()).toContain('helper started');
  };

  test('bun src/main.ts', () => check([process.execPath, MAIN]), 30_000);
  test.skipIf(!existsSync(COMPILED))('compiled binary', () => check([COMPILED]), 30_000);
});
