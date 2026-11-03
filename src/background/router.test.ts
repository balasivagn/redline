import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RpcRequest, RpcType } from '../core/messages';
import type { Annotation, PageSummary } from '../core/schema';
import type { AnnotationRepo, ShotStore } from '../core/storage';
import { createSettingsStore } from './settings-store';
import { createRouter, SHOT_DELETE_DELAY_MS, type RouterDeps } from './router';

function ann(id: string, pageKey = 'https://a.test/x', shotId?: string): Annotation {
  return {
    schema: 'redline/v1', id, number: 1, pageKey, createdAt: 'c', updatedAt: 'u',
    page: { url: pageKey, origin: 'https://a.test', path: '/x', title: 't', viewport: { width: 1, height: 1, dpr: 1 }, scroll: { x: 0, y: 0 }, userAgent: 'ua' },
    comment: { text: 'hi', source: 'typed' }, tags: [], meta: {},
    anchor: { kind: 'pin', selector: 'a', xpath: '/a', offset: { xRatio: 0, yRatio: 0 }, pagePoint: { x: 0, y: 0 } },
    dom: { tag: 'a', classes: [], text: '', outerHTML: '', rect: { x: 0, y: 0, width: 1, height: 1 }, styles: {}, ancestors: [] },
    ...(shotId ? { screenshot: { shotId, width: 1, height: 1 } } : {}),
  };
}

function fakeRepo() {
  const store = new Map<string, Annotation>();
  const repo: AnnotationRepo = {
    list: async (k) => [...store.values()].filter((a) => a.pageKey === k),
    listAll: async (): Promise<PageSummary[]> => [],
    listPages: async (ks) => [...store.values()].filter((a) => ks.includes(a.pageKey)),
    save: async (a) => { const s = { ...a, number: a.number || 1 }; store.set(s.id, s); return s; },
    delete: async (ids) => { const out = ids.map((i) => store.get(i)).filter((a): a is Annotation => !!a); ids.forEach((i) => store.delete(i)); return out; },
    restore: async (as) => { as.forEach((a) => store.set(a.id, a)); return as.length; },
  };
  return { repo, store };
}

function fakeShots() {
  const blobs = new Map<string, Blob>();
  const shots: ShotStore = {
    put: async (b) => { const id = `shot_${blobs.size + 1}`; blobs.set(id, b); return id; },
    get: async (id) => blobs.get(id),
    delete: async (ids) => { ids.forEach((i) => blobs.delete(i)); },
  };
  return { shots, blobs };
}

function setup() {
  const { repo, store } = fakeRepo();
  const { shots, blobs } = fakeShots();
  const area = { data: {} as Record<string, unknown>, get: async (k: string) => ({ [k]: area.data[k] }), set: async (o: Record<string, unknown>) => { Object.assign(area.data, o); } };
  const events: any[] = [];
  const opened: string[] = [];
  const speech = { start: vi.fn(async () => {}), stop: vi.fn(async () => ({ text: 'hello' })), cancel: vi.fn(async () => {}), status: vi.fn(), handleOffscreenEvent: vi.fn() };
  const helper = { status: vi.fn(async () => ({ installed: false, binaries: [], models: [], error: 'x' })), catalog: vi.fn(), download: vi.fn(), cancelDownload: vi.fn(async () => {}), request: vi.fn(), transcribe: vi.fn(), invalidateStatus: vi.fn() };
  const changed: string[][] = [];
  const deps: RouterDeps = {
    repo, shots, settings: createSettingsStore(area as never), helper: helper as never, speech: speech as never,
    broadcast: (e) => { events.push(e); },
    captureShot: async ({ rect }) => ({ blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), width: rect.width, height: rect.height }),
    getUrl: (p) => `chrome-extension://abc${p}`,
    openTab: async (u) => { opened.push(u); },
    onAnnotationsChanged: (k) => changed.push(k),
  };
  const router = createRouter(deps);
  const call = <T extends RpcType>(type: T, payload: RpcRequest<T>['payload'], sender = { tab: { id: 5, windowId: 9 } }) =>
    router.handle({ channel: 'redline/rpc', type, payload } as RpcRequest, sender);
  return { call, router, store, blobs, events, opened, speech, helper, changed, area };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('router', () => {
  it('save → broadcasts ann/changed and notifies badge', async () => {
    const t = setup();
    const r = await t.call('ann/save', { annotation: ann('a1') });
    expect(r).toMatchObject({ ok: true, data: { id: 'a1' } });
    expect(t.events).toEqual([{ type: 'ann/changed', pageKeys: ['https://a.test/x'] }]);
    expect(t.changed).toEqual([['https://a.test/x']]);
    expect(await t.call('ann/list', { pageKey: 'https://a.test/x' })).toMatchObject({ ok: true, data: [{ id: 'a1' }] });
  });

  it('returns {ok:false,error} when a handler throws', async () => {
    const t = setup();
    t.speech.start.mockRejectedValueOnce(new Error('nope'));
    expect(await t.call('speech/start', {})).toEqual({ ok: false, error: 'nope' });
  });

  it('delete removes screenshots only after 10 s', async () => {
    const t = setup();
    t.blobs.set('shot_a', new Blob(['x']));
    await t.call('ann/save', { annotation: ann('a1', 'https://a.test/x', 'shot_a') });
    const del = await t.call('ann/delete', { ids: ['a1'] });
    expect(del).toMatchObject({ ok: true, data: { deleted: [{ id: 'a1' }] } });
    expect(t.events.at(-1)).toEqual({ type: 'ann/changed', pageKeys: ['https://a.test/x'] });
    await vi.advanceTimersByTimeAsync(SHOT_DELETE_DELAY_MS - 1);
    expect(t.blobs.has('shot_a')).toBe(true);
    await vi.advanceTimersByTimeAsync(2);
    expect(t.blobs.has('shot_a')).toBe(false);
  });

  it('undo (restore) within 10 s keeps the screenshot', async () => {
    const t = setup();
    t.blobs.set('shot_a', new Blob(['x']));
    await t.call('ann/save', { annotation: ann('a1', 'https://a.test/x', 'shot_a') });
    const del = await t.call('ann/delete', { ids: ['a1'] });
    const deleted = (del as { ok: true; data: { deleted: Annotation[] } }).data.deleted;
    await vi.advanceTimersByTimeAsync(5000);
    expect(await t.call('ann/restore', { annotations: deleted })).toEqual({ ok: true, data: { restored: 1 } });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.blobs.has('shot_a')).toBe(true);
    expect(t.store.has('a1')).toBe(true);
    expect(t.router.pendingShotDeletes.size).toBe(0);
  });

  it('shot/capture uses the sender window and stores the blob; shot/get returns a data URL', async () => {
    const t = setup();
    const r = await t.call('shot/capture', { rect: { x: 0, y: 0, width: 10, height: 20 }, dpr: 2 });
    expect(r).toMatchObject({ ok: true, data: { width: 10, height: 20 } });
    const shotId = (r as { ok: true; data: { shotId: string } }).data.shotId;
    const got = await t.call('shot/get', { shotId });
    expect((got as { ok: true; data: { dataUrl: string } }).data.dataUrl).toBe('data:image/png;base64,iVBORw==');
    expect(await t.call('shot/get', { shotId: 'missing' })).toEqual({ ok: true, data: null });
    expect(await t.call('shot/capture', { rect: { x: 0, y: 0, width: 1, height: 1 }, dpr: 1 }, {} as never)).toMatchObject({ ok: false });
  });

  describe('screenshot files', () => {
    const installed = { installed: true, binaries: [], models: [] };
    const tabSender = { tab: { id: 5, windowId: 9, url: 'http://127.0.0.1:5173/pricing?x=1' } };

    it('shot/capture saves the PNG via the helper and returns its path', async () => {
      const t = setup();
      t.helper.status.mockResolvedValue(installed as never);
      t.helper.request.mockImplementation(async (r: { relPath: string }) => ({ ok: true, type: 'save-shot', path: `/home/u/.redline/shots/${r.relPath}` }));
      const r = await t.call('shot/capture', { rect: { x: 0, y: 0, width: 10, height: 20 }, dpr: 1 }, tabSender);
      const data = (r as { ok: true; data: { shotId: string; path: string } }).data;
      expect(t.helper.request).toHaveBeenCalledWith({
        type: 'save-shot',
        relPath: expect.stringMatching(new RegExp(`^127\\.0\\.0\\.1-5173/pricing/\\d{8}-\\d{6}-${data.shotId}\\.png$`)),
        pngBase64: 'iVBORw==',
      });
      expect(data.path).toMatch(/^\/home\/u\/\.redline\/shots\/127\.0\.0\.1-5173\/pricing\//);
    });

    it('no helper → no path; a failing write does not fail the capture', async () => {
      const t = setup();
      expect(await t.call('shot/capture', { rect: { x: 0, y: 0, width: 1, height: 1 }, dpr: 1 }, tabSender)).toMatchObject({ ok: true, data: { width: 1 } });
      expect(t.helper.request).not.toHaveBeenCalled();
      t.helper.status.mockResolvedValue(installed as never);
      t.helper.request.mockRejectedValue(new Error('disk full'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const r = await t.call('shot/capture', { rect: { x: 0, y: 0, width: 1, height: 1 }, dpr: 1 }, tabSender);
      expect(r).toMatchObject({ ok: true });
      expect((r as { ok: true; data: object }).data).not.toHaveProperty('path');
      warn.mockRestore();
    });

    it('delete removes the saved file after 10 s; undo keeps it', async () => {
      const t = setup();
      t.helper.request.mockResolvedValue({ ok: true, type: 'delete-shots', deleted: 1 });
      const withPath = (id: string, shotId: string): Annotation => ({ ...ann(id, 'https://a.test/x', shotId), screenshot: { shotId, width: 1, height: 1, path: `/home/u/.redline/shots/${shotId}.png` } });
      await t.call('ann/save', { annotation: withPath('a1', 'shot_a') });
      await t.call('ann/save', { annotation: withPath('a2', 'shot_b') });
      const del = await t.call('ann/delete', { ids: ['a1', 'a2'] });
      const deleted = (del as { ok: true; data: { deleted: Annotation[] } }).data.deleted;
      await vi.advanceTimersByTimeAsync(SHOT_DELETE_DELAY_MS - 1);
      expect(t.helper.request).not.toHaveBeenCalled();
      await t.call('ann/restore', { annotations: deleted.filter((a) => a.id === 'a2') });
      await vi.advanceTimersByTimeAsync(2);
      expect(t.helper.request).toHaveBeenCalledTimes(1);
      expect(t.helper.request).toHaveBeenCalledWith({ type: 'delete-shots', paths: ['/home/u/.redline/shots/shot_a.png'] });
    });
  });

  it('settings/set merges nested patches and broadcasts', async () => {
    const t = setup();
    const r = await t.call('settings/set', { patch: { voice: { engine: 'chrome', language: 'en' }, pillCorner: 'tl' } });
    expect(r).toMatchObject({ ok: true, data: { pillCorner: 'tl', voice: { engine: 'chrome' }, shortcuts: { pin: 'P' } } });
    expect(t.events.at(-1)).toMatchObject({ type: 'settings/changed', settings: { pillCorner: 'tl' } });
    expect(await t.call('settings/get', {})).toMatchObject({ ok: true, data: { pillCorner: 'tl' } });
  });

  it('site/setEnabled adds and removes origins without duplicates', async () => {
    const t = setup();
    await t.call('site/setEnabled', { origin: 'https://a.test', enabled: true });
    expect(await t.call('site/setEnabled', { origin: 'https://a.test', enabled: true })).toEqual({ ok: true, data: { enabledOrigins: ['https://a.test'] } });
    expect(await t.call('site/setEnabled', { origin: 'https://a.test', enabled: false })).toEqual({ ok: true, data: { enabledOrigins: [] } });
  });

  it('speech calls are scoped to the sender tab (or extension pages)', async () => {
    const t = setup();
    await t.call('speech/start', {}, { tab: { id: 5, windowId: 1 } });
    expect(t.speech.start).toHaveBeenCalledWith(5);
    expect(await t.call('speech/stop', {}, {} as never)).toEqual({ ok: true, data: { text: 'hello' } });
    expect(t.speech.stop).toHaveBeenCalledWith('extension');
  });

  it('opens extension pages', async () => {
    const t = setup();
    await t.call('open/reviews', { pageKey: 'https://a.test/x y' });
    await t.call('open/reviews', {});
    await t.call('open/settings', { section: 'voice' });
    expect(t.opened).toEqual([
      'chrome-extension://abc/reviews.html#page=https%3A%2F%2Fa.test%2Fx%20y',
      'chrome-extension://abc/reviews.html',
      'chrome-extension://abc/options.html#voice',
    ]);
  });

  it('helper/status passes through (installed:false with error)', async () => {
    const t = setup();
    expect(await t.call('helper/status', { refresh: true })).toEqual({ ok: true, data: { installed: false, binaries: [], models: [], error: 'x' } });
    expect(t.helper.status).toHaveBeenCalledWith(true);
  });

  it('listener ignores non-rpc messages and answers rpc asynchronously', async () => {
    const t = setup();
    const respond = vi.fn();
    expect(t.router.listener({ channel: 'other' }, {} as never, respond)).toBe(false);
    expect(t.router.listener({ channel: 'redline/rpc', type: 'settings/get', payload: {} }, {} as never, respond)).toBe(true);
    await vi.waitFor(() => expect(respond).toHaveBeenCalled());
    expect(respond.mock.calls[0]![0]).toMatchObject({ ok: true });
  });
});
