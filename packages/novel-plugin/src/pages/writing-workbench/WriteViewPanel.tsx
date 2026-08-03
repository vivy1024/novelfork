/**
 * WriteViewPanel — 写作视图（ActivityBar ✍️ 的主面板）
 *
 * 一屏回答三个问题：现在能不能写、缺什么、下一步点哪。
 * 数据只来自 write.preflight；文案只来自 preflight 的 explanation，不按 code 自造。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, RefreshCw, Sparkles, XCircle } from "lucide-react";

import {
  buildWriteViewModel,
  canStartWriting,
  planFixAction,
  type ReadyCheckItem,
  type SettingsSectionId,
  type WriteFixActionId,
  type WriteViewModel,
} from "./write-view-state";
import {
  fetchPendingEvents,
  groupProposalsByChapter,
  mutatePendingEvent,
  riskLabel,
  type PendingEvent,
} from "./narrative-pending-events";

export interface WriteViewPanelProps {
  readonly bookId?: string;
  /** 只读就绪查询；由工作台注入（内部补 bookId 等可信上下文）。 */
  readonly callTool?: (tool: string, input: Record<string, unknown>) => Promise<unknown>;
  /** 切到别的侧栏视图（一键修的 view 类动作）。 */
  readonly onSwitchView?: (view: "jingwei" | "tools" | "explorer") => void;
  /** 打开写作设置并定位到指定分区（如 Writing Skills）。 */
  readonly onOpenSettings?: (section?: SettingsSectionId) => void;
  /** 打开经纬完整面板并定位到指定分类（如 outline）。 */
  readonly onOpenLorePanel?: (category?: string) => void;
  /** 把需要写入的修复交给叙述者执行（走 Runtime 权限确认）。 */
  readonly onSendToNarrator?: (message: string) => Promise<void> | void;
  /** 生成蓝图 / 直接写章：交给工作台驱动叙述者执行。 */
  readonly onRunWrite?: (payload: {
    readonly mode: "blueprint" | "chapter";
    readonly chapterNumber: number;
    readonly directive: string;
    readonly acceptFocusDefault: boolean;
    readonly preflight: unknown;
  }) => void;
  readonly formalChapterCount?: number;
}

const LIGHT_STYLE: Record<WriteViewModel["light"], { bar: string; text: string; icon: typeof CheckCircle2 }> = {
  green: { bar: "bg-emerald-500/15 border-emerald-500/40", text: "text-emerald-600 dark:text-emerald-400", icon: CheckCircle2 },
  yellow: { bar: "bg-amber-500/15 border-amber-500/40", text: "text-amber-600 dark:text-amber-400", icon: AlertTriangle },
  red: { bar: "bg-red-500/15 border-red-500/40", text: "text-red-600 dark:text-red-400", icon: XCircle },
  unknown: { bar: "bg-muted border-border", text: "text-muted-foreground", icon: Sparkles },
};

const CHECK_ICON: Record<ReadyCheckItem["state"], { glyph: string; cls: string }> = {
  ok: { glyph: "✓", cls: "text-emerald-500" },
  warn: { glyph: "!", cls: "text-amber-500" },
  block: { glyph: "×", cls: "text-red-500" },
};

export function WriteViewPanel({
  bookId,
  callTool,
  onSwitchView,
  onOpenSettings,
  onOpenLorePanel,
  onSendToNarrator,
  onRunWrite,
  formalChapterCount,
}: WriteViewPanelProps) {
  const [raw, setRaw] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [directiveDraft, setDirectiveDraft] = useState("");
  const [acceptFocusDefault, setAcceptFocusDefault] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [fixBusy, setFixBusy] = useState<WriteFixActionId | null>(null);
  const [fixNote, setFixNote] = useState<string | null>(null);
  // 本章提议：章后结算提出、等作者确认的叙事事件。
  const [proposals, setProposals] = useState<readonly PendingEvent[]>([]);
  const [proposalBusyId, setProposalBusyId] = useState<string | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [earlierOpen, setEarlierOpen] = useState(false);

  const model = useMemo(() => buildWriteViewModel(raw), [raw]);

  const runPreflight = useCallback(async () => {
    if (!callTool) {
      setError("当前环境没有接入领域工具调用。");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setRaw(await callTool("write.preflight", {}));
    } catch (err) {
      setError(err instanceof Error ? err.message : "预检失败");
    } finally {
      setLoading(false);
    }
  }, [callTool]);

  const loadProposals = useCallback(async () => {
    if (!bookId) return;
    try {
      setProposals(await fetchPendingEvents(bookId, { limit: 100 }));
      setProposalError(null);
    } catch (err) {
      // 提议加载失败不该挡住写作，只标注拿不到。
      setProposals([]);
      setProposalError(err instanceof Error ? err.message : "读取本章提议失败");
    }
  }, [bookId]);

  // 切书或首次挂载时自动预检一次
  useEffect(() => {
    if (!bookId || !callTool) return;
    void runPreflight();
  }, [bookId, callTool, runPreflight]);

  useEffect(() => {
    void loadProposals();
  }, [loadProposals]);

  /**
   * 刷新写前状态与本章提议。
   *
   * 写作由叙述者异步执行，本面板无法知道哪一刻落盘完成，所以不做轮询猜测：
   * 作者写完回到写作视图点一次刷新，就同时拿到新的预检结果和章后提议。
   */
  const refreshAll = useCallback(() => {
    void runPreflight();
    void loadProposals();
  }, [loadProposals, runPreflight]);

  /**
   * 一键修分派。
   *
   * 每条分支在宿主没提供对应 handler 时都要写 fixNote：点了没反应会被当成
   * 按钮坏了，而真实原因是当前环境没接这个入口。
   */
  const handleFix = useCallback(async (action: WriteFixActionId) => {
    const plan = planFixAction(action, { chapterNumber: model.chapterNumber, formalChapterCount });
    setFixNote(null);
    if (plan.kind === "view") {
      if (!onSwitchView) {
        setFixNote(`当前环境无法切换侧栏视图，请手动打开「${plan.label}」。`);
        return;
      }
      onSwitchView(plan.view ?? "tools");
      return;
    }
    if (plan.kind === "settings") {
      if (!onOpenSettings) {
        setFixNote(`当前环境无法打开写作设置，请点左下角设置图标后处理「${plan.label}」。`);
        return;
      }
      onOpenSettings(plan.settingsSection);
      return;
    }
    if (plan.kind === "lore-panel") {
      if (!onOpenLorePanel) {
        setFixNote(`当前环境无法打开经纬面板，请手动到经纬里处理「${plan.label}」。`);
        return;
      }
      onOpenLorePanel(plan.loreCategory);
      return;
    }
    if (!plan.message) return;
    if (!onSendToNarrator) {
      setFixNote(`当前没有可用的叙述者会话，无法执行「${plan.label}」；请先在对话里开一个会话。`);
      return;
    }
    setFixBusy(action);
    try {
      await onSendToNarrator(plan.message);
      setFixNote(`已把「${plan.label}」交给叙述者，执行需要你在对话里确认权限。`);
    } catch (err) {
      setFixNote(err instanceof Error ? err.message : `${plan.label}失败`);
    } finally {
      setFixBusy(null);
    }
  }, [formalChapterCount, model.chapterNumber, onOpenLorePanel, onOpenSettings, onSendToNarrator, onSwitchView]);

  const handleProposal = useCallback(async (event: PendingEvent, action: "approve" | "reject") => {
    if (!bookId || !event.id) return;
    setProposalBusyId(event.id);
    setProposalError(null);
    try {
      await mutatePendingEvent(bookId, event.id, action, {
        reason: action === "approve" ? "写作视图确认本章提议" : "写作视图驳回本章提议",
      });
      await loadProposals();
      // 提议影响写前状态（如高风险待确认会成为提醒），处理完重新预检。
      if (callTool) void runPreflight();
    } catch (err) {
      setProposalError(err instanceof Error ? err.message : "处理提议失败");
    } finally {
      setProposalBusyId(null);
    }
  }, [bookId, callTool, loadProposals, runPreflight]);

  const gate = canStartWriting({ model, directiveDraft, acceptFocusDefault });
  const effectiveDirective = directiveDraft.trim() || model.resolvedDirective || "";

  const proposalGroups = useMemo(
    () => groupProposalsByChapter(proposals, model.chapterNumber),
    [proposals, model.chapterNumber],
  );

  const start = useCallback((mode: "blueprint" | "chapter") => {
    if (!gate.ok) return;
    onRunWrite?.({
      mode,
      chapterNumber: model.chapterNumber,
      directive: effectiveDirective,
      acceptFocusDefault,
      preflight: raw,
    });
  }, [acceptFocusDefault, effectiveDirective, gate.ok, model.chapterNumber, onRunWrite, raw]);

  const light = LIGHT_STYLE[model.light];
  const LightIcon = light.icon;

  if (!bookId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <span className="text-2xl">✍️</span>
        <p className="text-xs text-muted-foreground">先打开一本书，再回到写作视图。</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3" data-testid="write-view-panel">
      {/* 就绪条 */}
      <section className={`rounded-md border px-3 py-2 ${light.bar}`} data-testid="write-ready-bar">
        <div className="flex items-start gap-2">
          <LightIcon className={`mt-0.5 size-4 shrink-0 ${light.text}`} />
          <div className="min-w-0 flex-1">
            <p className={`text-xs font-medium ${light.text}`} data-testid="write-headline">{model.headline}</p>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              {model.volumeLabel && <span>卷纲：{model.volumeLabel}</span>}
              {model.platformLabel && <span>平台：{model.platformLabel}</span>}
              {model.recentChapters.length > 0 && <span>近章记忆：{model.recentChapters.length} 条</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={refreshAll}
            disabled={loading}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            title="重新检查就绪与本章提议"
            data-testid="write-refresh"
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          </button>
        </div>
      </section>

      {error && (
        <p className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* 检查项清单 */}
      {model.checks.length > 0 && (
        <ul className="flex flex-col gap-1 overflow-y-auto" data-testid="write-checks">
          {model.checks.map((check) => {
            const icon = CHECK_ICON[check.state];
            const open = expanded === check.code;
            const hasDetail = Boolean(check.explanation || check.message);
            return (
              <li key={check.code} className="rounded border border-border/60 bg-card/40">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <span className={`w-3 text-center text-xs font-bold ${icon.cls}`}>{icon.glyph}</span>
                  <span className="flex-1 truncate text-[11px] text-foreground">{check.label}</span>
                  {check.fixAction && (
                    <button
                      type="button"
                      onClick={() => void handleFix(check.fixAction!)}
                      disabled={fixBusy !== null}
                      className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/20 disabled:opacity-50"
                      data-testid={`write-fix-${check.code}`}
                    >
                      {fixBusy === check.fixAction ? "处理中" : "一键修"}
                    </button>
                  )}
                  {hasDetail && (
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : check.code)}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                      aria-label="展开说明"
                    >
                      <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
                    </button>
                  )}
                </div>
                {open && (
                  <div className="border-t border-border/60 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
                    {check.explanation ? (
                      <>
                        <p><span className="text-foreground">发生了什么：</span>{check.explanation.whatHappened}</p>
                        <p><span className="text-foreground">为什么要看：</span>{check.explanation.whyItMatters}</p>
                        <p><span className="text-foreground">建议怎么做：</span>{check.explanation.suggestedAction}</p>
                      </>
                    ) : (
                      <p>{check.message}</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {fixNote && <p className="text-[10px] text-muted-foreground">{fixNote}</p>}

      {/*
        本章提议：写作 → 叙事记忆 的回路终点。
        章后结算会从正文提出事实与事件，作者必须能在写作路径上就地确认，
        而不是写完再想起去叙事记忆面板翻队列。审批走与该面板同一条通道
        （narrative-pending-events），批准语义与错误文案不会漂移。
      */}
      {(proposalGroups.current.length > 0 || proposalGroups.earlier.length > 0 || proposalError) && (
        <section className="rounded-md border border-border bg-card/40 px-2 py-1.5" data-testid="write-proposals">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-foreground">
              本章提议 {proposalGroups.current.length > 0 ? `(${proposalGroups.current.length})` : ""}
            </span>
            {proposalGroups.highRiskCount > 0 && (
              <span className="text-[10px] text-amber-600 dark:text-amber-400">
                高风险 {proposalGroups.highRiskCount}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            章后结算从正文提出的事实与事件。确认后写入动态事实；不处理也不阻断写作。
          </p>

          {proposalError && (
            <p className="mt-1 rounded border border-red-500/40 bg-red-500/10 px-1.5 py-1 text-[10px] text-red-600 dark:text-red-400">
              {proposalError}
            </p>
          )}

          <ul className="mt-1.5 flex flex-col gap-1">
            {proposalGroups.current.map((event, index) => (
              <ProposalRow
                key={event.id ?? `current-${index}`}
                event={event}
                busy={proposalBusyId === event.id}
                disabled={proposalBusyId !== null}
                onApprove={() => void handleProposal(event, "approve")}
                onReject={() => void handleProposal(event, "reject")}
              />
            ))}
          </ul>

          {proposalGroups.earlier.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setEarlierOpen((open) => !open)}
                className="mt-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                data-testid="write-proposals-earlier-toggle"
              >
                {earlierOpen ? "收起" : `另有 ${proposalGroups.earlier.length} 条前面章节遗留`}
              </button>
              {earlierOpen && (
                <ul className="mt-1 flex flex-col gap-1">
                  {proposalGroups.earlier.map((event, index) => (
                    <ProposalRow
                      key={event.id ?? `earlier-${index}`}
                      event={event}
                      busy={proposalBusyId === event.id}
                      disabled={proposalBusyId !== null}
                      onApprove={() => void handleProposal(event, "approve")}
                      onReject={() => void handleProposal(event, "reject")}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}

      {/*
        完整套路市场不挂在这里。
        曾经嵌进本面板：面板一崩会带垮三栏 IDE 写作主路径（打开书即炸）。
        市场入口只在：侧栏「套路」→「写作配置」→「套路 skills」。
      */}

      {/* 一句话指示 */}
      <div className="mt-auto flex flex-col gap-2">
        <label className="text-[11px] font-medium text-foreground" htmlFor="write-directive">
          第 {model.chapterNumber || "?"} 章要发生什么
        </label>
        <textarea
          id="write-directive"
          value={directiveDraft}
          onChange={(event) => setDirectiveDraft(event.target.value)}
          placeholder={model.resolvedDirective ?? "一句话说明本章目标，例如：让林舟通过守门人试炼，并暴露旧伤。"}
          rows={3}
          className="resize-none rounded border border-border bg-background px-2 py-1.5 text-[11px] outline-none focus:border-primary"
          data-testid="write-directive-input"
        />
        {model.needsUserConfirm && !directiveDraft.trim() && (
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <input
              type="checkbox"
              checked={acceptFocusDefault}
              onChange={(event) => setAcceptFocusDefault(event.target.checked)}
              data-testid="write-accept-focus"
            />
            采用当前焦点的默认目标
          </label>
        )}
        {!gate.ok && <p className="text-[10px] text-amber-600 dark:text-amber-400">{gate.reason}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => start("blueprint")}
            disabled={!gate.ok}
            className="flex-1 rounded border border-border px-2 py-1.5 text-[11px] hover:bg-accent disabled:opacity-40"
            data-testid="write-blueprint"
          >
            生成蓝图
          </button>
          <button
            type="button"
            onClick={() => start("chapter")}
            disabled={!gate.ok}
            className="flex-1 rounded bg-primary px-2 py-1.5 text-[11px] text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            data-testid="write-chapter"
          >
            直接写章
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 一条本章提议。
 *
 * 220px 侧栏里放不下完整证据全文，所以只给作者判断所需的最少信息：
 * 提议了什么、来自第几章、正文依据、风险与置信度。深度审计仍在叙事记忆面板。
 */
function ProposalRow({ event, busy, disabled, onApprove, onReject }: {
  readonly event: PendingEvent;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onApprove: () => void;
  readonly onReject: () => void;
}) {
  return (
    <li className="rounded border border-border/60 bg-background/60 px-1.5 py-1" data-testid="write-proposal-item">
      <div className="flex items-start justify-between gap-1.5">
        <span className="min-w-0 flex-1 text-[11px] text-foreground">
          {event.entity ?? "未命名实体"}
          {event.eventType ? <span className="text-muted-foreground"> · {event.eventType}</span> : null}
        </span>
        <span className={`shrink-0 text-[10px] ${event.risk === "high" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
          {riskLabel(event.risk)}
        </span>
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">
        第 {event.chapterNumber ?? "—"} 章
        {typeof event.confidence === "number" ? ` · 置信度 ${event.confidence}` : ""}
      </div>
      {event.evidence && (
        <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">{event.evidence}</p>
      )}
      {event.id && (
        <div className="mt-1 flex justify-end gap-1">
          <button
            type="button"
            onClick={onReject}
            disabled={disabled}
            className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-accent disabled:opacity-40"
            data-testid="write-proposal-reject"
          >
            {busy ? "处理中" : "驳回"}
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={disabled}
            className="rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            data-testid="write-proposal-approve"
          >
            {busy ? "处理中" : "确认"}
          </button>
        </div>
      )}
    </li>
  );
}
