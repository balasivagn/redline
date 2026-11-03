import { beforeEach, describe, expect, it } from 'vitest';
import { buildAnchor, resolveAnchor, uniqueSelector } from './index';
import { isStableClass, isStableId } from './stable';
import { resolveXpath, xpathFor } from './xpath';

function html(markup: string) {
  document.body.innerHTML = markup;
}
const $ = (sel: string) => document.querySelector(sel)!;

function setBox(el: Element, x: number, y: number, width: number, height: number) {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON() {} }) as DOMRect;
}

beforeEach(() => {
  document.body.innerHTML = '';
  (document as { elementsFromPoint?: unknown }).elementsFromPoint = undefined;
  window.scrollTo?.(0, 0);
});

describe('stability heuristics', () => {
  it('rejects generated ids', () => {
    for (const id of [':r1:', '«r2»', 'radix-:r5:', 'ember1234', 'a1b2c3d4e5f6', 'item-1234567', 'x-9f8e7d6c5b4a', '123e4567-e89b-12d3-a456-426614174000'])
      expect(isStableId(id), id).toBe(false);
    for (const id of ['hero', 'main-nav', 'pricing_table', 'step2']) expect(isStableId(id), id).toBe(true);
  });
  it('rejects generated and state classes', () => {
    for (const c of ['css-1x2y3z', 'sc-aBcDeF', 'jsx-123456', '_a1b2c', 'Button_root__a1b2c', 'w-[37px]', 'md:flex', 'hover', 'active', 'is-open', 'has-error', 'svelte-xyz123', 'w-1/2'])
      expect(isStableClass(c), c).toBe(false);
    for (const c of ['card', 'card--pro', 'pricing-grid', 'btn-primary', 'flex', 'p-4']) expect(isStableClass(c), c).toBe(true);
  });
});

describe('uniqueSelector', () => {
  it('prefers a unique stable id', () => {
    html('<main><div id="hero" class="a"></div><div class="a"></div></main>');
    expect(uniqueSelector($('#hero'))).toBe('#hero');
  });
  it('skips auto-generated ids', () => {
    html('<main><button id=":r1:" class="cta">A</button><button id=":r2:" class="cta">B</button></main>');
    const el = document.getElementById(':r2:')!;
    const sel = uniqueSelector(el);
    expect(sel).not.toContain(':r2:');
    expect(document.querySelectorAll(sel)).toHaveLength(1);
    expect(document.querySelector(sel)).toBe(el);
  });
  it('uses data-testid', () => {
    html('<div><span data-testid="price">$9</span><span>x</span></div>');
    expect(uniqueSelector($('[data-testid]'))).toBe('[data-testid="price"]');
  });
  it('falls back to tag + stable classes and ignores generated ones', () => {
    html('<section class="pricing css-1x2y3z"><div class="card card--pro sc-abc123 hover w-[10px]">x</div><div class="card">y</div></section>');
    const el = $('.card--pro');
    const sel = uniqueSelector(el);
    expect(sel).toBe('div.card.card--pro');
    expect(sel).not.toMatch(/css-|sc-|hover|\[/);
  });
  it('adds :nth-of-type and ancestors when classes are not enough', () => {
    html('<ul class="list"><li><a>a</a></li><li><a>b</a></li><li><a>c</a></li></ul><ul class="other"><li><a>d</a></li></ul>');
    for (const a of Array.from(document.querySelectorAll('a'))) {
      const sel = uniqueSelector(a);
      expect(document.querySelectorAll(sel), sel).toHaveLength(1);
      expect(document.querySelector(sel)).toBe(a);
    }
    expect(uniqueSelector(document.querySelectorAll('li')[1]!)).toContain(':nth-of-type(2)');
  });
  it('is unique for every element of a messy tree and never mentions redline-ui', () => {
    html(`<header class="top"><nav><a href="#">1</a><a href="#">2</a></nav></header>
      <main><div class="row"><div class="col"><p>x</p><p>y</p></div><div class="col"><p>x</p></div></div></main>
      <redline-ui><div class="panel">ui</div></redline-ui>`);
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const sel = uniqueSelector(el);
      expect(document.querySelector(sel), sel).toBe(el);
      if (el.localName !== 'redline-ui') expect(sel).not.toContain('redline-ui');
    }
  });
  it('escapes odd characters', () => {
    html('<div id="a.b:c"></div><div data-testid=\'say "hi"\'></div>');
    for (const el of Array.from(document.body.children)) expect(document.querySelector(uniqueSelector(el))).toBe(el);
  });
});

describe('xpath', () => {
  it('round-trips', () => {
    html('<div><p>a</p><p>b</p><span>c</span></div>');
    for (const el of Array.from(document.querySelectorAll('*'))) {
      expect(resolveXpath(xpathFor(el), document)).toBe(el);
    }
    expect(xpathFor($('span'))).toBe('/html/body/div/span');
    expect(resolveXpath('/html/body/div/p[9]', document)).toBeNull();
  });
});

describe('buildAnchor / resolveAnchor', () => {
  it('pin: records ratios, textHint and page point, then resolves back', () => {
    html('<main><div class="card">Pro   plan\n $29/mo</div></main>');
    const card = $('.card');
    setBox(card, 100, 50, 200, 100);
    Object.defineProperty(window, 'scrollX', { value: 10, configurable: true });
    Object.defineProperty(window, 'scrollY', { value: 300, configurable: true });
    try {
      const { anchor, element } = buildAnchor({ kind: 'pin', element: card, clientPoint: { x: 150, y: 75 } });
      expect(element).toBe(card);
      expect(anchor.kind).toBe('pin');
      expect(anchor.offset).toEqual({ xRatio: 0.25, yRatio: 0.25 });
      expect(anchor.pagePoint).toEqual({ x: 160, y: 375 });
      expect(anchor.textHint).toBe('div|Pro plan $29/mo');
      expect(anchor.selector).toBe('div.card');
      expect(anchor.xpath).toBe('/html/body/main/div');

      setBox(card, 0, 0, 400, 40); // layout changed
      const r = resolveAnchor(anchor);
      expect(r.status).toBe('attached');
      if (r.status === 'attached') {
        expect(r.element).toBe(card);
        expect(r.clientPoint).toEqual({ x: 100, y: 10 });
      }
    } finally {
      Object.defineProperty(window, 'scrollX', { value: 0, configurable: true });
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    }
  });

  it('falls back to xpath when the selector breaks', () => {
    html('<main><div class="card">Pro</div></main>');
    const card = $('.card');
    setBox(card, 0, 0, 100, 100);
    const { anchor } = buildAnchor({ kind: 'pin', element: card, clientPoint: { x: 50, y: 50 } });
    card.className = 'tile'; // selector no longer matches, xpath still does
    const r = resolveAnchor(anchor);
    expect(r.status).toBe('attached');
    if (r.status === 'attached') expect(r.element).toBe(card);
  });

  it('falls back to textHint, then detached', () => {
    html('<main><div class="card">Pro plan</div><div class="card">Starter</div></main>');
    const card = $('.card');
    setBox(card, 20, 30, 100, 100);
    const { anchor } = buildAnchor({ kind: 'pin', element: card, clientPoint: { x: 70, y: 80 } });

    // Break selector AND xpath: wrap in a new container and rename class; reorder siblings.
    document.body.innerHTML = '<section><article class="x">Pro plan</article><div class="y">Pro plan</div></section>';
    const moved = document.querySelector('div.y')!;
    setBox(moved, 200, 200, 50, 50);
    const hinted = resolveAnchor(anchor);
    expect(hinted.status).toBe('attached');
    if (hinted.status === 'attached') {
      expect(hinted.element).toBe(moved);
      expect(hinted.clientPoint).toEqual({ x: 225, y: 225 });
    }

    document.body.innerHTML = '<section><div class="y">Something else</div></section>';
    const gone = resolveAnchor(anchor);
    expect(gone).toEqual({ status: 'detached', clientPoint: { x: 70, y: 80 } });
  });

  it('detached coordinates account for current scroll', () => {
    html('<div class="c">t</div>');
    setBox($('.c'), 0, 0, 10, 10);
    const { anchor } = buildAnchor({ kind: 'pin', element: $('.c'), clientPoint: { x: 5, y: 5 } });
    document.body.innerHTML = '';
    Object.defineProperty(window, 'scrollY', { value: 40, configurable: true });
    try {
      expect(resolveAnchor(anchor)).toEqual({ status: 'detached', clientPoint: { x: 5, y: -35 } });
    } finally {
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    }
  });

  it('area: picks the smallest container that fully contains the rect', () => {
    html(`<main class="page"><section class="grid"><div class="card a"><button class="btn">Go</button></div><div class="card b"></div></section></main>`);
    const [page, grid, a, b, btn] = ['.page', '.grid', '.a', '.b', '.btn'].map($);
    setBox(document.body, 0, 0, 1000, 800);
    setBox(page!, 0, 0, 1000, 800);
    setBox(grid!, 0, 100, 1000, 300);
    setBox(a!, 0, 100, 400, 300);
    setBox(b!, 500, 100, 400, 300);
    setBox(btn!, 10, 300, 80, 30);
    const redlineUi = document.createElement('redline-ui');
    document.body.append(redlineUi);

    // Stacking at the rect centre: Redline overlay on top, then the button chain, then html.
    (document as unknown as { elementsFromPoint: (x: number, y: number) => Element[] }).elementsFromPoint = () => [
      redlineUi, btn!, a!, grid!, page!, document.body, document.documentElement,
    ];

    // Rect inside card a but bigger than the button -> card a.
    const inA = buildAnchor({ kind: 'area', clientRect: { x: 20, y: 150, width: 200, height: 100 } });
    expect(inA.element).toBe(a);
    expect(inA.anchor.kind).toBe('area');
    expect(inA.anchor.areaRatio).toEqual({ x: 0.05, y: 50 / 300, width: 0.5, height: 100 / 300 });
    expect(inA.anchor.pageRect).toEqual({ x: 20, y: 150, width: 200, height: 100 });
    expect(inA.anchor.offset).toEqual({ xRatio: 0.05, yRatio: 50 / 300 });
    expect(inA.anchor.selector).toBe('div.card.a');

    // Rect spanning both cards -> grid.
    const span = buildAnchor({ kind: 'area', clientRect: { x: 300, y: 150, width: 400, height: 100 } });
    expect(span.element).toBe(grid);

    // Rect fully inside the button -> button.
    const tiny = buildAnchor({ kind: 'area', clientRect: { x: 20, y: 305, width: 20, height: 10 } });
    expect(tiny.element).toBe(btn);

    // Round trip: move/resize the anchor element, area scales with it.
    setBox(a!, 0, 0, 800, 600);
    const r = resolveAnchor(inA.anchor);
    expect(r.status).toBe('attached');
    if (r.status === 'attached') {
      expect(r.element).toBe(a);
      expect(r.clientRect).toEqual({ x: 40, y: 100, width: 400, height: 200 });
      expect(r.clientPoint).toEqual({ x: 40, y: 100 });
    }
  });

  it('area: never anchors to redline-ui or html, falls back to body', () => {
    html('<div class="small"></div>');
    setBox(document.body, 0, 0, 100, 100);
    setBox($('.small'), 0, 0, 10, 10);
    const ui = document.createElement('redline-ui');
    document.body.append(ui);
    setBox(ui, 0, 0, 1000, 1000);
    (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => [ui, document.documentElement];
    const res = buildAnchor({ kind: 'area', clientRect: { x: 0, y: 0, width: 500, height: 500 } });
    expect(res.element).toBe(document.body);
  });

  it('area detached resolves from pageRect', () => {
    html('<div class="small"></div>');
    setBox(document.body, 0, 0, 1000, 1000);
    const { anchor } = buildAnchor({ kind: 'area', clientRect: { x: 10, y: 20, width: 30, height: 40 } });
    document.documentElement.innerHTML = '<head></head><body></body>';
    const r = resolveAnchor(anchor);
    expect(r.status === 'attached' ? r.element.localName : r.status).toBe('body');
  });
});
