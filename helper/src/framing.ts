/** Chrome native messaging framing: 4-byte little-endian length + UTF-8 JSON. */

/** Chrome's own limit for messages sent to a native host. */
export const MAX_INBOUND_BYTES = 64 * 1024 * 1024;
/** Chrome's limit for host -> extension messages. */
export const MAX_OUTBOUND_BYTES = 1024 * 1024;

export class FrameError extends Error {}

export function encodeFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.length >= MAX_OUTBOUND_BYTES) {
    throw new FrameError(`outbound message too large (${body.length} bytes)`);
  }
  const out = Buffer.allocUnsafe(4 + body.length);
  out.writeUInt32LE(body.length, 0);
  body.copy(out, 4);
  return out;
}

/**
 * Incremental decoder. Feed it arbitrary chunks; it returns every complete message.
 * A body that is not valid JSON yields `{ error }` for that frame and decoding continues.
 */
export class FrameDecoder {
  private chunks: Buffer[] = [];
  private buffered = 0;
  private need: number | null = null; // body length once the header is known

  push(chunk: Uint8Array): Array<{ message: unknown } | { error: Error }> {
    const out: Array<{ message: unknown } | { error: Error }> = [];
    if (chunk.length) {
      this.chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      this.buffered += chunk.length;
    }
    for (;;) {
      if (this.need === null) {
        if (this.buffered < 4) break;
        const header = this.take(4);
        this.need = header.readUInt32LE(0);
        if (this.need > MAX_INBOUND_BYTES) {
          throw new FrameError(`inbound message too large (${this.need} bytes)`);
        }
      }
      if (this.buffered < this.need) break;
      const body = this.take(this.need);
      this.need = null;
      try {
        out.push({ message: JSON.parse(body.toString('utf8')) });
      } catch (e) {
        out.push({ error: e instanceof Error ? e : new Error(String(e)) });
      }
    }
    return out;
  }

  /** True when a frame is partially received (used to detect truncated input at EOF). */
  get pending(): boolean {
    return this.buffered > 0 || this.need !== null;
  }

  private take(n: number): Buffer {
    const joined = this.chunks.length === 1 ? this.chunks[0]! : Buffer.concat(this.chunks);
    const head = joined.subarray(0, n);
    const rest = joined.subarray(n);
    this.chunks = rest.length ? [rest] : [];
    this.buffered = rest.length;
    return Buffer.from(head);
  }
}
