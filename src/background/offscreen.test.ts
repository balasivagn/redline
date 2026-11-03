import { describe, expect, it, vi } from 'vitest';
import { sendOffscreen } from './offscreen';

const noReceiver = () => Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'));
const fast = { sleep: () => Promise.resolve() };

describe('sendOffscreen', () => {
  it('retries while the offscreen page is not listening yet', async () => {
    const send = vi.fn().mockImplementationOnce(noReceiver).mockImplementationOnce(noReceiver).mockResolvedValue({ ok: true, wavBase64: 'x' });
    const recreate = vi.fn();
    const res = await sendOffscreen<{ wavBase64: string }>({ type: 'record/stop' }, { ensure: async () => {}, recreate, send, ...fast });
    expect(res.wavBase64).toBe('x');
    expect(send).toHaveBeenCalledTimes(3);
    expect(recreate).not.toHaveBeenCalled();
  });

  it('recreates the document once when retries are exhausted', async () => {
    let recreated = false;
    const send = vi.fn().mockImplementation(() => (recreated ? Promise.resolve({ ok: true }) : noReceiver()));
    const recreate = vi.fn(async () => { recreated = true; });
    await expect(sendOffscreen({ type: 'record/cancel' }, { ensure: async () => {}, recreate, send, ...fast })).resolves.toEqual({ ok: true });
    expect(recreate).toHaveBeenCalledTimes(1);
  });

  it('gives a readable error when the page never answers', async () => {
    const send = vi.fn().mockImplementation(noReceiver);
    await expect(sendOffscreen({ type: 'record/cancel' }, { ensure: async () => {}, recreate: async () => {}, send, ...fast })).rejects.toThrow(/audio recorder page didn't start/);
  });

  it('passes through other errors and error replies', async () => {
    await expect(sendOffscreen({ type: 'record/cancel' }, { ensure: async () => {}, recreate: async () => {}, send: () => Promise.reject(new Error('boom')), ...fast })).rejects.toThrow('boom');
    await expect(sendOffscreen({ type: 'record/start', maxSeconds: 5 }, { ensure: async () => {}, recreate: async () => {}, send: async () => ({ ok: false, code: 'mic-permission', message: 'denied' }), ...fast })).rejects.toThrow('denied');
  });
});
