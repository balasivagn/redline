import { describe, expect, it } from 'vitest';
import { errorCodeFromMessage, isNotSetUp, pushLevel } from './voice';

describe('voice helpers', () => {
  it('recovers error codes from rpc messages', () => {
    expect(errorCodeFromMessage('speech: mic-permission denied')).toBe('mic-permission');
    expect(errorCodeFromMessage('no-engine available')).toBe('no-engine');
    expect(errorCodeFromMessage('boom')).toBe('transcribe-failed');
  });
  it('groups the "not set up" codes', () => {
    expect(['no-engine', 'helper-missing', 'no-model'].every((c) => isNotSetUp(c as never))).toBe(true);
    expect(isNotSetUp('mic-permission')).toBe(false);
  });
  it('keeps a bounded, clamped level history', () => {
    let l: number[] = [];
    for (let i = 0; i < 30; i++) l = pushLevel(l, i / 10, 5);
    expect(l).toHaveLength(5);
    expect(Math.max(...l)).toBe(1);
    expect(pushLevel([], NaN)).toEqual([0]);
  });
});
