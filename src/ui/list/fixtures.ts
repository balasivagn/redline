import type { Annotation } from '../../core/schema';

/** Test fixture factory (not imported by app code). */
export function makeAnnotation(over: Partial<Annotation> & { id: string; number: number }): Annotation {
  const { id, number, ...rest } = over;
  return {
    schema: 'redline/v1',
    id,
    number,
    pageKey: 'localhost:3000/pricing',
    createdAt: '2026-11-03T09:00:00.000Z',
    updatedAt: '2026-11-03T09:00:00.000Z',
    page: {
      url: 'http://localhost:3000/pricing',
      origin: 'http://localhost:3000',
      path: '/pricing',
      title: 'Pricing — Acme',
      viewport: { width: 1440, height: 900, dpr: 2 },
      scroll: { x: 0, y: 0 },
      userAgent: 'test',
    },
    comment: { text: `Comment ${number}`, source: 'typed' },
    tags: [],
    meta: {},
    anchor: {
      kind: 'pin',
      selector: `main > div.card.card--pro`,
      xpath: '/html/body/main/div',
      offset: { xRatio: 0.5, yRatio: 0.5 },
      pagePoint: { x: 10, y: 10 },
    },
    dom: {
      tag: 'div',
      classes: ['card', 'card--pro', 'extra'],
      text: 'Pro $29/mo',
      outerHTML: '<div class="card card--pro"></div>',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      styles: {},
      ancestors: [],
    },
    ...rest,
  };
}
