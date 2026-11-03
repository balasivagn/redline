import { describe, expect, it } from 'vitest';
import { pathSlug, shotRelPath, shotTimestamp } from './shot-files';

const d = new Date('2026-11-03T09:14:05.123Z');

describe('shot file paths', () => {
  it('formats a compact timestamp', () => {
    expect(shotTimestamp(d)).toBe('20261103-091405');
  });

  it('slugs page paths', () => {
    expect(pathSlug('/')).toBe('root');
    expect(pathSlug('')).toBe('root');
    expect(pathSlug('/pricing')).toBe('pricing');
    expect(pathSlug('/docs/getting%20started/')).toBe('docs-getting-started');
    expect(pathSlug('/a/b/c.html')).toBe('a-b-c.html');
    expect(pathSlug('/%2e%2e')).toBe('root');
    expect(pathSlug('/%E0%A4%A')).toBe('E0-A4-A');
    expect(pathSlug('/' + 'x'.repeat(200)).length).toBe(80);
  });

  it('builds <host>[-<port>]/<slug>/<timestamp>-<shotId>.png', () => {
    expect(shotRelPath('http://127.0.0.1:5173/pricing?x=1#h', 'shot_ab', d)).toBe('127.0.0.1-5173/pricing/20261103-091405-shot_ab.png');
    expect(shotRelPath('https://app.example.com/', 'shot_ab', d)).toBe('app.example.com/root/20261103-091405-shot_ab.png');
    expect(shotRelPath('https://example.com/a/b', 'x/../y', d)).toBe('example.com/a-b/20261103-091405-x-..-y.png');
    expect(shotRelPath('file:///tmp/x.html', 's1', d)).toBe('local/tmp-x.html/20261103-091405-s1.png');
    expect(shotRelPath(undefined, 's1', d)).toBe('unknown-page/root/20261103-091405-s1.png');
    expect(shotRelPath('not a url', 's1', d)).toBe('unknown-page/root/20261103-091405-s1.png');
  });
});
