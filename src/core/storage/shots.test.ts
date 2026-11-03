import { describe, expect, it } from 'vitest';
import { createShotStore } from './index';

const png = (bytes: number[]) => new Blob([new Uint8Array(bytes)], { type: 'image/png' });

describe('shot store', () => {
  it('put/get round-trips bytes and type', async () => {
    const store = createShotStore('t-shots-1');
    const id = await store.put(png([137, 80, 78, 71, 1, 2, 3]));
    expect(id).toMatch(/^shot_[a-z0-9]+$/);
    const blob = await store.get(id);
    expect(blob?.type).toBe('image/png');
    expect([...new Uint8Array((await blob?.arrayBuffer()) ?? new ArrayBuffer(0))]).toEqual([137, 80, 78, 71, 1, 2, 3]);
  });

  it('gives distinct ids, returns undefined for unknown ids', async () => {
    const store = createShotStore('t-shots-2');
    const [a, b] = await Promise.all([store.put(png([1])), store.put(png([2]))]);
    expect(a).not.toBe(b);
    expect(await store.get('shot_missing')).toBeUndefined();
  });

  it('delete removes only the given ids', async () => {
    const store = createShotStore('t-shots-3');
    const a = await store.put(png([1]));
    const b = await store.put(png([2]));
    await store.delete([a, 'shot_missing']);
    await store.delete([]);
    expect(await store.get(a)).toBeUndefined();
    expect(await store.get(b)).toBeDefined();
  });

  it('persists across store instances on the same db', async () => {
    const id = await createShotStore('t-shots-4').put(png([9]));
    expect(await createShotStore('t-shots-4').get(id)).toBeDefined();
  });
});
