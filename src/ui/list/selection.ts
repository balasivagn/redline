/** Pure selection helpers for the list (ids are annotation ids). */

export type SelectAllState = 'none' | 'some' | 'all';

export function selectAllState(selected: ReadonlySet<string>, ids: readonly string[]): SelectAllState {
  if (ids.length === 0) return 'none';
  let n = 0;
  for (const id of ids) if (selected.has(id)) n++;
  if (n === 0) return 'none';
  return n === ids.length ? 'all' : 'some';
}

/** Select all when not everything is selected, otherwise clear. */
export function toggleAll(selected: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  return selectAllState(selected, ids) === 'all' ? new Set() : new Set(ids);
}

export function toggleOne(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Drop ids that no longer exist (after a delete / refetch). Returns the same set when nothing changed. */
export function pruneSelection(selected: ReadonlySet<string>, ids: readonly string[]): ReadonlySet<string> {
  if (selected.size === 0) return selected;
  const alive = new Set(ids);
  let changed = false;
  const next = new Set<string>();
  for (const id of selected) {
    if (alive.has(id)) next.add(id);
    else changed = true;
  }
  return changed ? next : selected;
}
