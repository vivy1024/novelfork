/**
 * PipelineVisualization — real-time pipeline stage tracking via SSE.
 * Replaces the old polling approach with live pipeline:start/stage/complete events.
 */

import { useState, useEffect, useMemo } from "react";
import type { SSEMessage } from "../hooks/use-sse";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { fetchJson } from "../hooks/use-api";
import {
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Zap,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface PipelineStage {
  readonly name: string;
  readonly status: "waiting" | "running" | "completed" | "failed";
  readonly agent?: string;
  readonly model?: string;
  readonly durationMs?: number;
  readonly tokenUsage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
  readonly error?: string;
}

interface RunState {
  readonly runId: string;
  readonly bookId?: string;
  readonly bookTitle?: string;
  readonly chapterNumber?: number;
  readonly status: "running" | "completed" | "failed";
  readonly stages: Map<string, PipelineStage>;
  readonly startedAt: number;
  readonly completedAt?: number;
}

const DEFAULT_STAGES = [
  "radar", "planner", "composer", "architect", "writer",
  "observer", "settler", "length-normalizer", "continuity-auditor", "reviser",
];

function useSSERuns(messages: ReadonlyArray<SSEMessage>): Map<string, RunState> {
  const [runs, setRuns] = useState<Map<string, RunState>>(new Map());

  useEffect(() => {
    const last = messages.at(-1);
    if (!last) return;

    setRuns((prev) => {
      const next = new Map(prev);

      if (last.event === "pipeline:start") {
        const d = last.data as { runId: string; bookId?: string; bookTitle?: string; chapterNumber?: number };
        const stages = new Map<string, PipelineStage>();
        for (const name of DEFAULT_STAGES) {
          stages.set(name, { name, status: "waiting" });
        }
        next.set(d.runId, {
          runId: d.runId, bookId: d.bookId, bookTitle: d.bookTitle,
          chapterNumber: d.chapterNumber, status: "running",
          stages, startedAt: last.timestamp,
        });
      }

      if (last.event === "pipeline:stage") {
        const d = last.data as PipelineStage & { runId: string; stageName?: string };
        const stageName = d.stageName ?? d.name;
        const runId = d.runId;
        const run = next.get(runId);
        if (run) {
          const stages = new Map(run.stages);
          stages.set(stageName, { ...d, name: stageName });
          next.set(runId, { ...run, stages });
        }
      }

      if (last.event === "pipeline:complete") {
        const d = last.data as { runId: string; status: "completed" | "failed"; error?: string };
        const run = next.get(d.runId);
        if (run) {
          next.set(d.runId, { ...run, status: d.status, completedAt: last.timestamp });
        }
      }

      // Keep last 20 runs
      if (next.size > 20) {
        const sorted = [...next.entries()].sort((a, b) => b[1].startedAt - a[1].startedAt);
        return new Map(sorted.slice(0, 20));
      }
      return next;
    });
  }, [messages]);

  return runs;
}

export function PipelineVisualization({
  runId,
  nav,
  sse,
  theme,
  t,
}: {
  runId?: string;
  nav: { toDashboard: () => void };
  sse: { messages: ReadonlyArray<SSEMessage> };
  theme: Theme;
  t: TFunction;
}) {
  const c = useColors(theme);
  const sseRuns = useSSERuns(sse.messages);

  // If a specific runId is requested and not in SSE, try fetching it once
  const [fetchedRun, setFetchedRun] = useState<RunState | null>(null);
  useEffect(() => {
    if (!runId || sseRuns.has(runId)) return;
    fetchJson<{
      runId: string; bookId: string; bookTitle: string; status: string;
      startTime: number; endTime?: number;
      stages: ReadonlyArray<{ name: string; status: string; agent?: string; model?: string;
        startTime?: number; endTime?: number; error?: string;
        tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number } }>;
    }>(`/api/pipeline/${runId}/status`).then((data) => {
      const stages = new Map<string, PipelineStage>();
      for (const s of data.stages) {
        stages.set(s.name, {
          name: s.name,
          status: s.status as PipelineStage["status"],
          agent: s.agent, model: s.model,
          durationMs: s.startTime && s.endTime ? s.endTime - s.startTime : undefined,
          tokenUsage: s.tokenUsage, error: s.error,
        });
      }
      setFetchedRun({
        runId: data.runId, bookId: data.bookId, bookTitle: data.bookTitle,
        status: data.status as RunState["status"],
        stages, startedAt: data.startTime, completedAt: data.endTime,
      });
    }).catch(() => { /* ignore — SSE will pick up future runs */ });
  }, [runId, sseRuns]);

  const allRuns = useMemo(() => {
    const merged = new Map(sseRuns);
    if (fetchedRun && !merged.has(fetchedRun.runId)) {
      merged.set(fetchedRun.runId, fetchedRun);
    }
    return [...merged.values()].sort((a, b) => b.startedAt - a.startedAt);
  }, [sseRuns, fetchedRun]);

  const activeRun = allRuns.find((r) => r.status === "running");
  const displayRuns = runId ? allRuns.filter((r) => r.runId === runId) : allRuns;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span>Pipeline</span>
      </div>

      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-3xl flex items-center gap-3">
          <Activity size={28} className="text-primary" />
          Pipeline Monitor
        </h1>
        {activeRun && (
          <span className="flex items-center gap-2 text-xs text-primary font-medium px-3 py-1.5 rounded-full bg-primary/10">
            <Loader2 size={12} className="animate-spin" />
            运行中
          </span>
        )}
      </div>

      {displayRuns.length === 0 ? (
        <div className={`border border-dashed ${c.cardStatic} rounded-lg p-12 text-center text-muted-foreground text-sm italic`}>
          暂无 Pipeline 运行记录（触发写作后将实时显示）
        </div>
      ) : (
        <div className="space-y-4">
          {displayRuns.map((run) => (
            <RunCard key={run.runId} run={run} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function RunCard({ run, c }: { run: RunState; c: ReturnType<typeof useColors> }) {
  const [expanded, setExpanded] = useState(run.status === "running");
  const elapsed = (run.completedAt ?? Date.now()) - run.startedAt;
  const stages = [...run.stages.values()];
  const completedCount = stages.filter((s) => s.status === "completed").length;
  const totalTokens = stages.reduce((sum, s) => sum + (s.tokenUsage?.totalTokens ?? 0), 0);

  return (
    <div className={`border ${c.cardStatic} rounded-xl overflow-hidden`}>
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full px-5 py-3 bg-muted/40 border-b border-border flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <RunStatusIcon status={run.status} />
          <div>
            <span className="text-sm font-medium">
              {run.bookTitle ?? run.bookId ?? "Pipeline Run"}
              {run.chapterNumber != null && ` — 第${run.chapterNumber}章`}
            </span>
            <span className="text-[10px] text-muted-foreground ml-2 font-mono">
              {run.runId.slice(0, 8)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>{completedCount}/{stages.length} stages</span>
          {totalTokens > 0 && (
            <span className="flex items-center gap-1">
              <Zap size={10} /> {totalTokens.toLocaleString()}
            </span>
          )}
          <span className="flex items-center gap-1 tabular-nums">
            <Clock size={10} /> {formatDuration(elapsed)}
          </span>
        </div>
      </button>

      {/* Compact progress bar */}
      <div className="flex h-1">
        {stages.map((s) => (
          <div
            key={s.name}
            className={`flex-1 transition-colors duration-300 ${stageBarColor(s.status)}`}
          />
        ))}
      </div>

      {expanded && (
        <div className="px-5 py-3">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
            {stages.map((s) => (
              <StageCard key={s.name} stage={s} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StageCard({ stage }: { stage: PipelineStage }) {
  return (
    <div className="rounded-lg border border-border/40 p-2.5 text-xs">
      <div className="flex items-center gap-1.5 mb-1">
        <StageStatusIcon status={stage.status} />
        <span className="font-medium text-foreground truncate">{stage.name}</span>
      </div>
      {stage.agent && (
        <div className="text-[10px] text-muted-foreground truncate">
          {stage.agent}{stage.model ? ` · ${stage.model}` : ""}
        </div>
      )}
      {stage.durationMs != null && (
        <div className="text-[10px] text-muted-foreground tabular-nums">
          {formatDuration(stage.durationMs)}
        </div>
      )}
      {stage.status === "running" && (
        <div className="text-[10px] text-primary animate-pulse">运行中...</div>
      )}
      {stage.tokenUsage && (
        <div className="text-[10px] text-muted-foreground tabular-nums">
          {stage.tokenUsage.totalTokens.toLocaleString()} tok
        </div>
      )}
      {stage.error && (
        <div className="text-[10px] text-destructive truncate mt-0.5" title={stage.error}>
          {stage.error}
        </div>
      )}
    </div>
  );
}

function RunStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "running": return <Loader2 size={16} className="text-primary animate-spin shrink-0" />;
    case "completed": return <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />;
    case "failed": return <XCircle size={16} className="text-destructive shrink-0" />;
    default: return <Clock size={16} className="text-muted-foreground shrink-0" />;
  }
}

function StageStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "running": return <Loader2 size={10} className="text-primary animate-spin shrink-0" />;
    case "completed": return <CheckCircle2 size={10} className="text-emerald-500 shrink-0" />;
    case "failed": return <XCircle size={10} className="text-destructive shrink-0" />;
    default: return <div className="w-2.5 h-2.5 rounded-full border border-border shrink-0" />;
  }
}

function stageBarColor(status: string): string {
  switch (status) {
    case "running": return "bg-primary animate-pulse";
    case "completed": return "bg-emerald-500";
    case "failed": return "bg-destructive";
    default: return "bg-muted";
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}
