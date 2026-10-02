/**
 * 「待确认」聚合的接口契约（纯类型与常量，无 Node 依赖）。
 *
 * routes/pending-review.ts（服务端）与 pages/writing-workbench/PendingReviewPanel.tsx
 * （浏览器）共用这一份；浏览器组件只能从这里导入，不能碰路由实现——
 * 路由实现顶层引用 node:fs 等，会把浏览器包在模块求值期打崩。
 */

export const PENDING_REVIEW_KINDS = ["voice", "styleRule", "foreshadow", "event", "fact", "revision"] as const;
export type PendingReviewKind = (typeof PENDING_REVIEW_KINDS)[number];

export const PENDING_REVIEW_LABELS: Record<PendingReviewKind, string> = {
  voice: "声线",
  styleRule: "文风规则",
  foreshadow: "伏笔",
  event: "叙事事件",
  fact: "事实",
  revision: "改稿",
};

/** 「去处理」跳转目标：面板按 kind 选宿主注入的回调，不重写审批。 */
export type PendingReviewTarget =
  | { readonly kind: "jingwei-entry"; readonly entryId: string }
  | { readonly kind: "style-panel" }
  | { readonly kind: "events" }
  | { readonly kind: "vault"; readonly chapterNumber: number };

export interface PendingReviewItem {
  readonly id: string;
  readonly kind: PendingReviewKind;
  /** 类型标签（声线/文风规则/伏笔/叙事事件/事实/改稿）。 */
  readonly typeLabel: string;
  /** 书籍内位置（第几章/哪个角色/哪条规则）。 */
  readonly location: string;
  /** 一句话内容摘要。 */
  readonly summary: string;
  /** 去哪决定：原有确认入口的作者可读名称。 */
  readonly resolveAt: string;
  readonly target: PendingReviewTarget;
}

export interface PendingReviewGroup {
  readonly kind: PendingReviewKind;
  readonly label: string;
  /** 全量计数（items 只是前 N 条摘要）。 */
  readonly count: number;
  readonly items: readonly PendingReviewItem[];
}

export interface PendingReviewWarning {
  readonly code: string;
  readonly message: string;
}

export interface PendingReviewSummary {
  readonly bookId: string;
  readonly total: number;
  readonly groups: readonly PendingReviewGroup[];
  /** 口径与空结果说明：全部待确认项为何是这些、为空时各入口在哪。 */
  readonly explanation: string;
  readonly warnings: readonly PendingReviewWarning[];
}
