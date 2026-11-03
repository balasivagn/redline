import { describe, expect, it } from 'vitest';
import { isLibraryPath, normalizeSourcePath } from './source-path';

const n = (s: string) => {
  const r = normalizeSourcePath(s);
  return r ? { file: r.file, line: r.line, column: r.column } : undefined;
};

describe('normalizeSourcePath', () => {
  it('Vite /@fs URL with ?t= query in a monorepo (cuts before packages)', () => {
    const raw = 'http://localhost:5173/@fs/app/packages/ui/src/primitives/text/text.tsx?t=123:73:28';
    expect(normalizeSourcePath(raw)).toEqual({ file: 'packages/ui/src/primitives/text/text.tsx', line: 73, column: 28, raw });
  });

  it('Vite root-relative /src URL with a timestamp query', () => {
    expect(n('http://localhost:5173/src/components/Card.tsx?t=1730000:12:5')).toEqual({ file: 'src/components/Card.tsx', line: 12, column: 5 });
  });

  it('Vite /@fs absolute path outside the root, plain src project', () => {
    expect(n('http://127.0.0.1:3000/@fs/Users/a/proj/src/pages/Home.tsx:9:3')).toEqual({ file: 'src/pages/Home.tsx', line: 9, column: 3 });
  });

  it('Vite pre-bundled deps keep their node_modules path', () => {
    expect(n('http://localhost:5173/node_modules/.vite/deps/react-router-dom.js?v=abc123:300:12')).toEqual({
      file: 'node_modules/.vite/deps/react-router-dom.js',
      line: 300,
      column: 12,
    });
  });

  it('Vite /@id/ virtual modules', () => {
    expect(n('http://localhost:5173/@id/virtual:foo/bar.js:1:1')?.file).toBe('virtual:foo/bar.js');
  });

  it('webpack-internal with a layer prefix and ./ (Next app router)', () => {
    expect(n('webpack-internal:///(app-pages-browser)/./app/page.tsx:20:7')).toEqual({ file: 'app/page.tsx', line: 20, column: 7 });
  });

  it('webpack-internal with (ssr) and src folder', () => {
    expect(n('webpack-internal:///(ssr)/./src/app/layout.tsx:5:1')).toEqual({ file: 'src/app/layout.tsx', line: 5, column: 1 });
  });

  it('webpack://name/./path', () => {
    expect(n('webpack://my-app/./src/x.tsx:3:4')).toEqual({ file: 'src/x.tsx', line: 3, column: 4 });
    expect(n('webpack://_N_E/./app/dashboard/page.tsx')).toEqual({ file: 'app/dashboard/page.tsx', line: undefined, column: undefined });
  });

  it('rsc://React/Server/ with a nested webpack-internal path and a query', () => {
    expect(n('rsc://React/Server/webpack-internal:///(rsc)/./app/page.tsx?c7a1:14:3')).toEqual({ file: 'app/page.tsx', line: 14, column: 3 });
  });

  it('file:// URLs', () => {
    expect(n('file:///Users/a/proj/src/components/Card.tsx:42:7')).toEqual({ file: 'src/components/Card.tsx', line: 42, column: 7 });
  });

  it('monorepo markers win when they come before src', () => {
    expect(n('/Users/a/mono/apps/web/src/auth/AuthLayout.tsx:41:9')).toEqual({ file: 'apps/web/src/auth/AuthLayout.tsx', line: 41, column: 9 });
    expect(n('/home/ci/work/libs/shared/src/x.ts:1:1')?.file).toBe('libs/shared/src/x.ts');
  });

  it('plain absolute src path (no query, no line)', () => {
    expect(normalizeSourcePath('/Users/a/proj/src/components/Card.tsx')).toEqual({
      file: 'src/components/Card.tsx',
      raw: '/Users/a/proj/src/components/Card.tsx',
    });
  });

  it('Windows-style paths keep the tail after src', () => {
    expect(n('C:\\Users\\a\\proj\\src\\components\\Card.tsx:10:2')).toEqual({ file: 'src/components/Card.tsx', line: 10, column: 2 });
    expect(n('file:///C:/Users/a/proj/src/App.tsx:1:2')).toEqual({ file: 'src/App.tsx', line: 1, column: 2 });
  });

  it('only the first marker cuts: a later src segment does not', () => {
    expect(n('/x/packages/ui/src/a.ts:1:1')?.file).toBe('packages/ui/src/a.ts');
    expect(n('/x/src/lib/src/a.ts:1:1')?.file).toBe('src/lib/src/a.ts');
  });

  it('no marker: drops the home directory only', () => {
    expect(n('/Users/me/proj/app/page.tsx:2:2')?.file).toBe('proj/app/page.tsx');
    expect(n('/app/page.tsx')?.file).toBe('app/page.tsx');
  });

  it('package files keep node_modules even when the package has a src folder', () => {
    expect(n('/Users/a/proj/node_modules/lib/src/index.js:3:3')?.file).toBe('node_modules/lib/src/index.js');
  });

  it('decodes percent-encoding (Next dynamic routes)', () => {
    expect(n('webpack-internal:///(app-pages-browser)/./app/blog/%5Bslug%5D/page.tsx:1:1')?.file).toBe('app/blog/[slug]/page.tsx');
  });

  it('strips #hash and handles line without column', () => {
    expect(n('http://localhost:5173/src/a.ts#frag:7')).toEqual({ file: 'src/a.ts', line: 7, column: undefined });
  });

  it('returns undefined for empty/garbage and for a bare origin', () => {
    expect(normalizeSourcePath('')).toBeUndefined();
    expect(normalizeSourcePath(undefined)).toBeUndefined();
    expect(normalizeSourcePath('http://localhost:5173')).toBeUndefined();
  });
});

describe('isLibraryPath', () => {
  it('flags node_modules, vite deps, /@id/ and next chunks', () => {
    expect(isLibraryPath('http://x/node_modules/react-router/dist/index.js')).toBe(true);
    expect(isLibraryPath('/node_modules/.vite/deps/react.js?v=1')).toBe(true);
    expect(isLibraryPath('http://x/@id/__x00__virtual:y')).toBe(true);
    expect(isLibraryPath('http://x/_next/static/chunks/main-app.js')).toBe(true);
    expect(isLibraryPath('C:\\proj\\node_modules\\x\\y.js')).toBe(true);
  });
  it('does not flag app files', () => {
    expect(isLibraryPath('http://x/src/App.tsx')).toBe(false);
    expect(isLibraryPath('packages/ui/src/Text.tsx')).toBe(false);
    expect(isLibraryPath(undefined)).toBe(false);
  });
});
