import type { Anchor, Annotation, DomSnapshot, FrameworkInfo, Rect } from '../../core/schema';
import type { CommentSource } from './text';

/** What the comment box is editing. `getRect` returns the live viewport rect of the target. */
export type Draft =
  | {
      kind: 'new';
      anchorKind: 'pin' | 'area';
      anchor: Anchor;
      element: Element;
      dom: DomSnapshot;
      framework: Promise<FrameworkInfo | undefined>;
      getRect: () => Rect;
    }
  | { kind: 'existing'; annotation: Annotation; getRect: () => Rect };

export interface SaveRequest {
  text: string;
  source: CommentSource;
  dictated: string[];
  withShot: boolean;
}
