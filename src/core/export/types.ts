export interface ExportOptions {
  /** Default true. Include outerHTML (when short) in Markdown (always included in JSON). */
  includeDomDetails?: boolean;
  /**
   * `standard` (default): compact items; HTML only when short and includeDomDetails is on.
   * `detailed`: always the (stored) HTML, the full computed-styles list, selector and text.
   */
  detail?: 'standard' | 'detailed';
  toolVersion?: string;
  now?: Date;
}
