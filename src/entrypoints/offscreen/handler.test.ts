import { describe, expect, it, vi } from 'vitest';
import { SpeechError } from '../../speech/engine';
import { createOffscreenHandler } from './handler';
import { mapMediaError } from './recorder';

const named = (name: string) => Object.assign(new Error(name), { name });

describe('mapMediaError', () => {
  it('maps NotAllowedError → mic-permission and NotFoundError → mic-unavailable', () => {
    expect(mapMediaError(named('NotAllowedError')).code).toBe('mic-permission');
    expect(mapMediaError(named('NotFoundError')).code).toBe('mic-unavailable');
    expect(mapMediaError(named('NotReadableError')).code).toBe('mic-unavailable');
  });
});

describe('offscreen handler', () => {
  const make = () => {
    const recorder = { start: vi.fn(async () => {}), stop: vi.fn(() => new Uint8Array([1, 2, 3]).buffer), cancel: vi.fn() };
    const speech = { start: vi.fn(async () => {}), stop: vi.fn(async () => 'hi'), cancel: vi.fn() };
    return { recorder, speech, handle: createOffscreenHandler({ recorder, speech, status: async (lang) => ({ id: 'chrome', available: true, label: lang }) }) };
  };
  const m = (type: string, extra = {}) => ({ channel: 'redline/offscreen', type, ...extra }) as never;

  it('replies with base64 WAV on record/stop', async () => {
    const t = make();
    expect(await t.handle(m('record/stop'))).toEqual({ ok: true, wavBase64: 'AQID' });
  });
  it('converts thrown errors into {ok:false, code}', async () => {
    const t = make();
    t.recorder.start.mockRejectedValueOnce(new SpeechError('mic-permission', 'denied'));
    expect(await t.handle(m('record/start', { maxSeconds: 5 }))).toEqual({ ok: false, code: 'mic-permission', message: 'denied' });
  });
  it('cancel aborts both recorder and web speech', async () => {
    const t = make();
    await t.handle(m('record/cancel'));
    expect(t.recorder.cancel).toHaveBeenCalled();
    expect(t.speech.cancel).toHaveBeenCalled();
  });
  it('proxies chrome speech', async () => {
    const t = make();
    expect(await t.handle(m('chrome-speech/stop'))).toEqual({ ok: true, text: 'hi' });
    expect(await t.handle(m('chrome-speech/status', { lang: 'en-US' }))).toMatchObject({ ok: true, status: { label: 'en-US' } });
  });
});
