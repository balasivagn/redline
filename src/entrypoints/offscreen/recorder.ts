/** Mic capture in the offscreen document → 16 kHz mono WAV, with ~15 Hz level reports. */
import { SpeechError } from '../../speech/engine';
import { encodeRecording, levelFromRms } from '../../speech/wav';

export function mapMediaError(e: unknown): SpeechError {
  const name = (e as { name?: string } | null)?.name ?? '';
  const msg = e instanceof Error ? e.message : String(e);
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return new SpeechError('mic-permission', 'Microphone access has not been granted. Allow it once in Redline settings.');
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError' || name === 'AbortError') {
    return new SpeechError('mic-unavailable', `No usable microphone found${msg ? ` (${msg})` : ''}.`);
  }
  return new SpeechError('mic-unavailable', msg || 'Could not start the microphone.');
}

const WORKLET_SRC = `
class RedlineCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('redline-capture', RedlineCapture);
`;

export interface RecorderCallbacks {
  onLevel(level: number): void;
  /** Recording hit its maximum length. */
  onMax(): void;
}

export function createRecorder(cb: RecorderCallbacks) {
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let chunks: Float32Array[] = [];
  let sumSq = 0;
  let count = 0;
  let levelTimer: ReturnType<typeof setInterval> | undefined;
  let maxTimer: ReturnType<typeof setTimeout> | undefined;
  let sampleRate = 48000;
  let active = false;
  let teardown: () => void = () => undefined;

  function onSamples(data: Float32Array) {
    chunks.push(data);
    for (let i = 0; i < data.length; i++) sumSq += (data[i] ?? 0) * (data[i] ?? 0);
    count += data.length;
  }

  function release() {
    clearInterval(levelTimer);
    clearTimeout(maxTimer);
    try { teardown(); } catch { /* ignore */ }
    teardown = () => undefined;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    void ctx?.close().catch(() => undefined);
    ctx = null;
    active = false;
  }

  async function start(maxSeconds: number): Promise<void> {
    if (active) release();
    chunks = [];
    sumSq = 0;
    count = 0;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      throw mapMediaError(e);
    }
    try {
      ctx = new AudioContext();
      sampleRate = ctx.sampleRate;
      if (ctx.state === 'suspended') await ctx.resume();
      const source = ctx.createMediaStreamSource(stream);
      const sink = ctx.createGain();
      sink.gain.value = 0; // keep the graph pulling without playing the mic back
      sink.connect(ctx.destination);

      let usedWorklet = false;
      try {
        const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'text/javascript' }));
        try {
          await ctx.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        const node = new AudioWorkletNode(ctx, 'redline-capture');
        node.port.onmessage = (ev: MessageEvent<Float32Array>) => onSamples(ev.data);
        source.connect(node);
        node.connect(sink);
        teardown = () => { node.port.onmessage = null; node.disconnect(); source.disconnect(); };
        usedWorklet = true;
      } catch {
        // Worklet blocked (CSP) or unsupported: fall back to ScriptProcessor.
      }
      if (!usedWorklet) {
        const proc = ctx.createScriptProcessor(4096, 1, 1);
        proc.onaudioprocess = (ev) => onSamples(new Float32Array(ev.inputBuffer.getChannelData(0)));
        source.connect(proc);
        proc.connect(sink);
        teardown = () => { proc.onaudioprocess = null; proc.disconnect(); source.disconnect(); };
      }
    } catch (e) {
      release();
      throw mapMediaError(e);
    }
    active = true;
    levelTimer = setInterval(() => {
      const r = count ? Math.sqrt(sumSq / count) : 0;
      sumSq = 0;
      count = 0;
      cb.onLevel(levelFromRms(r));
    }, 66);
    maxTimer = setTimeout(() => cb.onMax(), maxSeconds * 1000);
  }

  /** Stop and return the WAV. The mic is released either way. */
  function stop(): ArrayBuffer {
    if (!active) throw new SpeechError('transcribe-failed', 'Not recording.');
    const captured = chunks;
    const rate = sampleRate;
    release();
    chunks = [];
    return encodeRecording(captured, rate);
  }

  function cancel(): void {
    release();
    chunks = [];
  }

  return { start, stop, cancel, get active() { return active; } };
}
