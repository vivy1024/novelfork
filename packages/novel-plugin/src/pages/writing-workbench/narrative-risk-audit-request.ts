/**
 * 叙事风险审计的指令构造。
 *
 * 产品侧不能自己开子代理 —— Agent Loop 与 Provider 都在 Runtime。所以这里
 * 只负责把「审哪一章、正文是什么、要守什么隔离纪律」组装成一条明确指令，
 * 交给叙述者执行；真正的零继承 spawn 由 `nf-narrative-risk-audit` skill 指导
 * 叙述者完成。
 *
 * 隔离纪律必须写进指令本身：如果只说「审一下这章」，叙述者会顺手把大纲、
 * 人物档案和自己的写作意图一起塞给子代理，审计立刻退化成自我确认。
 */

export interface NarrativeRiskAuditRequest {
  readonly chapterNumber?: number;
  readonly chapterTitle?: string;
  /** 当前编辑器里的正文。空正文不应构造指令。 */
  readonly content: string;
}

/** 正文过长时截断，避免一条指令撑爆上下文。 */
const MAX_CONTENT_CHARS = 12_000;

export function buildNarrativeRiskAuditMessage(request: NarrativeRiskAuditRequest): string {
  const label = request.chapterNumber !== undefined
    ? `第 ${request.chapterNumber} 章`
    : request.chapterTitle?.trim() || "当前章节";
  const truncated = request.content.length > MAX_CONTENT_CHARS;
  const body = truncated ? request.content.slice(0, MAX_CONTENT_CHARS) : request.content;

  return [
    `请对${label}跑一次叙事风险审计，使用 nf-narrative-risk-audit skill。`,
    "",
    "执行要求（隔离纪律，不可省略）：",
    "1. 用 fork_turns=none 的零继承子代理执行，只传 skill 里的「子代理任务模板」与下面这段正文。",
    "2. 不要把大纲、卷纲、人物档案、经纬条目、叙事记忆、章节蓝图、我的写作意图或历史审计结论传给子代理。",
    "3. 不要在 prompt 里暗示你怀疑哪里有问题，也不要告诉它这是第几章。",
    "4. 子代理只报告证据，不改稿。拿回结果后你再按正文判断哪些采纳，拿不准的标 [需复核] 交给我。",
    truncated ? "5. 注意：以下正文因长度已截断，只审这一部分。" : "",
    "",
    "待审正文：",
    "",
    body,
  ]
    .filter((line) => line !== "")
    .join("\n");
}
