/**
 * 章节循环（W1）：写作视图的「写 → 改 → 收尾」由状态推出当前步，不另存。
 *
 * - 写：针对下一章（写前预检推荐的章），写前准备（卷纲、创作罗盘、检查项）与写章同在这一步。
 * - 改 / 收尾：针对最近写完的那一章。它可能就是推荐章（推荐章已有正文），
 *   也可能是推荐章的前一章（刚写完，预检已经往后推了一章）。
 *
 * 数据只来自三处现有接口：写前预检（推荐章号、是否已有正文）、结算新鲜度（每章是否
 * 结算、结算后正文是否又改过）、文风金库（是否有 AI 原稿、作者改动占比）。
 * 「自审」一步属于 T2.5，功能上线前不出现在步骤条里（半成品默认隐藏）。
 */

export type ChapterLoopStep = "write" | "revise" | "close";

export type SettlementStatus = "fresh" | "stale" | "unsettled" | "unknown";

export interface LoopFreshnessChapter {
  readonly chapterNumber: number;
  readonly title?: string;
  readonly status: SettlementStatus;
}

export interface LoopVaultChapter {
  readonly chapterNumber: number;
  readonly hasAiDraft: boolean;
  readonly share?: { readonly authorRatio: number };
}

export interface ChapterLoopInput {
  /** 写前预检推荐的章号；0 表示还没拿到。 */
  readonly nextChapter: number;
  /** 推荐章是否已有正文（预检的 alreadyWritten）。 */
  readonly nextAlreadyWritten: boolean;
  readonly freshness?: readonly LoopFreshnessChapter[];
  readonly vault?: readonly LoopVaultChapter[];
  /** 各章待确认的章后提议数。 */
  readonly pendingByChapter?: ReadonlyMap<number, number>;
}

export interface LastWrittenChapter {
  readonly chapterNumber: number;
  readonly title?: string;
  readonly settlement: SettlementStatus;
  readonly hasAiDraft: boolean;
  /** 有 AI 原稿时的作者改动占比（0–1）；没有原稿时为空。 */
  readonly authorRatio?: number;
  readonly pendingCount: number;
  /** 需要收尾：没结算、结算后又改过，或还有待确认的提议。 */
  readonly needsClose: boolean;
}

export interface ChapterLoopStepView {
  readonly id: ChapterLoopStep;
  readonly label: string;
  /** 这一步针对第几章。 */
  readonly chapterNumber: number;
  /** 这一步是否有事要做（步骤条上加提示点）。 */
  readonly attention: boolean;
  readonly available: boolean;
}

export interface ChapterLoopModel {
  readonly lastWritten?: LastWrittenChapter;
  readonly defaultStep: ChapterLoopStep;
  readonly steps: readonly ChapterLoopStepView[];
}

function findLastWritten(input: ChapterLoopInput): LastWrittenChapter | undefined {
  if (input.nextChapter <= 0) return undefined;
  const chapterNumber = input.nextAlreadyWritten ? input.nextChapter : input.nextChapter - 1;
  if (chapterNumber < 1) return undefined;
  const freshness = input.freshness?.find((chapter) => chapter.chapterNumber === chapterNumber);
  // 章节索引里没有这一章：预检推荐的前一章并不存在（比如作者删过章），不强行收尾。
  if (!freshness) return undefined;
  const vault = input.vault?.find((chapter) => chapter.chapterNumber === chapterNumber);
  const pendingCount = input.pendingByChapter?.get(chapterNumber) ?? 0;
  const settlementNeedsWork = freshness.status === "unsettled" || freshness.status === "stale";
  return {
    chapterNumber,
    ...(freshness.title ? { title: freshness.title } : {}),
    settlement: freshness.status,
    hasAiDraft: Boolean(vault?.hasAiDraft),
    ...(vault?.hasAiDraft && vault.share ? { authorRatio: vault.share.authorRatio } : {}),
    pendingCount,
    needsClose: settlementNeedsWork || pendingCount > 0,
  };
}

/**
 * 默认停在哪一步：
 * 1. 最近写完的章是 AI 写的、作者一句没改、也还没结算 → 改；
 * 2. 最近写完的章需要收尾 → 收尾；
 * 3. 其余 → 写下一章。
 */
export function resolveChapterLoop(input: ChapterLoopInput): ChapterLoopModel {
  const lastWritten = findLastWritten(input);
  const untouchedAiDraft = Boolean(lastWritten?.hasAiDraft && (lastWritten.authorRatio ?? 0) === 0 && lastWritten.settlement !== "fresh");

  let defaultStep: ChapterLoopStep = "write";
  if (lastWritten && untouchedAiDraft) defaultStep = "revise";
  else if (lastWritten?.needsClose) defaultStep = "close";

  // 写这一步始终跟写前预检的推荐章一致（推荐章已有正文时显示「打开第 N 章正文」）。
  const next = input.nextChapter;
  const steps: ChapterLoopStepView[] = [
    { id: "write", label: "写", chapterNumber: next, attention: false, available: true },
    {
      id: "revise",
      label: "改",
      chapterNumber: lastWritten?.chapterNumber ?? 0,
      attention: untouchedAiDraft,
      available: Boolean(lastWritten),
    },
    {
      id: "close",
      label: "收尾",
      chapterNumber: lastWritten?.chapterNumber ?? 0,
      attention: Boolean(lastWritten?.needsClose),
      available: Boolean(lastWritten),
    },
  ];
  return { ...(lastWritten ? { lastWritten } : {}), defaultStep, steps };
}

const SETTLEMENT_LABELS: Record<SettlementStatus, string> = {
  fresh: "已结算",
  stale: "结算后正文又改过，记忆可能过期",
  unsettled: "还没结算",
  unknown: "结算状态未知（章节索引缺少正文指纹）",
};

export function settlementLabel(status: SettlementStatus): string {
  return SETTLEMENT_LABELS[status];
}
