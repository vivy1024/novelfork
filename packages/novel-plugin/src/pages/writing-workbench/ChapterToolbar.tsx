/**
 * ChapterToolbar — 章节编辑器底部可展开工具栏
 *
 * 四个 Tab，各管一层不同的检查：
 * - AI 味：本地 18 条统计/词表规则打分定位
 * - 人味润色：本地 deslop 引擎确定性改写，0 LLM
 * - 叙事审计：交叙述者开零继承子代理，按九项风险卡查叙事结构
 * - 发布检查：发布就绪的规则/连续性门禁
 *
 * 早期这里还有一个「节奏」Tab（ChapterHealthCard），只展示静态统计数字、
 * 没有可执行动作，已按作者反馈下线。
 */
import { useState } from "react";
import { ChevronUp, ChevronDown, Sparkles, Droplets, Play, Loader2, ShieldCheck, CheckCircle2, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/hooks/use-api";
import { buildNarrativeRiskAuditMessage } from "./narrative-risk-audit-request";

type ToolbarTab = "humanize" | "ai-taste" | "narrative" | "audit";

interface DeslopManualFlag {
  readonly rule: string;
  readonly excerpt: string;
  readonly reason: string;
  readonly instruction: string;
}

interface DeslopOutcome {
  readonly text: string;
  readonly autoEditCount: number;
  readonly manualFlags: readonly DeslopManualFlag[];
}

type AuditIssue = {
  readonly severity?: string;
  readonly type?: string;
  readonly description?: string;
  readonly suggestion?: string;
  readonly location?: string;
};

type AuditResult = {
  readonly passed?: boolean;
  readonly issues?: readonly AuditIssue[];
  readonly hardViolations?: readonly AuditIssue[];
  readonly softViolations?: readonly AuditIssue[];
  readonly error?: string;
};

function AuditSummary({ result }: { result: AuditResult }) {
  const hard = result.hardViolations ?? [];
  const soft = result.softViolations ?? [];
  const issues = result.issues ?? [];
  const allIssues = [...hard, ...soft, ...issues];
  const uniqueIssues = allIssues.filter((issue, index, items) => items.indexOf(issue) === index);
  return (
    <div className="space-y-2">
      <p className={result.passed === false ? "font-medium text-destructive" : "font-medium text-emerald-600"}>
        {result.passed === false ? `未通过：发现 ${uniqueIssues.length} 项问题` : "审计通过"}
      </p>
      {uniqueIssues.length > 0 && (
        <div className="max-h-32 space-y-1 overflow-y-auto">
          {uniqueIssues.slice(0, 12).map((issue, index) => (
            <details key={`${issue.type ?? "issue"}-${index}`} className="rounded border border-border/60 p-1.5">
              <summary className="cursor-pointer">
                {issue.severity ? `[${issue.severity}] ` : ""}{issue.description ?? issue.type ?? "未命名问题"}
              </summary>
              {issue.location && <p className="mt-1 text-muted-foreground">位置：{issue.location}</p>}
              {issue.suggestion && <p className="mt-1 text-muted-foreground">建议：{issue.suggestion}</p>}
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

export interface ChapterToolbarProps {
  bookId: string;
  chapterNumber?: number;
  /** 当前编辑器里的正文；人味润色必须拿真实正文才能工作。 */
  content?: string;
  /** 作者确认后把去 AI 味结果写回编辑器。 */
  onApplyContent?: (content: string) => void;
  /** 把需要语义判断的项转交叙述者。 */
  onSendToNarrator?: (message: string) => Promise<void> | void;
}

export function ChapterToolbar({ bookId, chapterNumber, content, onApplyContent, onSendToNarrator }: ChapterToolbarProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<ToolbarTab>("ai-taste");
  const [detecting, setDetecting] = useState(false);
  const [detectResult, setDetectResult] = useState<{ score?: number; details?: string } | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [humanizing, setHumanizing] = useState(false);
  const [humanizeOutcome, setHumanizeOutcome] = useState<DeslopOutcome | null>(null);
  const [humanizeError, setHumanizeError] = useState<string | null>(null);
  const [handedOff, setHandedOff] = useState(false);
  const [narrativeSent, setNarrativeSent] = useState(false);
  const [narrativeError, setNarrativeError] = useState<string | null>(null);

  /**
   * 叙事审计交给叙述者执行：零继承子代理需要 Agent Loop 与 Provider，
   * 产品 HTTP 层两者都没有，自己发起只会拿到空结果。
   */
  const handleRunNarrativeAudit = async () => {
    const source = content ?? "";
    setNarrativeError(null);
    setNarrativeSent(false);
    if (!source.trim()) {
      setNarrativeError("当前章节没有正文，无法审计。");
      return;
    }
    if (!onSendToNarrator) {
      setNarrativeError("当前视图没有可用的叙述者，无法执行叙事审计。");
      return;
    }
    try {
      await onSendToNarrator(buildNarrativeRiskAuditMessage({
        content: source,
        ...(chapterNumber !== undefined ? { chapterNumber } : {}),
      }));
      setNarrativeSent(true);
    } catch (err) {
      setNarrativeError(err instanceof Error ? err.message : "转交叙述者失败");
    }
  };

  const handleRunHumanize = async () => {
    const source = content ?? "";
    if (!source.trim()) {
      setHumanizeError("当前章节没有正文，无法执行人味润色。");
      return;
    }
    setHumanizing(true);
    setHumanizeError(null);
    setHumanizeOutcome(null);
    setHandedOff(false);
    try {
      const data = await fetchJson<{
        result?: {
          text?: string;
          edits?: readonly unknown[];
          manualFlags?: readonly DeslopManualFlag[];
        };
      }>("/api/filter/deslop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: source }),
      });
      const autoEditCount = data.result?.edits?.length ?? 0;
      const manualFlags = data.result?.manualFlags ?? [];
      if (autoEditCount === 0 && manualFlags.length === 0) {
        setHumanizeError("本地规则没有发现可改写的 AI 味特征。");
        return;
      }
      setHumanizeOutcome({
        text: data.result?.text ?? source,
        autoEditCount,
        manualFlags,
      });
    } catch (err) {
      setHumanizeError(err instanceof Error ? err.message : "人味润色失败");
    } finally {
      setHumanizing(false);
    }
  };

  /** 把规则没动的语义项交给叙述者，附带原文与逐条指示。 */
  const handOffManualFlags = async () => {
    if (!humanizeOutcome || !onSendToNarrator) return;
    const lines = [
      `请处理第 ${chapterNumber ?? "当前"} 章正文里以下需要语义判断的 AI 味问题。本地规则已改掉确定性部分，这些必须结合上下文改：`,
      "",
      ...humanizeOutcome.manualFlags.map((flag) => `- 「${flag.excerpt}」：${flag.reason}。${flag.instruction}`),
      "",
      "改完把结果给我确认，不要直接覆盖正文。",
    ];
    await onSendToNarrator(lines.join("\n"));
    setHandedOff(true);
  };

  const handleRunDetect = async () => {
    if (!chapterNumber) return;
    setDetecting(true);
    setDetectResult(null);
    try {
      const data = await fetchJson<{ score?: number; details?: string }>(
        `/api/books/${encodeURIComponent(bookId)}/detect/${chapterNumber}`,
        { method: "POST" },
      );
      setDetectResult(data);
    } catch (err) {
      setDetectResult({ details: err instanceof Error ? err.message : "检测失败" });
    } finally {
      setDetecting(false);
    }
  };

  const handleRunAudit = async () => {
    if (!chapterNumber) return;
    setAuditing(true);
    setAuditResult(null);
    try {
      const data = await fetchJson<AuditResult>(
        `/api/books/${encodeURIComponent(bookId)}/audit/${chapterNumber}`,
        { method: "POST" },
      );
      setAuditResult(data);
    } catch (err) {
      setAuditResult({ error: err instanceof Error ? err.message : "章节审计失败" });
    } finally {
      setAuditing(false);
    }
  };

  return (
    <div className="shrink-0 border-t border-border bg-muted/20">
      {/* 收起状态：只显示切换条 */}
      <div className="flex items-center h-8 px-3 gap-1">
        <Button
          variant="ghost"
          size="xs"
          className="h-6 gap-1"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
          <span className="text-[10px]">章节体检</span>
        </Button>

        {expanded && (
          <>
            <div className="mx-1 h-4 w-px bg-border" />
            <Button
              variant={activeTab === "ai-taste" ? "secondary" : "ghost"}
              size="xs"
              className="h-6 gap-1"
              onClick={() => setActiveTab("ai-taste")}
            >
              <Droplets className="size-3" />
              <span className="text-[10px]">AI味</span>
            </Button>
            <Button
              variant={activeTab === "humanize" ? "secondary" : "ghost"}
              size="xs"
              className="h-6 gap-1"
              onClick={() => setActiveTab("humanize")}
            >
              <Sparkles className="size-3" />
              <span className="text-[10px]">人味润色</span>
            </Button>
            <Button
              variant={activeTab === "narrative" ? "secondary" : "ghost"}
              size="xs"
              className="h-6 gap-1"
              onClick={() => setActiveTab("narrative")}
            >
              <ScanSearch className="size-3" />
              <span className="text-[10px]">叙事审计</span>
            </Button>
            <Button
              variant={activeTab === "audit" ? "secondary" : "ghost"}
              size="xs"
              className="h-6 gap-1"
              onClick={() => setActiveTab("audit")}
            >
              <ShieldCheck className="size-3" />
              <span className="text-[10px]">发布检查</span>
            </Button>
          </>
        )}
      </div>

      {/* 展开内容 */}
      {expanded && (
        <div className={cn("border-t border-border overflow-y-auto", "max-h-48 p-3")}>
          {activeTab === "humanize" && (
            <div className="space-y-2 py-1 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium">人味润色（本地规则去 AI 味）</p>
                  <p className="text-[10px] text-muted-foreground">0 模型调用：删套词、去否定翻转、规范标点；需语义判断的项只标注。</p>
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  className="gap-1"
                  disabled={humanizing || !content?.trim()}
                  onClick={() => void handleRunHumanize()}
                >
                  {humanizing ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                  {humanizing ? "分析中..." : "扫描本章"}
                </Button>
              </div>
              {humanizeError && <p role="alert" className="rounded border border-destructive/30 bg-destructive/5 p-2 text-destructive">{humanizeError}</p>}
              {handedOff && (
                <p className="rounded border border-border bg-muted/40 p-2 text-[10px] text-muted-foreground">
                  已把语义项交给叙述者，在对话面板查看结果。
                </p>
              )}
              {humanizeOutcome && (
                <div className="space-y-2">
                  <div className="rounded border border-border bg-muted/40 p-2.5 space-y-1.5">
                    <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                      <CheckCircle2 className="size-3" />
                      <span>规则已改 {humanizeOutcome.autoEditCount} 处</span>
                    </div>
                    {humanizeOutcome.autoEditCount > 0 && (
                      <>
                        <div className="max-h-24 overflow-y-auto text-xs whitespace-pre-wrap text-muted-foreground leading-5">
                          {humanizeOutcome.text.slice(0, 600)}
                          {humanizeOutcome.text.length > 600 ? "…" : ""}
                        </div>
                        {onApplyContent && (
                          <Button
                            size="xs"
                            className="w-full"
                            onClick={() => {
                              onApplyContent(humanizeOutcome.text);
                              setHumanizeOutcome(null);
                            }}
                          >
                            应用到正文（不自动保存）
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                  {humanizeOutcome.manualFlags.length > 0 && (
                    <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 space-y-1">
                      <div className="text-[10px] font-medium text-amber-700 dark:text-amber-400">
                        {humanizeOutcome.manualFlags.length} 处需语义判断，规则未改
                      </div>
                      <div className="max-h-20 space-y-0.5 overflow-y-auto">
                        {humanizeOutcome.manualFlags.slice(0, 8).map((flag, index) => (
                          <div key={`${flag.rule}-${index}`} className="text-[10px] text-muted-foreground">
                            「{flag.excerpt}」{flag.reason}
                          </div>
                        ))}
                      </div>
                      {onSendToNarrator && (
                        <Button size="xs" variant="outline" className="w-full" onClick={() => void handOffManualFlags()}>
                          交叙述者处理
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {activeTab === "ai-taste" && (
            <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
              <Droplets className="size-6 opacity-30 mb-2" />
              <p className="text-xs">AI 味检测</p>
              <p className="text-[10px] mt-1 opacity-60">保存章节后可运行检测</p>
              <Button
                variant="outline"
                size="xs"
                className="mt-3 gap-1"
                disabled={detecting || !chapterNumber}
                onClick={() => void handleRunDetect()}
              >
                {detecting ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
                {detecting ? "检测中..." : "运行检测"}
              </Button>
              {detectResult && (
                <div className="mt-3 text-xs text-center">
                  {detectResult.score != null && <p>AI 味分数：<span className="font-semibold">{detectResult.score}</span></p>}
                  {detectResult.details && <p className="mt-1 opacity-70">{detectResult.details}</p>}
                </div>
              )}
            </div>
          )}
          {activeTab === "narrative" && (
            <div className="space-y-2 py-1 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium">叙事审计（九项风险卡）</p>
                  <p className="text-[10px] text-muted-foreground">
                    由不知道大纲与你意图的零继承子代理只读正文，查「用结论替代过程」与「叙事过满」。
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  className="gap-1"
                  disabled={!content?.trim()}
                  onClick={() => void handleRunNarrativeAudit()}
                >
                  <ScanSearch className="size-3" />
                  交叙述者审计
                </Button>
              </div>
              <div className="rounded border border-border/60 bg-muted/30 p-2 text-[10px] leading-5 text-muted-foreground">
                <p className="font-medium text-foreground">查的是结构，不是词汇</p>
                <p>A 路：背景标签跳跃 / 情绪只命名不作用 / 人物共用作者脑 / 描写后加总结盖章</p>
                <p>B 路：信息过快就位 / 细节出现即功能化 / 同一转变说两遍 / 结尾清单式结算 / 验线走廊</p>
              </div>
              {narrativeError && (
                <p role="alert" className="rounded border border-destructive/30 bg-destructive/5 p-2 text-destructive">
                  {narrativeError}
                </p>
              )}
              {narrativeSent && (
                <p className="rounded border border-border bg-muted/40 p-2 text-[10px] text-muted-foreground">
                  已交给叙述者。它会开一个零继承子代理只读本章正文，结果在对话面板查看。
                </p>
              )}
            </div>
          )}
          {activeTab === "audit" && (
            <div className="space-y-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium">发布检查</p>
                  <p className="text-[10px] text-muted-foreground">敏感词、格式与连续性门禁，判断能不能发；不修改正文。</p>
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  className="gap-1"
                  disabled={auditing || !chapterNumber}
                  onClick={() => void handleRunAudit()}
                >
                  {auditing ? <Loader2 className="size-3 animate-spin" /> : <ShieldCheck className="size-3" />}
                  {auditing ? "审计中..." : "运行审计"}
                </Button>
              </div>
              {auditResult?.error && <p role="alert" className="rounded border border-destructive/30 bg-destructive/5 p-2 text-destructive">{auditResult.error}</p>}
              {auditResult && !auditResult.error && (
                <AuditSummary result={auditResult} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
