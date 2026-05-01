/**
 * Agent 写作上下文构建
 * 根据 bookId 聚合当前作品的关键状态信息，注入到 Agent 的 system prompt 中。
 */

import type { BookDetail } from "../../shared/contracts.js";

interface ContextInput {
  book: {
    id: string;
    title: string;
    genre?: string;
    platform?: string;
    chapterCount: number;
    targetChapters?: number;
  };
  chapterSummaries: Array<{ number: number; summary?: string }>;
  pendingHooks: string;
  currentFocus: string | null;
  auditIssues: Array<{ chapterNumber: number; count: number }>;
}

interface BuildContextResult {
  /** 注入到 system prompt 末尾的上下文字符串 */
  contextBlock: string;
  /** 上下文是否为空（书籍没有任何数据） */
  isEmpty: boolean;
}

export function buildBookContextBlock(input: ContextInput): BuildContextResult {
  const lines: string[] = [];

  // 基本信息
  lines.push(`- 作品：${input.book.title}`);
  if (input.book.genre) lines.push(`- 题材：${input.book.genre}`);
  if (input.book.platform) lines.push(`- 平台：${input.book.platform}`);
  const targetStr = input.book.targetChapters
    ? `${input.book.chapterCount}/${input.book.targetChapters}`
    : `${input.book.chapterCount}`;
  lines.push(`- 章节进度：${targetStr} 章`);

  // 当前焦点
  const focus = input.currentFocus?.trim();
  if (focus) {
    lines.push("");
    lines.push("### 当前焦点");
    lines.push(focus.length > 500 ? focus.slice(0, 500) + "..." : focus);
  }

  // 章节摘要
  const recentSummaries = input.chapterSummaries.slice(-3);
  if (recentSummaries.length > 0) {
    lines.push("");
    lines.push("### 最近章节摘要");
    for (const s of recentSummaries) {
      const summary = s.summary?.trim();
      if (summary) {
        lines.push(`- 第${s.number}章: ${summary.length > 120 ? summary.slice(0, 120) + "..." : summary}`);
      } else {
        lines.push(`- 第${s.number}章: （暂无摘要）`);
      }
    }
  }

  // 待回收伏笔
  const hooks = input.pendingHooks?.trim();
  if (hooks) {
    lines.push("");
    lines.push("### 待处理伏笔（pending_hooks.md 内容摘要）");
    // 只取前 1000 字符避免 token 过多
    lines.push(hooks.length > 1000 ? hooks.slice(0, 1000) + "..." : hooks);
  }

  // 审计问题
  const issues = input.auditIssues.filter((i) => i.count > 0);
  if (issues.length > 0) {
    lines.push("");
    lines.push("### 需要关注的审计问题");
    for (const issue of issues) {
      lines.push(`- 第${issue.chapterNumber}章: ${issue.count} 个审计问题`);
    }
  }

  const contextBlock = lines.join("\n");
  const isEmpty = lines.length <= 1; // 只有基本进度信息也算有上下文

  return { contextBlock, isEmpty };
}

/**
 * 从 Studio API 响应构建 Agent 上下文。
 * 各数据由调用方（session-chat-service）从已有 API 获取后传入。
 */
export function buildAgentContext(params: {
  bookId: string;
  book?: BookDetail;
  chapterSummaries?: Array<{ number: number; summary?: string }>;
  pendingHooks?: string;
  currentFocus?: string | null;
  auditIssues?: Array<{ chapterNumber: number; count: number }>;
}): string {
  if (!params.book) return "";

  return buildBookContextBlock({
    book: {
      id: params.bookId,
      title: params.book.title,
      genre: params.book.genre,
      platform: params.book.platform,
      chapterCount: params.book.chapterCount,
      targetChapters: params.book.targetChapters,
    },
    chapterSummaries: params.chapterSummaries ?? [],
    pendingHooks: params.pendingHooks ?? "",
    currentFocus: params.currentFocus ?? null,
    auditIssues: params.auditIssues ?? [],
  }).contextBlock;
}
