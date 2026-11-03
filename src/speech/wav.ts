/** Pure audio helpers: resample to 16 kHz mono, encode 16-bit PCM WAV, mic level, base64. */
export const WAV_SAMPLE_RATE = 16000;

export function concatFloat32(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Box-filter decimation (average of each input window); linear interpolation when upsampling. */
export function resample(input: Float32Array, inRate: number, outRate = WAV_SAMPLE_RATE): Float32Array {
  if (inRate === outRate || input.length === 0) return input;
  const ratio = inRate / outRate;
  const outLen = Math.max(0, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  if (ratio > 1) {
    for (let i = 0; i < outLen; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.max(start + 1, Math.min(input.length, Math.floor((i + 1) * ratio)));
      let sum = 0;
      for (let j = start; j < end; j++) sum += input[j] ?? 0;
      out[i] = sum / (end - start);
    }
  } else {
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const a = input[i0] ?? 0;
      const b = input[Math.min(i0 + 1, input.length - 1)] ?? a;
      out[i] = a + (b - a) * frac;
    }
  }
  return out;
}

export function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** 44-byte RIFF/WAVE header + little-endian 16-bit mono PCM. */
export function encodeWav(samples: Int16Array, sampleRate = WAV_SAMPLE_RATE): ArrayBuffer {
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  str(36, 'data');
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, samples[i] ?? 0, true);
  return buf;
}

/** Captured mono float chunks at `inputRate` → 16 kHz mono WAV. */
export function encodeRecording(chunks: Float32Array[], inputRate: number): ArrayBuffer {
  return encodeWav(floatToInt16(resample(concatFloat32(chunks), inputRate)), WAV_SAMPLE_RATE);
}

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] ?? 0;
    sum += s * s;
  }
  return Math.sqrt(sum / samples.length);
}

/** Map an RMS amplitude (0..1) to a 0..1 meter level (−50 dB → 0, −10 dB → 1). */
export function levelFromRms(r: number): number {
  if (r <= 0) return 0;
  const db = 20 * Math.log10(r);
  return Math.max(0, Math.min(1, (db + 50) / 40));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
