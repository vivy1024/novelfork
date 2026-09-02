/**
 * 「发展历程」改为 tidy-tree：章 → 该章事件。
 * 不再走 React Flow 图谱。scope=read 仍表示只读，不写 Narrative Memory。
 */

import { CanonicalTreesPanel } from "./CanonicalTreesPanel";

export interface DevelopmentTimelineViewProps {
  readonly bookId: string;
  readonly currentChapter?: number;
  readonly scope?: "read";
  readonly onSelectNode?: (nodeId: string) => void;
  readonly onOpenEntityDetail?: (entity: string, entryId?: string) => void;
  readonly onOpenChapter?: (chapterNumber: number) => void;
  readonly frameClassName?: string;
  readonly initialFocusEntity?: string;
}

export function DevelopmentTimelineView({
  bookId,
  scope = "read",
  onSelectNode,
  onOpenEntityDetail,
  onOpenChapter,
  frameClassName = "h-[min(72vh,720px)] min-h-[440px]",
}: DevelopmentTimelineViewProps) {
  return (
    <section
      className={frameClassName}
      data-slot="development-timeline-view"
      data-testid="development-timeline-view"
      data-source-scope={scope}
    >
      <CanonicalTreesPanel
        bookId={bookId}
        initialKind="timeline"
        showSwitcher={false}
        {...(onOpenEntityDetail
          ? {
              onOpenEntry: (entryId: string, label: string) => {
                onSelectNode?.(entryId);
                onOpenEntityDetail(label, entryId);
              },
            }
          : onSelectNode
            ? { onOpenEntry: (entryId: string) => onSelectNode(entryId) }
            : {})}
        {...(onOpenChapter ? { onOpenChapter } : {})}
      />
    </section>
  );
}

export const DevelopmentTimeline = DevelopmentTimelineView;
export type DevelopmentTimelineProps = DevelopmentTimelineViewProps;
