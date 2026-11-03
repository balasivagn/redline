/** Short relative time: "just now", "2 min ago", "1 hr ago", "yesterday", "3 days ago", "Oct 4". */
export function formatRelativeTime(iso: string, now: number | Date = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const diff = Math.max(0, nowMs - then);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;

  // Calendar-day difference in local time, so 23:50 yesterday reads "yesterday" at 00:10.
  const startOfDay = (ms: number) => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const days = Math.round((startOfDay(nowMs) - startOfDay(then)) / 86_400_000);
  if (days <= 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const sameYear = new Date(then).getFullYear() === new Date(nowMs).getFullYear();
  return new Date(then).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
