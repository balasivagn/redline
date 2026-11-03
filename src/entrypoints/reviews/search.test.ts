import { describe, expect, it } from 'vitest';
import type { PageSummary } from '../../core/schema';
import { makeAnnotation } from '../../ui/list/fixtures';
import { groupByOrigin, hashForPage, originCheckState, pageFromHash, toggleOrigin, togglePage } from './groups';
import { filterPages } from './search';

const page = (over: Partial<PageSummary> & { pageKey: string }): PageSummary => ({
  url: `https://${over.pageKey}`,
  origin: 'https://localhost:3000',
  path: '/x',
  title: 'T',
  count: 1,
  updatedAt: '2026-11-03T09:00:00.000Z',
  ...over,
});

const pricing = page({ pageKey: 'localhost:3000/pricing', url: 'http://localhost:3000/pricing', title: 'Pricing — Acme', path: '/pricing', count: 2 });
const checkout = page({ pageKey: 'localhost:3000/checkout', url: 'http://localhost:3000/checkout', title: 'Checkout', path: '/checkout', updatedAt: '2026-11-03T10:00:00.000Z' });
const staging = page({ pageKey: 'staging.acme.dev/pricing', origin: 'https://staging.acme.dev', url: 'https://staging.acme.dev/pricing', title: 'Pricing — Acme', path: '/pricing', updatedAt: '2026-11-02T10:00:00.000Z' });
const pages = [pricing, checkout, staging];

const anns = {
  [pricing.pageKey]: [
    makeAnnotation({ id: 'p1', number: 1, pageKey: pricing.pageKey, comment: { text: 'Price should be bigger', source: 'typed' } }),
    makeAnnotation({ id: 'p2', number: 2, pageKey: pricing.pageKey, comment: { text: 'Button misaligned', source: 'typed' } }),
  ],
  [checkout.pageKey]: [
    makeAnnotation({
      id: 'c1',
      number: 1,
      pageKey: checkout.pageKey,
      comment: { text: 'Totals wrong', source: 'typed' },
      anchor: { kind: 'pin', selector: 'form#pay > button.submit', xpath: '', offset: { xRatio: 0, yRatio: 0 }, pagePoint: { x: 0, y: 0 } },
    }),
  ],
};

const keys = (q: string, loaded = true) => filterPages(pages, loaded ? anns : undefined, q).map((m) => m.page.pageKey);

describe('filterPages', () => {
  it('returns everything for an empty query', () => {
    expect(keys('  ')).toEqual(pages.map((p) => p.pageKey));
  });

  it('matches comment text, title, URL and selector (case-insensitive)', () => {
    expect(keys('BIGGER')).toEqual([pricing.pageKey]);
    expect(keys('checkout')).toEqual([checkout.pageKey]);
    expect(keys('staging.acme')).toEqual([staging.pageKey]);
    expect(keys('button.submit')).toEqual([checkout.pageKey]);
  });

  it('ANDs words and counts matching comments', () => {
    expect(keys('pricing bigger')).toEqual([pricing.pageKey]);
    expect(keys('pricing nonsense')).toEqual([]);
    const m = filterPages(pages, anns, 'misaligned');
    expect(m).toHaveLength(1);
    expect(m[0]!.matches).toBe(1);
  });

  it('falls back to title/URL while comments are not loaded yet', () => {
    expect(keys('bigger', false)).toEqual([]);
    expect(keys('pricing', false)).toEqual([pricing.pageKey, staging.pageKey]);
  });
});

describe('groups', () => {
  it('groups by origin with counts, newest origin first', () => {
    const g = groupByOrigin(pages);
    expect(g.map((x) => x.host)).toEqual(['localhost:3000', 'staging.acme.dev']);
    expect(g[0]!.count).toBe(3);
    expect(g[0]!.pages.map((p) => p.path)).toEqual(['/checkout', '/pricing']);
  });

  it('origin checkbox is tri-state and toggles all of its pages', () => {
    const [local] = groupByOrigin(pages);
    let checked: ReadonlySet<string> = new Set();
    expect(originCheckState(local!, checked)).toBe('none');
    checked = togglePage(checked, pricing.pageKey);
    expect(originCheckState(local!, checked)).toBe('some');
    checked = toggleOrigin(local!, checked); // some → all
    expect(originCheckState(local!, checked)).toBe('all');
    checked = toggleOrigin(local!, checked); // all → none
    expect(originCheckState(local!, checked)).toBe('none');
  });

  it('round-trips #page=<encoded pageKey>', () => {
    const key = 'localhost:3000/a b#/route?x=1';
    expect(pageFromHash(hashForPage(key))).toBe(key);
    expect(pageFromHash('#general')).toBeNull();
    expect(pageFromHash('')).toBeNull();
  });
});
