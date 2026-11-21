/**
 * 本章质检伴随板（ChapterQualityRail）
 *
 * 将质检功能真正接入已写正文的伴随流：
 * 1. 本章审稿红标清单（支持点击「定位到正文」高亮句 + 「交叙述者定点修」）；
 * 2. 本章文风漂移检测（把真实 chapterContent 传入 StyleDriftPanel，不再使用空文本对比）；
 * 3. 本章局部表达自审与去 AI 味（零 Token 规则扫描 + 交叙述者语感体检 / 通篇润色）；
 * 4. 一键派单叙述者做「叙事风险九维审计」或「本章审稿复审」。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  LocateFixed,
  RefreshCw,
  ScanSearch,
  ShieldAlert,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import { reviewChapterParagraphs, type ParagraphSelfReviewResult } from "../../engine/compliance/paragraph-self-review";
import {
  buildAuditFixProposalMessage,
  dispatchLocateInEditor,
  isAutoFixableIssue,
  locateAuditIssueQuote,
  type AuditIssueLite,
} from "./audit-issue-actions";
import { buildNarrativeRiskAuditMessage } from "./narrative-risk-audit-request";
import { buildHumanizeMessage, buildPolishMessage } from "./self-review-handoff";
import { fetchCustomConstraints } from "./style-custom-constraints";
import { StyleDriftPanel } from "./StyleDriftPanel";
import { toWireToolName } from "../../engine/workflows/run-brief";

export interface ChapterQualityRailProps {
  readonly bookId: string;
  readonly chapterNumber?: number;
  readonly content: string;
  readonly onSendToNarrator?: (message: string) => Promise<void> | void;
  readonly onOpenQualityDashboard?: () => void;
  readonly className?: string;
}

interface AuditIssuesPayload {
  readonly exists?: boolean;
  readonly stale?: boolean;
  readonly issues?: readonly AuditIssueLite[];
  readonly summary?: string;
}

export function ChapterQualityRail({
  bookId,
  chapterNumber,
  content,
  onSendToNarrator,
  onOpenQualityDashboard,
  className,
}: ChapterQualityRailProps) {
  const hasChapter = typeof chapterNumber === "number" && chapterNumber > 0;
  const [auditData, setAuditData] = useState<AuditIssuesPayload | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [driftOpen, setDriftOpen] = useState(true);
  const [selfReview, setSelfReview] = useState<ParagraphSelfReviewResult | null>(null);
  const [selfReviewLoading, setSelfReviewLoading] = useState(false);
  const [actionNote, setActionNote] = useState<string | null>(null);

  const loadAuditIssues = useCallback(async () => {
    if (!hasChapter) {
      setAuditData(null);
      return;
    }
    setAuditLoading(true);
    try {
      const payload = await fetchJson<AuditIssuesPayload>(
        `/api/books/${encodeURIComponent(bookId)}/narrative-memory/audit-issues?chapter=${chapterNumber}`,
      );
      setAuditData(payload);
    } catch {
      setAuditData(null);
    } finally {
      setAuditLoading(false);
    }
  }, [bookId, chapterNumber, hasChapter]);

  useEffect(() => {
    void loadAuditIssues();
  }, [loadAuditIssues]);

  const runSelfReview = useCallback(() => {
    if (!hasChapter) {
      setSelfReview(null);
      return;
    }
    setSelfReviewLoading(true);
    try {
      const res = reviewChapterParagraphs(content);
      setSelfReview(res);
    } catch {
      setSelfReview(null);
    } finally {
      setSelfReviewLoading(false);
    }
  }, [content, hasChapter]);

  useEffect(() => {
    if (!hasChapter) {
      setSelfReview(null);
      return;
    }
    const timer = window.setTimeout(() => {
      runSelfReview();
    }, 320);
    return () => window.clearTimeout(timer);
  }, [hasChapter, runSelfReview]);

  const issues = useMemo(() => auditData?.issues ?? [], [auditData]);

  const dispatchWithConstraints = async (build: (constraints: readonly string[]) => string, successTip: string) => {
    if (!onSendToNarrator) {
      setActionNote("当前未开启叙述者会话，无法派单处理。");
      return;
    }
    let constraints: readonly string[] = [];
    try {
      constraints = await fetchCustomConstraints(bookId);
    } catch {
      constraints = [];
    }
    await onSendToNarrator(build(constraints));
    setActionNote(successTip);
  };

  return (
    <aside
      className={cn("flex h-full min-h-0 flex-col overflow-y-auto bg-card text-card-foreground", className)}
      data-testid="chapter-quality-rail"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-foreground">
              {hasChapter ? `第 ${chapterNumber} 章质检` : "本章质检"}
            </span>
            {auditData?.exists ? (
              issues.length > 0 ? (
                <Badge variant="destructive" className="h-4 px-1.5 text-2xs">
                  {issues.length} 处红标
                </Badge>
              ) : (
                <Badge variant="outline" className="h-4 px-1.5 text-2xs text-primary border-primary/40">
                  已审通过
                </Badge>
              )
            ) : (
              <Badge variant="secondary" className="h-4 px-1.5 text-2xs">
                未审
              </Badge>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            void loadAuditIssues();
            void runSelfReview();
          }}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="刷新本章质检"
          aria-label="刷新本章质检"
        >
          <RefreshCw className={cn("size-3.5", (auditLoading || selfReviewLoading) && "animate-spin")} />
        </button>
      </header>

      <div className="flex flex-1 flex-col divide-y divide-border">
        {actionNote ? (
          <div className="bg-primary/8 px-3 py-2 text-2xs text-primary">
            {actionNote}
          </div>
        ) : null}

        {/* 1. 本章审稿红标（可定位正文 + 交叙述者定点修订） */}
        <section className="space-y-2 px-3 py-2.5" data-testid="chapter-quality-audit-section">
          <div className="flex items-center justify-between gap-1">
            <span className="inline-flex items-center gap-1 text-2xs font-semibold text-foreground">
              <ShieldAlert className="size-3 text-destructive" />
              本章审稿意见
            </span>
            {hasChapter && onSendToNarrator ? (
              <button
                type="button"
                onClick={() => {
                  void onSendToNarrator(
                    `请对第 ${chapterNumber} 章执行 ${toWireToolName("chapter.audit")}，并对照前文设定核查是否有连续性或节奏问题。`,
                  );
                  setActionNote("已派叙述者审计本章并更新红标。");
                }}
                className="text-2xs font-medium text-primary hover:underline"
              >
                让叙述者审计
              </button>
            ) : null}
          </div>

          {auditData?.stale ? (
            <p className="rounded bg-warning/10 px-2 py-1 text-2xs text-warning">
              正文已改动，以下审稿意见可能已过时，建议让叙述者重审。
            </p>
          ) : null}

          {!auditData?.exists ? (
            <p className="text-2xs text-muted-foreground">
              本章尚无 AI 审稿记录（不会乱标通过）。点右上角「让叙述者审计」可发起全维审校。
            </p>
          ) : issues.length === 0 ? (
            <div className="flex items-center gap-1.5 text-2xs text-primary">
              <CheckCircle2 className="size-3.5 shrink-0" />
              <span>最近一次审稿未发现红标问题。</span>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {issues.map((issue, idx) => {
                const locate = locateAuditIssueQuote(content, issue);
                const autoFixable = isAutoFixableIssue(issue, locate);
                return (
                  <li
                    key={issue.issueId ?? idx}
                    className="rounded-md border border-border/80 bg-background/60 p-2 text-2xs space-y-1"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-medium text-foreground">
                        [{issue.severity ?? "warning"}] {issue.category ?? "审稿"}
                      </span>
                      {locate.quote ? (
                        <button
                          type="button"
                          onClick={() => dispatchLocateInEditor(locate.quote!)}
                          className="inline-flex items-center gap-0.5 text-primary hover:underline"
                        >
                          <LocateFixed className="size-3" />
                          <span>定位正文</span>
                        </button>
                      ) : null}
                    </div>
                    {issue.description ? (
                      <p className="leading-relaxed text-muted-foreground">{issue.description}</p>
                    ) : null}
                    {issue.suggestion ? (
                      <p className="text-foreground/85">建议：{issue.suggestion}</p>
                    ) : null}
                    {autoFixable && locate.quote && onSendToNarrator ? (
                      <div className="pt-0.5">
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          className="h-5 gap-1 px-1.5 text-2xs"
                          onClick={() => {
                            void onSendToNarrator(
                              buildAuditFixProposalMessage({
                                chapterNumber,
                                issue,
                                quote: locate.quote!,
                              }),
                            );
                            setActionNote("已向叙述者发出定点修订提案，候选将回传正文对比。");
                          }}
                        >
                          <Sparkles className="size-2.5 text-primary" />
                          <span>交叙述者定点修</span>
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* 2. 零 Token 本地表达体检 & 语感润色派单 */}
        <section className="space-y-2 px-3 py-2.5" data-testid="chapter-quality-self-review-section">
          <div className="flex items-center justify-between gap-1">
            <span className="inline-flex items-center gap-1 text-2xs font-semibold text-foreground">
              <ScanSearch className="size-3 text-primary" />
              表达自审与去 AI 味
            </span>
            {selfReview ? (
              <span className="text-2xs text-muted-foreground">
                命中 {selfReview.issues.length} 处
              </span>
            ) : null}
          </div>

          {selfReview && selfReview.issues.length > 0 ? (
            <ul className="space-y-1">
              {selfReview.issues.slice(0, 5).map((item, idx) => (
                <li key={`${item.ruleId}-${idx}`} className="rounded border border-border/70 bg-background/60 p-1.5 text-2xs">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-medium text-foreground truncate">「{item.evidence}」</span>
                    <button
                      type="button"
                      onClick={() => dispatchLocateInEditor(item.evidence)}
                      className="shrink-0 text-primary hover:underline"
                    >
                      定位
                    </button>
                  </div>
                  <p className="mt-0.5 text-muted-foreground">{item.reason}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-2xs text-muted-foreground">
              {selfReview?.message ?? "本地规则暂未检出明显 AI 套话。"}
            </p>
          )}

          {hasChapter && onSendToNarrator ? (
            <div className="flex flex-wrap gap-1.5">
              {selfReview && selfReview.issues.length > 0 ? (
                <Button
                  type="button"
                  size="xs"
                  className="h-6 gap-1 px-2 text-2xs"
                  onClick={() => {
                    void dispatchWithConstraints(
                      (c) => buildHumanizeMessage(chapterNumber!, selfReview.issues, c),
                      "已将表达命中项交给叙述者，候选将逐条回传正文。",
                    );
                  }}
                >
                  <Sparkles className="size-3" />
                  <span>语感体检派单</span>
                </Button>
              ) : null}
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="h-6 gap-1 px-2 text-2xs"
                onClick={() => {
                  void dispatchWithConstraints(
                    (c) => buildPolishMessage(chapterNumber!, c),
                    "已派叙述者通篇打磨本章语言，候选逐条确认。",
                  );
                }}
              >
                <span>通篇润色</span>
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="h-6 gap-1 px-2 text-2xs"
                onClick={() => {
                  if (!content.trim()) {
                    setActionNote("当前章节没有正文，无法执行叙事审计。");
                    return;
                  }
                  void onSendToNarrator(buildNarrativeRiskAuditMessage({
                    content,
                    ...(chapterNumber !== undefined ? { chapterNumber } : {}),
                  }));
                  setActionNote("已派叙述者对本章做九维叙事风险审计。");
                }}
              >
                <AlertTriangle className="size-3 text-warning" />
                <span>九维叙事审计</span>
              </Button>
            </div>
          ) : null}
        </section>

        {/* 3. 本章文风漂移检测（接入真实正文 chapterContent） */}
        <section className="px-3 py-2.5" data-testid="chapter-quality-drift-section">
          {driftOpen ? (
            <StyleDriftPanel
              bookId={bookId}
              chapterContent={content}
              onClose={() => setDriftOpen(false)}
            />
          ) : (
            <Button
              type="button"
              size="xs"
              variant="outline"
              className="w-full text-2xs"
              onClick={() => setDriftOpen(true)}
            >
              展开本章文风漂移检测
            </Button>
          )}
        </section>

        {/* 4. 去全书质检大盘 */}
        {onOpenQualityDashboard ? (
          <section className="mt-auto px-3 py-2.5">
            <Button
              type="button"
              size="xs"
              variant="outline"
              className="w-full text-2xs"
              onClick={onOpenQualityDashboard}
              data-testid="quality-rail-open-dashboard"
            >
              打开全书质检与分析大盘 →
            </Button>
          </section>
        ) : null}
      </div>
    </aside>
  );
}
