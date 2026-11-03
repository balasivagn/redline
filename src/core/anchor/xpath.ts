/** Absolute xpath such as `/html/body/div[2]/span` (index only when same-tag siblings exist). */
export function xpathFor(el: Element): string {
  const steps: string[] = [];
  let cur: Element | null = el;
  while (cur) {
    const tag = cur.localName;
    const parent: Element | null = cur.parentElement;
    if (!parent) {
      steps.unshift(tag);
      break;
    }
    let index = 0;
    let total = 0;
    for (const sib of Array.from(parent.children)) {
      if (sib.localName === tag) {
        total++;
        if (sib === cur) index = total;
      }
    }
    steps.unshift(total > 1 ? `${tag}[${index}]` : tag);
    cur = parent;
  }
  return '/' + steps.join('/');
}

/** Resolve an xpath produced by `xpathFor` (no dependency on document.evaluate). */
export function resolveXpath(xpath: string, doc: Document): Element | null {
  const steps = xpath.split('/').filter(Boolean);
  if (steps.length === 0) return null;
  let cur: Element | null = null;
  for (let i = 0; i < steps.length; i++) {
    const m = /^([^[\]]+)(?:\[(\d+)\])?$/.exec(steps[i]!);
    if (!m) return null;
    const tag = m[1]!.toLowerCase();
    const want = m[2] ? Number(m[2]) : 1;
    if (i === 0) {
      const root = doc.documentElement;
      if (!root || root.localName !== tag) return null;
      cur = root;
      continue;
    }
    let n = 0;
    let next: Element | null = null;
    for (const child of Array.from(cur!.children)) {
      if (child.localName === tag && ++n === want) {
        next = child;
        break;
      }
    }
    if (!next) return null;
    cur = next;
  }
  return cur;
}
