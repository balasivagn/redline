import { describe, expect, it } from 'vitest';
import { keepOnTop } from './keepOnTop';

describe('keepOnTop', () => {
  it('re-appends the host as body\'s last child when the page appends later', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = keepOnTop(host);

    const pageEl = document.createElement('div');
    document.body.appendChild(pageEl);
    // MutationObserver is async — flush a microtask.
    await Promise.resolve();
    await Promise.resolve();

    expect(document.body.lastElementChild).toBe(host);
    dispose();
    host.remove();
    pageEl.remove();
  });

  it('stops re-appending after dispose', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = keepOnTop(host);
    dispose();

    const pageEl = document.createElement('div');
    document.body.appendChild(pageEl);
    await Promise.resolve();
    await Promise.resolve();

    expect(document.body.lastElementChild).toBe(pageEl);
    host.remove();
    pageEl.remove();
  });
});
