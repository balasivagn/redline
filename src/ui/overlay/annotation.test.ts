import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Anchor, DomSnapshot, FrameworkInfo, PageInfo } from '../../core/schema';

vi.mock('../../core/capture', () => ({
  captureDom: vi.fn(),
  capturePage: vi.fn(),
  detectFramework: vi.fn(),
  describeElement: vi.fn(() => 'div.card'),
}));
vi.mock('../../core/page-key', () => ({ pageKeyFor: vi.fn((u: string) => `key:${u}`) }));
vi.mock('../../core/rpc', () => ({ rpc: vi.fn(), onRedlineEvent: vi.fn() }));

import { captureDom, capturePage, detectFramework } from '../../core/capture';
import { rpc } from '../../core/rpc';
import { buildAnnotation, captureShot, createAnnotation, describeDom, withEditedText, withNewAnchor } from './annotation';

const page: PageInfo = {
  url: 'http://localhost/pricing',
  origin: 'http://localhost',
  path: '/pricing',
  title: 'Pricing',
  viewport: { width: 1000, height: 800, dpr: 2 },
  scroll: { x: 0, y: 0 },
  userAgent: 'test',
};
const dom: DomSnapshot = {
  tag: 'div',
  classes: ['card', 'card--pro'],
  text: 'Pro',
  outerHTML: '<div class="card"></div>',
  rect: { x: 10, y: 20, width: 100, height: 50 },
  styles: {},
  ancestors: [],
};
const anchor: Anchor = {
  kind: 'pin',
  selector: 'main > div.card',
  xpath: '/html/body/main/div',
  offset: { xRatio: 0.5, yRatio: 0.5 },
  pagePoint: { x: 60, y: 45 },
};
const fw: FrameworkInfo = { name: 'react', component: 'PricingCard', componentStack: ['PricingCard'] };

beforeEach(() => {
  vi.mocked(captureDom).mockReturnValue(dom);
  vi.mocked(capturePage).mockReturnValue(page);
  vi.mocked(detectFramework).mockResolvedValue(fw);
  vi.mocked(rpc).mockReset();
});

describe('buildAnnotation', () => {
  it('assembles a redline/v1 annotation with number 0 and framework merged into dom', () => {
    const a = buildAnnotation({ id: 'ann_1', now: '2026-11-03T00:00:00Z', pageKey: 'k', page, anchor, dom, framework: fw, text: 'Bigger', source: 'typed' });
    expect(a).toMatchObject({
      schema: 'redline/v1',
      id: 'ann_1',
      number: 0,
      pageKey: 'k',
      comment: { text: 'Bigger', source: 'typed' },
      tags: [],
      meta: {},
    });
    expect(a.dom.framework).toEqual(fw);
    expect(a.screenshot).toBeUndefined();
    expect('screenshot' in a).toBe(false);
  });

  it('attaches a screenshot when given', () => {
    const a = buildAnnotation({ id: 'x', now: 'n', pageKey: 'k', page, anchor, dom, text: 't', source: 'voice', screenshot: { shotId: 's1', width: 10, height: 5 } });
    expect(a.screenshot).toEqual({ shotId: 's1', width: 10, height: 5 });
    expect(a.comment.source).toBe('voice');
  });
});

describe('createAnnotation (mocked capture)', () => {
  it('captures page, dom and framework for the element', async () => {
    const el = document.createElement('div');
    const a = await createAnnotation({ element: el, anchor, text: 'Hello', source: 'mixed' });
    expect(captureDom).toHaveBeenCalledWith(el);
    expect(a.id).toMatch(/^ann_/);
    expect(a.pageKey).toBe(`key:${location.href}`);
    expect(a.page).toBe(page);
    expect(a.dom.framework?.component).toBe('PricingCard');
    expect(a.comment.source).toBe('mixed');
    expect(a.createdAt).toBe(a.updatedAt);
  });

  it('reuses an already-detected framework promise instead of asking again', async () => {
    const el = document.createElement('div');
    const a = await createAnnotation({ element: el, anchor, text: 't', source: 'typed', dom, framework: Promise.resolve(undefined) });
    expect(detectFramework).not.toHaveBeenCalled();
    expect(captureDom).not.toHaveBeenCalled();
    expect(a.dom.framework).toBeUndefined();
  });
});

describe('editing helpers', () => {
  const base = buildAnnotation({ id: 'a', now: '2026-01-01T00:00:00Z', pageKey: 'k', page, anchor, dom, text: 'old', source: 'typed' });

  it('edit changes text only and keeps anchor/dom/number', () => {
    const next = withEditedText(base, 'new text', [], '2026-02-02T00:00:00Z');
    expect(next.comment).toEqual({ text: 'new text', source: 'typed' });
    expect(next.anchor).toBe(base.anchor);
    expect(next.dom).toBe(base.dom);
    expect(next.number).toBe(base.number);
    expect(next.createdAt).toBe(base.createdAt);
    expect(next.updatedAt).toBe('2026-02-02T00:00:00Z');
  });

  it('marks edited voice comments as mixed and unchanged text keeps its source', () => {
    const voiceAnn = { ...base, comment: { text: 'spoken', source: 'voice' as const } };
    expect(withEditedText(voiceAnn, 'spoken', []).comment.source).toBe('voice');
    expect(withEditedText(voiceAnn, 'spoken!', []).comment.source).toBe('mixed');
    expect(withEditedText(base, 'old + dictated', ['dictated']).comment.source).toBe('mixed');
  });

  it('re-pin replaces anchor and dom but keeps id, number and text', () => {
    const newAnchor = { ...anchor, selector: 'footer' };
    const next = withNewAnchor(base, { anchor: newAnchor, dom: { ...dom, tag: 'footer' }, framework: fw, page });
    expect(next.id).toBe(base.id);
    expect(next.comment).toEqual(base.comment);
    expect(next.anchor.selector).toBe('footer');
    expect(next.dom.tag).toBe('footer');
    expect(next.dom.framework).toEqual(fw);
  });

  it('describes a stored dom', () => {
    expect(describeDom({ ...dom, id: 'x', classes: ['a', 'b', 'c', 'd'] })).toBe('div#x.a.b.c');
  });
});

describe('captureShot', () => {
  it('hides the host while capturing, sends the clamped rect and restores visibility', async () => {
    const host = document.createElement('div');
    host.style.visibility = 'visible';
    let during = '';
    vi.mocked(rpc).mockImplementation(async () => {
      during = host.style.visibility;
      return { shotId: 's9', width: 200, height: 100 };
    });
    const shot = await captureShot(host, { x: -20, y: 10, width: 120, height: 50 }, { width: 1000, height: 800 });
    expect(during).toBe('hidden');
    expect(host.style.visibility).toBe('visible');
    expect(rpc).toHaveBeenCalledWith('shot/capture', { rect: { x: 0, y: 10, width: 100, height: 50 }, dpr: window.devicePixelRatio || 1 });
    expect(shot).toEqual({ shotId: 's9', width: 200, height: 100 });
  });

  it('also hides a shadow host whose :host styles are !important, and cleans up', async () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    let hidden = false;
    vi.mocked(rpc).mockImplementation(async () => {
      hidden = Array.from(shadow.querySelectorAll('style')).some((s) => /:host\s*{\s*opacity:\s*0\s*!important/.test(s.textContent ?? ''));
      return { shotId: 's9', width: 200, height: 100, path: '/x/y.png' };
    });
    const shot = await captureShot(host, { x: 0, y: 0, width: 10, height: 10 }, { width: 1000, height: 800 });
    expect(hidden).toBe(true);
    expect(shadow.querySelector('style')).toBeNull();
    expect(shot).toEqual({ shotId: 's9', width: 200, height: 100, path: '/x/y.png' });
  });

  it('skips off-screen targets and restores visibility on failure', async () => {
    const host = document.createElement('div');
    expect(await captureShot(host, { x: 5000, y: 0, width: 10, height: 10 }, { width: 1000, height: 800 })).toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
    vi.mocked(rpc).mockRejectedValue(new Error('nope'));
    await expect(captureShot(host, { x: 0, y: 0, width: 10, height: 10 }, { width: 1000, height: 800 })).rejects.toThrow('nope');
    expect(host.style.visibility).toBe('');
  });
});

describe('withTimeout', () => {
  it('resolves when the promise settles in time', async () => {
    const { withTimeout } = await import('./annotation');
    await expect(withTimeout(Promise.resolve(7), 50, 'slow')).resolves.toBe(7);
  });
  it('rejects with the message when the promise hangs', async () => {
    const { withTimeout } = await import('./annotation');
    await expect(withTimeout(new Promise(() => {}), 20, 'the screenshot took too long')).rejects.toThrow('the screenshot took too long');
  });
});
