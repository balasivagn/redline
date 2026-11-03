import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHelperClient, type NativePort } from './helper-client';

class FakePort implements NativePort {
  sent: any[] = [];
  disconnected = false;
  private msgCbs: Array<(m: any) => void> = [];
  private discCbs: Array<() => void> = [];
  onMessage = { addListener: (cb: (m: any) => void) => void this.msgCbs.push(cb) };
  onDisconnect = { addListener: (cb: () => void) => void this.discCbs.push(cb) };
  postMessage(m: unknown) { this.sent.push(m); }
  disconnect() { this.disconnected = true; }
  emit(m: unknown) { this.msgCbs.forEach((cb) => cb(m)); }
  drop() { this.discCbs.forEach((cb) => cb()); }
}

function setup(extra: Parameters<typeof createHelperClient>[0] = {}) {
  const ports: FakePort[] = [];
  let err: string | undefined;
  const events: any[] = [];
  const client = createHelperClient({
    connect: () => { const p = new FakePort(); ports.push(p); return p; },
    lastError: () => err,
    onEvent: (e) => events.push(e),
    ...extra,
  });
  return { client, ports, events, setErr: (e: string) => { err = e; } };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('helper client', () => {
  it('correlates out-of-order responses by id', async () => {
    const { client, ports } = setup();
    const a = client.request({ type: 'catalog' });
    const b = client.request({ type: 'cancel-download', catalogId: 'x' });
    const p = ports[0]!;
    expect(p.sent.map((m) => m.type)).toEqual(['catalog', 'cancel-download']);
    p.emit({ id: p.sent[1].id, ok: true, type: 'cancel-download' });
    p.emit({ id: p.sent[0].id, ok: true, type: 'catalog', entries: [] });
    await expect(a).resolves.toMatchObject({ type: 'catalog', entries: [] });
    await expect(b).resolves.toMatchObject({ type: 'cancel-download' });
  });

  it('rejects ok:false responses with the helper message and code', async () => {
    const { client, ports } = setup();
    const r = client.request({ type: 'catalog' });
    const p = ports[0]!;
    p.emit({ id: p.sent[0].id, ok: false, error: { code: 'boom', message: 'it broke' } });
    await expect(r).rejects.toMatchObject({ message: 'it broke', code: 'boom' });
  });

  it('times out and ignores a late response', async () => {
    const { client, ports } = setup({ timeouts: { catalog: 1000 } });
    const r = client.request({ type: 'catalog' });
    const assertion = expect(r).rejects.toThrow(/did not answer/);
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
    const p = ports[0]!;
    p.emit({ id: p.sent[0].id, ok: true, type: 'catalog', entries: [] }); // must not throw
  });

  it('progress events are forwarded and extend the timeout', async () => {
    const { client, ports, events } = setup({ timeouts: { download: 1000 } });
    const r = client.request({ type: 'download', catalogId: 'm' });
    const p = ports[0]!;
    const id = p.sent[0].id;
    await vi.advanceTimersByTimeAsync(800);
    p.emit({ id, event: 'download-progress', catalogId: 'm', receivedBytes: 1, totalBytes: 2, phase: 'downloading' });
    await vi.advanceTimersByTimeAsync(800);
    p.emit({ id, ok: true, type: 'download', model: { id: 'whisper.cpp:m' } });
    await expect(r).resolves.toMatchObject({ type: 'download' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ catalogId: 'm', receivedBytes: 1 });
  });

  it('reports a missing host from the disconnect error and reconnects next time', async () => {
    const { client, ports, setErr } = setup();
    const s = client.status(true);
    setErr('Specified native messaging host not found.');
    ports[0]!.drop();
    await expect(s).resolves.toEqual({
      installed: false, binaries: [], models: [], error: 'Specified native messaging host not found.',
    });
    const s2 = client.status(true);
    expect(ports).toHaveLength(2);
    const p = ports[1]!;
    p.emit({ id: p.sent[0].id, ok: true, type: 'hello', version: '1.0', protocol: 1, platform: 'darwin' });
    await vi.advanceTimersByTimeAsync(0);
    p.emit({ id: p.sent[1].id, ok: true, type: 'detect', binaries: [], models: [] });
    await expect(s2).resolves.toMatchObject({ installed: true, version: '1.0' });
  });

  it('caches status for 30 s and refresh bypasses', async () => {
    let t = 0;
    const { client, ports } = setup({ now: () => t });
    const answer = async (p: FakePort, from: number) => {
      p.emit({ id: p.sent[from].id, ok: true, type: 'hello', version: '1', protocol: 1, platform: 'x' });
      await vi.advanceTimersByTimeAsync(0);
      p.emit({ id: p.sent[from + 1].id, ok: true, type: 'detect', binaries: [], models: [] });
    };
    const first = client.status();
    await answer(ports[0]!, 0);
    await first;
    t = 29_000;
    await client.status(); // cached: nothing new sent
    expect(ports[0]!.sent).toHaveLength(2);
    const refreshed = client.status(true);
    await answer(ports[0]!, 2);
    await refreshed;
    expect(ports[0]!.sent).toHaveLength(4);
    t = 29_000 + 31_000;
    const stale = client.status();
    await answer(ports[0]!, 4);
    await stale;
    expect(ports[0]!.sent).toHaveLength(6);
  });

  it('closes the port when idle', async () => {
    const { client, ports } = setup({ idleMs: 500 });
    const r = client.cancelDownload('x');
    const p = ports[0]!;
    p.emit({ id: p.sent[0].id, ok: true, type: 'cancel-download' });
    await r;
    expect(p.disconnected).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    expect(p.disconnected).toBe(true);
  });

  it('rejects every pending request when the port drops', async () => {
    const { client, ports, setErr } = setup();
    const a = client.request({ type: 'catalog' });
    const b = client.request({ type: 'catalog' });
    setErr('gone');
    ports[0]!.drop();
    await expect(a).rejects.toThrow('gone');
    await expect(b).rejects.toThrow('gone');
  });
});
