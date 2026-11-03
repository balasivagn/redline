import { useCallback, useEffect, useRef, useState } from 'react';

export type MicPermission = 'unknown' | 'granted' | 'denied' | 'prompt';

export function micErrorMessage(e: unknown): string {
  const name = e instanceof DOMException || e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access was blocked. Allow it in the browser prompt or in chrome://settings/content/microphone.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone found.';
  if (name === 'NotReadableError') return 'The microphone is in use by another app.';
  return e instanceof Error ? e.message : String(e);
}

/**
 * Mic permission for the extension origin. Offscreen documents can't show the prompt, so the
 * grant happens here, once, on an extension page.
 */
export function useMicPermission() {
  const [permission, setPermission] = useState<MicPermission>('unknown');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let status: PermissionStatus | undefined;
    let alive = true;
    const sync = () => status && alive && setPermission(status.state as MicPermission);
    navigator.permissions
      ?.query({ name: 'microphone' as PermissionName })
      .then((s) => {
        status = s;
        sync();
        s.addEventListener('change', sync);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      status?.removeEventListener('change', sync);
    };
  }, []);

  const grant = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setPermission('granted');
    } catch (e) {
      setError(micErrorMessage(e));
      setPermission('denied');
    } finally {
      setBusy(false);
    }
  }, []);

  return { permission, error, busy, grant };
}

export type MicTestState =
  | { phase: 'idle' }
  | { phase: 'recording'; level: number; secondsLeft: number }
  | { phase: 'done'; peak: number; bytes: number }
  | { phase: 'error'; message: string };

export const MIC_TEST_MS = 3000;
/** Peak level (0..1) above which we call the mic "working". */
export const MIC_HEARD_THRESHOLD = 0.04;

/** Record 3 s with MediaRecorder and drive a live level meter. Permission/device check only. */
export function useMicTest() {
  const [state, setState] = useState<MicTestState>({ phase: 'idle' });
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  const start = useCallback(async () => {
    cleanup.current?.();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);

      const recorder = new MediaRecorder(stream);
      let bytes = 0;
      recorder.ondataavailable = (e) => (bytes += e.data.size);
      recorder.start(250);

      const startedAt = performance.now();
      let peak = 0;
      let finished = false;
      const finish = (result?: MicTestState) => {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        if (recorder.state !== 'inactive') recorder.stop();
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close().catch(() => undefined);
        cleanup.current = null;
        setState(result ?? { phase: 'done', peak, bytes });
      };
      const timer = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const level = Math.min(1, Math.sqrt(sum / buf.length) * 3);
        peak = Math.max(peak, level);
        const elapsed = performance.now() - startedAt;
        if (elapsed >= MIC_TEST_MS) finish();
        else setState({ phase: 'recording', level, secondsLeft: Math.ceil((MIC_TEST_MS - elapsed) / 1000) });
      }, 60);
      cleanup.current = () => finish({ phase: 'idle' });
      setState({ phase: 'recording', level: 0, secondsLeft: 3 });
    } catch (e) {
      setState({ phase: 'error', message: micErrorMessage(e) });
    }
  }, []);

  return { state, start };
}
