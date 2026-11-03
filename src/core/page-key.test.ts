import { describe, expect, it } from 'vitest';
import { pageKeyFor } from './page-key';

describe('pageKeyFor', () => {
  it('uses origin + pathname', () => {
    expect(pageKeyFor('http://localhost:3000/pricing')).toBe('http://localhost:3000/pricing');
  });
  it('drops query and hash', () => {
    expect(pageKeyFor('https://acme.com/pricing?plan=pro#faq')).toBe('https://acme.com/pricing');
  });
  it('trims trailing slashes but keeps the root', () => {
    expect(pageKeyFor('https://acme.com/pricing/')).toBe('https://acme.com/pricing');
    expect(pageKeyFor('https://acme.com/')).toBe('https://acme.com/');
    expect(pageKeyFor('https://acme.com')).toBe('https://acme.com/');
    expect(pageKeyFor('https://acme.com/a/b//')).toBe('https://acme.com/a/b');
  });
  it('keeps #/ hash routes', () => {
    expect(pageKeyFor('http://localhost:5173/#/settings/profile')).toBe('http://localhost:5173/#/settings/profile');
    expect(pageKeyFor('http://localhost:5173/app?x=1#/users/42/')).toBe('http://localhost:5173/app#/users/42');
  });
  it('keeps #!/ hash routes', () => {
    expect(pageKeyFor('https://acme.com/#!/docs/intro')).toBe('https://acme.com/#!/docs/intro');
  });
  it('drops anchor-style hashes', () => {
    expect(pageKeyFor('https://acme.com/docs#installation')).toBe('https://acme.com/docs');
    expect(pageKeyFor('https://acme.com/docs#top/section')).toBe('https://acme.com/docs');
  });
  it('keeps non-default ports and differentiates origins', () => {
    expect(pageKeyFor('https://staging.acme.com:8443/x')).toBe('https://staging.acme.com:8443/x');
    expect(pageKeyFor('https://acme.com:443/x')).toBe('https://acme.com/x');
  });
  it('handles file:// URLs', () => {
    expect(pageKeyFor('file:///Users/me/site/index.html?x=1')).toBe('file:///Users/me/site/index.html');
    expect(pageKeyFor('file:///Users/me/site/')).toBe('file:///Users/me/site');
  });
  it('returns invalid URLs and opaque origins unchanged', () => {
    expect(pageKeyFor('not a url')).toBe('not a url');
    expect(pageKeyFor('')).toBe('');
    expect(pageKeyFor('about:blank')).toBe('about:blank');
  });
});
