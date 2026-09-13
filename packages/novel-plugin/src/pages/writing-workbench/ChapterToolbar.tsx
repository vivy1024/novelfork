/**
 * ChapterToolbar — 章节编辑器底部可展开工具栏
 *
 * 四个 Tab，各管一层不同的检查：
 * - 人味润色：本地 deslop 引擎确定性改写，0 LLM
 * - 叙事审计：交叙述者开零继承子代理，按九项风险卡查叙事结构
 * - 本章审稿：落盘 audit-issues 的定位原文 + auto_fixable 修订提案
 * - 全书发布检查：发布就绪的规则/连续性门禁
 *
 * 早期这里还有一个「节奏」Tab（ChapterHealthCard），只展示静态统计数字、
 * 没有可执行动作，已按作者反馈下线。
 */
import { useEffect, useState } from "react";
import { ChevronUp, ChevronDown, Sparkles, Loader2, ShieldCheck, CheckCircle2, ScanSearch, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/hooks/use-api";
import { buildNarrativeRiskAuditMessage } from "./narrative-risk-audit-request";
import { toCompliancePlatform } from "./compliance-platform";
import {
  buildAuditFixProposalMessage,
  dispatchLocateInEditor,
  isAutoFixableIssue,
  locateAuditIssueQuote,
  type AuditIssueLite,
} from "./audit-issue-actions";

type ToolbarTab = "humanize" | "narrative" | "adversarial" | "issues" | "audit";

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

type ComplianceEvidence = {
  readonly ruleId: string;
  readonly rulePackId?: string;
  readonly source: string;
  readonly severity: "high" | "medium" | "low";
  readonly chapterNumber?: number;
  readonly chapterTitle?: string;
  readonly message: string;
  readonly context?: string;
  readonly suggestion?: string;
};

type PublishReadinessReport = {
  readonly platform: string;
  readonly status: "ready" | "has-warnings" | "needs-review" | "skipped";
  readonly rulePack: { readonly id: string; readonly name: string; readonly version: string; readonly confidence: string; readonly source: string };
  readonly evidence: readonly ComplianceEvidence[];
  readonly totalBlockCount: number;
  readonly totalWarnCount: number;
  readonly totalSuggestCount: number;
  readonly sensitiveScan: {
    readonly totalBlockCount: number;
    readonly totalWarnCount: number;
    readonly totalSuggestCount: number;
    readonly chapters: readonly { readonly chapterNumber: number; readonly chapterTitle: string; readonly blockCount: number; readonly warnCount: number; readonly suggestCount: number }[];
  };
  readonly formatCheck: { readonly blockCount: number; readonly warnCount: number; readonly suggestCount: number; readonly chapterCount: number };
  readonly continuity: { readonly status: "passed" | "has-issues" | "unknown"; readonly blockCount?: number; readonly warnCount?: number; readonly reason?: string };
};

function readinessStatusLabel(status: PublishReadinessReport["status"]): string {
  switch (status) {
    case "ready": return "全书可发布";
    case "has-warnings": return "全书有提醒";
    case "needs-review": return "全书需人工复核";
    case "skipped": return "检查已跳过";
  }
}

function evidenceKey(evidence: ComplianceEvidence): string {
  return `${evidence.ruleId}:${evidence.chapterNumber ?? "book"}:${evidence.message}`;
}

function EvidenceList({ evidence }: { evidence: readonly ComplianceEvidence[] }) {
  const unique = [...new Map(evidence.map((item) => [evidenceKey(item), item])).values()];
  if (unique.length === 0) return <p className="text-[10px] text-muted-foreground">未发现可定位证据。</p>;
  return (
    <div className="max-h-36 space-y-1 overflow-y-auto">
      {unique.slice(0, 12).map((item) => (
        <div key={evidenceKey(item)} className="rounded border border-border/60 p-1.5">
          <p className="font-medium">[{item.severity}] {item.message}</p>
          <p className="mt-1 text-muted-foreground">
            规则：{item.rulePackId ? `${item.rulePackId} · ` : ""}{item.ruleId} · 来源：{item.source}
            {item.chapterNumber !== undefined ? ` · 第 ${item.chapterNumber} 章${item.chapterTitle ? `《${item.chapterTitle}》` : ""}` : " · 全书"}
          </p>
          {item.context && <p className="mt-1 break-words text-muted-foreground">正文摘录：{item.context}</p>}
          {item.suggestion && <p className="mt-1 text-muted-foreground">建议：{item.suggestion}</p>}
        </div>
      ))}
      {unique.length > 12 && <p className="text-[10px] text-muted-foreground">另有 {unique.length - 12} 条证据。</p>}
    </div>
  );
}

function PublishReadinessSummary({ report, chapterNumber }: { report: PublishReadinessReport; chapterNumber?: number }) {
  const currentEvidence = chapterNumber === undefined
    ? []
    : report.evidence.filter((item) => item.chapterNumber === chapterNumber);
  const otherEvidence = chapterNumber === undefined
    ? report.evidence
    : report.evidence.filter((item) => item.chapterNumber !== chapterNumber);
  const continuityLabel = report.continuity.status === "passed"
    ? "通过"
    : report.continuity.status === "has-issues"
      ? `有问题（${(report.continuity.blockCount ?? 0) + (report.continuity.warnCount ?? 0)} 条）`
      : `未知${report.continuity.reason ? `：${report.continuity.reason}` : ""}`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className={report.status === "ready" ? "font-medium text-emerald-600" : "font-medium text-destructive"}>
          {readinessStatusLabel(report.status)}
        </p>
        <span className="text-[10px] text-muted-foreground">平台：{report.platform}</span>
      </div>
      <p className="rounded border border-border/60 bg-muted/30 p-2 text-[10px] text-muted-foreground">
        本次检查扫描全书 {report.formatCheck.chapterCount} 章，不是只检查当前章；当前章节仅用于置顶本章证据。
      </p>
      <div className="grid grid-cols-3 gap-1 text-[10px] text-muted-foreground">
        <span>拦截 {report.totalBlockCount}</span>
        <span>提醒 {report.totalWarnCount}</span>
        <span>建议 {report.totalSuggestCount}</span>
      </div>
      <div className="grid gap-1 text-[10px] text-muted-foreground">
        <span>敏感词：拦截 {report.sensitiveScan.totalBlockCount} · 提醒 {report.sensitiveScan.totalWarnCount} · 建议 {report.sensitiveScan.totalSuggestCount}</span>
        <span>格式：拦截 {report.formatCheck.blockCount} · 提醒 {report.formatCheck.warnCount} · 建议 {report.formatCheck.suggestCount}</span>
        <span>连续性：{continuityLabel}</span>
      </div>
      {currentEvidence.length > 0 && (
        <div className="space-y-1 border-t border-border pt-2">
          <p className="text-[10px] font-medium">本章证据（第 {chapterNumber} 章）</p>
          <EvidenceList evidence={currentEvidence} />
        </div>
      )}
      {otherEvidence.length > 0 && (
        <details className="border-t border-border pt-2">
          <summary className="cursor-pointer text-[10px] font-medium">其他章节 / 全书证据（{otherEvidence.length} 条）</summary>
          <div className="mt-1"><EvidenceList evidence={otherEvidence} /></div>
        </details>
      )}
    </div>
  );
}

export interface ChapterToolbarProps {
  bookId: string;
  chapterNumber?: number;
  /** 书籍配置中的平台枚举，用于映射 compliance 规则包。 */
  bookPlatform?: string;
  /** 当前编辑器里的正文；人味润色必须拿真实正文才能工作。 */
  content?: string;
  /** 作者确认后把去 AI 味结果写回编辑器。 */
  onApplyContent?: (content: string) => void;
  /** 把需要语义判断的项转交叙述者。 */
  onSendToNarrator?: (message: string) => Promise<void> | void;
}

export function ChapterToolbar({ bookId, chapterNumber, bookPlatform, content, onApplyContent, onSendToNarrator }: ChapterToolbarProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<ToolbarTab>("humanize");
  const [auditing, setAuditing] = useState(false);
  const [auditResult, setAuditResult] = useState<PublishReadinessReport | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [humanizing, setHumanizing] = useState(false);
  const [humanizeOutcome, setHumanizeOutcome] = useState<DeslopOutcome | null>(null);
  const [humanizeError, setHumanizeError] = useState<string | null>(null);
  const [handedOff, setHandedOff] = useState(false);
  const [narrativeRunning, setNarrativeRunning] = useState(false);
  const [narrativeSent, setNarrativeSent] = useState(false);
  const [narrativeError, setNarrativeError] = useState<string | null>(null);
  const [adversarialRunning, setAdversarialRunning] = useState(false);
  const [adversarialSent, setAdversarialSent] = useState(false);
  const [adversarialError, setAdversarialError] = useState<string | null>(null);
  const [issues, setIssues] = useState<readonly AuditIssueLite[]>([]);
  const [issuesStale, setIssuesStale] = useState(false);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issueNote, setIssueNote] = useState<string | null>(null);

  // 跨作品或跨章节切换时，彻底重置临时分析与运行结果，防止章节正文与审计结果串流覆盖
  useEffect(() => {
    setAuditResult(null);
    setAuditError(null);
    setHumanizeOutcome(null);
    setHumanizeError(null);
    setHandedOff(false);
    setNarrativeSent(false);
    setNarrativeError(null);
    setAdversarialSent(false);
    setAdversarialError(null);
    setIssueNote(null);
  }, [bookId, chapterNumber]);

  useEffect(() => {
    if (!chapterNumber) {
      setIssues([]);
      return;
    }
    let cancelled = false;
    setIssuesLoading(true);
    setIssuesError(null);
    void fetchJson<{ issues?: readonly AuditIssueLite[]; stale?: boolean }>(
      `/api/books/${encodeURIComponent(bookId)}/narrative-memory/audit-issues?chapter=${chapterNumber}`,
    ).then((payload) => {
      if (cancelled) return;
      setIssues(payload.issues ?? []);
      setIssuesStale(payload.stale === true);
    }).catch((cause) => {
      if (cancelled) return;
      setIssues([]);
      const status = cause && typeof cause === "object" && "status" in cause ? Number((cause as { status?: number }).status) : undefined;
      setIssuesError(status === 404 ? null : cause instanceof Error ? cause.message : "读取审稿记录失败");
    }).finally(() => {
      if (!cancelled) setIssuesLoading(false);
    });
    return () => { cancelled = true; };
  }, [bookId, chapterNumber]);

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
    setNarrativeRunning(true);
    try {
      await onSendToNarrator(buildNarrativeRiskAuditMessage({
        content: source,
        ...(chapterNumber !== undefined ? { chapterNumber } : {}),
      }));
      setNarrativeSent(true);
    } catch (err) {
      setNarrativeError(err instanceof Error ? err.message : "转交叙述者失败");
    } finally {
      setNarrativeRunning(false);
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
    try {
      await onSendToNarrator(lines.join("\n"));
      setHandedOff(true);
    } catch (err) {
      setHumanizeError(err instanceof Error ? err.message : "转交叙述者失败");
    }
  };

  const handleRunAdversarialAudit = async () => {
    const source = content ?? "";
    setAdversarialError(null);
    setAdversarialSent(false);
    if (!source.trim()) {
      setAdversarialError("当前章节没有正文，无法执行对抗审查。");
      return;
    }
    if (!onSendToNarrator) {
      setAdversarialError("当前视图没有可用的叙述者，无法唤起对抗审查。");
      return;
    }
    setAdversarialRunning(true);
    try {
      await onSendToNarrator(
        `请按当前作品创作工作流装配的审查工序，对第 ${chapterNumber ?? "当前"} 章正文进行多视角对抗式审查，严格输出问题清单：\n\n${source}`
      );
      setAdversarialSent(true);
    } catch (err) {
      setAdversarialError(err instanceof Error ? err.message : "唤起对抗审查失败");
    } finally {
      setAdversarialRunning(false);
    }
  };

  const handleRunAudit = async () => {
    setAuditing(true);
    setAuditResult(null);
    setAuditError(null);
    try {
      const data = await fetchJson<{ report: PublishReadinessReport }>(
        `/api/books/${encodeURIComponent(bookId)}/compliance/publish-readiness`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platform: toCompliancePlatform(bookPlatform) }),
        },
      );
      setAuditResult(data.report);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : "发布检查失败");
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
              variant={activeTab === "adversarial" ? "secondary" : "ghost"}
              size="xs"
              className="h-6 gap-1"
              onClick={() => setActiveTab("adversarial")}
            >
              <ShieldCheck className="size-3 text-purple-600 dark:text-purple-400" />
              <span className="text-[10px] font-medium">对抗审查</span>
            </Button>
            <Button
              variant={activeTab === "issues" ? "secondary" : "ghost"}
              size="xs"
              className="h-6 gap-1"
              onClick={() => setActiveTab("issues")}
            >
              <ListChecks className="size-3" />
              <span className="text-[10px]">本章审稿{issues.length > 0 ? ` ${issues.length}` : ""}</span>
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
                  disabled={narrativeRunning || !content?.trim()}
                  onClick={() => void handleRunNarrativeAudit()}
                >
                  {narrativeRunning ? <Loader2 className="size-3 animate-spin" /> : <ScanSearch className="size-3" />}
                  {narrativeRunning ? "提交中..." : "交叙述者审计"}
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
          {activeTab === "adversarial" && (
            <div className="space-y-2 py-1 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium">多视角对抗式审查</p>
                  <p className="text-[10px] text-muted-foreground">
                    由主叙述者根据作品创作工作流装配的角色与规则，对本章进行并发审查。
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  className="gap-1 bg-purple-50 hover:bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-800"
                  disabled={adversarialRunning || !content?.trim()}
                  onClick={() => void handleRunAdversarialAudit()}
                >
                  {adversarialRunning ? <Loader2 className="size-3 animate-spin" /> : <ShieldCheck className="size-3" />}
                  {adversarialRunning ? "派发中..." : "唤起工作流审查"}
                </Button>
              </div>
              {adversarialError && (
                <p role="alert" className="rounded border border-destructive/30 bg-destructive/5 p-2 text-destructive">
                  {adversarialError}
                </p>
              )}
              {adversarialSent && (
                <p className="rounded border border-border bg-muted/40 p-2 text-[10px] text-muted-foreground">
                  已唤起主叙述者执行对抗审查，请在主对话面板查看审查官会审结果。
                </p>
              )}
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                <div className="rounded border border-purple-500/20 bg-purple-500/5 p-2">
                  <p className="font-medium text-purple-700 dark:text-purple-300">A. 连续性审查官</p>
                  <p className="mt-0.5 text-muted-foreground">带工具查证前文，严查战力崩塌、时间线冲突与角色OOC</p>
                </div>
                <div className="rounded border border-blue-500/20 bg-blue-500/5 p-2">
                  <p className="font-medium text-blue-700 dark:text-blue-300">B. 叙事质量审查官</p>
                  <p className="mt-0.5 text-muted-foreground">黄金三章节奏模型，查流水账、读者期待与配角工具人化</p>
                </div>
                <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-2">
                  <p className="font-medium text-emerald-700 dark:text-emerald-300">C. 文本风控审查官</p>
                  <p className="mt-0.5 text-muted-foreground">专项过滤AI套词、句式段落等长、词汇疲劳与敏感词</p>
                </div>
              </div>
            </div>
          )}
          {activeTab === "issues" && (
            <div className="space-y-2 py-1 text-xs" data-testid="chapter-audit-issues">
              <div>
                <p className="font-medium">本章审稿意见</p>
                <p className="text-[10px] text-muted-foreground">定位原文高亮编辑器选区；可自动修的条目生成修订提案交给叙述者，不直接覆盖正文。</p>
              </div>
              {issuesStale ? <p className="text-[10px] text-amber-600 dark:text-amber-400">正文在审计后改过，意见可能过期。</p> : null}
              {issuesLoading ? <p className="text-[10px] text-muted-foreground">正在读取审稿记录…</p> : null}
              {issuesError ? <p role="alert" className="text-[10px] text-destructive">{issuesError}</p> : null}
              {issueNote ? <p className="text-[10px] text-muted-foreground">{issueNote}</p> : null}
              {!issuesLoading && issues.length === 0 && !issuesError ? (
                <p className="text-[10px] text-muted-foreground">本章还没有落盘的审稿意见。先跑叙事审计或写章管线。</p>
              ) : null}
              <ul className="space-y-1.5">
                {issues.map((issue, index) => {
                  const locate = locateAuditIssueQuote(content ?? "", issue);
                  const autoFixable = isAutoFixableIssue(issue, locate);
                  return (
                    <li
                      key={issue.issueId ?? `${issue.category}-${index}`}
                      className="rounded border border-border/70 bg-card/50 px-2 py-1.5"
                      data-testid="chapter-audit-issue"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-medium text-foreground">{issue.category ?? "审稿"}</span>
                        <span className="text-[10px] text-muted-foreground">{issue.severity ?? "warning"}</span>
                      </div>
                      <p className="mt-0.5 text-[10px] leading-5 text-muted-foreground">{issue.description}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={!locate.quote}
                          data-testid="audit-issue-locate"
                          onClick={() => {
                            if (!locate.quote) {
                              setIssueNote("这条意见在正文里找不到可定位片段。");
                              return;
                            }
                            dispatchLocateInEditor(locate.quote);
                            setIssueNote(`已定位：${locate.quote}`);
                          }}
                        >
                          定位原文
                        </Button>
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={!autoFixable || !onSendToNarrator}
                          data-testid="audit-issue-autofix"
                          onClick={() => {
                            if (!autoFixable || !locate.quote || !onSendToNarrator) {
                              setIssueNote("这条不能自动修：无法定位，或属于结构类/info。");
                              return;
                            }
                            void Promise.resolve(
                              onSendToNarrator(buildAuditFixProposalMessage({
                                chapterNumber,
                                issue,
                                quote: locate.quote,
                              })),
                            )
                              .then(() => setIssueNote("已把定点修订提案交给叙述者，请在对话里确认。"))
                              .catch((err) =>
                                setIssueNote(err instanceof Error ? err.message : "发送修订提案失败")
                              );
                          }}
                        >
                          生成修订提案
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {activeTab === "audit" && (
            <div className="space-y-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium">全书发布检查</p>
                  <p className="text-[10px] text-muted-foreground">扫描本书全部章节的敏感词、格式与连续性门禁，不修改正文。</p>
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
              {auditError && <p role="alert" className="rounded border border-destructive/30 bg-destructive/5 p-2 text-destructive">{auditError}</p>}
              {auditResult && (
                <PublishReadinessSummary report={auditResult} chapterNumber={chapterNumber} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
