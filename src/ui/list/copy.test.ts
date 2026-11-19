import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeAnnotation } from './fixtures';

vi.mock('../../core/rpc', () => ({ rpc: vi.fn(), onRedlineEvent: vi.fn(() => () => undefined) }));
vi.mock('../../core/export', () => ({
  toMarkdown: vi.fn((a: unknown[]) => `MD(${a.length})`),
  toExportDocument: vi.fn((a: unknown[]) => ({ schema: 'redline/export/v1', pages: [], count: a.length })),
  buildBundle: vi.fn(),
}));

import { rpc } from '../../core/rpc';
import {
  bundleFileName,
  copyAnnotations,
  shotWarning,
  copiedMessage,
  dataUrlToBlob,
  defaultScope,
  effectiveScope,
  formatAnnotations,
  loadAllAnnotations,
  resolveScope,
} from './copy';

const a1 = makeAnnotation({ id: 'a1', number: 1 });
const a2 = makeAnnotation({ id: 'a2', number: 2 });
const a3 = makeAnnotation({ id: 'a3', number: 3 });
const list = [a1, a2, a3];

describe('copy scope resolution', () => {
  it('selected keeps list order and only selected ids', async () => {
    expect(await resolveScope('selected', { annotations: list, selectedIds: new Set(['a3', 'a1']) })).toEqual([a1, a3]);
  });

  it('page returns everything shown', async () => {
    expect(await resolveScope('page', { annotations: list, selectedIds: new Set(['a1']) })).toEqual(list);
  });

  it('all loads through the loader (listAll → listPages)', async () => {
    const loadAll = vi.fn().mockResolvedValue([a1]);
    expect(await resolveScope('all', { annotations: list, selectedIds: new Set(), loadAll })).toEqual([a1]);
    expect(loadAll).toHaveBeenCalledOnce();
  });

  it('default / effective scope fall back when nothing is selected', () => {
    expect(defaultScope(0)).toBe('page');
    expect(defaultScope(2)).toBe('selected');
    expect(effectiveScope('selected', 0)).toBe('page');
    expect(effectiveScope('selected', 2)).toBe('selected');
    expect(effectiveScope('all', 0)).toBe('all');
    expect(effectiveScope(null, 1)).toBe('selected');
  });
});

describe('loadAllAnnotations', () => {
  beforeEach(() => {
    vi.mocked(rpc).mockReset();
  });

  it('lists pages then fetches every key', async () => {
    vi.mocked(rpc).mockImplementation((async (type: string) => {
      if (type === 'ann/listAll') return [{ pageKey: 'k1' }, { pageKey: 'k2' }];
      if (type === 'ann/listPages') return [a1, a2];
      throw new Error(type);
    }) as never);
    expect(await loadAllAnnotations()).toEqual([a1, a2]);
    expect(rpc).toHaveBeenLastCalledWith('ann/listPages', { pageKeys: ['k1', 'k2'] });
  });

  it('skips the second call when there are no pages', async () => {
    vi.mocked(rpc).mockResolvedValueOnce([] as never);
    expect(await loadAllAnnotations()).toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe('formatting helpers', () => {
  it('formats markdown and pretty JSON', () => {
    expect(formatAnnotations(list, 'markdown')).toBe('MD(3)');
    const json = formatAnnotations(list, 'json');
    expect(json).toContain('\n  "schema"');
    expect(JSON.parse(json).count).toBe(3);
  });

  it('builds the toast text', () => {
    expect(copiedMessage(3, 'markdown')).toBe('Copied 3 comments as Markdown');
    expect(copiedMessage(1, 'json')).toBe('Copied 1 comment as JSON');
  });

  it('names the bundle by local date', () => {
    expect(bundleFileName(new Date(2026, 10, 3, 9, 5))).toBe('redline-2026-11-03.zip');
  });

  it('decodes data URLs to blobs', async () => {
    const blob = dataUrlToBlob('data:image/png;base64,iVBORw0K');
    expect(blob.type).toBe('image/png');
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  });
});

describe('screenshot delivery warnings', () => {
  const withShot = (id: string, shot: { width: number; height: number; path?: string }) =>
    makeAnnotation({ id, number: 1, screenshot: { shotId: 's', ...shot } } as never);

  it('is silent when every screenshot has a saved file of a sane size', () => {
    expect(shotWarning([withShot('a', { width: 800, height: 600, path: '/x/a.png' }), a1], 'markdown')).toBeUndefined();
  });
  it('warns when the image has no saved file (agent would get text only)', () => {
    expect(shotWarning([withShot('a', { width: 800, height: 600 })], 'markdown')).toMatch(/no saved file.*text only/);
  });
  it('warns on a blank / 1 px capture even when a path exists', () => {
    expect(shotWarning([withShot('a', { width: 1, height: 1, path: '/x/a.png' })], 'markdown')).toMatch(/blank or too small/);
  });
  it('JSON copies are not flagged', () => {
    expect(shotWarning([withShot('a', { width: 800, height: 600 })], 'json')).toBeUndefined();
  });
  it('copyAnnotations still copies, then fails loudly', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await expect(copyAnnotations([withShot('a', { width: 800, height: 600 })], 'markdown')).rejects.toThrow(/text only/);
    expect(writeText).toHaveBeenCalledWith('MD(1)');
    await expect(copyAnnotations([a1], 'markdown')).resolves.toBe('Copied 1 comment as Markdown');
  });
});
