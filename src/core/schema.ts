/**
 * Redline data contract — `redline/v1`.
 *
 * Every annotation is self-describing so an exported file can be processed downstream
 * without the extension. Keep additions backwards compatible: add optional fields, or
 * bump SCHEMA and add a step to `migrateAnnotation`.
 */
import { z } from 'zod';

export const SCHEMA = 'redline/v1' as const;
export const EXPORT_SCHEMA = 'redline/export/v1' as const;

export const rectSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
export type Rect = z.infer<typeof rectSchema>;

export const pageInfoSchema = z.object({
  url: z.string(),
  origin: z.string(),
  path: z.string(),
  title: z.string(),
  viewport: z.object({ width: z.number(), height: z.number(), dpr: z.number() }),
  scroll: z.object({ x: z.number(), y: z.number() }),
  userAgent: z.string(),
});
export type PageInfo = z.infer<typeof pageInfoSchema>;

export const anchorSchema = z.object({
  kind: z.enum(['pin', 'area']),
  /** Unique, as-stable-as-possible CSS selector for the anchor element. */
  selector: z.string(),
  xpath: z.string(),
  /** Tag + trimmed text fingerprint used when the selector no longer matches. */
  textHint: z.string().optional(),
  /** Pin: point inside the element as 0..1 ratios of its box. */
  offset: z.object({ xRatio: z.number(), yRatio: z.number() }),
  /** Area: the drawn box relative to the anchor element's box, as 0..1(+) ratios. */
  areaRatio: rectSchema.optional(),
  /** Fallback when no element can be found: document coordinates (CSS px). */
  pagePoint: z.object({ x: z.number(), y: z.number() }),
  /** Area fallback in document coordinates. */
  pageRect: rectSchema.optional(),
});
export type Anchor = z.infer<typeof anchorSchema>;

export const sourceLocationSchema = z.object({
  /** Normalised, project-relative where possible (dev-server prefixes stripped). */
  file: z.string(),
  line: z.number().optional(),
  column: z.number().optional(),
  /** Unmodified location as reported by the framework/dev server. */
  raw: z.string().optional(),
});
export type SourceLocation = z.infer<typeof sourceLocationSchema>;

export const componentFrameSchema = z.object({
  component: z.string(),
  /** Where this component was USED (its JSX call site in the parent), when known. */
  usedAt: sourceLocationSchema.optional(),
  /** true for library/framework components (source in node_modules or a known internal). */
  library: z.boolean().optional(),
});
export type ComponentFrame = z.infer<typeof componentFrameSchema>;

export const frameworkInfoSchema = z.object({
  name: z.enum(['react', 'vue', 'svelte', 'angular', 'unknown']),
  /** Nearest app (non-library) component. */
  component: z.string().optional(),
  /** Nearest first, app components only, e.g. ["PricingCard", "PricingGrid", "Page"]. */
  componentStack: z.array(z.string()).optional(),
  /** Where the selected DOM element itself is written (e.g. inside a shared primitive). */
  source: sourceLocationSchema.optional(),
  /** Best place to edit: the call site of the nearest app component that renders this element. */
  usedAt: sourceLocationSchema.optional(),
  /** Full chain nearest first, including library frames (flagged), each with its call site. */
  frames: z.array(componentFrameSchema).optional(),
});
export type FrameworkInfo = z.infer<typeof frameworkInfoSchema>;

export const domSnapshotSchema = z.object({
  tag: z.string(),
  id: z.string().optional(),
  classes: z.array(z.string()),
  role: z.string().optional(),
  ariaLabel: z.string().optional(),
  testId: z.string().optional(),
  /** innerText, whitespace-collapsed, max 200 chars. */
  text: z.string(),
  /** outerHTML truncated to ~2 KB. */
  outerHTML: z.string(),
  /** Viewport-relative box at capture time (CSS px). */
  rect: rectSchema,
  /** Small curated subset of computed styles. */
  styles: z.record(z.string(), z.string()),
  /** Short descriptors from parent to root, e.g. ["div.card", "section.pricing", "main"]. */
  ancestors: z.array(z.string()),
  framework: frameworkInfoSchema.optional(),
});
export type DomSnapshot = z.infer<typeof domSnapshotSchema>;

export const annotationSchema = z.object({
  schema: z.literal(SCHEMA),
  id: z.string(),
  /** Display number on the page (①②…), stable once assigned. */
  number: z.number().int().positive(),
  pageKey: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  page: pageInfoSchema,
  comment: z.object({ text: z.string(), source: z.enum(['typed', 'voice', 'mixed']) }),
  /** Free-form for now; type/status will live here or in `meta` later. */
  tags: z.array(z.string()).default([]),
  meta: z.record(z.string(), z.unknown()).default({}),
  anchor: anchorSchema,
  dom: domSnapshotSchema,
  screenshot: z
    .object({
      shotId: z.string(),
      width: z.number(),
      height: z.number(),
      /** Absolute file path written by the local helper (~/.redline/shots/…), when available. */
      path: z.string().optional(),
    })
    .optional(),
});
export type Annotation = z.infer<typeof annotationSchema>;

/** One stored page record (chrome.storage.local key `page:<pageKey>`). */
export const pageRecordSchema = z.object({
  pageKey: z.string(),
  url: z.string(),
  origin: z.string(),
  path: z.string(),
  title: z.string(),
  updatedAt: z.string(),
  nextNumber: z.number().int().positive(),
  annotations: z.array(annotationSchema),
});
export type PageRecord = z.infer<typeof pageRecordSchema>;

export interface PageSummary {
  pageKey: string;
  url: string;
  origin: string;
  path: string;
  title: string;
  count: number;
  updatedAt: string;
}

export interface ExportDocument {
  schema: typeof EXPORT_SCHEMA;
  exportedAt: string;
  tool: { name: 'redline'; version: string };
  pages: Array<{ pageKey: string; url: string; title: string; annotations: Annotation[] }>;
}

/** Upgrade any stored/imported shape to the current schema. Throws on garbage. */
export function migrateAnnotation(raw: unknown): Annotation {
  return annotationSchema.parse(raw);
}

export function newId(prefix = 'ann'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
