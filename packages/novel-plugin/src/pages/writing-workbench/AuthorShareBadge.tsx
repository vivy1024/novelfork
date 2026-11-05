/**
 * 写作台实时「作者改动占比」徽标（T2.7）。
 *
 * - 本章 AI 原稿取自 GET /style/vault/chapters/:n/ai-draft（只读）；
 * - 占比用 style-vault-share 的 computeAuthorShare 在前端现算——与文风金库面板（服务端 GET /style/vault）
 *   是同一个函数，编辑器内容与已保存正文一致时两边数字相同；
 * - 输入防抖后再算，长章节不随每次击键重算；
 * - 没有 AI 原稿的章节显示「无 AI 原稿」，点击跳到文风金库该章。
 */
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { fetchJson } from "@/hooks/use-api";

import { computeAuthorShare } from "../../engine/writing-layers/style-vault-share";
import { useDebouncedValue } from "./use-debounced-value";

export const AUTHOR_SHARE_DEBOUNCE_MS = 400;

interface AiDraftResponse {
  readonly hasAiDraft?: boolean;
  readonly text?: string;
}

export function aiDraftPath(bookId: string, chapterNumber: number): string {
  return `/api/books/${encodeURIComponent(bookId)}/style/vault/chapters/${chapterNumber}/ai-draft`;
}

/** 与文风金库面板同一取整口径。 */
export function formatAuthorRatio(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export interface AuthorShareBadgeProps {
  readonly bookId: string;
  readonly chapterNumber: number;
  /** 编辑器当前正文（未保存的也算）。 */
  readonly content: string;
  /**
   * 本章正文的版本信号（章节节点的 updatedAt / version）。叙述者重写本章会写入新的 AI 原稿并刷新节点，
   * 版本一变就重读原稿；只按章号做键的话，重写前后键不变，占比会一直拿旧原稿算。
   */
  readonly revision?: string | number;
  readonly onOpenStyleVault?: (chapterNumber: number) => void;
}

export function AuthorShareBadge({ bookId, chapterNumber, content, revision, onOpenStyleVault }: AuthorShareBadgeProps) {
  const [state, setState] = useState<{ key: string; data?: AiDraftResponse; error?: string } | null>(null);
  const path = aiDraftPath(bookId, chapterNumber);
  // 换章或本章版本变了（叙述者重写会换新原稿）就重读；键里带版本，旧响应与新版本对不上时不显示。
  const key = `${path}#${revision ?? ""}`;
  useEffect(() => {
    let cancelled = false;
    fetchJson<AiDraftResponse>(path)
      .then((data) => { if (!cancelled) setState({ key, data }); })
      .catch((cause: unknown) => { if (!cancelled) setState({ key, error: cause instanceof Error ? cause.message : String(cause) }); });
    return () => { cancelled = true; };
  }, [key, path]);
  const current = state?.key === key ? state : null;
  const data = current?.data;
  const error = current?.error;
  const loading = current === null;
  const debounced = useDebouncedValue(content, AUTHOR_SHARE_DEBOUNCE_MS);
  const aiText = data?.hasAiDraft ? data.text ?? "" : null;
  const share = useMemo(() => (aiText === null ? null : computeAuthorShare(aiText, debounced)), [aiText, debounced]);

  if (loading && !data) return null;
  const open = () => onOpenStyleVault?.(chapterNumber);
  const clickable = Boolean(onOpenStyleVault);

  let label: string;
  let title: string;
  if (error) {
    label = "AI 原稿读取失败";
    title = String(error);
  } else if (!share) {
    label = "无 AI 原稿";
    title = "这一章没有 AI 原稿（不是 AI 写的，或写于文风金库启用之前），算不出作者改动占比。";
  } else {
    label = `作者改动 ${formatAuthorRatio(share.authorRatio)}`;
    title = `逐句比对 AI 原稿：作者改写或新写 ${share.authorChars.toLocaleString()} 字，原样保留 ${share.aiChars.toLocaleString()} 字。只反映你改了多少，不代表任何检测工具的判断。${clickable ? "点击打开文风金库的这一章。" : ""}`;
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={!clickable}
      title={title}
      aria-label={`${label}${clickable ? "，打开文风金库" : ""}`}
      data-testid="author-share-badge"
      className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
    >
      <Badge variant={share ? "secondary" : "outline"} className="h-4 px-1.5 text-2xs">{label}</Badge>
    </button>
  );
}
