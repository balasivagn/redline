import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHandler, type Outbound } from '../src/handler';
import { sanitizeRelPath } from '../src/shots';
import { tempDir, tempEnv } from './helpers';

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

async function call(h: ReturnType<typeof createHandler>, req: unknown): Promise<Outbound> {
  const out: Outbound[] = [];
  await h.handle(req, (m) => out.push(m));
  return out[0]!;
}

describe('sanitizeRelPath', () => {
  test('replaces unsafe characters per segment', () => {
    expect(sanitizeRelPath('localhost-3000/my page/a b:c.png')).toEqual(['localhost-3000', 'my-page', 'a-b-c.png']);
    expect(sanitizeRelPath('é/ü.png')).toEqual(['-', '-.png']);
  });
  test('rejects absolute, traversal, empty and malformed paths', () => {
    for (const bad of ['/etc/passwd', '\\evil', 'C:\\x', '../x.png', 'a/../x.png', 'a/./b', 'a//b.png', 'a/', '', 'a\\..\\b', 'a\0b', '..']) {
      expect(() => sanitizeRelPath(bad)).toThrow();
    }
    expect(() => sanitizeRelPath(5)).toThrow();
  });
});

describe('save-shot / delete-shots', () => {
  test('writes the png under ~/.redline/shots and returns the absolute path', async () => {
    const { env } = await tempEnv();
    const h = createHandler(env);
    const res = await call(h, { id: '1', type: 'save-shot', relPath: 'localhost-3000/pricing/2026 x-shot_1.png', pngBase64: PNG.toString('base64') });
    expect(res).toMatchObject({ id: '1', ok: true, type: 'save-shot' });
    const path = (res as { path: string }).path;
    expect(path).toBe(join(env.redlineDir, 'shots', 'localhost-3000', 'pricing', '2026-x-shot_1.png'));
    expect(readFileSync(path).equals(PNG)).toBe(true);
    // atomic: no tmp leftovers
    expect(await readdir(join(env.shotsDir, 'localhost-3000', 'pricing'))).toEqual(['2026-x-shot_1.png']);
  });

  test('overwrites an existing file', async () => {
    const { env } = await tempEnv();
    const h = createHandler(env);
    const req = (b: Buffer) => ({ id: 'o', type: 'save-shot', relPath: 'a/b.png', pngBase64: b.toString('base64') });
    await call(h, req(PNG));
    const res = (await call(h, req(Buffer.from('second')))) as { path: string };
    expect(readFileSync(res.path, 'utf8')).toBe('second');
  });

  test('rejects traversal / absolute / bad input without writing', async () => {
    const { env, home } = await tempEnv();
    const h = createHandler(env);
    for (const relPath of ['../escape.png', '/tmp/abs.png', 'a/../../b.png', 'a//b.png', '']) {
      const res = await call(h, { id: 'x', type: 'save-shot', relPath, pngBase64: PNG.toString('base64') });
      expect(res).toMatchObject({ ok: false, error: { code: 'bad-path' } });
    }
    expect(await call(h, { id: 'y', type: 'save-shot', relPath: 'a.png' })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    expect(await call(h, { id: 'z', type: 'save-shot', relPath: 'a.png', pngBase64: '' })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    expect(existsSync(join(home, 'escape.png'))).toBe(false);
  });

  test('refuses to write through a symlinked directory that leaves the shots root', async () => {
    const { env } = await tempEnv();
    const outside = await tempDir('rl-outside-');
    await mkdir(env.shotsDir, { recursive: true });
    await symlink(outside, join(env.shotsDir, 'link'));
    const res = await call(createHandler(env), { id: 's', type: 'save-shot', relPath: 'link/x.png', pngBase64: PNG.toString('base64') });
    expect(res).toMatchObject({ ok: false, error: { code: 'bad-path' } });
    expect(await readdir(outside)).toEqual([]);
  });

  test('delete-shots removes only files inside the shots root and prunes empty dirs', async () => {
    const { env, home } = await tempEnv();
    const h = createHandler(env);
    const save = async (relPath: string) =>
      ((await call(h, { id: 's', type: 'save-shot', relPath, pngBase64: PNG.toString('base64') })) as { path: string }).path;
    const a = await save('host/page/a.png');
    const b = await save('host/page/b.png');
    const c = await save('other/root/c.png');

    const outsideFile = join(home, 'precious.png');
    await writeFile(outsideFile, 'keep');
    const outsideDir = await tempDir('rl-outside-');
    const sneaky = join(outsideDir, 'sneaky.png');
    await writeFile(sneaky, 'keep');
    await symlink(outsideDir, join(env.shotsDir, 'escape'));

    const res = await call(h, {
      id: 'd',
      type: 'delete-shots',
      paths: [a, outsideFile, sneaky, join(env.shotsDir, 'escape', 'sneaky.png'), join(env.shotsDir, '..', 'precious.png'), join(env.shotsDir, 'nope.png'), 'relative.png', 42, env.shotsDir],
    });
    expect(res).toMatchObject({ ok: true, type: 'delete-shots', deleted: 1 });
    expect(existsSync(a)).toBe(false);
    expect(existsSync(b)).toBe(true);
    expect(existsSync(outsideFile)).toBe(true);
    expect(existsSync(sneaky)).toBe(true);

    // deleting the rest prunes empty parents but keeps the shots root
    expect(await call(h, { id: 'd2', type: 'delete-shots', paths: [b, c] })).toMatchObject({ ok: true, deleted: 2 });
    expect(existsSync(join(env.shotsDir, 'host'))).toBe(false);
    expect(existsSync(join(env.shotsDir, 'other'))).toBe(false);
    expect(existsSync(env.shotsDir)).toBe(true);
  });

  test('delete-shots on a missing shots folder is a no-op; bad input is an error', async () => {
    const { env } = await tempEnv();
    const h = createHandler(env);
    expect(await call(h, { id: 'm', type: 'delete-shots', paths: [join(env.shotsDir, 'a.png')] })).toMatchObject({ ok: true, deleted: 0 });
    expect(await call(h, { id: 'n', type: 'delete-shots' })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
  });
});
