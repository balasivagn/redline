import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RedlineEvent } from '../../core/messages';
import type { Annotation } from '../../core/schema';
import { DEFAULT_SETTINGS } from '../../core/settings';
import { makeAnnotation } from './fixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const handlers = new Set<(e: RedlineEvent) => void>();
vi.mock('../../core/rpc', () => ({
  rpc: vi.fn(),
  onRedlineEvent: vi.fn((h: (e: RedlineEvent) => void) => {
    handlers.add(h);
    return () => handlers.delete(h);
  }),
}));
vi.mock('../../core/export', () => ({
  toMarkdown: vi.fn((a: unknown[]) => `MD(${a.length})`),
  toExportDocument: vi.fn(() => ({})),
  buildBundle: vi.fn(),
}));

import { rpc } from '../../core/rpc';
import { ReviewList, type ReviewListProps } from './ReviewList';
import { clearShotCache } from './shots';

let store: Annotation[];
const mockedRpc = vi.mocked(rpc) as unknown as ReturnType<typeof vi.fn>;
let host: HTMLDivElement;
let root: Root;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mount(props: Partial<ReviewListProps> = {}) {
  await act(async () => {
    root.render(<ReviewList pageKeys={['localhost:3000/pricing']} variant="drawer" {...props} />);
  });
  await flush();
}

const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel);
const qa = (sel: string) => Array.from(host.querySelectorAll<HTMLElement>(sel));
const click = async (el: Element | null) => {
  expect(el).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flush();
};
const byText = (sel: string, text: string) => qa(sel).find((e) => e.textContent?.includes(text)) ?? null;

beforeEach(() => {
  vi.useRealTimers();
  handlers.clear();
  store = [
    makeAnnotation({ id: 'a1', number: 1 }),
    makeAnnotation({
      id: 'a2',
      number: 2,
      anchor: { kind: 'area', selector: 'div.grid', xpath: '', offset: { xRatio: 0, yRatio: 0 }, pagePoint: { x: 0, y: 0 } },
      screenshot: { shotId: 's1', width: 10, height: 10 },
      comment: { text: 'Dictated thing', source: 'voice' },
    }),
    makeAnnotation({ id: 'a3', number: 3 }),
  ];
  clearShotCache();
  mockedRpc.mockReset();
  mockedRpc.mockImplementation(async (type: string, payload: never) => {
    switch (type) {
      case 'ann/listPages':
        return [...store];
      case 'settings/get':
        return DEFAULT_SETTINGS;
      case 'shot/get':
        return { dataUrl: 'data:image/png;base64,iVBORw==' };
      case 'ann/delete': {
        const ids = (payload as { ids: string[] }).ids;
        const deleted = store.filter((a) => ids.includes(a.id));
        store = store.filter((a) => !ids.includes(a.id));
        return { deleted };
      }
      case 'ann/restore': {
        const back = (payload as { annotations: Annotation[] }).annotations;
        store = [...store, ...back];
        return { restored: back.length };
      }
      case 'ann/save': {
        const a = (payload as { annotation: Annotation }).annotation;
        store = store.map((x) => (x.id === a.id ? a : x));
        return a;
      }
      default:
        throw new Error(`unexpected rpc ${type}`);
    }
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('<ReviewList>', () => {
  it('renders rows with descriptor, badges and area marker', async () => {
    await mount();
    expect(mockedRpc).toHaveBeenCalledWith('ann/listPages', { pageKeys: ['localhost:3000/pricing'] });
    const rows = qa('[data-testid="review-row"]');
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain('div.card.card--pro'); // max two classes
    expect(rows[0]!.textContent).not.toContain('.extra');
    expect(rows[1]!.querySelector('[aria-label="Area comment"]')).toBeTruthy();
    expect(rows[1]!.querySelector('[aria-label="Has screenshot"]')).toBeTruthy();
    expect(rows[1]!.querySelector('[aria-label="Dictated"]')).toBeTruthy();
    expect(rows[0]!.querySelector('[aria-label="Dictated"]')).toBeNull();
    expect(host.textContent).toContain('3 comments');
  });

  it('shows the empty state', async () => {
    store = [];
    await mount();
    expect(host.textContent).toContain('No comments yet');
  });

  it('renders detached rows with re-pin that calls onRepin, and row click calls onFocus', async () => {
    const onRepin = vi.fn();
    const onFocus = vi.fn();
    await mount({ detachedIds: new Set(['a3']), onRepin, onFocus });
    const rows = qa('[data-testid="review-row"]');
    expect(rows[2]!.textContent).toContain('detached');
    expect(rows[0]!.textContent).not.toContain('detached');
    await click(byText('button', 're-pin'));
    expect(onRepin).toHaveBeenCalledWith(expect.objectContaining({ id: 'a3' }));
    await click(rows[0]!.querySelector('button.block'));
    expect(onFocus).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
  });

  it('refetches on ann/changed for a matching key only', async () => {
    await mount();
    const calls = () => mockedRpc.mock.calls.filter((c) => c[0] === 'ann/listPages').length;
    const before = calls();
    await act(async () => handlers.forEach((h) => h({ channel: 'redline/event', type: 'ann/changed', pageKeys: ['other'] })));
    await flush();
    expect(calls()).toBe(before);
    store = store.slice(0, 1);
    await act(async () => handlers.forEach((h) => h({ channel: 'redline/event', type: 'ann/changed', pageKeys: ['localhost:3000/pricing'] })));
    await flush();
    expect(calls()).toBe(before + 1);
    expect(qa('[data-testid="review-row"]')).toHaveLength(1);
  });

  it('bulk delete asks for confirmation first', async () => {
    await mount();
    await click(q('input[aria-label="Select comment 1"]'));
    await click(q('input[aria-label="Select comment 2"]'));
    expect(host.textContent).toContain('2 selected');
    await click(byText('button', 'Delete 2'));
    expect(host.textContent).toContain('Delete 2 comments?');
    expect(mockedRpc).not.toHaveBeenCalledWith('ann/delete', expect.anything());

    await click(byText('button', 'Cancel'));
    expect(host.textContent).not.toContain('Delete 2 comments?');

    await click(byText('button', 'Delete 2'));
    await click(q('[role="alertdialog"]')!.querySelectorAll('button')[1]!);
    expect(mockedRpc).toHaveBeenCalledWith('ann/delete', { ids: ['a1', 'a2'] });
    expect(qa('[data-testid="review-row"]')).toHaveLength(1);
    expect(host.textContent).toContain('Deleted 2 comments');
    expect(host.textContent).not.toContain('selected');
  });

  it('single delete needs no confirm and offers Undo, which restores', async () => {
    await mount();
    await click(q('button[aria-label="Delete comment 1"]'));
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(qa('[data-testid="review-row"]')).toHaveLength(2);
    await click(byText('button', 'Undo'));
    expect(mockedRpc).toHaveBeenCalledWith('ann/restore', { annotations: [expect.objectContaining({ id: 'a1' })] });
    expect(qa('[data-testid="review-row"]')).toHaveLength(3);
  });

  it('the Undo toast disappears after 5 s', async () => {
    await mount();
    vi.useFakeTimers();
    await click(q('button[aria-label="Delete comment 3"]'));
    expect(byText('button', 'Undo')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(5100);
    });
    expect(byText('button', 'Undo')).toBeNull();
  });

  it('select all toggles every row; copy menu disables Selected until something is selected', async () => {
    await mount();
    await click(byText('button', 'Copy'));
    const selectedRadio = () => qa('[role="menu"] input[type="radio"]')[0] as HTMLInputElement;
    expect(selectedRadio().disabled).toBe(true);
    await click(byText('button', 'Copy')); // close
    await click(q('label input[type="checkbox"]'));
    expect(host.textContent).toContain('3 selected');
    await click(byText('button', 'Copy 3'));
    expect(selectedRadio().disabled).toBe(false);
    expect(selectedRadio().checked).toBe(true);
  });

  it('inline edit saves with ⌘/Ctrl+Enter and cancels with Esc', async () => {
    await mount();
    await click(q('button[aria-label="Edit comment 1"]'));
    const ta = q<HTMLTextAreaElement>('textarea')!;
    expect(ta.value).toBe('Comment 1');
    await act(async () => {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(q('textarea')).toBeNull();

    await click(q('button[aria-label="Edit comment 1"]'));
    const ta2 = q<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(ta2, 'Changed text');
      ta2.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      ta2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    });
    await flush();
    const saveCall = mockedRpc.mock.calls.find((c) => c[0] === 'ann/save');
    expect(saveCall?.[1].annotation.comment.text).toBe('Changed text');
    expect(q('textarea')).toBeNull();
    expect(host.textContent).toContain('Changed text');
  });

  describe('screenshots', () => {
    beforeEach(() => {
      store = store.map((a) => (a.id === 'a2' ? { ...a, screenshot: { shotId: 's1', width: 800, height: 600, path: '/home/u/.redline/shots/h/p/a.png' } } : a));
    });
    const write = vi.fn(async (_items: unknown[]) => {});
    const writeText = vi.fn(async (_t: string) => {});
    beforeEach(() => {
      write.mockClear();
      writeText.mockClear();
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write, writeText } });
      vi.stubGlobal('ClipboardItem', class { constructor(public data: Record<string, Blob>) {} });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('shows a lazily loaded, cached thumbnail only on rows with a screenshot', async () => {
      await mount();
      expect(qa('[data-testid="shot-thumb"]')).toHaveLength(1);
      const img = q<HTMLImageElement>('[data-testid="shot-thumb-img"]')!;
      expect(img.getAttribute('src')).toBe('data:image/png;base64,iVBORw==');
      expect(mockedRpc.mock.calls.filter((c) => c[0] === 'shot/get')).toHaveLength(1);
      await mount(); // re-render: still one fetch (cache)
      expect(mockedRpc.mock.calls.filter((c) => c[0] === 'shot/get')).toHaveLength(1);
    });

    it('opens a lightbox with the path, copies the path, closes on Esc and on outside click', async () => {
      await mount();
      await click(q('[data-testid="shot-thumb"]'));
      const box = q('[data-testid="shot-lightbox"]')!;
      expect(box).toBeTruthy();
      expect(q<HTMLInputElement>('input[aria-label="Screenshot file path"]')!.value).toBe('/home/u/.redline/shots/h/p/a.png');
      expect(q('[data-testid="shot-full"]')).toBeTruthy();
      await click(q('[aria-label="Copy file path"]'));
      expect(writeText).toHaveBeenCalledWith('/home/u/.redline/shots/h/p/a.png');
      expect(host.textContent).toContain('Path copied');
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      expect(q('[data-testid="shot-lightbox"]')).toBeNull();
      await click(q('[data-testid="shot-thumb"]'));
      expect(q('[data-testid="shot-lightbox"]')).toBeTruthy();
      await act(async () => {
        box.parentElement?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      });
      expect(q('[data-testid="shot-lightbox"]')).toBeNull();
    });

    it('shows a hint instead of a path when the file was not saved', async () => {
      store = store.map((a) => (a.id === 'a2' ? { ...a, screenshot: { shotId: 's1', width: 8, height: 6 } } : a));
      await mount();
      await click(q('[data-testid="shot-thumb"]'));
      expect(q<HTMLInputElement>('input[aria-label="Screenshot file path"]')!.value).toMatch(/Not saved to a file/);
      expect(q('[aria-label="Copy file path"]')).toBeNull();
    });

    it('copies the image as image/png from the row action and the lightbox, toasting the result', async () => {
      await mount();
      await click(q('[aria-label="Copy image of comment 2"]'));
      expect(write).toHaveBeenCalledTimes(1);
      const item = write.mock.calls[0]![0]![0] as { data: Record<string, Blob> };
      expect(Object.keys(item.data)).toEqual(['image/png']);
      expect(host.textContent).toContain('Image copied');
      await click(q('[data-testid="shot-thumb"]'));
      await click(byText('button', 'Copy image'));
      expect(write).toHaveBeenCalledTimes(2);
    });

    it('toasts the reason when the clipboard refuses', async () => {
      write.mockRejectedValueOnce(new Error('Document is not focused'));
      await mount();
      await click(q('[aria-label="Copy image of comment 2"]'));
      expect(host.textContent).toContain("Couldn't copy the image: Document is not focused");
    });
  });

  it('works in a shadow root (inline popover, no portals)', async () => {
    const shadowHost = document.createElement('div');
    document.body.appendChild(shadowHost);
    const shadow = shadowHost.attachShadow({ mode: 'open' });
    const mountPoint = document.createElement('div');
    shadow.appendChild(mountPoint);
    const r = createRoot(mountPoint);
    await act(async () => r.render(<ReviewList pageKeys={['localhost:3000/pricing']} variant="drawer" />));
    await flush();
    const copyBtn = Array.from(shadow.querySelectorAll('button')).find((b) => b.textContent?.startsWith('Copy'))!;
    await act(async () => copyBtn.click());
    expect(shadow.querySelector('[role="menu"]')).toBeTruthy();
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    act(() => r.unmount());
    shadowHost.remove();
  });
});
