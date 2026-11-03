/** Small pure text helpers for the comment box. */

export interface InsertResult {
  value: string;
  /** Caret position after the insertion. */
  caret: number;
  /** Range of the inserted text itself (without separator spaces), or null when nothing was inserted. */
  highlight: { start: number; end: number } | null;
}

/**
 * Insert dictated text at the cursor, never replacing existing text. With a selection the text goes
 * after the selection. Adds a separating space when the neighbouring characters would otherwise
 * glue words together.
 */
export function insertAtCursor(value: string, selStart: number, selEnd: number, insertion: string): InsertResult {
  const text = insertion.trim();
  const pos = Math.min(value.length, Math.max(0, Math.max(selStart, selEnd)));
  if (!text) return { value, caret: pos, highlight: null };
  const before = value.slice(0, pos);
  const after = value.slice(pos);
  const prefix = before && !/\s$/.test(before) ? ' ' : '';
  const suffix = after && !/^\s/.test(after) ? ' ' : '';
  const start = before.length + prefix.length;
  const end = start + text.length;
  return { value: before + prefix + text + suffix + after, caret: end + suffix.length, highlight: { start, end } };
}

export type CommentSource = 'typed' | 'voice' | 'mixed';

/** Typed unless dictated segments were inserted; voice when nothing but dictated text remains. */
export function commentSource(text: string, dictated: string[]): CommentSource {
  if (dictated.length === 0) return 'typed';
  let rest = text;
  for (const seg of dictated) rest = rest.replace(seg, '');
  return rest.trim() === '' ? 'voice' : 'mixed';
}

/** 7000 → "0:07". */
export function formatTimer(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function excerpt(text: string, max = 90): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
