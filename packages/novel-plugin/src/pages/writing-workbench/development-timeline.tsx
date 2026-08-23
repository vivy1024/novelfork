import { NarrativeMemoryGraphWorkspace } from "./NarrativeMemoryGraphWorkspace";
import type { NarrativeMemoryView } from "./narrative-memory-graph-model";

/**
 * 「发展历程」是叙事记忆的只读聚合入口。
 *
 * 它不另建数据接口，直接复用 NarrativeMemoryGraphWorkspace 的
 * `/narrative-memory/graph` 读取链路；scope=read 仅显式标记该视图不会写入
 * Narrative Memory。默认从时间线开始，其他四个既有图谱由工作区的固定主题切换承载。
 */
export interface DevelopmentTimelineViewProps {
  readonly bookId: string;
  /** 最近一次 memory.read 对应的章节，用于在时间线中标记当前写作位置。 */
  readonly currentChapter?: number;
  readonly scope?: "read";
  readonly onSelectNode?: (nodeId: string) => void;
  readonly onOpenEntityDetail?: (entity: string) => void;
}

export function DevelopmentTimelineView({
  bookId,
  currentChapter,
  scope = "read",
  onSelectNode,
  onOpenEntityDetail,
}: DevelopmentTimelineViewProps) {
  const initialView: NarrativeMemoryView = "timeline";

  return (
    <section
      className="h-[min(72vh,720px)] min-h-[440px]"
      data-slot="development-timeline-view"
      data-testid="development-timeline-view"
      data-source-scope={scope}
    >
      <NarrativeMemoryGraphWorkspace
        bookId={bookId}
        initialView={initialView}
        mode="development"
        dataScope={scope}
        currentChapter={currentChapter}
        onSelectNode={onSelectNode}
        onOpenEntityDetail={onOpenEntityDetail}
      />
    </section>
  );
}

export const DevelopmentTimeline = DevelopmentTimelineView;
export type DevelopmentTimelineProps = DevelopmentTimelineViewProps;
