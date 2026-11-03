import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnnotationRepo } from './index';
import { createFakeStorageArea, makeAnnotation } from './test-helpers';

function setup(initial: Record<string, unknown> = {}) {
  const area = createFakeStorageArea(initial);
  return { area, repo: createAnnotationRepo(area) };
}

afterEach(() => vi.restoreAllMocks());

describe('annotation repo', () => {
  it('assigns sequential numbers and stores under page:<key>', async () => {
    const { repo, area } = setup();
    const a = await repo.save(makeAnnotation({ id: 'a' }));
    const b = await repo.save(makeAnnotation({ id: 'b' }));
    expect([a.number, b.number]).toEqual([1, 2]);
    const record = area.dump()['page:http://localhost:3000/pricing'] as { nextNumber: number; title: string; path: string };
    expect(record.nextNumber).toBe(3);
    expect(record.title).toBe('Pricing — Acme');
    expect(record.path).toBe('/pricing');
  });

  it('keeps createdAt and number on update, bumps updatedAt, refreshes page info', async () => {
    const { repo, area } = setup();
    const first = await repo.save(makeAnnotation({ id: 'a', createdAt: '2020-01-01T00:00:00.000Z' }));
    await new Promise((r) => setTimeout(r, 5));
    const base = makeAnnotation({ id: 'a', number: 0, createdAt: '2025-05-05T00:00:00.000Z' });
    const updated = await repo.save({
      ...base,
      comment: { text: 'changed', source: 'typed' },
      page: { ...base.page, title: 'New title' },
    });
    expect(updated.number).toBe(first.number);
    expect(updated.createdAt).toBe('2020-01-01T00:00:00.000Z');
    expect(updated.updatedAt > first.updatedAt).toBe(true);
    expect(await repo.list(first.pageKey)).toHaveLength(1);
    expect((area.dump()['page:http://localhost:3000/pricing'] as { title: string }).title).toBe('New title');
  });

  it('numbers per page independently', async () => {
    const { repo } = setup();
    await repo.save(makeAnnotation({ id: 'a' }));
    const other = await repo.save(makeAnnotation({ id: 'b', pagePath: '/checkout' }));
    expect(other.number).toBe(1);
  });

  it('numbers never get reused after deleting', async () => {
    const { repo } = setup();
    await repo.save(makeAnnotation({ id: 'a' }));
    const b = await repo.save(makeAnnotation({ id: 'b' }));
    await repo.delete([b.id]);
    const c = await repo.save(makeAnnotation({ id: 'c' }));
    expect(c.number).toBe(3);
  });

  it('20 concurrent saves get 20 distinct numbers and none are lost', async () => {
    const { repo } = setup();
    const saved = await Promise.all(Array.from({ length: 20 }, (_, i) => repo.save(makeAnnotation({ id: `a${i}` }))));
    expect(new Set(saved.map((s) => s.number)).size).toBe(20);
    const listed = await repo.list(saved[0]!.pageKey);
    expect(listed).toHaveLength(20);
    expect(listed.map((a) => a.number)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('concurrent saves and deletes do not lose updates', async () => {
    const { repo } = setup();
    const first = await repo.save(makeAnnotation({ id: 'keep' }));
    await Promise.all([
      repo.delete(['nope']),
      ...Array.from({ length: 5 }, (_, i) => repo.save(makeAnnotation({ id: `n${i}` }))),
      repo.save({ ...first, comment: { text: 'edited', source: 'typed' } }),
    ]);
    const all = await repo.list(first.pageKey);
    expect(all).toHaveLength(6);
    expect(all.find((a) => a.id === 'keep')?.comment.text).toBe('edited');
  });

  it('delete works across pages, returns deleted annotations and removes empty page keys', async () => {
    const { repo, area } = setup();
    const a = await repo.save(makeAnnotation({ id: 'a' }));
    const b = await repo.save(makeAnnotation({ id: 'b', pagePath: '/checkout' }));
    await repo.save(makeAnnotation({ id: 'c', pagePath: '/checkout' }));
    const deleted = await repo.delete([a.id, b.id, 'missing']);
    expect(deleted.map((d) => d.id).sort()).toEqual(['a', 'b']);
    expect(Object.keys(area.dump())).toEqual(['page:http://localhost:3000/checkout']);
  });

  it('delete + restore round-trips exactly and bumps nextNumber', async () => {
    const { repo, area } = setup();
    await repo.save(makeAnnotation({ id: 'a' }));
    const b = await repo.save(makeAnnotation({ id: 'b' }));
    const c = await repo.save(makeAnnotation({ id: 'c' }));
    const deleted = await repo.delete([b.id, c.id]);
    expect(Object.keys(area.dump())).toHaveLength(1);
    expect(await repo.restore(deleted)).toBe(2);
    expect(await repo.list(b.pageKey)).toEqual([expect.objectContaining({ id: 'a', number: 1 }), b, c]);
    expect((await repo.save(makeAnnotation({ id: 'd' }))).number).toBe(4);
  });

  it('restore recreates a removed page and ignores ids that already exist', async () => {
    const { repo } = setup();
    const only = await repo.save(makeAnnotation({ id: 'a' }));
    const [deleted] = [await repo.delete([only.id])];
    expect(await repo.restore(deleted)).toBe(1);
    expect(await repo.restore(deleted)).toBe(0);
    expect(await repo.list(only.pageKey)).toHaveLength(1);
    expect((await repo.listAll())[0]?.title).toBe('Pricing — Acme');
  });

  it('skips invalid stored annotations with a warning instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const good = makeAnnotation({ id: 'good', number: 1 });
    const key = 'page:http://localhost:3000/pricing';
    const { repo } = setup({
      [key]: {
        pageKey: good.pageKey,
        url: good.page.url,
        origin: good.page.origin,
        path: good.page.path,
        title: good.page.title,
        updatedAt: good.updatedAt,
        nextNumber: 3,
        annotations: [good, { id: 'bad', schema: 'nope' }, 42],
      },
      'page:http://broken': { nonsense: true },
      settings: { theme: 'dark' },
    });
    expect((await repo.list(good.pageKey)).map((a) => a.id)).toEqual(['good']);
    expect(await repo.listAll()).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
  });

  it('listAll sorts pages by updatedAt desc with counts', async () => {
    const { repo } = setup();
    await repo.save(makeAnnotation({ id: 'a', pagePath: '/one' }));
    await new Promise((r) => setTimeout(r, 5));
    await repo.save(makeAnnotation({ id: 'b', pagePath: '/two' }));
    await new Promise((r) => setTimeout(r, 5));
    await repo.save(makeAnnotation({ id: 'c', pagePath: '/one' }));
    const all = await repo.listAll();
    expect(all.map((p) => [p.path, p.count])).toEqual([['/one', 2], ['/two', 1]]);
  });

  it('list is sorted by number and listPages concatenates in the given page order', async () => {
    const { repo } = setup();
    await repo.restore([
      makeAnnotation({ id: 'x3', number: 3 }),
      makeAnnotation({ id: 'x1', number: 1 }),
      makeAnnotation({ id: 'y1', number: 1, pagePath: '/other' }),
    ]);
    const k1 = 'http://localhost:3000/pricing';
    const k2 = 'http://localhost:3000/other';
    expect((await repo.list(k1)).map((a) => a.id)).toEqual(['x1', 'x3']);
    expect((await repo.listPages([k2, k1, 'missing'])).map((a) => a.id)).toEqual(['y1', 'x1', 'x3']);
    expect(await repo.list('missing')).toEqual([]);
  });
});
