import type { PageSummary } from '../../core/schema';

export interface OriginGroup {
  origin: string;
  host: string;
  count: number;
  pages: PageSummary[];
}

export type CheckState = 'none' | 'some' | 'all';

function hostOf(origin: string): string {
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
}

/** Origins by most recent activity, pages inside by most recent update. */
export function groupByOrigin(pages: readonly PageSummary[]): OriginGroup[] {
  const map = new Map<string, PageSummary[]>();
  for (const p of pages) {
    const list = map.get(p.origin);
    if (list) list.push(p);
    else map.set(p.origin, [p]);
  }
  const latest = (list: PageSummary[]) => list.reduce((m, p) => (p.updatedAt > m ? p.updatedAt : m), '');
  const groups = [...map.entries()].map(([origin, list]) => ({
    origin,
    host: hostOf(origin),
    count: list.reduce((n, p) => n + p.count, 0),
    pages: [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.path.localeCompare(b.path))),
  }));
  return groups.sort((a, b) => (latest(a.pages) < latest(b.pages) ? 1 : latest(a.pages) > latest(b.pages) ? -1 : a.host.localeCompare(b.host)));
}

export function originCheckState(group: OriginGroup, checked: ReadonlySet<string>): CheckState {
  const n = group.pages.filter((p) => checked.has(p.pageKey)).length;
  return n === 0 ? 'none' : n === group.pages.length ? 'all' : 'some';
}

export function toggleOrigin(group: OriginGroup, checked: ReadonlySet<string>): Set<string> {
  const next = new Set(checked);
  const all = originCheckState(group, checked) === 'all';
  for (const p of group.pages) {
    if (all) next.delete(p.pageKey);
    else next.add(p.pageKey);
  }
  return next;
}

export function togglePage(checked: ReadonlySet<string>, pageKey: string): Set<string> {
  const next = new Set(checked);
  if (next.has(pageKey)) next.delete(pageKey);
  else next.add(pageKey);
  return next;
}

export function pageFromHash(hash: string): string | null {
  const m = /^#?page=(.+)$/.exec(hash);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

export const hashForPage = (pageKey: string) => `#page=${encodeURIComponent(pageKey)}`;
