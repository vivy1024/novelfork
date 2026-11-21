/**
 * T4b · 改章 stale 横幅——挂在写作区章节编辑器上方。
 *
 * 正文 dirty 时防抖调 settlement-status 路由比对指纹；
 * changed=true 则显示黄条提醒「记忆可能过期」，并给出两条重结算路径：
 *   - 「让叙述者重结算」：由宿主通过 onAskResettle 注入，走对话里的叙述者；
 *   - 「直接重结算」：直接调 POST …/chapters/:n/resettle，由服务端用作者配置的
 *     默认模型结算，不要求先开叙述者会话。没有可用模型时后端返回三段式说明，
 *     这里如实展示，不用规则兜底冒充结算成功。
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
  const [resettling, setResettling] = useState(false);
  const [resettleError, setResettleError] = useState<string | null>(null);
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

  /**
   * 直接重结算：不依赖叙述者会话，直接调产品路由让服务端用作者配置的默认模型结算。
   * 失败时后端会给出三段式说明（发生了什么 / 为什么要看 / 建议怎么做），
   * 请求封装已把它拼成 message，这里不再按 code 自造文案。
   */
  const resettleDirectly = async () => {
    if (resettling) return;
    setResettling(true);
    setResettleError(null);
    try {
      await fetchJson<{ summary?: string }>(
        `/api/books/${encodeURIComponent(bookId)}/narrative-memory/chapters/${chapterNumber}/resettle`,
        { method: "POST" },
      );
      // 结算已按当前正文重跑：横幅的前提（记忆落后于正文）不再成立。
      setState({ status: "fresh" });
    } catch (cause) {
      setResettleError(cause instanceof Error && cause.message ? cause.message : "重新结算失败。");
    } finally {
      setResettling(false);
    }
  };

  if (state.status !== "changed") return null;

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-warning"
      data-testid="chapter-stale-banner"
    >
      <AlertTriangle className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">本章正文在结算后改过，章后事实可能过时，建议重新结算。</span>
      <Button
        size="xs"
        variant="outline"
        className="h-6 shrink-0 gap-1 text-2xs"
        disabled={!onAskResettle}
        title={onAskResettle ? undefined : "先在对话里开启叙述者会话"}
        onClick={onAskResettle}
      >
        让叙述者重结算
      </Button>
      <Button
        size="xs"
        variant="outline"
        className="h-6 shrink-0 gap-1 text-2xs"
        disabled={resettling}
        title="用作者配置的默认模型直接重结算这一章，不必打开叙述者会话"
        onClick={() => void resettleDirectly()}
        data-testid="chapter-stale-direct-resettle"
      >
        {resettling ? <Loader2 className="size-3 animate-spin" /> : null}
        直接重结算
      </Button>
      {!onAskResettle ? (
        <span className="shrink-0 text-xs text-warning/80" data-testid="chapter-stale-no-narrator">先在对话里开启叙述者会话</span>
      ) : null}
      {resettleError ? (
        <span role="alert" className="basis-full text-2xs text-destructive" data-testid="chapter-stale-resettle-error">
          {resettleError}
        </span>
      ) : null}
    </div>
  );
}
