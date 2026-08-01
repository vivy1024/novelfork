export type NarrativeNodeType =
  | "chapter"
  | "event"
  | "conflict"
  | "foreshadow"
  | "payoff"
  | "character-arc"
  | "setting";

export type NarrativeEdgeType =
  | "causes"
  | "reveals"
  | "escalates"
  | "resolves"
  | "foreshadows"
  | "pays-off"
  | "contradicts"
  | "supports";

export type NarrativeEdgeConfidence = "explicit" | "inferred" | "agent-proposed";

export interface NarrativeResourceRef {
  readonly kind: string;
  readonly id: string;
  readonly bookId?: string;
  readonly title?: string;
  readonly chapterNumber?: number;
  readonly path?: string;
}

export interface NarrativeLine {
  readonly id: string;
  readonly bookId: string;
  readonly title: string;
  readonly summary?: string;
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
  readonly updatedAt?: string;
}

export interface NarrativeNode {
  readonly id: string;
  readonly bookId: string;
  readonly type: NarrativeNodeType;
  readonly title: string;
  readonly summary?: string;
  readonly sourceRef?: NarrativeResourceRef;
  readonly chapterNumber?: number;
  readonly status?: string;
}

export interface NarrativeEdge {
  readonly id: string;
  readonly bookId: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly type: NarrativeEdgeType;
  readonly label?: string;
  readonly confidence: NarrativeEdgeConfidence;
}

export interface StoryBeat {
  readonly id: string;
  readonly bookId: string;
  readonly title: string;
  readonly summary?: string;
  readonly chapterNumber?: number;
  readonly nodeIds: readonly string[];
}

export interface ConflictThread {
  readonly id: string;
  readonly bookId: string;
  readonly title: string;
  readonly status: "open" | "escalating" | "paused" | "resolved";
  readonly nodeIds: readonly string[];
  readonly nextExpectedChapter?: number;
}

export interface ForeshadowThread {
  readonly id: string;
  readonly bookId: string;
  readonly title: string;
  readonly status: "open" | "due" | "paid-off" | "abandoned";
  readonly setupNodeIds: readonly string[];
  readonly dueChapter?: number;
}

export interface PayoffLink {
  readonly id: string;
  readonly bookId: string;
  readonly foreshadowThreadId: string;
  readonly payoffNodeId: string;
  readonly summary?: string;
}

export interface NarrativeWarning {
  readonly id?: string;
  readonly type: "open-foreshadow" | "stalled-conflict" | "missing-payoff" | "chapter-drift" | "mainline-risk" | string;
  readonly severity: "info" | "warning" | "critical";
  readonly summary: string;
  readonly nodeIds?: readonly string[];
}

export interface NarrativeLineSnapshot {
  readonly bookId: string;
  readonly lines?: readonly NarrativeLine[];
  readonly nodes: readonly NarrativeNode[];
  readonly edges: readonly NarrativeEdge[];
  readonly beats?: readonly StoryBeat[];
  readonly conflictThreads?: readonly ConflictThread[];
  readonly foreshadowThreads?: readonly ForeshadowThread[];
  readonly payoffLinks?: readonly PayoffLink[];
  readonly warnings: readonly NarrativeWarning[];
  readonly generatedAt?: string;
}

export interface NarrativeLineMutationPreview {
  readonly id: string;
  readonly bookId: string;
  readonly summary: string;
  readonly nodes?: readonly NarrativeNode[];
  readonly edges?: readonly NarrativeEdge[];
  /**
   * 待删除的作者节点 ID。
   *
   * 删除是与新增并列的显式意图，不能靠「提交一个空节点」表达 —— 那样只会
   * 静默写入一个占位节点。派生节点（章节/经纬）不在此列：它们由权威源计算，
   * 删除请求会在 preview 阶段被标为不可执行。
   */
  readonly removeNodeIds?: readonly string[];
  /** 待删除的作者边 ID。 */
  readonly removeEdgeIds?: readonly string[];
  readonly warnings?: readonly NarrativeWarning[];
}
