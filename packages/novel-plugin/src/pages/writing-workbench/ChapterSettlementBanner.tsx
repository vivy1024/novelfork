/**
 * T4b · 改章 stale 横幅——挂在写作区章节编辑器上方。
 *
 * 正文 dirty 时防抖调 settlement-status 路由比对指纹；
 * changed=true 则显示黄条提醒「记忆可能过期」+「让叙述者重结算」按钮。
 * 纯展示组件，重结算的实际触发由宿主通过 onAskResettle 注入。
 */

import { useEffect, useRef, useState } from "react";
import { fetchJson } from "@/hooks/use-api";
import { AlertTriangle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface ChapterSettlementBannerProps {
  readonly bookId: string;
  readonly chapterNumber: number;
  /** 当前编辑器正文（dirty 时才传，clean 不查）。 */
  readonly content: string;
  /** 点击按钮后由宿主发起重结算（发叙述者指令或直调工具）。 */
  readonly onAskResettle?: () => void;
}

type CheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "changed" }
  | { status: "fresh" };

export function ChapterSettlementBanner({ bookId, chapterNumber, content, onAskResettle }: ChapterSettlementBannerProps) {
  const [state, setState] = useState<CheckState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!content.trim()) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(async () => {
      try {
        const payload = await fetchJson<{ changed?: boolean }>(
          `/api/books/${encodeURIComponent(bookId)}/narrative-memory/settlement-status`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chapterNumber, content }),
            signal: controller.signal,
          },
        );
        if (!controller.signal.aborted) {
          setState(payload.changed ? { status: "changed" } : { status: "fresh" });
        }
      } catch {
        if (!controller.signal.aborted) setState({ status: "idle" });
      }
    }, 800);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [bookId, chapterNumber, content]);

  if (state.status !== "changed") return null;

  return (
    <div
      className="flex items-center gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400"
      data-testid="chapter-stale-banner"
    >
      <AlertTriangle className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">本章正文在结算后已被修改——叙事记忆可能过期，建议重新结算。</span>
      <Button
        size="xs"
        variant="outline"
        className="h-6 shrink-0 gap-1 text-[11px]"
        onClick={onAskResettle}
      >
        让叙述者重结算
      </Button>
    </div>
  );
}
