import { afterEach, describe, expect, it } from 'vitest';
import { isLibraryFrame, parseStackFrames, probeElement } from './probe-logic';
import { normalizeSourcePath } from './source-path';

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as { ng?: unknown }).ng;
});

function mount(html = '<main><div class="card"><button>Go</button></div></main>') {
  document.body.innerHTML = html;
  return document.querySelector('button') ?? document.body.firstElementChild!;
}

function PricingCard() {}
function PricingGrid() {}
function Page() {}
const Provider = { $$typeof: Symbol.for('react.provider'), _context: {} };
const Memo = { $$typeof: Symbol.for('react.memo'), type: Object.assign(function Inner() {}, { displayName: 'MemoizedBit' }) };
const Fwd = { $$typeof: Symbol.for('react.forward_ref'), render: function FancyButton() {} };

describe('probeElement: React', () => {
  it('React 18: reads component stack and _debugSource', () => {
    const el = mount();
    const page = { type: Page, return: null };
    const providerFiber = { type: Provider, return: page };
    const grid = { type: PricingGrid, return: providerFiber };
    const card = { type: PricingCard, return: grid };
    const host = { type: 'button', return: { type: 'div', return: card }, _debugSource: { fileName: '/Users/me/app/src/Pricing.tsx', lineNumber: 42, columnNumber: 7 } };
    (el as unknown as Record<string, unknown>)['__reactFiber$abc123'] = host;

    const info = probeElement(el)!;
    expect(info).toMatchObject({
      name: 'react',
      component: 'PricingCard',
      componentStack: ['PricingCard', 'PricingGrid', 'Page'],
      source: { file: 'src/Pricing.tsx', line: 42, column: 7, raw: '/Users/me/app/src/Pricing.tsx' },
    });
    expect(info.usedAt).toBeUndefined(); // no component fiber carries a call site
    expect(info.frames?.map((f) => f.component)).toEqual(['PricingCard', 'PricingGrid', 'Page']);
  });

  it('React 18: component call sites come from each fiber _debugSource; library frames are flagged and left out of the stack', () => {
    const el = mount();
    const at = (fileName: string, lineNumber: number) => ({ fileName, lineNumber, columnNumber: 3 });
    function Text() {}
    function AuthLayout() {}
    function LoginPage() {}
    function RenderedRoute() {}
    function Routes() {}
    const root = { type: Routes, return: null, _debugSource: at('/p/node_modules/react-router/dist/index.js', 10) };
    const route = { type: RenderedRoute, return: root, _debugSource: at('/p/node_modules/react-router/dist/index.js', 20) };
    const page = { type: LoginPage, return: route, _debugSource: at('/p/src/routes.tsx', 8) };
    const layout = { type: AuthLayout, return: page, _debugSource: at('http://localhost:5173/src/pages/LoginPage.tsx?t=9', 12) };
    const text = { type: Text, return: layout, _debugSource: at('http://localhost:5173/@fs/p/packages/web/src/auth/AuthLayout.tsx?t=9', 41) };
    const h2 = { type: 'h2', return: text, _debugSource: at('http://localhost:5173/@fs/p/packages/ui/src/text.tsx', 73) };
    (el as unknown as Record<string, unknown>)['__reactFiber$r18'] = h2;

    const info = probeElement(el)!;
    expect(info.componentStack).toEqual(['Text', 'AuthLayout', 'LoginPage']);
    expect(info.component).toBe('Text');
    expect(info.source).toMatchObject({ file: 'packages/ui/src/text.tsx', line: 73, column: 3 });
    expect(info.usedAt).toMatchObject({ file: 'packages/web/src/auth/AuthLayout.tsx', line: 41 });
    expect(info.frames).toEqual([
      { component: 'Text', usedAt: expect.objectContaining({ file: 'packages/web/src/auth/AuthLayout.tsx', line: 41 }) },
      { component: 'AuthLayout', usedAt: expect.objectContaining({ file: 'src/pages/LoginPage.tsx', line: 12 }) },
      { component: 'LoginPage', usedAt: expect.objectContaining({ file: 'src/routes.tsx', line: 8 }) },
      { component: 'RenderedRoute', library: true, usedAt: expect.objectContaining({ file: 'node_modules/react-router/dist/index.js' }) },
      { component: 'Routes', library: true, usedAt: expect.objectContaining({ file: 'node_modules/react-router/dist/index.js' }) },
    ]);
  });

  it('React 19: parses _debugStack skipping react internals and node_modules', () => {
    const el = mount();
    const stack = [
      'Error: react-stack-top-frame',
      '    at exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1a2b3c:250:25)',
      '    at chunk-ABCDEF12.js:44:10',
      '    at PricingCard (http://localhost:5173/src/components/Pricing.tsx?t=1730:42:7)',
      '    at renderWithHooks (http://localhost:5173/node_modules/react-dom/cjs/react-dom-client.development.js:100:1)',
    ].join('\n');
    const err = new Error('x');
    err.stack = stack;
    const card = { type: PricingCard, return: null };
    const host = { type: 'button', return: card, _debugStack: err };
    (el as unknown as Record<string, unknown>)['__reactFiber$xyz'] = host;
    const info = probeElement(el)!;
    expect(info.name).toBe('react');
    expect(info.component).toBe('PricingCard');
    expect(info.source).toMatchObject({ file: 'src/components/Pricing.tsx', line: 42, column: 7 });
  });

  it('React 19: call sites per component from _debugStack, with router/provider frames filtered', () => {
    const el = mount();
    const stackOf = (...frames: string[]) => {
      const e = new Error('x');
      e.stack = ['Error: react-stack-top-frame', '    at jsxDEV (http://h/node_modules/.vite/deps/react_jsx-dev-runtime.js:1:1)', ...frames.map((f) => `    at ${f}`)].join('\n');
      return e;
    };
    function Text() {}
    function AuthLayout() {}
    function LoginPage() {}
    function ThemeProvider() {}
    function Outlet() {}
    const theme = { type: ThemeProvider, return: null, _debugStack: stackOf('App (http://h/src/App.tsx?t=1:9:5)') };
    const outlet = { type: Outlet, return: theme, _debugStack: stackOf('RenderedRoute (http://h/node_modules/.vite/deps/react-router.js:5:5)') };
    const page = { type: LoginPage, return: outlet, _debugStack: stackOf('Routes (http://h/src/routes.tsx:3:3)') };
    const layout = { type: AuthLayout, return: page, _debugStack: stackOf('LoginPage (http://h/src/pages/LoginPage.tsx:12:10)') };
    const text = { type: Text, return: layout, _debugStack: stackOf('AuthLayout (http://h/@fs/p/packages/web/src/AuthLayout.tsx?t=2:41:9)') };
    const h2 = { type: 'h2', return: text, _debugStack: stackOf('Text (http://h/@fs/p/packages/ui/src/Text.tsx:5:7)', 'renderWithHooks (http://h/node_modules/react-dom/x.js:1:1)') };
    (el as unknown as Record<string, unknown>)['__reactFiber$r19'] = h2;

    const info = probeElement(el)!;
    expect(info.componentStack).toEqual(['Text', 'AuthLayout', 'LoginPage']);
    expect(info.source).toMatchObject({ file: 'packages/ui/src/Text.tsx', line: 5, column: 7 });
    expect(info.usedAt).toMatchObject({ file: 'packages/web/src/AuthLayout.tsx', line: 41, column: 9 });
    expect(info.frames?.map((f) => [f.component, f.library ?? false])).toEqual([
      ['Text', false],
      ['AuthLayout', false],
      ['LoginPage', false],
      ['Outlet', true],
      ['ThemeProvider', true],
    ]);
    expect(info.frames?.[3]?.usedAt).toBeUndefined();
  });

  it('caps componentStack at 6 app frames and frames at 12', () => {
    const el = mount();
    let fiber: unknown = null;
    const names = Array.from({ length: 20 }, (_, i) => `C${i}`);
    for (const n of names.reverse()) fiber = { type: Object.defineProperty(function () {}, 'name', { value: n }), return: fiber };
    (el as unknown as Record<string, unknown>)['__reactFiber$cap'] = { type: 'button', return: fiber };
    const info = probeElement(el)!;
    expect(info.componentStack).toEqual(['C0', 'C1', 'C2', 'C3', 'C4', 'C5']);
    expect(info.frames).toHaveLength(12);
  });

  it('unwraps memo/forwardRef, skips providers/host/fragments, caps the stack at 6, finds fiber on a parent', () => {
    const wrapper = mount('<div id="w"><span><i>x</i></span></div>');
    void wrapper;
    const inner = document.querySelector('i')!;
    let fiber: unknown = null;
    const types: unknown[] = [Page, Provider, Fwd, Memo, 'div', Symbol('fragment'), null, PricingGrid, function A() {}, function B() {}, function C() {}, function D() {}];
    for (const t of types) fiber = { type: t, return: fiber };
    (document.getElementById('w') as unknown as Record<string, unknown>)['__reactFiber$q'] = { type: 'div', return: fiber };
    const info = probeElement(inner)!;
    expect(info.componentStack).toEqual(['D', 'C', 'B', 'A', 'PricingGrid', 'MemoizedBit']);
    expect(info.componentStack).toHaveLength(6);
  });

  it('returns undefined for a plain element', () => {
    expect(probeElement(mount())).toBeUndefined();
  });
});

describe('probeElement: Vue', () => {
  it('Vue 3: component name, file and parent stack, found via parent element', () => {
    mount();
    const app = { type: { __name: 'App', __file: 'src/App.vue' }, parent: null };
    const card = { type: { name: 'PricingCard', __file: '/src/components/PricingCard.vue?t=1' }, parent: app };
    (document.querySelector('.card') as unknown as Record<string, unknown>).__vueParentComponent = card;
    expect(probeElement(document.querySelector('button')!)).toEqual({
      name: 'vue',
      component: 'PricingCard',
      componentStack: ['PricingCard', 'App'],
      source: { file: 'src/components/PricingCard.vue', raw: '/src/components/PricingCard.vue?t=1' },
    });
  });

  it('Vue 2: reads $options', () => {
    const el = mount();
    const root = { $options: { name: 'Root' }, $parent: null };
    (el as unknown as Record<string, unknown>).__vue__ = { $options: { _componentTag: 'pricing-card', __file: 'src/PricingCard.vue' }, $parent: root };
    expect(probeElement(el)).toMatchObject({ name: 'vue', component: 'pricing-card', componentStack: ['pricing-card', 'Root'], source: { file: 'src/PricingCard.vue' } });
    expect(probeElement(el)?.usedAt).toBeUndefined();
  });
});

describe('probeElement: Svelte / Angular', () => {
  it('Svelte: __svelte_meta.loc', () => {
    const el = mount();
    (el as unknown as Record<string, unknown>).__svelte_meta = { loc: { file: 'src/lib/Card.svelte', line: 12, column: 4 } };
    expect(probeElement(el)).toEqual({ name: 'svelte', component: 'Card', componentStack: ['Card'], source: { file: 'src/lib/Card.svelte', line: 12, column: 4, raw: 'src/lib/Card.svelte' } });
  });

  it('Angular: window.ng.getComponent', () => {
    const el = mount();
    class HeroCard {}
    class AppRoot {}
    const hostOf = new Map<unknown, unknown>();
    const hero = new HeroCard();
    const app = new AppRoot();
    hostOf.set(hero, 'hero-host');
    hostOf.set(app, 'app-host');
    (window as unknown as { ng: unknown }).ng = {
      getComponent: (n: Element) => (n === el ? hero : null),
      getHostElement: (c: unknown) => hostOf.get(c),
      getOwningComponent: (n: unknown) => (n === 'hero-host' ? app : null),
    };
    expect(probeElement(el)).toEqual({ name: 'angular', component: 'HeroCard', componentStack: ['HeroCard', 'AppRoot'] });
  });
});

describe('helpers', () => {
  it('normalizeSourcePath handles the bundler prefixes used by probes', () => {
    expect(normalizeSourcePath('http://localhost:3000/src/a/B.tsx?t=123')?.file).toBe('src/a/B.tsx');
    expect(normalizeSourcePath('webpack-internal:///(app-pages-browser)/./src/app/page.tsx')?.file).toBe('src/app/page.tsx');
    expect(normalizeSourcePath('webpack://proj/./src/x.tsx')?.file).toBe('src/x.tsx');
  });
  it('isLibraryFrame: path decides when known, name list otherwise', () => {
    expect(isLibraryFrame('Button', { file: 'node_modules/ui/dist/button.js', raw: '/p/node_modules/ui/dist/button.js' })).toBe(true);
    expect(isLibraryFrame('Routes', { file: 'src/app.tsx' })).toBe(false); // app file wins over router names
    expect(isLibraryFrame('Routes', undefined)).toBe(true);
    expect(isLibraryFrame('LoginPage', undefined)).toBe(false);
    for (const n of ['Suspense', 'StrictMode', 'Fragment', 'Profiler', 'ThemeProvider', 'AuthConsumer', 'RouterContext', 'ErrorBoundary']) {
      expect(isLibraryFrame(n, { file: 'src/x.tsx' })).toBe(true);
    }
  });
  it('parseStackFrames handles V8 and Firefox formats', () => {
    const v8 = parseStackFrames('Error\n    at Foo (http://x/a.js:1:2)\n    at http://x/b.js:3:4');
    expect(v8).toEqual([
      { fn: 'Foo', file: 'http://x/a.js', line: 1, column: 2 },
      { fn: undefined, file: 'http://x/b.js', line: 3, column: 4 },
    ]);
    expect(parseStackFrames('foo@http://x/c.js:5:6')[0]).toMatchObject({ file: 'http://x/c.js', line: 5 });
  });
});
