/** Test-only helpers: an in-memory chrome.storage.StorageArea and an annotation factory. */
import { SCHEMA } from '../schema';
import type { Annotation } from '../schema';

type Items = Record<string, unknown>;

export function createFakeStorageArea(initial: Items = {}): chrome.storage.StorageArea & { dump(): Items } {
  const data = new Map<string, unknown>(Object.entries(initial));
  const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

  const area = {
    async get(keys?: string | string[] | Items | null): Promise<Items> {
      await Promise.resolve();
      const out: Items = {};
      if (keys === null || keys === undefined) {
        for (const [k, v] of data) out[k] = clone(v);
      } else if (typeof keys === 'string') {
        if (data.has(keys)) out[keys] = clone(data.get(keys));
      } else if (Array.isArray(keys)) {
        for (const k of keys) if (data.has(k)) out[k] = clone(data.get(k));
      } else {
        for (const [k, fallback] of Object.entries(keys)) out[k] = data.has(k) ? clone(data.get(k)) : fallback;
      }
      return out;
    },
    async set(items: Items): Promise<void> {
      await Promise.resolve();
      for (const [k, v] of Object.entries(items)) data.set(k, clone(v));
    },
    async remove(keys: string | string[]): Promise<void> {
      await Promise.resolve();
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    },
    async clear(): Promise<void> {
      await Promise.resolve();
      data.clear();
    },
    dump(): Items {
      return Object.fromEntries([...data].map(([k, v]) => [k, clone(v)]));
    },
  };
  return area as unknown as chrome.storage.StorageArea & { dump(): Items };
}

export function makeAnnotation(overrides: Partial<Annotation> & { pagePath?: string; origin?: string } = {}): Annotation {
  const { pagePath = '/pricing', origin = 'http://localhost:3000', ...rest } = overrides;
  const pageKey = rest.pageKey ?? `${origin}${pagePath}`;
  return {
    schema: SCHEMA,
    id: `ann_${Math.random().toString(36).slice(2, 10)}`,
    number: 0,
    pageKey,
    createdAt: '2026-11-03T01:00:00.000Z',
    updatedAt: '2026-11-03T01:00:00.000Z',
    page: {
      url: `${origin}${pagePath}`,
      origin,
      path: pagePath,
      title: 'Pricing — Acme',
      viewport: { width: 1440, height: 900, dpr: 2 },
      scroll: { x: 0, y: 0 },
      userAgent: 'test',
    },
    comment: { text: 'The price should be bigger.', source: 'typed' },
    tags: [],
    meta: {},
    anchor: {
      kind: 'pin',
      selector: 'main > section.pricing > div.card.card--pro',
      xpath: '/html/body/main/section/div[2]',
      offset: { xRatio: 0.5, yRatio: 0.5 },
      pagePoint: { x: 100, y: 200 },
    },
    dom: {
      tag: 'div',
      classes: ['card', 'card--pro'],
      text: 'Pro $29/mo Choose',
      outerHTML: '<div class="card card--pro">Pro</div>',
      rect: { x: 10, y: 20, width: 320, height: 240 },
      styles: { display: 'flex', padding: '16px' },
      ancestors: ['section.pricing', 'main'],
    },
    ...rest,
  };
}
