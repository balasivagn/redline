import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './time';

const NOW = new Date(2026, 10, 3, 12, 0, 0).getTime(); // local noon, 3 Nov 2026
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HR = 60 * MIN;

describe('formatRelativeTime', () => {
  it('handles just now / minutes / hours', () => {
    expect(formatRelativeTime(ago(10_000), NOW)).toBe('just now');
    expect(formatRelativeTime(ago(2 * MIN), NOW)).toBe('2 min ago');
    expect(formatRelativeTime(ago(59 * MIN), NOW)).toBe('59 min ago');
    expect(formatRelativeTime(ago(HR), NOW)).toBe('1 hr ago');
    expect(formatRelativeTime(ago(5 * HR), NOW)).toBe('5 hr ago');
  });

  it('uses calendar days after 24 h', () => {
    expect(formatRelativeTime(new Date(2026, 10, 2, 9, 0).toISOString(), NOW)).toBe('yesterday');
    expect(formatRelativeTime(new Date(2026, 10, 1, 9, 0).toISOString(), NOW)).toBe('2 days ago');
    expect(formatRelativeTime(new Date(2026, 9, 28, 9, 0).toISOString(), NOW)).toBe('6 days ago');
  });

  it('falls back to a date for older items and includes the year when it differs', () => {
    expect(formatRelativeTime(new Date(2026, 9, 4, 9, 0).toISOString(), NOW)).toBe('Oct 4');
    expect(formatRelativeTime(new Date(2025, 9, 4, 9, 0).toISOString(), NOW)).toBe('Oct 4, 2025');
  });

  it('treats future timestamps as just now and bad input as empty', () => {
    expect(formatRelativeTime(new Date(NOW + HR).toISOString(), NOW)).toBe('just now');
    expect(formatRelativeTime('nope', NOW)).toBe('');
  });
});
