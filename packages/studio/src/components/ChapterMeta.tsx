/**
 * ChapterMeta — 章节元数据可折叠面板
 * 展示 token 消耗、字数遥测、AI 检测分数、审计问题、审阅备注、字数警告
 */
import { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Cpu,
  Ruler,
  ScanEye,
  AlertTriangle,
  MessageSquareText,
  TriangleAlert,
} from "lucide-react";
import { useColors } from "../hooks/use-colors";

// --- 类型定义 ---

interface TokenUsage {
  readonly prompt: number;
  readonly completion: number;
  readonly total: number;
}

interface LengthTelemetry {
  readonly target: number;
  readonly actual: number;
  readonly delta: number;
}

interface ChapterMetaProps {
  readonly chapter: any;
  readonly theme: any;
  readonly t: any;
}

// --- 辅助函数 ---

/** 检测分数风险等级颜色 */
function detectionColor(score: number): string {
  if (score < 0.3) return "text-emerald-500";
  if (score <= 0.7) return "text-amber-500";
  return "text-red-500";
}

function detectionBg(score: number): string {
  if (score < 0.3) return "bg-emerald-500/10";
  if (score <= 0.7) return "bg-amber-500/10";
  return "bg-red-500/10";
}
/** Token 条形图中单项的百分比宽度 */
function barWidth(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.min(Math.round((value / total) * 100), 100)}%`;
}

/** 判断章节是否有任何元数据可展示 */
function hasAnyMeta(ch: any): boolean {
  return !!(
    ch.tokenUsage ||
    ch.lengthTelemetry ||
    ch.detectionScore != null ||
    (ch.auditIssues && ch.auditIssues.length > 0) ||
    ch.reviewNote ||
    (ch.lengthWarnings && ch.lengthWarnings.length > 0)
  );
}

// --- 子组件 ---

/** Token 消耗区块 */
function TokenSection({ usage, colors }: { usage: TokenUsage; colors: ReturnType<typeof useColors> }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Cpu size={13} className={colors.accent} />
        <span>Token 消耗</span>
        <span className={`ml-auto font-mono text-[11px] ${colors.muted}`}>{usage.total.toLocaleString()}</span>
      </div>
      {/* 条形图 */}
      <div className="space-y-1.5">
        <TokenBar label="Prompt" value={usage.prompt} total={usage.total} color="bg-blue-500" />
        <TokenBar label="Completion" value={usage.completion} total={usage.total} color="bg-violet-500" />
      </div>
    </div>
  );
}

function TokenBar({ label, value, total, color }: {
  label: string; value: number; total: number; color: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-20 text-muted-foreground shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-muted/60 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: barWidth(value, total) }} />
      </div>
      <span className="w-14 text-right font-mono text-muted-foreground">{value.toLocaleString()}</span>
    </div>
  );
}

/** 字数遥测区块 */
function LengthSection({ telemetry, colors }: { telemetry: LengthTelemetry; colors: ReturnType<typeof useColors> }) {
  const isOver = telemetry.delta > 0;
  const deltaColor = isOver ? "text-red-500" : "text-emerald-500";
  const deltaSign = isOver ? "+" : "";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Ruler size={13} className={colors.accent} />
        <span>字数遥测</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div className="rounded-md bg-muted/40 px-2 py-1.5 text-center">
          <div className="text-muted-foreground">目标</div>
          <div className="font-mono font-medium text-foreground">{telemetry.target.toLocaleString()}</div>
        </div>
        <div className="rounded-md bg-muted/40 px-2 py-1.5 text-center">
          <div className="text-muted-foreground">实际</div>
          <div className="font-mono font-medium text-foreground">{telemetry.actual.toLocaleString()}</div>
        </div>
        <div className={`rounded-md px-2 py-1.5 text-center ${isOver ? "bg-red-500/10" : "bg-emerald-500/10"}`}>
          <div className="text-muted-foreground">偏差</div>
          <div className={`font-mono font-medium ${deltaColor}`}>{deltaSign}{telemetry.delta.toLocaleString()}</div>
        </div>
      </div>
    </div>
  );
}

/** AI 检测分数区块 */
function DetectionSection({ score, provider, colors }: {
  score: number; provider?: string; colors: ReturnType<typeof useColors>;
}) {
  const pct = Math.round(score * 100);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <ScanEye size={13} className={colors.accent} />
        <span>AI 检测</span>
      </div>
      <div className={`flex items-center gap-3 rounded-md px-3 py-2 ${detectionBg(score)}`}>
        <span className={`text-lg font-bold font-mono ${detectionColor(score)}`}>{pct}%</span>
        <div className="flex-1">
          {/* 进度条 */}
          <div className="h-1.5 rounded-full bg-muted/60 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                score < 0.3 ? "bg-emerald-500" : score <= 0.7 ? "bg-amber-500" : "bg-red-500"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          {provider && (
            <div className="text-[10px] text-muted-foreground mt-1">via {provider}</div>
          )}
        </div>
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${detectionBg(score)} ${detectionColor(score)}`}>
          {score < 0.3 ? "低风险" : score <= 0.7 ? "中风险" : "高风险"}
        </span>
      </div>
    </div>
  );
}

/** 审计问题区块 */
function AuditSection({ issues, colors }: { issues: ReadonlyArray<any>; colors: ReturnType<typeof useColors> }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <AlertTriangle size={13} className={colors.accent} />
        <span>审计问题</span>
        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{issues.length}</span>
      </div>
      <ul className="space-y-1">
        {issues.map((issue, i) => {
          const severity = issue.severity ?? issue.level ?? "info";
          const severityStyle = severity === "error" || severity === "critical"
            ? "bg-red-500/10 text-red-500"
            : severity === "warning"
              ? "bg-amber-500/10 text-amber-500"
              : "bg-blue-500/10 text-blue-500";
          return (
            <li key={i} className="flex items-start gap-2 text-[11px] rounded-md bg-muted/30 px-2 py-1.5">
              <span className={`shrink-0 mt-0.5 px-1 py-0.5 rounded text-[9px] font-bold uppercase ${severityStyle}`}>
                {severity}
              </span>
              <span className="text-foreground/80">{issue.message ?? issue.description ?? String(issue)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 审阅备注区块 */
function ReviewNoteSection({ note, colors }: { note: string; colors: ReturnType<typeof useColors> }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <MessageSquareText size={13} className={colors.accent} />
        <span>审阅备注</span>
      </div>
      <div className={`text-[11px] leading-relaxed rounded-md border border-border px-3 py-2 ${colors.surface} text-foreground/80`}>
        {note}
      </div>
    </div>
  );
}

/** 字数警告区块 */
function WarningsSection({ warnings, colors }: { warnings: ReadonlyArray<string>; colors: ReturnType<typeof useColors> }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <TriangleAlert size={13} className={colors.accent} />
        <span>字数警告</span>
        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500">{warnings.length}</span>
      </div>
      <ul className="space-y-1">
        {warnings.map((w, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px] text-amber-600 dark:text-amber-400">
            <span className="shrink-0 mt-0.5">•</span>
            <span>{w}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- 主组件 ---

export function ChapterMeta({ chapter, theme, t }: ChapterMetaProps) {
  const [open, setOpen] = useState(false);
  const colors = useColors(theme);

  // 没有任何元数据时不渲染
  if (!hasAnyMeta(chapter)) return null;

  const tokenUsage: TokenUsage | undefined = chapter.tokenUsage;
  const lengthTelemetry: LengthTelemetry | undefined = chapter.lengthTelemetry;
  const detectionScore: number | undefined = chapter.detectionScore;
  const detectionProvider: string | undefined = chapter.detectionProvider;
  const auditIssues: ReadonlyArray<any> | undefined =
    chapter.auditIssues && chapter.auditIssues.length > 0 ? chapter.auditIssues : undefined;
  const reviewNote: string | undefined = chapter.reviewNote || undefined;
  const lengthWarnings: ReadonlyArray<string> | undefined =
    chapter.lengthWarnings && chapter.lengthWarnings.length > 0 ? chapter.lengthWarnings : undefined;

  return (
    <div className={`rounded-lg border ${colors.cardStatic} ${colors.surface} overflow-hidden`}>
      {/* 折叠头部 */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-foreground hover:bg-muted/40 transition-colors"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{t?.("chapter.meta") ?? "章节元数据"}</span>
        {/* 简要指标预览（收起时可见） */}
        {!open && (
          <span className={`ml-auto flex items-center gap-3 text-[10px] font-normal ${colors.muted}`}>
            {tokenUsage && <span className="font-mono">{tokenUsage.total.toLocaleString()} tok</span>}
            {detectionScore != null && (
              <span className={`font-mono ${detectionColor(detectionScore)}`}>
                AI {Math.round(detectionScore * 100)}%
              </span>
            )}
            {auditIssues && <span className="text-red-500">{auditIssues.length} 问题</span>}
          </span>
        )}
      </button>

      {/* 展开内容 */}
      {open && (
        <div className="px-4 pb-4 pt-1 space-y-4 border-t border-border">
          {tokenUsage && <TokenSection usage={tokenUsage} colors={colors} />}
          {lengthTelemetry && <LengthSection telemetry={lengthTelemetry} colors={colors} />}
          {detectionScore != null && (
            <DetectionSection score={detectionScore} provider={detectionProvider} colors={colors} />
          )}
          {auditIssues && <AuditSection issues={auditIssues} colors={colors} />}
          {reviewNote && <ReviewNoteSection note={reviewNote} colors={colors} />}
          {lengthWarnings && <WarningsSection warnings={lengthWarnings} colors={colors} />}
        </div>
      )}
    </div>
  );
}
