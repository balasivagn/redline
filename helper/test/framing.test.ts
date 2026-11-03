import { describe, expect, test } from 'bun:test';
import { encodeFrame, FrameDecoder, FrameError, MAX_OUTBOUND_BYTES } from '../src/framing';

describe('framing', () => {
  test('encodes 4-byte little-endian length + UTF-8 JSON', () => {
    const msg = { id: '1', type: 'hello', text: 'héllo ✓' };
    const frame = encodeFrame(msg);
    const body = Buffer.from(JSON.stringify(msg), 'utf8');
    expect(frame.readUInt32LE(0)).toBe(body.length);
    expect(frame.subarray(4).equals(body)).toBe(true);
  });

  test('decodes a single whole frame', () => {
    const d = new FrameDecoder();
    expect(d.push(encodeFrame({ a: 1 }))).toEqual([{ message: { a: 1 } }]);
    expect(d.pending).toBe(false);
  });

  test('decodes several frames delivered in one chunk', () => {
    const d = new FrameDecoder();
    const out = d.push(Buffer.concat([encodeFrame({ n: 1 }), encodeFrame({ n: 2 }), encodeFrame({ n: 3 })]));
    expect(out.map((o) => ('message' in o ? o.message : null))).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  test('reassembles frames split at every possible byte boundary', () => {
    const all = Buffer.concat([encodeFrame({ text: 'ünïcode ✓' }), encodeFrame({ n: 2 })]);
    for (let cut = 1; cut < all.length; cut++) {
      const d = new FrameDecoder();
      const got = [...d.push(all.subarray(0, cut)), ...d.push(all.subarray(cut))];
      expect(got).toEqual([{ message: { text: 'ünïcode ✓' } }, { message: { n: 2 } }]);
    }
  });

  test('reassembles byte-by-byte and flags a truncated tail', () => {
    const frame = encodeFrame({ id: 'x', blob: 'a'.repeat(5000) });
    const d = new FrameDecoder();
    const got: unknown[] = [];
    for (const byte of frame.subarray(0, frame.length - 1)) got.push(...d.push(Uint8Array.of(byte)));
    expect(got).toEqual([]);
    expect(d.pending).toBe(true);
    expect(d.push(frame.subarray(frame.length - 1))).toHaveLength(1);
    expect(d.pending).toBe(false);
  });

  test('invalid JSON yields an error item and decoding continues', () => {
    const bad = Buffer.from('not json');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(bad.length, 0);
    const d = new FrameDecoder();
    const out = d.push(Buffer.concat([header, bad, encodeFrame({ ok: 1 })]));
    expect(out).toHaveLength(2);
    expect('error' in out[0]!).toBe(true);
    expect(out[1]).toEqual({ message: { ok: 1 } });
  });

  test('rejects oversized inbound and outbound frames', () => {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(100 * 1024 * 1024, 0);
    expect(() => new FrameDecoder().push(header)).toThrow(FrameError);
    expect(() => encodeFrame({ big: 'x'.repeat(MAX_OUTBOUND_BYTES) })).toThrow(FrameError);
  });
});
