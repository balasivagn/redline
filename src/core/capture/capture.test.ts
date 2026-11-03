import { afterEach, describe, expect, it } from 'vitest';
import { domSnapshotSchema, frameworkInfoSchema } from '../schema';
import { captureDom, capturePage, describeElement, detectFramework } from './index';

const $ = (sel: string) => document.querySelector(sel)!;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('describeElement', () => {
  it('formats tag and up to 3 stable classes', () => {
    document.body.innerHTML = '<div class="card card--pro css-1x2y3z hover a b"></div>';
    expect(describeElement($('div'))).toBe('div.card.card--pro.a');
  });
  it('uses #id when stable, ignores generated ids', () => {
    document.body.innerHTML = '<section id="pricing" class="x"></section><p id=":r4:" class="y"></p>';
    expect(describeElement($('section'))).toBe('section#pricing');
    expect(describeElement($('p'))).toBe('p.y');
  });
});

describe('captureDom', () => {
  it('captures facts and validates against the schema', () => {
    document.body.innerHTML = `<main><section class="pricing"><div class="card card--pro" id="pro" role="group" aria-label="Pro plan" data-testid="pro-card" style="display:flex;padding:8px;opacity:0.5">
      Pro   <b>$29/mo</b>
      Choose</div></section></main>`;
    const el = $('.card');
    el.getBoundingClientRect = () => ({ x: 5, y: 6, width: 7, height: 8, left: 5, top: 6, right: 12, bottom: 14, toJSON() {} }) as DOMRect;
    const snap = captureDom(el);
    expect(domSnapshotSchema.safeParse(snap).success).toBe(true);
    expect(snap).toMatchObject({
      tag: 'div',
      id: 'pro',
      classes: ['card', 'card--pro'],
      role: 'group',
      ariaLabel: 'Pro plan',
      testId: 'pro-card',
      text: 'Pro $29/mo Choose',
      rect: { x: 5, y: 6, width: 7, height: 8 },
      ancestors: ['section.pricing', 'main'],
    });
    expect(snap.styles.display).toBe('flex');
    expect(snap.styles.opacity).toBe('0.5');
    expect(snap.styles).not.toHaveProperty('position');
    expect(snap.styles).not.toHaveProperty('z-index');
  });

  it('drops zero-width borders but keeps real ones', () => {
    document.body.innerHTML = `<div id="a" style="border:0px solid rgb(223, 222, 227)"></div><div id="b" style="border:1px solid rgb(1, 2, 3)"></div>`;
    expect(captureDom($('#a')).styles).not.toHaveProperty('border');
    expect(captureDom($('#b')).styles.border).toMatch(/^1px solid/);
  });

  it('truncates text to 200 and outerHTML to 2048 chars', () => {
    document.body.innerHTML = `<div class="big">${'word '.repeat(2000)}</div>`;
    const snap = captureDom($('.big'));
    expect(snap.text.length).toBe(200);
    expect(snap.text.endsWith('…')).toBe(true);
    expect(snap.outerHTML.length).toBe(2048);
    expect(snap.outerHTML.endsWith('…')).toBe(true);
  });

  it('does not touch short content and caps ancestors at 6', () => {
    document.body.innerHTML = '<div class="l1"><div class="l2"><div class="l3"><div class="l4"><div class="l5"><div class="l6"><div class="l7"><i>x</i></div></div></div></div></div></div></div>';
    const snap = captureDom($('i'));
    expect(snap.outerHTML).toBe('<i>x</i>');
    expect(snap.text).toBe('x');
    expect(snap.ancestors).toEqual(['div.l7', 'div.l6', 'div.l5', 'div.l4', 'div.l3', 'div.l2']);
  });
});

describe('capturePage', () => {
  it('collects page facts', () => {
    document.title = 'Pricing — Acme';
    const p = capturePage();
    expect(p.title).toBe('Pricing — Acme');
    expect(p.viewport.dpr).toBeGreaterThan(0);
    expect(typeof p.userAgent).toBe('string');
  });
});

describe('detectFramework', () => {
  it('resolves undefined after the timeout when no probe answers, and cleans the attribute', async () => {
    document.body.innerHTML = '<div class="x"></div>';
    const el = $('.x');
    const started = Date.now();
    const info = await detectFramework(el);
    expect(info).toBeUndefined();
    expect(Date.now() - started).toBeGreaterThanOrEqual(120);
    expect(el.hasAttribute('data-redline-probe')).toBe(false);
  });

  it('round-trips through the event bridge', async () => {
    document.body.innerHTML = '<div class="x"></div>';
    const el = $('.x');
    const onReq = (e: Event) => {
      const id = (e as CustomEvent).detail as string;
      expect(document.querySelector(`[data-redline-probe="${id}"]`)).toBe(el);
      window.dispatchEvent(
        new CustomEvent('redline:probe-result', {
          detail: JSON.stringify({ id, info: { name: 'react', component: 'Card', componentStack: ['Card'] } }),
        }),
      );
    };
    window.addEventListener('redline:probe', onReq);
    try {
      const info = await detectFramework(el);
      expect(frameworkInfoSchema.parse(info)).toEqual({ name: 'react', component: 'Card', componentStack: ['Card'] });
      expect(el.hasAttribute('data-redline-probe')).toBe(false);
    } finally {
      window.removeEventListener('redline:probe', onReq);
    }
  });

  it('ignores results for other request ids', async () => {
    document.body.innerHTML = '<div class="x"></div>';
    const onReq = () => {
      window.dispatchEvent(new CustomEvent('redline:probe-result', { detail: JSON.stringify({ id: 'other', info: { name: 'vue' } }) }));
    };
    window.addEventListener('redline:probe', onReq);
    try {
      expect(await detectFramework($('.x'))).toBeUndefined();
    } finally {
      window.removeEventListener('redline:probe', onReq);
    }
  });
});
