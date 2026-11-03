import { describe, expect, it } from 'vitest';
import { probeElementAsync } from './probe-logic';
import { loadSourceMap, originalPosition, resolveStackLocations } from './sourcemap';

// generated line 5 col 0 → source line 7 col 6 (0-based); same line col 10 → source line 8 col 10
const MAPPINGS = ';;;;AAMM,UACI';
const map = { sources: ['A.tsx'], mappings: MAPPINGS };
const dataUrl = (m: object) => `//# sourceMappingURL=data:application/json;base64,${btoa(JSON.stringify(m))}`;

describe('originalPosition', () => {
  it('maps 1-based generated positions to 1-based original positions', () => {
    expect(originalPosition(map, 5, 1)).toEqual({ line: 7, column: 7 });
    expect(originalPosition(map, 5, 5)).toEqual({ line: 7, column: 7 }); // greatest segment <= col
    expect(originalPosition(map, 5, 11)).toEqual({ line: 8, column: 11 });
  });
  it('returns undefined for unmapped lines', () => {
    expect(originalPosition(map, 2, 1)).toBeUndefined();
    expect(originalPosition({}, 1, 1)).toBeUndefined();
  });
});

describe('loadSourceMap', () => {
  it('reads inline base64 maps and external maps', async () => {
    expect(await loadSourceMap('http://h/a.js', `code\n${dataUrl(map)}\n`, async () => '')).toEqual(map);
    const seen: string[] = [];
    const ext = await loadSourceMap('http://h/dir/a.js?t=1', 'code\n//# sourceMappingURL=a.js.map', async (u) => (seen.push(u), JSON.stringify(map)));
    expect(ext).toEqual(map);
    expect(seen).toEqual(['http://h/dir/a.js.map']);
  });
  it('returns undefined without a map or with garbage', async () => {
    expect(await loadSourceMap('http://h/a.js', 'no map here', async () => '')).toBeUndefined();
    expect(await loadSourceMap('http://h/a.js', '//# sourceMappingURL=data:application/json;base64,@@@', async () => '')).toBeUndefined();
  });
});

describe('resolveStackLocations', () => {
  it('only touches http stack locations and fetches each module once', async () => {
    let fetches = 0;
    const fetchText = async () => (fetches++, `code\n${dataUrl(map)}`);
    const a = { file: 'src/A.tsx', line: 5, column: 1, raw: 'http://h/src/A.tsx?t=1:5:1' };
    const b = { file: 'src/A.tsx', line: 5, column: 11, raw: 'http://h/src/A.tsx?t=1:5:11' };
    const exact = { file: 'src/B.tsx', line: 3, raw: '/Users/me/src/B.tsx' };
    const out = await resolveStackLocations([a, b, exact, undefined], fetchText, new Map());
    expect(out.get(a)).toMatchObject({ file: 'src/A.tsx', line: 7, column: 7 });
    expect(out.get(b)).toMatchObject({ line: 8, column: 11 });
    expect(out.has(exact)).toBe(false);
    expect(fetches).toBe(1);
  });
  it('failed fetches leave locations out (caller keeps raw positions)', async () => {
    const a = { file: 'src/A.tsx', line: 5, column: 1, raw: 'http://h/src/Z.tsx:5:1' };
    const out = await resolveStackLocations([a], async () => { throw new Error('404'); }, new Map());
    expect(out.size).toBe(0);
  });
});

describe('probeElementAsync', () => {
  it('corrects React 19 call-site lines through the source map', async () => {
    document.body.innerHTML = '<button>Go</button>';
    const el = document.querySelector('button')!;
    const stack = new Error('x');
    stack.stack = ['Error: react-stack-top-frame', `    at Card (${location.origin}/src/Card.tsx?t=1:5:1)`].join('\n');
    function Card() {}
    (el as unknown as Record<string, unknown>)['__reactFiber$z'] = { type: 'button', return: { type: Card, return: null, _debugStack: stack }, _debugStack: stack };
    const info = await probeElementAsync(el, { fetchText: async () => `code\n${dataUrl(map)}` });
    expect(info?.source).toMatchObject({ file: 'src/Card.tsx', line: 7, column: 7 });
    expect(info?.usedAt).toMatchObject({ line: 7, column: 7 });
    expect(info?.frames?.[0]?.usedAt).toMatchObject({ line: 7 });
  });
  it('falls back to the raw positions when the module cannot be fetched', async () => {
    document.body.innerHTML = '<button>Go</button>';
    const el = document.querySelector('button')!;
    const stack = new Error('x');
    stack.stack = `Error\n    at Card (${location.origin}/src/Card.tsx:5:1)`;
    (el as unknown as Record<string, unknown>)['__reactFiber$z'] = { type: 'button', return: null, _debugStack: stack };
    const info = await probeElementAsync(el, { fetchText: async () => { throw new Error('offline'); } });
    expect(info?.source).toMatchObject({ file: 'src/Card.tsx', line: 5, column: 1 });
  });
});
