/**
 * 记忆过期的章节（T4.2 正文接纳）。
 *
 * 任何入口改过正文、指纹与结算时不一致的章列在这里，逐章「重新结算」。
 * 数据来自 GET …/narrative-memory/settlement-freshness（服务端现算）；重新结算走
 * POST …/chapters/:n/resettle（经 Runtime 使用作者配置的默认模型）。没有模型时如实显示服务端给的原因。
 */

import { useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { fetchJson, invalidateApiPaths, useApi } from "@/hooks/use-api";

interface FreshnessChapter {
  readonly chapterNumber: number;
  readonly title: string;
  readonly status: "fresh" | "stale" | "unsettled" | "unknown";
  readonly settledAt?: string;
}

interface FreshnessResponse {
  readonly chapters?: readonly FreshnessChapter[];
  readonly staleChapters?: readonly number[];
  readonly explanation?: { readonly whatHappened?: string; readonly whyItMatters?: string; readonly suggestedAction?: string };
}

export function freshnessPath(bookId: string): string {
  return `/api/books/${encodeURIComponent(bookId)}/narrative-memory/settlement-freshness`;
}

/** 过期章数：给「下一步」卡用，与列表同一个接口，只取数量。 */
export function useStaleSettlementCount(bookId: string): number {
  const { data } = useApi<FreshnessResponse>(freshnessPath(bookId));
  return data?.staleChapters?.length ?? 0;
}

function readError(error: unknown): string {
  // 请求封装已把服务端的三段式解释拼成 message（发生了什么 + 建议怎么做）
  return error instanceof Error && error.message ? error.message : "重新结算失败。";
}

export function StaleSettlementList({ bookId }: { readonly bookId: string }) {
  const { data, loading } = useApi<FreshnessResponse>(freshnessPath(bookId));
  const [busyChapter, setBusyChapter] = useState<number | null>(null);
  const [message, setMessage] = useState<{ readonly tone: "ok" | "error"; readonly text: string } | null>(null);

  const stale = (data?.chapters ?? []).filter((chapter) => chapter.status === "stale");
  if (loading || stale.length === 0) return null;

  const resettle = async (chapterNumber: number) => {
    setBusyChapter(chapterNumber);
    setMessage(null);
    try {
      const result = await fetchJson<{ summary?: string }>(
        `/api/books/${encodeURIComponent(bookId)}/narrative-memory/chapters/${chapterNumber}/resettle`,
        { method: "POST" },
      );
      setMessage({ tone: "ok", text: result.summary ?? `第 ${chapterNumber} 章已重新结算。` });
      invalidateApiPaths([
        freshnessPath(bookId),
        `/api/books/${encodeURIComponent(bookId)}/narrative-memory/events/pending`,
      ]);
    } catch (error) {
      setMessage({ tone: "error", text: readError(error) });
    } finally {
      setBusyChapter(null);
    }
  };

  return (
    <section
      aria-label="记忆过期的章节"
      className="mb-2 space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2"
    >
      <div className="flex items-center gap-1.5 text-2xs font-semibold">
        <AlertTriangle className="size-3.5 text-amber-600" />
        <span>记忆过期的章节 · {stale.length}</span>
      </div>
      {data?.explanation?.whyItMatters ? (
        <p className="text-2xs leading-relaxed text-muted-foreground">{data.explanation.whyItMatters}</p>
      ) : null}
      <ul className="space-y-1">
        {stale.map((chapter) => (
          <li key={chapter.chapterNumber} className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate">第 {chapter.chapterNumber} 章 · {chapter.title}</span>
            <Button
              size="xs"
              variant="outline"
              className="h-6 shrink-0 gap-1 px-2 text-2xs"
              disabled={busyChapter !== null}
              onClick={() => void resettle(chapter.chapterNumber)}
              aria-label={`重新结算第 ${chapter.chapterNumber} 章`}
            >
              {busyChapter === chapter.chapterNumber ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
              重新结算
            </Button>
          </li>
        ))}
      </ul>
      {message ? (
        <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-2xs text-destructive" : "text-2xs text-muted-foreground"}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
