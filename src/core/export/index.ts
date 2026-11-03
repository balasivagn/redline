import { strToU8, zipSync } from 'fflate';
import { EXPORT_SCHEMA } from '../schema';
import type { Annotation, ExportDocument } from '../schema';
import { groupByPage, renderMarkdown, shotPath } from './markdown';
import type { ExportOptions } from './types';

export type { ExportOptions } from './types';

const DEFAULT_TOOL_VERSION = '0.1.0';

/** Agent-ready Markdown, grouped by page, ordered by number. See docs/ARCHITECTURE.md "Export format". */
export function toMarkdown(annotations: Annotation[], opts: ExportOptions = {}): string {
  return renderMarkdown(annotations, opts);
}

export function toExportDocument(annotations: Annotation[], opts: ExportOptions = {}): ExportDocument {
  return {
    schema: EXPORT_SCHEMA,
    exportedAt: (opts.now ?? new Date()).toISOString(),
    tool: { name: 'redline', version: opts.toolVersion ?? DEFAULT_TOOL_VERSION },
    pages: groupByPage(annotations).map((group) => {
      const first = group.annotations[0];
      return {
        pageKey: group.pageKey,
        url: first?.page.url ?? group.pageKey,
        title: first?.page.title ?? '',
        annotations: group.annotations,
      };
    }),
  };
}

/** Zip: review.md, annotations.json, shots/<number>-<id>.png. Missing screenshots are skipped and noted in review.md. */
export async function buildBundle(
  annotations: Annotation[],
  getShot: (shotId: string) => Promise<Blob | undefined>,
  opts: ExportOptions = {},
): Promise<Uint8Array> {
  const now = opts.now ?? new Date();
  const options = { ...opts, now };
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  const available = new Set<string>();

  for (const a of annotations) {
    if (!a.screenshot) continue;
    const { shotId } = a.screenshot;
    try {
      const blob = await getShot(shotId);
      if (!blob) continue;
      // PNG is already compressed: store it.
      files[shotPath(a)] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
      available.add(shotId);
    } catch (error) {
      console.warn(`[redline] could not read screenshot ${shotId}`, error);
    }
  }

  files['review.md'] = strToU8(renderMarkdown(annotations, options, available));
  files['annotations.json'] = strToU8(`${JSON.stringify(toExportDocument(annotations, options), null, 2)}\n`);
  return zipSync(files);
}
