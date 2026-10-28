/**
 * 写前召回记录（服务端自记，模型不传任何参数）。
 *
 * write.preflight 通过时把本章召回包交给 Agent，同时在这里记一笔「这个会话、这本书、这一章已召回」；
 * pipeline.write 保存前查这笔记录，证明这一章的正文是在拿到召回包之后生成的，而不是凭对话残留现编。
 *
 * 为什么不让模型回传凭证：凭证只是服务端自己发、自己验的一次性回执。会话身份（叙述者 id）由宿主
 * 可信传入，书和章号也由服务端确定，让模型抄写一串随机 token 再原样传回只是多一道会出错的手续，
 * 不增加任何保证。
 *
 * 存储选择：进程内带 TTL 的 Map，不落盘。
 * - 单一权威源：preflight 是一次性诊断（CLAUDE.md「诊断结果不落盘」），召回记录只是它的回执；
 * - 不复用 writing-injection-preserve 保留件：保留件每书只有一份、会被 memory.read 的任何写作召回
 *   覆盖，也不区分会话，用它当记录既会被无关调用顶掉，又挡不住别的会话借用；
 * - 写章发生在同一个 Runtime 进程里，进程重启后记录全部失效，最坏情况只是让 Agent 重做一次 preflight，
 *   不会放过未召回的写入。
 *
 * 记录在 TTL 内对同一章可重复使用（审计不过改稿后重提不必重新召回），只对记录时的会话、书和章号有效。
 */
import { createHash } from "node:crypto";

import type { DiagnosticExplanation } from "./diagnostic-explanation.js";

/** 30 分钟：覆盖一次正常的写章 + 一两轮审计改稿；超过就该重新召回，前情可能已变。 */
export const RECALL_RECORD_TTL_MS = 30 * 60 * 1000;

/** 防止异常调用把 Map 撑爆；超出时按记录顺序淘汰最旧的。 */
const MAX_ACTIVE_RECORDS = 512;

/**
 * 没有会话身份时（测试、宿主未传 sessionId 的内部调用）共用的会话键。
 * 生产写章都经叙述者工具调用进来，宿主总会带上叙述者 id。
 */
const ANONYMOUS_SESSION = "__no-session__";

export interface RecallRecord {
  readonly sessionId: string;
  readonly bookId: string;
  readonly chapterNumber: number;
  /** 召回包指纹（sections 原文的 sha256），用于诊断「这章是按哪一份召回写的」。 */
  readonly packageFingerprint: string;
  readonly recordedAt: number;
  readonly expiresAt: number;
}

const records = new Map<string, RecallRecord>();

function recordKey(sessionId: string | undefined, bookId: string, chapterNumber: number): string {
  return `${sessionId?.trim() || ANONYMOUS_SESSION}\u0000${bookId}\u0000${chapterNumber}`;
}

function pruneExpired(now: number): void {
  for (const [key, record] of records) {
    if (record.expiresAt <= now) records.delete(key);
  }
  while (records.size > MAX_ACTIVE_RECORDS) {
    const oldest = records.keys().next().value;
    if (oldest === undefined) break;
    records.delete(oldest);
  }
}

/** 召回包指纹：只取进上下文的 sections 原文，与诊断耗时等易变字段无关。 */
export function fingerprintRecallPackage(sections: Readonly<Record<string, string>>): string {
  const ordered = Object.keys(sections).sort().map((key) => `${key}\u0000${sections[key] ?? ""}`).join("\u0001");
  return createHash("sha256").update(ordered, "utf8").digest("hex");
}

/** preflight 召回成功后记一笔；同一会话同一章再次召回会刷新记录与有效期。 */
export function recordWriteRecall(input: {
  readonly sessionId?: string;
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly packageFingerprint: string;
  readonly now?: number;
  readonly ttlMs?: number;
}): RecallRecord {
  const now = input.now ?? Date.now();
  pruneExpired(now);
  const key = recordKey(input.sessionId, input.bookId, input.chapterNumber);
  const record: RecallRecord = {
    sessionId: input.sessionId?.trim() || ANONYMOUS_SESSION,
    bookId: input.bookId,
    chapterNumber: input.chapterNumber,
    packageFingerprint: input.packageFingerprint,
    recordedAt: now,
    expiresAt: now + (input.ttlMs ?? RECALL_RECORD_TTL_MS),
  };
  // 先删后插：刷新后排到最新，淘汰时不会被当成最旧的那条。
  records.delete(key);
  records.set(key, record);
  return record;
}

export type RecallVerdict =
  | { readonly ok: true; readonly record: RecallRecord }
  | {
      readonly ok: false;
      readonly reason: "missing" | "expired";
      /** 一句话原因，拼进 error。 */
      readonly message: string;
      readonly explanation: DiagnosticExplanation;
    };

const RECALL_WHY = "长篇写到后面，模型能看到的前情只来自写前召回：没先召回就写，人物状态、伏笔和设定全凭对话残留去猜，越往后越容易写崩。";

function recallAction(chapterNumber: number): string {
  return `先调用 write.preflight（chapterNumber=${chapterNumber}），按返回的 recall.text 召回包生成正文，再调用 pipeline.write 保存；不需要传任何凭证参数。`;
}

/** pipeline.write 保存前查本会话本章的召回记录。 */
export function verifyWriteRecall(expected: {
  readonly sessionId?: string;
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly now?: number;
}): RecallVerdict {
  const now = expected.now ?? Date.now();
  const key = recordKey(expected.sessionId, expected.bookId, expected.chapterNumber);
  const record = records.get(key);
  if (!record) {
    return {
      ok: false,
      reason: "missing",
      message: `本会话还没有为第${expected.chapterNumber}章做写前召回。`,
      explanation: {
        whatHappened: `保存第${expected.chapterNumber}章之前，没有找到本会话对这一章的写前召回记录（write.preflight 没调用、调用的是别的章号，或服务重启后记录已失效）。`,
        whyItMatters: RECALL_WHY,
        suggestedAction: recallAction(expected.chapterNumber),
      },
    };
  }
  if (record.expiresAt <= now) {
    records.delete(key);
    return {
      ok: false,
      reason: "expired",
      message: `第${expected.chapterNumber}章的写前召回已过期。`,
      explanation: {
        whatHappened: `这一章的写前召回发生在 ${new Date(record.recordedAt).toISOString()}，已超过 ${Math.round(RECALL_RECORD_TTL_MS / 60000)} 分钟有效期。`,
        whyItMatters: "这期间前情、伏笔或设定可能已经变了，按旧召回包写出的正文可能与现状对不上。",
        suggestedAction: recallAction(expected.chapterNumber),
      },
    };
  }
  return { ok: true, record };
}

/** 仅测试用：清空召回记录。 */
export function resetWriteRecallsForTest(): void {
  records.clear();
}
