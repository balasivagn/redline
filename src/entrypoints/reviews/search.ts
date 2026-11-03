import type { Annotation, PageSummary } from '../../core/schema';

export interface PageMatch {
  page: PageSummary;
  /** Comments on this page whose own text/selector/… match every search word. */
  matches: number;
}

const norm = (s: string) => s.toLowerCase();
export const tokenize = (query: string) => norm(query).split(/\s+/).filter(Boolean);

const pageHaystack = (p: PageSummary) => norm(`${p.title}\n${p.url}\n${p.pageKey}`);
const annotationHaystack = (a: Annotation) =>
  norm(`${a.comment.text}\n${a.anchor.selector}\n${a.page.title}\n${a.page.url}\n${a.dom.text}\n${a.dom.framework?.component ?? ''}`);

/**
 * Words are ANDed. A word matches a page when it appears in the page's title/URL or in any of its
 * comments (comment text, selector, …). `annotationsByPage` may be undefined while still loading:
 * then only title/URL are searched.
 */
export function filterPages(
  pages: readonly PageSummary[],
  annotationsByPage: Readonly<Record<string, readonly Annotation[]>> | undefined,
  query: string,
): PageMatch[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return pages.map((page) => ({ page, matches: 0 }));
  const out: PageMatch[] = [];
  for (const page of pages) {
    const ph = pageHaystack(page);
    const anns = (annotationsByPage?.[page.pageKey] ?? []).map(annotationHaystack);
    if (!tokens.every((t) => ph.includes(t) || anns.some((h) => h.includes(t)))) continue;
    out.push({ page, matches: anns.filter((h) => tokens.every((t) => h.includes(t))).length });
  }
  return out;
}
