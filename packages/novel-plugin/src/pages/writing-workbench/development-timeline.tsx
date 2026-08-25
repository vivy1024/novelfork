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
  readonly onOpenEntityDetail?: (entity: string, entryId?: string) => void;
  /**
   * 外层容器高度类。默认保持面板内嵌的 72vh 高度；
   * 大屏画布（StoryProgressionCanvas）传入 "h-full min-h-[80vh]" 以铺满流视图标准。
   */
  readonly frameClassName?: string;
  /** 初始聚焦实体（角色名等），透传给底层图谱工作区。 */
  readonly initialFocusEntity?: string;
}

export function DevelopmentTimelineView({
  bookId,
  currentChapter,
  scope = "read",
  onSelectNode,
  onOpenEntityDetail,
  frameClassName = "h-[min(72vh,720px)] min-h-[440px]",
  initialFocusEntity,
}: DevelopmentTimelineViewProps) {
  const initialView: NarrativeMemoryView = "timeline";

  return (
    <section
      className={frameClassName}
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
        initialFocusEntity={initialFocusEntity}
        onSelectNode={onSelectNode}
        onOpenEntityDetail={onOpenEntityDetail}
      />
    </section>
  );
}

export const DevelopmentTimeline = DevelopmentTimelineView;
export type DevelopmentTimelineProps = DevelopmentTimelineViewProps;
