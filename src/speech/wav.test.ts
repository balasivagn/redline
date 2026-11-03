import { describe, expect, it } from 'vitest';
import {
  base64ToBytes, bytesToBase64, encodeRecording, encodeWav, floatToInt16, levelFromRms, resample, rms,
} from './wav';

const ascii = (v: DataView, off: number, n: number) =>
  Array.from({ length: n }, (_, i) => String.fromCharCode(v.getUint8(off + i))).join('');

describe('encodeWav', () => {
  it('writes a valid 44-byte PCM header', () => {
    const samples = Int16Array.from([0, 1, -1, 32767, -32768]);
    const buf = encodeWav(samples, 16000);
    const v = new DataView(buf);
    expect(buf.byteLength).toBe(44 + samples.length * 2);
    expect(ascii(v, 0, 4)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(36 + samples.length * 2);
    expect(ascii(v, 8, 4)).toBe('WAVE');
    expect(ascii(v, 12, 4)).toBe('fmt ');
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(28, true)).toBe(32000);
    expect(v.getUint16(32, true)).toBe(2);
    expect(v.getUint16(34, true)).toBe(16);
    expect(ascii(v, 36, 4)).toBe('data');
    expect(v.getUint32(40, true)).toBe(samples.length * 2);
    expect(v.getInt16(44 + 3 * 2, true)).toBe(32767);
    expect(v.getInt16(44 + 4 * 2, true)).toBe(-32768);
  });

  it('handles empty audio', () => {
    expect(encodeWav(new Int16Array(0)).byteLength).toBe(44);
  });
});

describe('resample', () => {
  it('48k → 16k yields a third of the samples and keeps DC level', () => {
    const out = resample(new Float32Array(4800).fill(0.5), 48000);
    expect(out.length).toBe(1600);
    expect(out[10]).toBeCloseTo(0.5, 5);
  });
  it('averages windows (44.1k → 16k length)', () => {
    const out = resample(new Float32Array(44100), 44100);
    expect(out.length).toBe(16000);
  });
  it('is a no-op at 16k', () => {
    const input = new Float32Array([0.1, 0.2]);
    expect(resample(input, 16000)).toBe(input);
  });
  it('upsamples with interpolation', () => {
    const out = resample(Float32Array.from([0, 1]), 8000);
    expect(out.length).toBe(4);
    expect(out[1]).toBeCloseTo(0.5, 5);
  });
});

describe('encodeRecording', () => {
  it('1 s of 48 kHz audio becomes 1 s of 16 kHz WAV', () => {
    const chunks = [new Float32Array(24000).fill(0.25), new Float32Array(24000).fill(0.25)];
    const buf = encodeRecording(chunks, 48000);
    expect(buf.byteLength).toBe(44 + 16000 * 2);
    expect(new DataView(buf).getUint32(24, true)).toBe(16000);
    expect(new DataView(buf).getInt16(44 + 100 * 2, true)).toBe(Math.round(0.25 * 0x7fff));
  });
});

describe('levels + conversion', () => {
  it('floatToInt16 clamps', () => {
    expect(Array.from(floatToInt16(Float32Array.from([2, -2, 0])))).toEqual([32767, -32768, 0]);
  });
  it('rms and level mapping', () => {
    expect(rms(new Float32Array(0))).toBe(0);
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
    expect(levelFromRms(0)).toBe(0);
    expect(levelFromRms(1)).toBe(1);
    expect(levelFromRms(0.01)).toBeCloseTo(0.25, 2);
  });
  it('base64 round-trips large buffers', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });
});
