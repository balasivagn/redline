import { useCallback, useEffect, useRef, useState } from 'react';
import { onRedlineEvent, rpc } from '../../core/rpc';
import type { SpeechErrorCode } from '../../speech/types';
import { errorCodeFromMessage, pushLevel } from './voice';

export type VoiceStatus =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'listening'; startedAt: number }
  | { phase: 'transcribing'; engineLabel?: string }
  | { phase: 'error'; code: SpeechErrorCode; message: string };

/** Dictation state machine around the speech/* rpcs and events. */
export function useVoice(onText: (text: string) => void) {
  const [status, setStatus] = useState<VoiceStatus>({ phase: 'idle' });
  const [levels, setLevels] = useState<number[]>([]);
  const statusRef = useRef(status);
  statusRef.current = status;
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const stoppingRef = useRef(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    const off = onRedlineEvent((e) => {
      if (e.type === 'speech/level') {
        if (statusRef.current.phase === 'listening') setLevels((l) => pushLevel(l, e.level));
      } else if (e.type === 'speech/state') {
        const s = e.state;
        const phase = statusRef.current.phase;
        if (s.state === 'listening' && (phase === 'starting' || phase === 'listening')) {
          setStatus({ phase: 'listening', startedAt: s.startedAt });
        } else if (s.state === 'transcribing' && phase !== 'idle') {
          setStatus({ phase: 'transcribing', engineLabel: s.engineLabel });
        } else if (s.state === 'error') {
          if (s.code === 'cancelled') setStatus({ phase: 'idle' });
          else if (phase !== 'idle' || !stoppingRef.current) setStatus({ phase: 'error', code: s.code, message: s.message });
        } else if (s.state === 'done' && phase === 'listening' && !stoppingRef.current) {
          // Recording ended on its own (e.g. max length); insert what we got.
          setStatus({ phase: 'idle' });
          onTextRef.current(s.text);
        }
      }
    });
    return () => {
      aliveRef.current = false;
      off();
      if (statusRef.current.phase === 'listening' || statusRef.current.phase === 'starting') void rpc('speech/cancel', {}).catch(() => {});
    };
  }, []);

  const start = useCallback(async () => {
    const phase = statusRef.current.phase;
    if (phase === 'starting' || phase === 'listening' || phase === 'transcribing') return;
    stoppingRef.current = false;
    setLevels([]);
    setStatus({ phase: 'starting' });
    try {
      await rpc('speech/start', {});
      if (!aliveRef.current) return;
      setStatus((s) => (s.phase === 'starting' ? { phase: 'listening', startedAt: Date.now() } : s));
    } catch (err) {
      if (!aliveRef.current) return;
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ phase: 'error', code: errorCodeFromMessage(message), message });
    }
  }, []);

  const stop = useCallback(async () => {
    if (statusRef.current.phase !== 'listening') return;
    stoppingRef.current = true;
    setStatus({ phase: 'transcribing' });
    try {
      const { text } = await rpc('speech/stop', {});
      if (!aliveRef.current) return;
      setStatus({ phase: 'idle' });
      onTextRef.current(text);
    } catch (err) {
      if (!aliveRef.current) return;
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ phase: 'error', code: errorCodeFromMessage(message), message });
    } finally {
      stoppingRef.current = false;
    }
  }, []);

  const cancel = useCallback(async () => {
    const phase = statusRef.current.phase;
    setStatus({ phase: 'idle' });
    if (phase === 'listening' || phase === 'starting' || phase === 'transcribing') {
      await rpc('speech/cancel', {}).catch(() => {});
    }
  }, []);

  const dismiss = useCallback(() => setStatus({ phase: 'idle' }), []);

  const toggle = useCallback(() => {
    if (statusRef.current.phase === 'listening') void stop();
    else void start();
  }, [start, stop]);

  return { status, levels, start, stop, cancel, dismiss, toggle };
}
