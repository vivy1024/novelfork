/**
 * 实体抽屉的「知情」页（T4.3，只读）：这个角色截至所问章知道什么、还不知道什么。
 *
 * 数据来自知情账与状态流水（已确认记忆事实按实体派生），不是作者手填设定；
 * 「他还不知道」就是写作禁忌——写作时不能让角色主动提及或据此行动。
 */

import { useEffect, useState } from "react";
import { Ban, CheckCheck, Info, Loader2, RefreshCw } from "lucide-react";

import { fetchJson } from "@/hooks/use-api";

export interface EntityKnowledgeTabProps {
  readonly bookId: string;
  /** 经纬条目 id；null 表示没找到对应条目。 */
  readonly entryId: string | null;
  /** 条目还在解析（经纬检索未返回）。 */
  readonly resolving?: boolean;
  readonly entityName: string;
  readonly currentChapter?: number;
}

interface KnowledgeFactRow {
  readonly factId: string;
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly category: string;
  readonly chapter: number;
  readonly evidence: string | null;
  readonly confidence: number;
}

interface KnowledgeExplanation {
  readonly whatHappened: string;
  readonly whyItMatters: string;
  readonly suggestedAction: string;
}

interface KnowledgeResponse {
  readonly status: "ok" | "empty";
  readonly reason?: string;
  readonly explanation?: KnowledgeExplanation;
  readonly notice?: KnowledgeExplanation;
  readonly chapter?: number | null;
  readonly entity?: { readonly id: string; readonly name: string; readonly type: string };
  readonly state?: readonly { readonly fluent: string; readonly value: string; readonly chapter: number }[];
  readonly knows?: readonly KnowledgeFactRow[];
  readonly unaware?: readonly KnowledgeFactRow[];
}

type State =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly data: KnowledgeResponse };

function ExplanationBlock({ explanation, testId }: { explanation: KnowledgeExplanation; testId: string }) {
  return (
    <div className="space-y-1 rounded-lg border border-dashed border-border/80 bg-muted/10 p-3 text-2xs leading-relaxed" data-testid={testId}>
      <p className="text-xs font-medium text-foreground">{explanation.whatHappened}</p>
      <p className="text-muted-foreground">{explanation.whyItMatters}</p>
      <p className="text-muted-foreground">建议：{explanation.suggestedAction}</p>
    </div>
  );
}

function FactListRow({ fact, tone }: { fact: KnowledgeFactRow; tone: "knows" | "unaware" }) {
  return (
    <li
      className={`rounded-lg border p-2 text-xs shadow-xs ${
        tone === "unaware" ? "border-amber-500/30 bg-amber-500/[0.04]" : "border-border/70 bg-card"
      }`}
      data-testid={`knowledge-${tone}-row`}
    >
      <div className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
        <span>第 {fact.chapter} 章</span>
        <span className="truncate">{fact.evidence ? `依据：${fact.evidence.slice(0, 40)}${fact.evidence.length > 40 ? "…" : ""}` : ""}</span>
      </div>
      <div className="mt-1 font-medium text-foreground">
        {fact.subject} · {fact.predicate} → {fact.object}
      </div>
    </li>
  );
}

export function EntityKnowledgeTab({ bookId, entryId, resolving, entityName, currentChapter }: EntityKnowledgeTabProps) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!entryId) return;
    let cancelled = false;
    setState({ status: "loading" });
    const params = new URLSearchParams({ entryId });
    if (currentChapter !== undefined) params.set("chapter", String(currentChapter));
    fetchJson<KnowledgeResponse>(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/knowledge?${params.toString()}`)
      .then((data) => { if (!cancelled) setState({ status: "ready", data }); })
      .catch((cause) => { if (!cancelled) setState({ status: "error", message: cause instanceof Error ? cause.message : "读取知情边界失败" }); });
    return () => { cancelled = true; };
  }, [bookId, entryId, currentChapter, nonce]);

  const anchor = currentChapter !== undefined ? `截至第 ${currentChapter} 章` : "至今";

  if (!entryId) {
    if (resolving) {
      return (
        <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground" data-testid="knowledge-loading">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-xs">正在找对应的条目…</span>
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-dashed border-border/80 p-6 text-center text-xs text-muted-foreground bg-muted/10" data-testid="knowledge-no-entry">
        没有找到这个角色对应的条目——知情账按实体记，先在作品基础里建条目再结算章节。
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground" data-testid="knowledge-loading">
        <Loader2 className="size-4 animate-spin" />
        <span className="text-xs">正在读知情账…</span>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 space-y-2 text-destructive" data-testid="knowledge-error">
        <p className="text-2xs">{state.message}</p>
        <button
          type="button"
          onClick={() => setNonce((value) => value + 1)}
          className="rounded border border-destructive/40 px-2 py-1 text-2xs hover:bg-destructive/10"
        >
          重试
        </button>
      </div>
    );
  }

  const data = state.data;
  if (data.status === "empty" && data.explanation) {
    return <ExplanationBlock explanation={data.explanation} testId="knowledge-explanation" />;
  }

  const states = data.state ?? [];
  const knows = data.knows ?? [];
  const unaware = data.unaware ?? [];
  return (
    <div className="space-y-3" data-testid="knowledge-tab">
      <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/20 p-2.5 text-2xs text-muted-foreground leading-relaxed">
        <Info className="size-3 mt-0.5 shrink-0" />
        <p>
          以下内容由已确认的记忆事实按实体派生（{anchor}），不是作者手填设定；只读。
          {data.notice ? ` ${data.notice.whatHappened}` : ""}
        </p>
        <button
          type="button"
          onClick={() => setNonce((value) => value + 1)}
          className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-muted-foreground hover:text-foreground"
          aria-label="刷新"
        >
          <RefreshCw className="size-3" />
        </button>
      </div>

      <section className="space-y-1.5">
        <h3 className="text-xs font-semibold flex items-center gap-1.5 px-0.5">现状</h3>
        {states.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/80 p-3 text-center text-2xs text-muted-foreground bg-muted/10">
            还没有状态流水。
          </p>
        ) : (
          <ul className="space-y-1" data-testid="knowledge-state-list">
            {states.map((item) => (
              <li key={item.fluent} className="flex items-baseline justify-between gap-2 rounded-lg border border-border/70 bg-card p-2 text-xs">
                <span className="text-muted-foreground">{item.fluent}</span>
                <span className="font-medium text-foreground">{item.value}</span>
                <span className="text-2xs text-muted-foreground shrink-0">第 {item.chapter} 章记</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-1.5">
        <h3 className="text-xs font-semibold flex items-center gap-1.5 px-0.5">
          <CheckCheck className="size-3 text-primary" />
          他知道<span className="text-2xs font-normal text-muted-foreground">（{knows.length} 条）</span>
        </h3>
        {knows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/80 p-3 text-center text-2xs text-muted-foreground bg-muted/10">
            还没有知情记录。
          </p>
        ) : (
          <ul className="space-y-1" data-testid="knowledge-knows-list">
            {knows.map((fact) => <FactListRow key={fact.factId} fact={fact} tone="knows" />)}
          </ul>
        )}
      </section>

      <section className="space-y-1.5">
        <h3 className="text-xs font-semibold flex items-center gap-1.5 px-0.5">
          <Ban className="size-3 text-amber-600 dark:text-amber-400" />
          他还不知道<span className="text-2xs font-normal text-muted-foreground">（写作禁忌，{unaware.length} 条）</span>
        </h3>
        {unaware.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/80 p-3 text-center text-2xs text-muted-foreground bg-muted/10">
            {anchor}没有他缺席的关键剧情。
          </p>
        ) : (
          <ul className="space-y-1" data-testid="knowledge-unaware-list">
            {unaware.map((fact) => <FactListRow key={fact.factId} fact={fact} tone="unaware" />)}
          </ul>
        )}
      </section>
    </div>
  );
}
