import { rpc } from '../../core/rpc';
import { buildBundle, toExportDocument, toMarkdown } from '../../core/export';
import type { Annotation } from '../../core/schema';

export type CopyFormat = 'markdown' | 'json';
/** Built-in list scopes; other surfaces (e.g. the All reviews page) pass their own ids. */
export type ListScope = 'selected' | 'page' | 'all';

export const FORMAT_LABEL: Record<CopyFormat, string> = { markdown: 'Markdown', json: 'JSON' };

export function formatAnnotations(annotations: Annotation[], format: CopyFormat): string {
  if (format === 'json') return `${JSON.stringify(toExportDocument(annotations), null, 2)}\n`;
  return toMarkdown(annotations);
}

export function copiedMessage(count: number, format: CopyFormat): string {
  return `Copied ${count} comment${count === 1 ? '' : 's'} as ${FORMAT_LABEL[format]}`;
}

/** All comments on every page (listAll, then listPages for every key). */
export async function loadAllAnnotations(): Promise<Annotation[]> {
  const pages = await rpc('ann/listAll', {});
  if (pages.length === 0) return [];
  return rpc('ann/listPages', { pageKeys: pages.map((p) => p.pageKey) });
}

export interface ScopeContext {
  /** Annotations currently shown in the list (already in display order). */
  annotations: readonly Annotation[];
  selectedIds: ReadonlySet<string>;
  loadAll?: () => Promise<Annotation[]>;
}

/** Turn a copy scope into the annotations to export. */
export async function resolveScope(scope: ListScope, ctx: ScopeContext): Promise<Annotation[]> {
  switch (scope) {
    case 'selected':
      return ctx.annotations.filter((a) => ctx.selectedIds.has(a.id));
    case 'page':
      return [...ctx.annotations];
    case 'all':
      return (ctx.loadAll ?? loadAllAnnotations)();
  }
}

/** Default scope: the selection when there is one, otherwise the whole list. */
export function defaultScope(selectedCount: number): ListScope {
  return selectedCount > 0 ? 'selected' : 'page';
}

/** Selected is disabled when nothing is selected, so fall back instead of exporting nothing. */
export function effectiveScope(chosen: ListScope | null, selectedCount: number): ListScope {
  if (chosen === 'selected' && selectedCount === 0) return 'page';
  return chosen ?? defaultScope(selectedCount);
}

export async function writeClipboard(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fall through to the legacy path (page permissions policy, unfocused document, …)
  }
  const doc = document;
  const ta = doc.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
  const previous = doc.activeElement as HTMLElement | null;
  doc.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = doc.execCommand('copy');
  } finally {
    ta.remove();
    previous?.focus?.();
  }
  if (!ok) throw new Error('Clipboard is not available');
}

/** Smallest side (px) a stored screenshot may have before it counts as a failed capture. */
export const MIN_SHOT_SIDE = 16;

/**
 * Screenshots an agent will not receive when the Markdown is pasted: no saved file path (text
 * only references a path inside the .zip) or a degenerate size (blank / 1 px capture).
 */
export function unsendableShots(annotations: readonly Annotation[]): Annotation[] {
  return annotations.filter((a) => {
    const s = a.screenshot;
    return !!s && (!s.path || s.width < MIN_SHOT_SIDE || s.height < MIN_SHOT_SIDE);
  });
}

export function shotWarning(annotations: readonly Annotation[], format: CopyFormat): string | undefined {
  if (format !== 'markdown') return undefined;
  const bad = unsendableShots(annotations);
  if (bad.length === 0) return undefined;
  const tiny = bad.some((a) => a.screenshot && (a.screenshot.width < MIN_SHOT_SIDE || a.screenshot.height < MIN_SHOT_SIDE));
  const n = bad.length;
  return tiny
    ? `Copied the text, but ${n === 1 ? 'a screenshot is' : `${n} screenshots are`} blank or too small. The agent gets no usable image. Retake it.`
    : `Copied the text, but ${n === 1 ? 'a screenshot has' : `${n} screenshots have`} no saved file, so the agent gets text only. Install the Redline helper to save screenshots.`;
}

/** Copies to the clipboard; throws a warning (after copying) when an agent would get text without its image. */
export async function copyAnnotations(annotations: Annotation[], format: CopyFormat): Promise<string> {
  await writeClipboard(formatAnnotations(annotations, format));
  const warning = shotWarning(annotations, format);
  if (warning) throw new Error(warning);
  return copiedMessage(annotations.length, format);
}

/** data:image/png;base64,… → Blob (manual decode: page CSP may block fetch(data:) in content scripts). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, comma);
  const mime = /^data:([^;,]+)/.exec(header)?.[1] ?? 'application/octet-stream';
  const payload = dataUrl.slice(comma + 1);
  if (!header.includes(';base64')) return new Blob([decodeURIComponent(payload)], { type: mime });
  const bin = atob(payload);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function bundleFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `redline-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.zip`;
}

export async function downloadBundle(annotations: Annotation[]): Promise<string> {
  const bytes = await buildBundle(annotations, async (shotId) => {
    const res = await rpc('shot/get', { shotId });
    return res ? dataUrlToBlob(res.dataUrl) : undefined;
  });
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = bundleFileName();
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return `Downloaded ${annotations.length} comment${annotations.length === 1 ? '' : 's'} as .zip`;
}
