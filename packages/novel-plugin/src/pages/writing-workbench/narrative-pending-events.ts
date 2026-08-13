/**
 * 章后提议（pending narrative events）的唯一前端读写通道。
 *
 * 待审事件同时出现在两个位置：
 * - 写作视图：写完一章后就地处理「本章提议」，不必离开写作路径；
 * - 叙事记忆面板：全书范围的待审队列与结算历史。
 *
 * 两处必须共用同一份取数与审批实现。若各写一套 fetch，批准语义、错误
 * 文案和刷新时机就会漂移，作者在两个地方看到的同一条提议会有不同结果。
 */

/** 章后结算提出的一条待确认事件。字段与 pendingEventSummary 返回体对齐。 */
export interface PendingEvent {
  id?: string;
  eventType?: string;
  /** = event.subject，后端已做别名映射 */
  entity?: string;
  subject?: string;
  predicate?: string;
  object?: string;
  confidence?: number;
  /** = event.riskLevel */
  risk?: string;
  /** = event.evidenceText，正文出处 */
  evidence?: string;
  chapterNumber?: number;
}

export type PendingEventAction = "approve" | "reject";

/** edit-approve：批准时覆盖原草案字段，机器抽错可随手改再应用。 */
export interface PendingEventEdit {
  readonly subject?: string;
  readonly predicate?: string;
  readonly object?: string;
  readonly evidenceText?: string;
}

interface PendingEventsResponse {
  events?: PendingEvent[];
}

/** 允许注入 fetch，便于测试与 Runtime 认证通道替换。 */
export type JsonFetch = (input: string, init?: RequestInit) => Promise<Response>;

function memoryBase(bookId: string): string {
  return `/api/books/${encodeURIComponent(bookId)}/narrative-memory`;
}

export async function fetchPendingEvents(
  bookId: string,
  options: { readonly limit?: number; readonly fetchImpl?: JsonFetch } = {},
): Promise<PendingEvent[]> {
  const doFetch = options.fetchImpl ?? fetch;
  const query = options.limit ? `?limit=${encodeURIComponent(String(options.limit))}` : "";
  const response = await doFetch(`${memoryBase(bookId)}/events/pending${query}`);
  if (!response.ok) throw new Error(`events ${response.status}`);
  const payload = await response.json() as PendingEventsResponse;
  return payload.events ?? [];
}

/**
 * 批准或拒绝一条待审事件。
 *
 * 这是作者的显式审批动作，不是 agent 静默写入，所以由前端直接调用产品
 * API；写作视图里那些「一键修」性质的写操作仍必须交给叙述者执行，以保留
 * Runtime 的权限确认。
 */
export async function mutatePendingEvent(
  bookId: string,
  eventId: string,
  action: PendingEventAction,
  options: { readonly reason?: string; readonly edit?: PendingEventEdit; readonly fetchImpl?: JsonFetch } = {},
): Promise<void> {
  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(`${memoryBase(bookId)}/events/${encodeURIComponent(eventId)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reason: options.reason ?? defaultReason(action),
      ...(action === "approve" && options.edit
        ? {
            ...(options.edit.subject?.trim() ? { editSubject: options.edit.subject.trim() } : {}),
            ...(options.edit.predicate?.trim() ? { editPredicate: options.edit.predicate.trim() } : {}),
            ...(options.edit.object?.trim() ? { editObject: options.edit.object.trim() } : {}),
            ...(options.edit.evidenceText?.trim() ? { editEvidenceText: options.edit.evidenceText.trim() } : {}),
          }
        : {}),
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { summary?: string; error?: string };
    throw new Error(payload.summary ?? payload.error ?? `事件操作失败（${response.status}）`);
  }
}

function defaultReason(action: PendingEventAction): string {
  return action === "approve" ? "工作台确认 Narrative Memory 事件" : "工作台拒绝 Narrative Memory 事件";
}

export interface ChapterProposalGroups {
  /** 当前正在写的这一章提出的 */
  readonly current: readonly PendingEvent[];
  /** 之前章节遗留、仍未处理的 */
  readonly earlier: readonly PendingEvent[];
  /** current + earlier 里风险为 high 的条数 */
  readonly highRiskCount: number;
}

/**
 * 按当前章号把待审事件分成「本章」和「往前遗留」。
 *
 * 写作视图只需要作者此刻该看的那几条：本章刚提出的，加上还没清掉的旧账。
 * 缺 chapterNumber 的条目算作本章，宁可多提示一次也不要静默丢掉。
 */
export function groupProposalsByChapter(
  events: readonly PendingEvent[],
  chapterNumber: number,
): ChapterProposalGroups {
  const current: PendingEvent[] = [];
  const earlier: PendingEvent[] = [];
  for (const event of events) {
    const number = event.chapterNumber;
    if (typeof number !== "number" || !Number.isFinite(number) || number >= chapterNumber) current.push(event);
    else earlier.push(event);
  }
  const highRiskCount = events.filter((event) => event.risk === "high").length;
  return { current, earlier, highRiskCount };
}

/**
 * 风险等级的作者可读文案。
 *
 * 未知等级回落到「待审」而不是显示后端枚举原文：这些条目本就处于待审状态，
 * 而按 code 自造文案或直接暴露原始枚举都会让作者看到看不懂的字符串。
 */
export function riskLabel(risk?: string): string {
  if (risk === "high") return "高风险";
  if (risk === "medium") return "中风险";
  if (risk === "low") return "低风险";
  return risk ?? "待审";
}
