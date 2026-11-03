import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { migrateAnnotation } from '../schema';
import type { Annotation } from '../schema';
import { makeAnnotation } from '../storage/test-helpers';
import { buildBundle, toExportDocument, toMarkdown } from './index';
import { colorToHex, styleSummary } from './markdown';

const now = new Date(2026, 10, 3, 9, 14);

const loginStyles = {
  display: 'block',
  border: '0px solid rgb(223, 222, 227)',
  color: 'rgb(0, 0, 0)',
  'background-color': 'rgba(0, 0, 0, 0)',
  'font-family': 'Syne, sans-serif',
  'font-size': '36px',
  'font-weight': '600',
  'line-height': '45px',
};

const pin = (): Annotation => {
  const base = makeAnnotation();
  return makeAnnotation({
    id: 'ann_x',
    number: 1,
    comment: { text: 'Make the title bigger,\nand align it left.', source: 'typed' },
    dom: {
      ...base.dom,
      tag: 'h2',
      classes: ['font-syne', 'text-[2.25rem]', 'font-semibold', 'md:text-4xl', 'leading-tight'],
      text: 'Login',
      outerHTML: '<h2 class="font-syne">Login</h2>',
      rect: { x: 0, y: 0, width: 400, height: 45 },
      styles: loginStyles,
      framework: {
        name: 'react',
        component: 'Text',
        componentStack: ['Text', 'AuthLayout', 'LoginPage'],
        source: { file: 'packages/ui/src/primitives/text/text.tsx', line: 73, column: 28, raw: 'http://localhost:5173/@fs/app/packages/ui/src/primitives/text/text.tsx?t=1:73:28' },
        usedAt: { file: 'packages/web/src/auth/AuthLayout.tsx', line: 41, column: 9 },
        frames: [
          { component: 'Text', usedAt: { file: 'packages/web/src/auth/AuthLayout.tsx', line: 41 } },
          { component: 'Suspense', library: true },
        ],
      },
    },
    screenshot: { shotId: 'shot_1', width: 100, height: 50 },
  });
};

describe('toMarkdown', () => {
  it('renders a single page (v2 compact item)', () => {
    const md = toMarkdown([pin()], { now });
    expect(md).toMatchInlineSnapshot(`
      "# Redline review — localhost:3000/pricing

      > Review comments to implement. Each comment says what to change and where: selector, visible text, component and source file when known.

      Page: "Pricing — Acme" · 1440×900 @2x · 2026-11-03 09:14

      ## 1. "Login" heading: <Text> in AuthLayout
      Make the title bigger,
      and align it left.

      - where: LoginPage › AuthLayout › Text
      - edit at: packages/web/src/auth/AuthLayout.tsx:41  (renders packages/ui/src/primitives/text/text.tsx:73)
      - element: h2 · \`h2.font-syne.font-semibold.leading-tight\`
      - style: Syne 36/45 · 600 · #000000 · 400×45
      - screenshot: shots/1-ann_x.png (in the exported .zip)

      \`\`\`html
      <h2 class="font-syne">Login</h2>
      \`\`\`
      "
    `);
  });

  it('uses the absolute screenshot path when the helper wrote one', () => {
    const a = pin();
    const md = toMarkdown([{ ...a, screenshot: { ...a.screenshot!, path: '/Users/me/.redline/shots/1-ann_x.png' } }], { now });
    expect(md).toContain('- screenshot: /Users/me/.redline/shots/1-ann_x.png\n');
    expect(md).not.toContain('.zip');
  });

  it('shows only "source:" when the call site is unknown, plus the selector', () => {
    const a = pin();
    const { usedAt: _u, ...fw } = a.dom.framework!;
    void _u;
    const md = toMarkdown([{ ...a, dom: { ...a.dom, framework: fw } }], { now });
    expect(md).toContain('- source: packages/ui/src/primitives/text/text.tsx:73\n');
    expect(md).not.toContain('edit at');
  });

  it('does not repeat the location when usedAt and source are the same', () => {
    const a = pin();
    const loc = { file: 'src/Page.tsx', line: 9 };
    const md = toMarkdown([{ ...a, dom: { ...a.dom, framework: { ...a.dom.framework!, usedAt: loc, source: { ...loc, column: 4 } } } }], { now });
    expect(md).toContain('- edit at: src/Page.tsx:9\n');
    expect(md).not.toContain('renders');
  });

  it('no framework: label from text, selector kept, no where/edit lines', () => {
    const base = makeAnnotation({ number: 2 });
    const md = toMarkdown([{ ...base, dom: { ...base.dom, tag: 'button', classes: ['btn', 'w-[12px]', 'hover:bg-red'], text: 'Choose the professional plan with unlimited seats' } }], { now });
    expect(md).toContain('## 2. "Choose the professional plan with unlim…" button\n');
    expect(md).toContain('- element: button · `button.btn`');
    expect(md).toContain('- selector: `main > section.pricing > div.card.card--pro`');
    expect(md).not.toContain('- where');
    expect(md).not.toContain('edit at');
    expect(md).toContain('- style: 320×240');
  });

  it('no text: falls back to the descriptor without arbitrary-value classes', () => {
    const base = makeAnnotation({ number: 3 });
    const md = toMarkdown([{ ...base, dom: { ...base.dom, tag: 'div', classes: ['card', 'p-[3px]', 'sm:flex', 'shadow'], text: '' } }], { now });
    expect(md).toContain('## 3. div.card.shadow\n');
  });

  it('role words for tags and aria roles', () => {
    const base = makeAnnotation({ number: 1 });
    const head = (dom: Partial<Annotation['dom']>) => toMarkdown([{ ...base, dom: { ...base.dom, text: 'Hi', ...dom } }], { now }).split('\n').find((l) => l.startsWith('## '));
    expect(head({ tag: 'a' })).toBe('## 1. "Hi" link');
    expect(head({ tag: 'img', text: '' , ariaLabel: 'Logo' })).toBe('## 1. "Logo" image');
    expect(head({ tag: 'div', role: 'button' })).toBe('## 1. "Hi" button');
    expect(head({ tag: 'ul' })).toBe('## 1. "Hi" list');
    expect(head({ tag: 'section' })).toBe('## 1. "Hi" section');
    expect(head({ tag: 'div' })).toBe('## 1. "Hi" element');
  });

  it('omits the html fence when disabled or longer than 400 chars; detailed always includes it', () => {
    const a = pin();
    expect(toMarkdown([a], { now, includeDomDetails: false })).not.toContain('```html');
    const long = { ...a, dom: { ...a.dom, outerHTML: `<h2>${'x'.repeat(500)}</h2>` } };
    expect(toMarkdown([long], { now })).not.toContain('```html');
    const detailed = toMarkdown([long], { now, detail: 'detailed' });
    expect(detailed).toContain('```html');
    expect(detailed).toContain('x'.repeat(500));
  });

  it('detailed mode adds selector, text, full styles and keeps the compact lines', () => {
    const md = toMarkdown([pin()], { now, detail: 'detailed' });
    expect(md).toContain('- where: LoginPage › AuthLayout › Text');
    expect(md).toContain('- selector: `main > section.pricing > div.card.card--pro`');
    expect(md).toContain('- text: "Login"');
    expect(md).toContain('- styles: `display: block; border: 0px solid rgb(223, 222, 227); color: rgb(0, 0, 0)');
    expect(md).toContain('font-family: Syne, sans-serif');
  });

  it('style summary: hex colours, background, non-zero border, skips defaults', () => {
    const a = pin();
    const styles = { 'font-family': '"Inter Var", system-ui', 'font-size': '14px', 'line-height': 'normal', 'font-weight': '400', color: 'rgb(255, 0, 128)', 'background-color': 'rgba(10, 20, 30, 0.5)', border: '1px solid rgb(0, 0, 0)' };
    expect(styleSummary({ ...a, dom: { ...a.dom, styles } })).toBe('Inter Var 14 · #ff0080 · bg #0a141e80 · border 1px #000000 · 400×45');
    expect(colorToHex('rgba(0, 0, 0, 0)')).toBeUndefined();
    expect(colorToHex('rgb(255 255 255)')).toBe('#ffffff');
    expect(colorToHex('#abc')).toBe('#aabbcc');
    expect(styleSummary({ ...a, dom: { ...a.dom, styles: {} } })).toBe('400×45');
  });

  it('omits the html fence when disabled', () => {
    const md = toMarkdown([pin()], { now, includeDomDetails: false });
    expect(md).not.toContain('```html');
    expect(md).toContain('- element:');
  });

  it('renders area items with size and the page url when it has a query string', () => {
    const base = makeAnnotation({ id: 'ann_a', number: 5 });
    const area: Annotation = {
      ...base,
      page: { ...base.page, url: 'http://localhost:3000/pricing?plan=pro' },
      anchor: { ...base.anchor, kind: 'area', areaRatio: { x: 0, y: 0, width: 0.5, height: 0.5 }, pageRect: { x: 0, y: 0, width: 400, height: 300 } },
    };
    const md = toMarkdown([area], { now });
    expect(md).toContain('## 5. area in div.card.card--pro (400×300)');
    expect(md).toContain('- url: http://localhost:3000/pricing?plan=pro');
    expect(md).not.toContain('- screenshot');
  });

  it('area size falls back to areaRatio × element box', () => {
    const base = makeAnnotation({ number: 1 });
    const area: Annotation = { ...base, anchor: { ...base.anchor, kind: 'area', areaRatio: { x: 0, y: 0, width: 0.5, height: 0.5 } } };
    expect(toMarkdown([area], { now })).toContain('area in div.card.card--pro (160×120)');
  });

  it('groups several pages in order of first appearance, then number', () => {
    const list = [
      makeAnnotation({ id: 'c2', number: 2, pagePath: '/checkout', comment: { text: 'c two', source: 'typed' } }),
      makeAnnotation({ id: 'p3', number: 3, comment: { text: 'p three', source: 'typed' } }),
      makeAnnotation({ id: 'c1', number: 1, pagePath: '/checkout', comment: { text: 'c one', source: 'typed' } }),
      makeAnnotation({ id: 'p1', number: 1, comment: { text: 'p one', source: 'typed' } }),
    ];
    const md = toMarkdown(list, { now, includeDomDetails: false });
    expect(md.split('\n')[0]).toBe('# Redline review — 4 comments on 2 pages');
    const order = [...md.matchAll(/^(##+) (.*)$/gm)].map((m) => `${m[1]} ${m[2]!.split('  ')[0]}`);
    expect(order).toEqual([
      '## localhost:3000/checkout',
      '### 1. "Pro $29/mo Choose" element',
      '### 2. "Pro $29/mo Choose" element',
      '## localhost:3000/pricing',
      '### 1. "Pro $29/mo Choose" element',
      '### 3. "Pro $29/mo Choose" element',
    ]);
    expect(md.indexOf('c one')).toBeLessThan(md.indexOf('c two'));
    expect(toMarkdown(list, { now, includeDomDetails: false })).toBe(md);
  });

  it('keeps comment lines starting with # from becoming headings', () => {
    const md = toMarkdown([makeAnnotation({ number: 1, comment: { text: '# Big\n  ## also\nnot # here', source: 'typed' } })], { now });
    expect(md).toContain('\\# Big\n  \\## also\nnot # here');
    expect(md.match(/^#+ /gm)).toEqual(['# ', '## ']);
  });

  it('uses a longer fence when the html contains backticks', () => {
    const a = makeAnnotation({ number: 1 });
    const md = toMarkdown([{ ...a, dom: { ...a.dom, outerHTML: '<code>```x```</code>' } }], { now });
    expect(md).toContain('````html\n<code>```x```</code>\n````');
  });
});

describe('toExportDocument', () => {
  it('groups by page with exportedAt from opts.now', () => {
    const doc = toExportDocument([makeAnnotation({ id: 'a', number: 2 }), makeAnnotation({ id: 'b', number: 1 }), makeAnnotation({ id: 'c', number: 1, pagePath: '/x' })], {
      now: new Date('2026-11-03T01:00:00.000Z'),
      toolVersion: '9.9.9',
    });
    expect(doc.schema).toBe('redline/export/v1');
    expect(doc.exportedAt).toBe('2026-11-03T01:00:00.000Z');
    expect(doc.tool).toEqual({ name: 'redline', version: '9.9.9' });
    expect(doc.pages.map((p) => [p.pageKey, p.annotations.map((a) => a.id)])).toEqual([
      ['http://localhost:3000/pricing', ['b', 'a']],
      ['http://localhost:3000/x', ['c']],
    ]);
    expect(doc.pages[0]).toMatchObject({ url: 'http://localhost:3000/pricing', title: 'Pricing — Acme' });
  });
});

describe('buildBundle', () => {
  it('zips review.md, annotations.json and available screenshots; notes missing ones', async () => {
    const withShot = pin();
    const missing = { ...makeAnnotation({ id: 'ann_m', number: 5 }), screenshot: { shotId: 'shot_gone', width: 1, height: 1 } };
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10]);
    const zip = await buildBundle(
      [withShot, missing],
      async (id) => (id === 'shot_1' ? new Blob([bytes], { type: 'image/png' }) : undefined),
      { now, toolVersion: '1.2.3' },
    );
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(['annotations.json', 'review.md', 'shots/1-ann_x.png']);
    expect([...files['shots/1-ann_x.png']!]).toEqual([...bytes]);

    const md = strFromU8(files['review.md']!);
    expect(md).toContain('- screenshot: shots/1-ann_x.png');
    expect(md).toContain('- screenshot: not available (shots/5-ann_m.png)');

    const json = JSON.parse(strFromU8(files['annotations.json']!));
    expect(json.tool.version).toBe('1.2.3');
    expect(json.pages[0].annotations.map((a: Annotation) => migrateAnnotation(a).id)).toEqual(['ann_x', 'ann_m']);
  });
});
