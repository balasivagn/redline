import type { Annotation } from '../../core/schema';

/** "div#hero.card.card--pro" from the DOM snapshot (at most 2 classes, keeps rows short). */
export function describeDom(dom: Annotation['dom']): string {
  const tag = dom.tag.toLowerCase();
  const id = dom.id ? `#${dom.id}` : '';
  const classes = dom.classes.filter(Boolean).slice(0, 2).map((c) => `.${c}`).join('');
  return `${tag}${id}${classes}`;
}

/** Order annotations by the order of `pageKeys`, then by display number. */
export function sortAnnotations(annotations: Annotation[], pageKeys: readonly string[]): Annotation[] {
  const rank = new Map(pageKeys.map((k, i) => [k, i] as const));
  return [...annotations].sort(
    (a, b) => (rank.get(a.pageKey) ?? 0) - (rank.get(b.pageKey) ?? 0) || a.number - b.number,
  );
}
