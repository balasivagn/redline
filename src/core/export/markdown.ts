import type { Annotation, SourceLocation } from '../schema';
import type { ExportOptions } from './types';

export interface PageGroup {
  pageKey: string;
  annotations: Annotation[];
}

/** Group by page in order of first appearance; annotations within a page sorted by number. */
export function groupByPage(annotations: Annotation[]): PageGroup[] {
  const groups = new Map<string, PageGroup>();
  for (const annotation of annotations) {
    const group = groups.get(annotation.pageKey);
    if (group) group.annotations.push(annotation);
    else groups.set(annotation.pageKey, { pageKey: annotation.pageKey, annotations: [annotation] });
  }
  const out = [...groups.values()];
  for (const group of out) group.annotations.sort((a, b) => a.number - b.number);
  return out;
}

export const shotPath = (a: Annotation): string => `shots/${a.number}-${a.id}.png`;

const INTRO =
  '> Review comments to implement. Each comment says what to change and where: ' +
  'selector, visible text, component and source file when known.';

const pad = (n: number) => String(n).padStart(2, '0');
const formatDate = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const round = (n: number) => Math.round(n);

function hostOf(origin: string): string {
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
}

/** Inline code span that survives backticks inside the content. */
function codeSpan(text: string): string {
  const flat = text.replace(/\s*\n\s*/g, ' ');
  const longest = Math.max(0, ...(flat.match(/`+/g) ?? []).map((m) => m.length));
  const fence = '`'.repeat(longest + 1);
  const pad = flat.startsWith('`') || flat.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${flat}${pad}${fence}`;
}

function fenced(lang: string, body: string): string {
  const longest = Math.max(2, ...(body.match(/`+/g) ?? []).map((m) => m.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${lang}\n${body}\n${fence}`;
}

/** Keep comment text verbatim, except lines that would turn into headings get a backslash escape. */
export function escapeCommentText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/^( {0,3})#/gm, '$1\\#');
}

/** Classes that are one-off utilities (`text-[2.25rem]`, `md:flex`) and say little to a human. */
const noisyClass = (c: string) => c.includes('[') || c.includes(':');

/** Short element descriptor without arbitrary-value / variant utility classes: `h2.font-syne.font-semibold`. */
export function describeElement(a: Annotation, maxClasses = 3): string {
  const { tag, id, classes } = a.dom;
  const cls = classes.filter((c) => c && !noisyClass(c)).slice(0, maxClasses).map((c) => `.${c}`).join('');
  return `${tag}${id ? `#${id}` : ''}${cls}`;
}

const TAG_ROLE: Record<string, string> = {
  h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
  button: 'button', a: 'link', img: 'image', svg: 'image', picture: 'image',
  input: 'input', textarea: 'input', select: 'input',
  ul: 'list', ol: 'list', dl: 'list',
  section: 'section', article: 'section', aside: 'section', nav: 'section', main: 'section', header: 'section', footer: 'section',
};
const ARIA_ROLE: Record<string, string> = {
  heading: 'heading', button: 'button', link: 'link', img: 'image', textbox: 'input', searchbox: 'input', combobox: 'input',
  checkbox: 'input', radio: 'input', switch: 'input', list: 'list', navigation: 'section', region: 'section',
};

function roleWord(a: Annotation): string {
  return (a.dom.role && ARIA_ROLE[a.dom.role]) || TAG_ROLE[a.dom.tag] || 'element';
}

function shortText(text: string, max = 40): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function areaSize(a: Annotation): string | undefined {
  const { pageRect, areaRatio } = a.anchor;
  if (pageRect) return `${round(pageRect.width)}×${round(pageRect.height)}`;
  if (areaRatio) return `${round(areaRatio.width * a.dom.rect.width)}×${round(areaRatio.height * a.dom.rect.height)}`;
  return undefined;
}

function locText(loc: SourceLocation): string {
  return `${loc.file}${loc.line !== undefined ? `:${loc.line}` : ''}`;
}

const sameLoc = (a: SourceLocation, b: SourceLocation) => a.file === b.file && a.line === b.line;

function heading(a: Annotation, level: string): string {
  let title: string;
  if (a.anchor.kind === 'area') {
    const size = areaSize(a);
    title = `area in ${describeElement(a)}${size ? ` (${size})` : ''}`;
  } else {
    const text = shortText(a.dom.text);
    const label = shortText(a.dom.ariaLabel ?? '');
    if (text) title = `${JSON.stringify(text)} ${roleWord(a)}`;
    else if (label) title = `${JSON.stringify(label)} ${roleWord(a)}`;
    else title = describeElement(a);
  }
  const framework = a.dom.framework;
  const component = framework?.component;
  if (component) {
    const parent = framework.componentStack?.[1];
    title += `: <${component}>${parent ? ` in ${parent}` : ''}`;
  }
  return `${level} ${a.number}. ${title}`;
}

// ---- style summary -----------------------------------------------------------------------

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** `rgb(0, 0, 0)` / `rgba(…)` / `color(srgb …)` → `#000000`; undefined when transparent or unparseable. */
export function colorToHex(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'transparent') return undefined;
  if (/^#[0-9a-f]{3,8}$/.test(v)) return v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v;
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(v);
  if (!m) return undefined;
  let alpha = 1;
  if (m[4] !== undefined) alpha = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (alpha === 0) return undefined;
  const hex = `#${hex2(Number(m[1]))}${hex2(Number(m[2]))}${hex2(Number(m[3]))}`;
  return alpha < 1 ? `${hex}${hex2(alpha * 255)}` : hex;
}

const num = (v: string | undefined): string | undefined => {
  const m = v && /^(-?[\d.]+)px$/.exec(v.trim());
  return m ? String(Math.round(parseFloat(m[1]!) * 10) / 10) : undefined;
};

function firstFamily(v: string | undefined): string | undefined {
  const first = v?.split(',')[0]?.trim().replace(/^["']|["']$/g, '');
  return first || undefined;
}

/** `Syne 36/45 · 600 · #000000 · bg #fff · border 1px #ddd · 400×45` */
export function styleSummary(a: Annotation): string {
  const st = a.dom.styles;
  const parts: string[] = [];
  const family = firstFamily(st['font-family']);
  const size = num(st['font-size']);
  const lh = num(st['line-height']);
  const font = [family, size && (lh ? `${size}/${lh}` : size)].filter(Boolean).join(' ');
  if (font) parts.push(font);
  const weight = st['font-weight'];
  if (weight && weight !== '400' && weight !== 'normal') parts.push(weight);
  const color = colorToHex(st['color']);
  if (color) parts.push(color);
  const bg = colorToHex(st['background-color']);
  if (bg) parts.push(`bg ${bg}`);
  const border = st['border'];
  if (border && !/^0(px)?\s/.test(border) && !border.startsWith('none')) {
    const bm = /^([\d.]+px)\s+\w+\s+(.*)$/.exec(border);
    parts.push(bm ? `border ${bm[1]}${colorToHex(bm[2]) ? ` ${colorToHex(bm[2])}` : ''}` : `border ${border}`);
  }
  parts.push(`${round(a.dom.rect.width)}×${round(a.dom.rect.height)}`);
  return parts.join(' · ');
}

// ---- item --------------------------------------------------------------------------------

const HTML_STANDARD_MAX = 400;

function renderItem(a: Annotation, level: string, opts: { includeDom: boolean; detailed: boolean }, availableShots?: Set<string>): string {
  const { includeDom, detailed } = opts;
  const fw = a.dom.framework;
  const lines: string[] = [heading(a, level), escapeCommentText(a.comment.text), ''];

  const chain = (fw?.componentStack ?? []).slice().reverse();
  if (chain.length) lines.push(`- where: ${chain.join(' › ')}`);

  const usedAt = fw?.usedAt;
  const source = fw?.source;
  if (usedAt) {
    const renders = source && !sameLoc(usedAt, source) ? `  (renders ${locText(source)})` : '';
    lines.push(`- edit at: ${locText(usedAt)}${renders}`);
  } else if (source) {
    lines.push(`- source: ${locText(source)}`);
  }

  const element = describeElement(a, 4);
  lines.push(`- element: ${a.dom.tag} · ${codeSpan(element)}`);
  if (detailed || (!usedAt && !source)) lines.push(`- selector: ${codeSpan(a.anchor.selector)}`);
  if (a.dom.testId) lines.push(`- testId: ${codeSpan(a.dom.testId)}`);
  if (detailed) {
    if (a.dom.text) lines.push(`- text: ${JSON.stringify(a.dom.text)}`);
    if (a.dom.ariaLabel) lines.push(`- aria-label: ${JSON.stringify(a.dom.ariaLabel)}`);
    if (a.dom.role) lines.push(`- role: ${codeSpan(a.dom.role)}`);
  }
  lines.push(`- style: ${styleSummary(a)}`);

  if (a.screenshot) {
    const rel = shotPath(a);
    const inBundle = availableShots !== undefined;
    const missing = inBundle && !availableShots.has(a.screenshot.shotId);
    if (inBundle && !missing) lines.push(`- screenshot: ${rel}`);
    else if (a.screenshot.path) lines.push(`- screenshot: ${a.screenshot.path}`);
    else if (missing) lines.push(`- screenshot: not available (${rel})`);
    else lines.push(`- screenshot: ${rel} (in the exported .zip)`);
  }
  if (a.page.url.includes('?')) lines.push(`- url: ${a.page.url}`);
  if (a.tags.length > 0) lines.push(`- tags: ${a.tags.join(', ')}`);
  if (detailed) {
    const styles = Object.entries(a.dom.styles).map(([k, v]) => `${k}: ${v}`).join('; ');
    if (styles) lines.push(`- styles: ${codeSpan(styles)}`);
  }
  const html = a.dom.outerHTML;
  if (html && (detailed || (includeDom && html.length <= HTML_STANDARD_MAX))) lines.push('', fenced('html', html));
  return lines.join('\n');
}

function pageLine(first: Annotation, now: Date): string {
  const { title, viewport } = first.page;
  return `Page: "${title}" · ${round(viewport.width)}×${round(viewport.height)} @${viewport.dpr}x · ${formatDate(now)}`;
}

const pageLabel = (a: Annotation) => `${hostOf(a.page.origin)}${a.page.path}`;

/**
 * Render Markdown. `availableShots` (shot ids that exist) lets the bundle flag missing screenshots;
 * when omitted every screenshot path is listed as-is.
 */
export function renderMarkdown(annotations: Annotation[], opts: ExportOptions = {}, availableShots?: Set<string>): string {
  const detailed = opts.detail === 'detailed';
  const itemOpts = { includeDom: opts.includeDomDetails ?? true, detailed };
  const now = opts.now ?? new Date();
  const groups = groupByPage(annotations);
  const out: string[] = [];

  if (groups.length <= 1) {
    const group = groups[0];
    const first = group?.annotations[0];
    if (!group || !first) {
      out.push('# Redline review — 0 comments', '', INTRO);
    } else {
      out.push(`# Redline review — ${pageLabel(first)}`, '', INTRO, '', pageLine(first, now));
      for (const a of group.annotations) out.push('', renderItem(a, '##', itemOpts, availableShots));
    }
  } else {
    const total = groups.reduce((n, g) => n + g.annotations.length, 0);
    out.push(`# Redline review — ${total} ${total === 1 ? 'comment' : 'comments'} on ${groups.length} pages`, '', INTRO);
    for (const group of groups) {
      const first = group.annotations[0];
      if (!first) continue;
      out.push('', `## ${pageLabel(first)}`, '', pageLine(first, now));
      for (const a of group.annotations) out.push('', renderItem(a, '###', itemOpts, availableShots));
    }
  }
  return `${out.join('\n')}\n`;
}
