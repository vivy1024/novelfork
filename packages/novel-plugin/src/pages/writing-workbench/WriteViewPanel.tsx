/**
 * WriteViewPanel — 写作视图（ActivityBar ✍️ 的主面板）
 *
 * 一屏回答三个问题：现在能不能写、缺什么、下一步点哪。
 * 写前状态只来自 write.preflight；文案只来自 preflight 的 explanation，不按 code 自造。
 *
 * 章节循环（W1）：面板顶部是「写 → 改 → 收尾」步骤条，当前步由 chapter-loop-state
 * 从写前预检、结算新鲜度与文风金库推出，不另存。写 = 写前准备 + 写下一章；
 * 改 / 收尾针对最近写完的那一章。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BookOpen, CheckCircle2, ChevronDown, ChevronRight, Compass, Loader2, RefreshCw, Sparkles, Workflow, XCircle } from "lucide-react";
import type { ViewId } from "./ide/use-panel-manager";

import { fetchJson, invalidateApiPaths, useApi } from "@/hooks/use-api";
import { resolveChapterLoop, settlementLabel, type ChapterLoopStep, type LastWrittenChapter, type LoopFreshnessChapter } from "./chapter-loop-state";
import { freshnessPath } from "./ide/StaleSettlementList";
import { ChapterRevisions, vaultPath, type VaultSummary } from "./ide/StyleVaultPanel";
import { reviewChapterParagraphs, type ParagraphSelfReviewIssue, type ParagraphSelfReviewResult } from "../../engine/compliance/paragraph-self-review";
import { composeCustomConstraintsSection } from "../../engine/writing-layers/style-preset-custom-constraints";
import { dispatchLocateInEditor } from "./audit-issue-actions";
import { fetchCustomConstraints } from "./style-custom-constraints";

import type { BeatBudgetItem } from "../../handlers/beat-budget";
import { BeatBudgetEditor } from "./BeatBudgetEditor";

import {
  buildWriteViewModel,
  canStartWriting,
  planFixAction,
  type ReadyCheckItem,
  type SettingsSectionId,
  type WriteFixActionId,
  type WriteViewModel,
} from "./write-view-state";
import { useWritingProgressRefresh } from "./use-writing-progress-refresh";
import {
  buildVolumeCockpitModel,
  type VolumeCockpitModel,
} from "./volume-cockpit-state";
import {
  fetchPendingEvents,
  groupProposalsByChapter,
  mutatePendingEvent,
  riskLabel,
  type PendingEvent,
} from "./narrative-pending-events";
import { CreativeCompassPanel } from "./CreativeCompassPanel";
import { useNewBookGuideCompleted } from "./new-book-guide-state";

/** @deprecated 请从 writing-progress-event 导入；此处保留兼容旧 import。 */
export { WRITING_PROGRESS_EVENT } from "./writing-progress-event";

export interface WriteViewPanelProps {
  readonly bookId?: string;
  /** 只读就绪查询；由工作台注入（内部补 bookId 等可信上下文）。 */
  readonly callTool?: (tool: string, input: Record<string, unknown>) => Promise<unknown>;
  /** 切到别的侧栏视图（一键修的 view 类动作）。 */
  readonly onSwitchView?: (view: ViewId) => void;
  /** 打开写作设置并定位到指定分区（如写作技能）。 */
  readonly onOpenSettings?: (section?: SettingsSectionId) => void;
  /** 打开角色与设定完整面板并定位到指定分类（如 outline）。 */
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
    /** 作者在本面板编辑好的情节点预算；为空表示不干预模型自行拆点。 */
    readonly beatBudget?: readonly BeatBudgetItem[];
  }) => void;
  /**
   * 作者配置的单章目标字数（book.json chapterWordCount）。
   * 拿不到时传 0/不传：情节点预算编辑器会显示"未知"，不编造默认值。
   */
  readonly chapterWordTarget?: number;
  readonly formalChapterCount?: number;
  /** 推荐章已有正文时，打开该章编辑器。 */
  readonly onJumpToChapter?: (chapterNumber: number) => void;
  /**
   * 面板是否可见（写作视图为当前侧栏视图且侧栏展开）。
   * 由 false→true 时自动刷新一次，作者写完回到写作视图即拿到最新状态，
   * 无需手动点刷新，也不引入常驻轮询。
   */
  readonly visible?: boolean;
  /**
   * 资源树里是否已有章节（与作品总览同一判据）。有章节的书不再显示建书十一问，
   * 起书引导卡改为「补全本章焦点」。
   */
  readonly hasChapters?: boolean;
  /** 打开作品总览里的建书十一问（起书引导卡「先回答建书十一问」）。 */
  readonly onOpenNewBookGuide?: () => void;
  /**
   * 在中央打开工作流（按作者装配的工序写这一章）。工作流的唯一入口在这里；
   * 不传时不显示入口（例如宿主还没绑定书）。
   */
  readonly onOpenWorkflow?: () => void;
  /** 在中央打开故事画布并落在「下一章」（「伏笔到期」一键修的落点：伏笔账本在那里）。 */
  readonly onOpenStoryCanvas?: () => void;
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
  chapterWordTarget = 0,
  onJumpToChapter,
  visible,
  hasChapters = false,
  onOpenNewBookGuide,
  onOpenWorkflow,
  onOpenStoryCanvas,
}: WriteViewPanelProps) {
  const [raw, setRaw] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [directiveDraft, setDirectiveDraft] = useState("");
  const [acceptFocusDefault, setAcceptFocusDefault] = useState(false);
  const directiveDraftRef = useRef(directiveDraft);
  const acceptFocusDefaultRef = useRef(acceptFocusDefault);
  directiveDraftRef.current = directiveDraft;
  acceptFocusDefaultRef.current = acceptFocusDefault;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [fixBusy, setFixBusy] = useState<WriteFixActionId | null>(null);
  const [fixNote, setFixNote] = useState<string | null>(null);
  // 本章提议：章后结算提出、等作者确认的叙事事件。
  const [proposals, setProposals] = useState<readonly PendingEvent[]>([]);
  const [proposalBusyId, setProposalBusyId] = useState<string | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [earlierOpen, setEarlierOpen] = useState(false);
  // 卷驾驶舱：当前卷上下文，走 outline.volume(action=get) 只读通道。
  const [volumeRaw, setVolumeRaw] = useState<unknown>(null);
  const [volumeError, setVolumeError] = useState<string | null>(null);
  // 作者编辑的情节点预算：默认折叠、默认为空（空=不干预模型自行拆点）。
  const [beatBudget, setBeatBudget] = useState<readonly BeatBudgetItem[]>([]);
  const [beatOpen, setBeatOpen] = useState(false);
  const compassRef = useRef<HTMLDivElement>(null);

  const guideCompleted = useNewBookGuideCompleted(bookId);
  const newBookGuidePending = !hasChapters && !guideCompleted;
  const model = useMemo(
    () => buildWriteViewModel(raw, { newBookGuidePending }),
    [raw, newBookGuidePending],
  );
  const volumeModel = useMemo<VolumeCockpitModel>(
    () => buildVolumeCockpitModel(volumeRaw, model.chapterNumber),
    [volumeRaw, model.chapterNumber],
  );

  const runPreflight = useCallback(async () => {
    if (!callTool) {
      setError("当前环境没有接入领域工具调用。");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setRaw(await callTool("write.preflight", {
        userDirectives: directiveDraftRef.current,
        acceptFocusDefault: acceptFocusDefaultRef.current,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "预检失败");
    } finally {
      setLoading(false);
    }
  }, [callTool]);

  const loadVolume = useCallback(async () => {
    if (!callTool) return;
    try {
      setVolumeRaw(await callTool("outline.volume", {}));
      setVolumeError(null);
    } catch (err) {
      // 卷纲加载失败不该挡住写作，只标注拿不到当前卷。
      setVolumeRaw(null);
      setVolumeError(err instanceof Error ? err.message : "读取卷纲失败");
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

  // 切书或首次挂载时自动预检一次，并读取当前卷。
  useEffect(() => {
    if (!bookId || !callTool) return;
    void runPreflight();
    void loadVolume();
  }, [bookId, callTool, runPreflight, loadVolume]);

  useEffect(() => {
    void loadProposals();
  }, [loadProposals]);

  /**
   * 刷新写前状态、卷驾驶舱与本章提议。
   *
   * 写作由叙述者异步执行，本面板无法在进程内知道哪一刻落盘完成。刷新有三条
   * 来源，都不依赖轮询定时器：手动点刷新、面板由隐藏转为可见、以及工作台在
   * 章节保存/结算后派发的 WRITING_PROGRESS_EVENT。
   */
  const refreshAll = useCallback(() => {
    void runPreflight();
    void loadProposals();
    void loadVolume();
    if (bookId) invalidateApiPaths([freshnessPath(bookId), vaultPath(bookId)]);
  }, [bookId, loadProposals, loadVolume, runPreflight]);

  useWritingProgressRefresh(bookId, refreshAll);

  // 面板由隐藏转为可见时刷新一次：覆盖「叙述者异步写完、作者切回写作视图」，
  // 免去手动刷新，也避免面板不可见时做无谓请求。
  const wasVisibleRef = useRef(false);
  useEffect(() => {
    if (!bookId || !callTool) return;
    if (visible && !wasVisibleRef.current) refreshAll();
    wasVisibleRef.current = Boolean(visible);
  }, [visible, bookId, callTool, refreshAll]);

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
      onSwitchView(plan.view ?? "resources");
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
    if (plan.kind === "write-compass") {
      compassRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      const goal = compassRef.current?.querySelector<HTMLTextAreaElement>("[data-testid='creative-compass-goal']");
      goal?.focus();
      setFixNote("请在上方创作罗盘填写本章目标；保存后写章会按它推进。");
      return;
    }
    if (plan.kind === "story-canvas") {
      if (!onOpenStoryCanvas) {
        setFixNote(`当前环境无法打开故事画布，请点活动栏「故事推进」，再点「打开故事画布」处理「${plan.label}」。`);
        return;
      }
      onOpenStoryCanvas();
      return;
    }
    if (plan.kind === "lore-panel") {
      if (!onOpenLorePanel) {
        setFixNote(`当前环境无法打开角色与设定面板，请手动到角色与设定里处理「${plan.label}」。`);
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
  }, [formalChapterCount, model.chapterNumber, onOpenLorePanel, onOpenSettings, onOpenStoryCanvas, onSendToNarrator, onSwitchView]);

  /** 起书引导卡的按钮：没答十一问 → 打开作品总览的十一问；答过 → 定位创作罗盘。 */
  const handleOnboardingAction = useCallback(() => {
    if (model.onboarding?.kind === "answer-guide") {
      setFixNote(null);
      if (!onOpenNewBookGuide) {
        setFixNote("当前环境无法切换到作品总览，请点活动栏「资源」，再点侧栏顶部的「作品总览」回答建书十一问。");
        return;
      }
      onOpenNewBookGuide();
      return;
    }
    void handleFix("open-focus");
  }, [handleFix, model.onboarding?.kind, onOpenNewBookGuide]);

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

  // ── 章节循环：写 → 改 → 收尾 ──
  const { data: freshnessData } = useApi<{ readonly chapters?: readonly LoopFreshnessChapter[] }>(bookId ? freshnessPath(bookId) : null);
  const { data: vaultData } = useApi<VaultSummary>(bookId ? vaultPath(bookId) : null);
  const pendingByChapter = useMemo(() => {
    const counts = new Map<number, number>();
    for (const event of proposals) {
      if (typeof event.chapterNumber === "number") counts.set(event.chapterNumber, (counts.get(event.chapterNumber) ?? 0) + 1);
    }
    return counts;
  }, [proposals]);
  const loop = useMemo(() => resolveChapterLoop({
    nextChapter: model.chapterNumber,
    nextAlreadyWritten: model.alreadyWritten,
    freshness: freshnessData?.chapters,
    vault: vaultData?.chapters,
    pendingByChapter,
  }), [freshnessData, vaultData, model.chapterNumber, model.alreadyWritten, pendingByChapter]);
  const [pickedStep, setPickedStep] = useState<ChapterLoopStep | null>(null);
  // 由状态推出的默认步变了（收尾完成、换了章或换了书），作者之前手动选的步不再适用。
  useEffect(() => {
    setPickedStep(null);
  }, [bookId, loop.defaultStep, loop.lastWritten?.chapterNumber]);
  const activeStep = pickedStep ?? loop.defaultStep;
  const lastWritten = loop.lastWritten;

  const [settleBusy, setSettleBusy] = useState(false);
  const [settleNote, setSettleNote] = useState<{ readonly tone: "ok" | "error"; readonly text: string } | null>(null);
  /** 收尾：经 Runtime 默认模型结算本章；没有模型时如实显示服务端给的原因，不用规则冒充。 */
  const settleChapter = useCallback(async (chapterNumber: number, force = false) => {
    if (!bookId) return;
    setSettleBusy(true);
    setSettleNote(null);
    try {
      const result = await fetchJson<{ summary?: string }>(
        `/api/books/${encodeURIComponent(bookId)}/narrative-memory/chapters/${chapterNumber}/resettle`,
        force
          ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true }) }
          : { method: "POST" },
      );
      setSettleNote({ tone: "ok", text: result.summary ?? `第 ${chapterNumber} 章已结算。` });
      invalidateApiPaths([freshnessPath(bookId), `/api/books/${encodeURIComponent(bookId)}/narrative-memory/events/pending`]);
      void loadProposals();
    } catch (err) {
      setSettleNote({ tone: "error", text: err instanceof Error && err.message ? err.message : "结算失败。" });
    } finally {
      setSettleBusy(false);
    }
  }, [bookId, loadProposals]);

  // 本章提议按最近写完的那一章分组（刚写完时预检已推荐下一章，用推荐章会把本章提议算成「前面遗留」）。
  const proposalGroups = useMemo(
    () => groupProposalsByChapter(proposals, lastWritten?.chapterNumber ?? model.chapterNumber),
    [proposals, lastWritten?.chapterNumber, model.chapterNumber],
  );

  const start = useCallback((mode: "blueprint" | "chapter") => {
    if (model.alreadyWritten) {
      if (model.chapterNumber > 0) onJumpToChapter?.(model.chapterNumber);
      return;
    }
    if (!gate.ok) return;
    onRunWrite?.({
      mode,
      chapterNumber: model.chapterNumber,
      directive: effectiveDirective,
      acceptFocusDefault,
      preflight: raw,
      ...(beatBudget.length > 0 ? { beatBudget } : {}),
    });
  }, [acceptFocusDefault, beatBudget, effectiveDirective, gate.ok, model.alreadyWritten, model.chapterNumber, onJumpToChapter, onRunWrite, raw]);

  const effectiveWordTarget = chapterWordTarget > 0 ? chapterWordTarget : model.wordTarget;

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

  // 收尾一步可用时，本章提议放进收尾；还没有写完的章时（提议来自更早的章），留在写这一步。
  const proposalsInClose = Boolean(lastWritten);
  const proposalsSection = (proposalGroups.current.length > 0 || proposalGroups.earlier.length > 0 || proposalError) ? (
    <ProposalsSection
      groups={proposalGroups}
      error={proposalError}
      busyId={proposalBusyId}
      earlierOpen={earlierOpen}
      onToggleEarlier={() => setEarlierOpen((open) => !open)}
      onDecide={(event, action) => void handleProposal(event, action)}
    />
  ) : null;

  return (
    <div className="flex h-full flex-col gap-3 p-3" data-testid="write-view-panel">
      <ChapterLoopBar steps={loop.steps} active={activeStep} onSelect={setPickedStep} />

      {activeStep === "revise" && lastWritten ? (
        <>
          <ReviseStep chapter={lastWritten} onOpenChapter={onJumpToChapter} />
          <SelfReviewSection bookId={bookId} chapterNumber={lastWritten.chapterNumber} onJumpToChapter={onJumpToChapter} onSendToNarrator={onSendToNarrator} />
        </>
      ) : null}

      {activeStep === "close" && lastWritten ? (
        <>
          <CloseStep
            chapter={lastWritten}
            busy={settleBusy}
            note={settleNote}
            onSettle={(force) => void settleChapter(lastWritten.chapterNumber, force)}
          />
          {proposalsSection}
          {lastWritten.hasAiDraft && (lastWritten.authorRatio ?? 0) > 0 ? (
            <section className="rounded-md border border-border bg-card/40 px-2 py-1.5" data-testid="chapter-loop-revisions">
              <p className="text-2xs font-medium text-foreground">把改得好的段落存为范文</p>
              <p className="mt-0.5 text-2xs text-muted-foreground">勾选你改过的段落，采纳后写下一章时优先作为示例。</p>
              <ChapterRevisions
                bookId={bookId}
                chapterNumber={lastWritten.chapterNumber}
                onAdopted={() => invalidateApiPaths([vaultPath(bookId)])}
              />
            </section>
          ) : null}
          <button
            type="button"
            onClick={() => setPickedStep("write")}
            className="rounded border border-border px-2 py-1.5 text-2xs hover:bg-accent"
            data-testid="chapter-loop-next"
          >
            {lastWritten.chapterNumber < model.chapterNumber ? `开始写第 ${model.chapterNumber} 章` : "回到写作"}
          </button>
        </>
      ) : null}

      {activeStep === "write" ? (
      <>
      {/*
        起书引导卡：新书缺本章焦点与大纲时，用它替换红色报错。
        文案属于引导而非诊断，由 write-view-state 按状态（十一问是否答过）给出；
        真有其它阻断时 onboarding 为空，下面照常显示报错就绪条。
      */}
      {model.onboarding && (
        <section className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2" data-testid="write-onboarding">
          <div className="flex items-start gap-2">
            <Compass className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground" data-testid="write-onboarding-title">{model.onboarding.title}</p>
              <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{model.onboarding.description}</p>
              <button
                type="button"
                onClick={handleOnboardingAction}
                className="mt-1.5 rounded bg-primary px-2 py-1 text-2xs text-primary-foreground hover:bg-primary/90"
                data-testid="write-onboarding-action"
              >
                {model.onboarding.actionLabel}
              </button>
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
      )}

      {/* 就绪条 */}
      {!model.onboarding && (
      <section className={`rounded-md border px-3 py-2 ${light.bar}`} data-testid="write-ready-bar">
        <div className="flex items-start gap-2">
          <LightIcon className={`mt-0.5 size-4 shrink-0 ${light.text}`} />
          <div className="min-w-0 flex-1">
            <p className={`text-xs font-medium ${light.text}`} data-testid="write-headline">{model.headline}</p>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-muted-foreground">
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
      )}

      {error && (
        <p className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-2xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* 卷驾驶舱：当前卷目标与本章在本卷的位置，就绪红绿灯下方集中呈现。 */}
      <VolumeCockpit
        volume={volumeModel}
        chapterNumber={model.chapterNumber}
        error={volumeError}
        onCreateVolume={() => void handleFix("set-volume")}
        creating={fixBusy === "set-volume"}
      />

      <div ref={compassRef}>
        <CreativeCompassPanel
          bookId={bookId}
          onFillDirective={(goal) => setDirectiveDraft(goal)}
        />
      </div>

      {/* 检查项清单 */}
      {model.checks.length > 0 && (
        <ul className="flex flex-col gap-1 overflow-y-auto" data-testid="write-checks">
          {model.checks.map((check, index) => {
            const icon = CHECK_ICON[check.state];
            // 同一 code 可能出现多条（如多条设定/现状不一致），键与展开状态都带序号。
            const checkKey = `${check.code}:${index}`;
            const open = expanded === checkKey;
            const hasDetail = Boolean(check.explanation || check.message);
            return (
              <li key={checkKey} className="rounded border border-border/60 bg-card/40">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <span className={`w-3 text-center text-xs font-bold ${icon.cls}`}>{icon.glyph}</span>
                  <span className="flex-1 truncate text-2xs text-foreground">{check.label}</span>
                  {check.fixAction && (
                    <button
                      type="button"
                      onClick={() => void handleFix(check.fixAction!)}
                      disabled={fixBusy !== null}
                      className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-2xs text-primary hover:bg-primary/20 disabled:opacity-50"
                      data-testid={`write-fix-${check.code}`}
                    >
                      {fixBusy === check.fixAction ? "处理中" : "一键修"}
                    </button>
                  )}
                  {hasDetail && (
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : checkKey)}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                      aria-label="展开说明"
                    >
                      <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
                    </button>
                  )}
                </div>
                {open && (
                  <div className="border-t border-border/60 px-2 py-1.5 text-2xs leading-relaxed text-muted-foreground">
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

      {fixNote && <p className="text-2xs text-muted-foreground">{fixNote}</p>}

      {/*
        本章提议：写作 → 叙事记忆 的回路终点。有写完的章时放在「收尾」一步；
        还没有写完的章（提议来自更早的章）时留在这里，作者照样能就地确认。
      */}
      {!proposalsInClose ? proposalsSection : null}

      {/*
        完整套路市场不挂在这里。
        曾经嵌进本面板：面板一崩会带垮三栏 IDE 写作主路径（打开书即炸）。
        市场入口只在：侧栏「套路」→「写作配置」→「套路 skills」。
      */}

      {/* 一句话指示 */}
      <div className="mt-auto flex flex-col gap-2">
        {/*
          情节点预算：作者可选地亲手排本章节奏。
          编辑结果随写章请求交给叙述者，由它作为 scene.spec 的 beatBudget 传入；
          本面板只做本地校验预览，不自行调用工具。
        */}
        <section className="rounded border border-border bg-card/40" data-testid="write-beat-budget">
          <button
            type="button"
            onClick={() => setBeatOpen((open) => !open)}
            className="flex w-full items-center justify-between px-2 py-1 text-2xs font-medium text-foreground"
            data-testid="write-beat-budget-toggle"
          >
            <span>
              本章情节点预算（可选）
              {beatBudget.length > 0 ? ` · ${beatBudget.length} 点` : ""}
            </span>
            <ChevronDown className={`size-3 shrink-0 text-muted-foreground transition-transform ${beatOpen ? "rotate-180" : ""}`} />
          </button>
          {beatOpen && (
            <div className="border-t border-border/60 px-2 py-1.5">
              <BeatBudgetEditor
                chapterTarget={effectiveWordTarget}
                value={beatBudget}
                onChange={setBeatBudget}
              />
            </div>
          )}
        </section>

        <div className="flex items-baseline justify-between gap-2">
          <label className="text-2xs font-medium text-foreground" htmlFor="write-directive">
            第 {model.chapterNumber || "?"} 章要发生什么
          </label>
          {effectiveWordTarget > 0 ? (
            <span className="text-2xs tabular-nums text-muted-foreground" data-testid="write-word-target">
              目标 {effectiveWordTarget.toLocaleString()} 字
            </span>
          ) : null}
        </div>
        <textarea
          id="write-directive"
          value={directiveDraft}
          onChange={(event) => setDirectiveDraft(event.target.value)}
          placeholder={model.resolvedDirective ?? "一句话说明本章目标，例如：让林舟通过守门人试炼，并暴露旧伤。"}
          rows={3}
          className="resize-none rounded border border-border bg-background px-2 py-1.5 text-2xs outline-none focus:border-primary"
          data-testid="write-directive-input"
        />
        {model.needsUserConfirm && !directiveDraft.trim() && (
          <label className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            <input
              type="checkbox"
              checked={acceptFocusDefault}
              onChange={(event) => setAcceptFocusDefault(event.target.checked)}
              data-testid="write-accept-focus"
            />
            采用当前焦点的默认目标
          </label>
        )}
        {!gate.ok && !model.alreadyWritten && <p className="text-2xs text-amber-600 dark:text-amber-400">{gate.reason}</p>}
        {model.alreadyWritten ? (
          <button
            type="button"
            onClick={() => start("chapter")}
            disabled={!onJumpToChapter || model.chapterNumber <= 0}
            className="rounded bg-primary px-2 py-1.5 text-2xs text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            data-testid="write-open-chapter"
          >
            打开第 {model.chapterNumber} 章正文
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => start("blueprint")}
              disabled={!gate.ok}
              className="flex-1 rounded border border-border px-2 py-1.5 text-2xs hover:bg-accent disabled:opacity-40"
              data-testid="write-blueprint"
            >
              生成蓝图
            </button>
            <button
              type="button"
              onClick={() => start("chapter")}
              disabled={!gate.ok}
              className="flex-1 rounded bg-primary px-2 py-1.5 text-2xs text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
              data-testid="write-chapter"
            >
              写第 {model.chapterNumber || "?"} 章
            </button>
          </div>
        )}
      </div>
      </>
      ) : null}

      {/*
        工作流：按作者装配的工序图写这一章（原故事画布「执行」页）。写、改、收尾三步都可见：
        工序停下等作者确认时，作者可能正在任何一步。
      */}
      {onOpenWorkflow ? (
        <button
          type="button"
          onClick={onOpenWorkflow}
          title="按工作流方案把这一章拆成几道工序，叙述者逐道做；需要你确认的工序会停下等你。在中央打开。"
          className="flex w-full items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-2 py-1.5 text-left text-2xs text-foreground transition-colors hover:bg-primary/10"
          data-testid="write-open-workflow"
        >
          <Workflow className="size-3.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate">工作流：按工序写这一章</span>
          <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
        </button>
      ) : null}
    </div>
  );
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** 步骤条：写 → 改 → 收尾。没有写完的章时，改与收尾不可点。 */
function ChapterLoopBar({ steps, active, onSelect }: {
  readonly steps: ReturnType<typeof resolveChapterLoop>["steps"];
  readonly active: ChapterLoopStep;
  readonly onSelect: (step: ChapterLoopStep) => void;
}) {
  return (
    <div role="tablist" aria-label="本章进度" className="flex items-stretch gap-1 rounded-md border border-border bg-muted/30 p-0.5" data-testid="chapter-loop-bar">
      {steps.map((item, index) => {
        const selected = item.id === active;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={!item.available}
            onClick={() => onSelect(item.id)}
            className={`relative flex flex-1 flex-col items-center rounded px-1 py-1 text-2xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              selected ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid={`chapter-loop-step-${item.id}`}
          >
            <span>{index + 1} · {item.label}</span>
            {item.available && item.chapterNumber > 0 ? <span className="text-2xs text-muted-foreground">第 {item.chapterNumber} 章</span> : null}
            {item.attention ? (
              <span className="absolute right-1 top-1 size-1.5 rounded-full bg-amber-500" aria-label="有待处理" data-testid={`chapter-loop-attention-${item.id}`} />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** 改：打开刚写完的章，说明作者改动占比与可用的改稿操作。 */
function ReviseStep({ chapter, onOpenChapter }: {
  readonly chapter: LastWrittenChapter;
  readonly onOpenChapter?: (chapterNumber: number) => void;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-card/40 px-3 py-2" data-testid="chapter-loop-revise">
      <p className="text-xs font-medium text-foreground">
        改第 {chapter.chapterNumber} 章{chapter.title ? ` · ${chapter.title}` : ""}
      </p>
      <p className="text-2xs leading-relaxed text-muted-foreground" data-testid="chapter-loop-author-ratio">
        {chapter.hasAiDraft
          ? `这一章是 AI 写的，你目前改动了 ${percent(chapter.authorRatio ?? 0)}。这个比例只反映你改了多少，不代表任何检测工具的判断。`
          : "这一章没有 AI 原稿记录（可能是你自己写的，或写于保留原稿之前）。"}
      </p>
      <ul className="list-disc space-y-0.5 pl-4 text-2xs leading-relaxed text-muted-foreground">
        <li>选中一段文字，可以续写、润色、改写、扩写、精简或人味化。</li>
        <li>正文里带虚线的人名，按住 Ctrl（Mac 上是 ⌘）点击可以看资料卡。</li>
        <li>改完保存后到「收尾」结算本章，记忆和人物关系才会更新。</li>
      </ul>
      <button
        type="button"
        onClick={() => onOpenChapter?.(chapter.chapterNumber)}
        disabled={!onOpenChapter}
        className="rounded bg-primary px-2 py-1.5 text-2xs text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
        data-testid="chapter-loop-open-chapter"
      >
        打开第 {chapter.chapterNumber} 章正文
      </button>
    </section>
  );
}

/**
 * 把自审命中交给叙述者做整章人文化：逐条生成定点候选（≤10% 改动），
 * 不带编辑器坐标，候选回到正文按原文定位由作者逐条确认。
 */
export function buildHumanizeMessage(
  chapterNumber: number,
  issues: readonly ParagraphSelfReviewIssue[],
  customConstraints?: readonly string[],
): string {
  const lines = [
    `第 ${chapterNumber} 章的表达检查发现了 ${issues.length} 处规则命中的写法问题。请逐条生成「人文化」候选，用 chapter.propose_selection 提交（每条问题一条候选）。`,
    "",
    "要求：",
    "- 只改被命中的句子，改动不超过原句的 10%；情节、对白、设定一律不动。",
    "- from/to 是编辑器坐标你拿不到：不要编造坐标，直接省略 from/to，编辑器会按候选原文在正文里定位。sourceText 必须是正文里的原文，candidateText 是改写后的句子。",
    "- requestId 自行生成，每条候选一个稳定编号。",
  ];
  // 作者硬约束先于人文化手法说明；没有约束时输出与此前逐字一致。
  lines.push(...composeCustomConstraintsSection(customConstraints));
  lines.push(
    "- 可选的人文化手法（按需选择，不必全用）：矛盾的情绪、小身体细节、无关的随机念头、不完美的对话、环境作用于身体、注意到无关事物、刻意的节奏断裂。",
    "- 不要改正文；作者会在编辑器里逐条确认。",
    "",
    "问题清单：",
  );
  issues.slice(0, 20).forEach((issue, index) => {
    lines.push(`${index + 1}. 第 ${issue.paragraph} 段「${issue.evidence}」：${issue.reason}${issue.suggestion ? `。参考方向：${issue.suggestion}` : ""}`);
  });
  if (issues.length > 20) lines.push(`（另有 ${issues.length - 20} 条未列出，先处理上面这些。）`);
  return lines.join("\n");
}

/**
 * 表达自审（改这一步）：客户端复用去套话规则引擎只读定位命中，
 * 不改写正文、不出结论；「定位」打开章节后把原句送进编辑器搜索。
 */
function SelfReviewSection({ bookId, chapterNumber, onJumpToChapter, onSendToNarrator }: {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly onJumpToChapter?: (chapterNumber: number) => void;
  readonly onSendToNarrator?: (message: string) => Promise<void> | void;
}) {
  const [report, setReport] = useState<ParagraphSelfReviewResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [handoffNote, setHandoffNote] = useState<string | null>(null);
  const [handoffBusy, setHandoffBusy] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchJson<{ content?: string }>(
        `/api/books/${encodeURIComponent(bookId)}/chapters/${chapterNumber}`,
      );
      setReport(reviewChapterParagraphs(data?.content ?? ""));
    } catch (err) {
      setReport(null);
      setLoadError(err instanceof Error && err.message ? err.message : "读取章节正文失败");
    } finally {
      setLoading(false);
    }
  }, [bookId, chapterNumber]);

  useEffect(() => {
    void run();
  }, [run]);

  const locate = (quote: string) => {
    onJumpToChapter?.(chapterNumber);
    // 章节 tab 可能刚打开，给编辑器挂载与正文加载留出时间；定位失败时搜索栏已带原句。
    window.setTimeout(() => dispatchLocateInEditor(quote), 300);
  };

  const handoffToNarrator = useCallback(async () => {
    if (!report || report.issues.length === 0) return;
    if (!onSendToNarrator) {
      setHandoffNote("当前视图没有可用的叙述者，无法执行人文化。");
      return;
    }
    setHandoffBusy(true);
    setHandoffNote(null);
    // 作者硬约束随指令注入；读取失败按未注入继续，但在交接说明里讲清楚。
    let customConstraints: readonly string[] = [];
    let constraintsMissed = false;
    try {
      customConstraints = await fetchCustomConstraints(bookId);
    } catch {
      constraintsMissed = true;
    }
    try {
      await onSendToNarrator(buildHumanizeMessage(chapterNumber, report.issues, customConstraints));
      setHandoffNote(`已把 ${report.issues.length} 处表达问题交给叙述者${constraintsMissed ? "；读取文风预设的硬约束失败，本次未注入" : ""}；候选逐条产回正文后，在章节编辑器里对照确认。`);
    } catch (err) {
      setHandoffNote(err instanceof Error && err.message ? err.message : "交给叙述者失败");
    } finally {
      setHandoffBusy(false);
    }
  }, [bookId, chapterNumber, onSendToNarrator, report]);

  return (
    <section className="rounded-md border border-border bg-card/40 px-3 py-2" data-testid="chapter-loop-self-review">
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-medium text-foreground">表达自审（只检查，不改正文）</span>
        <div className="flex items-center gap-2">
          {report && report.issues.length > 0 ? (
            <button
              type="button"
              className="rounded bg-primary px-2 py-0.5 text-2xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              onClick={() => void handoffToNarrator()}
              disabled={handoffBusy || loading}
              data-testid="self-review-humanize"
            >
              {handoffBusy ? "交接中…" : "交叙述者人文化"}
            </button>
          ) : null}
          <button
            type="button"
            className="text-2xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            onClick={() => void run()}
            disabled={loading}
            data-testid="self-review-rerun"
          >
            {loading ? "检查中…" : "重新检查"}
          </button>
        </div>
      </div>
      {loadError ? (
        <p className="mt-1 text-2xs text-destructive" data-testid="self-review-error">{loadError}</p>
      ) : null}
      {handoffNote ? (
        <p className="mt-1 text-2xs text-muted-foreground" data-testid="self-review-handoff-note">{handoffNote}</p>
      ) : null}
      {report ? (
        <>
          <p className="mt-1 text-2xs text-muted-foreground" data-testid="self-review-message">{report.message}</p>
          {report.issues.length > 0 ? (
            <ul className="mt-1.5 flex flex-col gap-1">
              {report.issues.slice(0, 8).map((issue, index) => (
                <li key={`${issue.ruleId}-${issue.start}-${index}`} className="rounded border border-border/60 bg-background/60 px-1.5 py-1 text-2xs" data-testid="self-review-item">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-muted-foreground">第 {issue.paragraph} 段</span>
                    <button
                      type="button"
                      className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-primary hover:bg-primary/20"
                      onClick={() => locate(issue.evidence)}
                      data-testid="self-review-locate"
                    >
                      定位
                    </button>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-foreground">「{issue.evidence}」</p>
                  <p className="mt-0.5 text-muted-foreground">{issue.reason}</p>
                  {issue.suggestion ? (
                    <p className="mt-0.5 text-muted-foreground">建议：{issue.suggestion}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {report.issues.length > 8 ? (
            <p className="mt-1 text-2xs text-muted-foreground">
              另有 {report.issues.length - 8} 条命中未列出；打开章节逐段「人味化」处理。
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** 收尾：结算本章（经 Runtime 默认模型），结算提出的变化在下方逐条确认。 */
function CloseStep({ chapter, busy, note, onSettle }: {
  readonly chapter: LastWrittenChapter;
  readonly busy: boolean;
  readonly note: { readonly tone: "ok" | "error"; readonly text: string } | null;
  readonly onSettle: (force: boolean) => void;
}) {
  const settled = chapter.settlement === "fresh";
  return (
    <section className="flex flex-col gap-1.5 rounded-md border border-border bg-card/40 px-3 py-2" data-testid="chapter-loop-close">
      <p className="text-xs font-medium text-foreground">
        收尾第 {chapter.chapterNumber} 章{chapter.title ? ` · ${chapter.title}` : ""}
      </p>
      <p className="text-2xs text-muted-foreground" data-testid="chapter-loop-settlement">
        记忆：{settlementLabel(chapter.settlement)}
      </p>
      <p className="text-2xs leading-relaxed text-muted-foreground">
        结算会让模型读一遍本章，提出人物状态、关系、伏笔和新设定的变化；你确认后才写进记忆，下一章写作会用到。
      </p>
      {!settled ? (
        <button
          type="button"
          onClick={() => onSettle(false)}
          disabled={busy}
          className="self-start rounded bg-primary px-2 py-1 text-2xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          data-testid="chapter-loop-settle"
        >
          {busy ? "结算中…" : chapter.settlement === "stale" ? `重新结算第 ${chapter.chapterNumber} 章` : `结算第 ${chapter.chapterNumber} 章`}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onSettle(true)}
          disabled={busy}
          title="正文没改也让模型重新读一遍本章。上次结算漏记了才需要。"
          className="self-start text-2xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
          data-testid="chapter-loop-force-settle"
        >
          {busy ? "结算中…" : "强制重新结算（上次漏记时用）"}
        </button>
      )}
      {note ? (
        <p
          className={`rounded px-1.5 py-1 text-2xs ${note.tone === "ok" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"}`}
          data-testid="chapter-loop-settle-note"
        >
          {note.text}
        </p>
      ) : null}
    </section>
  );
}

/** 章后结算提出的事实与事件，逐条确认或驳回；审批走与叙事记忆面板同一条通道。 */
function ProposalsSection({ groups, error, busyId, earlierOpen, onToggleEarlier, onDecide }: {
  readonly groups: ReturnType<typeof groupProposalsByChapter>;
  readonly error: string | null;
  readonly busyId: string | null;
  readonly earlierOpen: boolean;
  readonly onToggleEarlier: () => void;
  readonly onDecide: (event: PendingEvent, action: "approve" | "reject") => void;
}) {
  return (
    <section className="rounded-md border border-border bg-card/40 px-2 py-1.5" data-testid="write-proposals">
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-medium text-foreground">
          本章提议 {groups.current.length > 0 ? `(${groups.current.length})` : ""}
        </span>
        {groups.highRiskCount > 0 && (
          <span className="text-2xs text-amber-600 dark:text-amber-400">
            高风险 {groups.highRiskCount}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-2xs text-muted-foreground">
        章后结算从正文提出的事实与事件。确认后写入动态事实；不处理也不阻断写作。
      </p>

      {error && (
        <p className="mt-1 rounded border border-red-500/40 bg-red-500/10 px-1.5 py-1 text-2xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <ul className="mt-1.5 flex flex-col gap-1">
        {groups.current.map((event, index) => (
          <ProposalRow
            key={event.id ?? `current-${index}`}
            event={event}
            busy={busyId === event.id}
            disabled={busyId !== null}
            onApprove={() => onDecide(event, "approve")}
            onReject={() => onDecide(event, "reject")}
          />
        ))}
      </ul>

      {groups.earlier.length > 0 && (
        <>
          <button
            type="button"
            onClick={onToggleEarlier}
            className="mt-1.5 text-2xs text-muted-foreground hover:text-foreground"
            data-testid="write-proposals-earlier-toggle"
          >
            {earlierOpen ? "收起" : `另有 ${groups.earlier.length} 条前面章节遗留`}
          </button>
          {earlierOpen && (
            <ul className="mt-1 flex flex-col gap-1">
              {groups.earlier.map((event, index) => (
                <ProposalRow
                  key={event.id ?? `earlier-${index}`}
                  event={event}
                  busy={busyId === event.id}
                  disabled={busyId !== null}
                  onApprove={() => onDecide(event, "approve")}
                  onReject={() => onDecide(event, "reject")}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/**
 * 卷驾驶舱：写作视图侧栏的当前卷视图。
 *
 * 卷此前只有三个派生标签露脸（就绪条的「卷纲：」、画布卷进度条、经纬 outline
 * 条目），没有集中的卷视图。这里一屏回答：当前是第几卷、章号区间、本章在本卷
 * 的位置、剩余章数、本卷剧情目标与卷状态。
 *
 * 数据只来自 outline.volume(action=get)。没有卷纲时给建卷引导而非空白区块；
 * 章号落在本卷区间外时用醒目样式提示脱节（这是对数据的事实呈现，与后端
 * renderCurrentVolumeFocus 的口径一致，不按 code 自造告警文案）。
 */
function VolumeCockpit({ volume, chapterNumber, error, onCreateVolume, creating }: {
  readonly volume: VolumeCockpitModel;
  readonly chapterNumber: number;
  readonly error: string | null;
  readonly onCreateVolume: () => void;
  readonly creating: boolean;
}) {
  // 尚无卷纲：给建卷引导，不显示空白区块。
  if (volume.state === "empty") {
    return (
      <section className="rounded-md border border-dashed border-border bg-card/40 px-2.5 py-2" data-testid="write-volume-cockpit">
        <div className="flex items-center gap-1.5 text-2xs font-medium text-foreground">
          <BookOpen className="size-3.5 text-muted-foreground" />
          当前卷
        </div>
        <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
          {error ?? "还没有卷纲。设定卷目标后，长篇每章都能对齐本卷主线，不易写散。"}
        </p>
        <button
          type="button"
          onClick={onCreateVolume}
          disabled={creating}
          className="mt-1.5 rounded bg-primary/10 px-2 py-0.5 text-2xs text-primary hover:bg-primary/20 disabled:opacity-50"
          data-testid="write-volume-create"
        >
          {creating ? "处理中" : "生成卷纲草案"}
        </button>
      </section>
    );
  }

  const current = volume.current!;
  const rangeText = typeof current.from === "number" && typeof current.to === "number"
    ? `第 ${current.from}–${current.to} 章`
    : "章号区间未填写";
  const derailed = volume.inRange === false;

  return (
    <section
      className={`rounded-md border px-2.5 py-2 ${derailed ? "border-amber-500/50 bg-amber-500/10" : "border-border bg-card/40"}`}
      data-testid="write-volume-cockpit"
    >
      <div className="flex items-center gap-1.5">
        <BookOpen className={`size-3.5 shrink-0 ${derailed ? "text-amber-600 dark:text-amber-400" : "text-primary"}`} />
        <span className="min-w-0 flex-1 truncate text-2xs font-medium text-foreground">
          {volume.index > 0 ? `第 ${volume.index} 卷 · ` : ""}{current.title}
        </span>
        <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-2xs text-muted-foreground">{volume.statusLabel}</span>
      </div>

      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-muted-foreground">
        <span>{rangeText}</span>
        {volume.offset !== null && volume.total > 0 && (
          <span data-testid="write-volume-position">本章第 {volume.offset}/{volume.total} 章</span>
        )}
        {volume.remaining !== null && (
          <span>剩余 {volume.remaining} 章</span>
        )}
      </div>

      {derailed && (
        <p className="mt-1 text-2xs leading-relaxed text-amber-600 dark:text-amber-400" data-testid="write-volume-derailed">
          第 {chapterNumber} 章不在本卷区间（{rangeText}），卷纲与实际进度已脱节。
        </p>
      )}

      <p className="mt-1 text-2xs leading-relaxed text-foreground/90">
        {current.goal
          ? `本卷目标：${current.goal}`
          : "本卷目标：未填写（卷纲缺目标，无法据此约束本章走向）"}
      </p>
    </section>
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
        <span className="min-w-0 flex-1 text-2xs text-foreground">
          {event.entity ?? "未命名实体"}
          {event.eventType ? <span className="text-muted-foreground"> · {event.eventType}</span> : null}
        </span>
        <span className={`shrink-0 text-2xs ${event.risk === "high" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
          {riskLabel(event.risk)}
        </span>
      </div>
      <div className="mt-0.5 text-2xs text-muted-foreground">
        第 {event.chapterNumber ?? "—"} 章
        {typeof event.confidence === "number" ? ` · 置信度 ${event.confidence}` : ""}
      </div>
      {event.evidence && (
        <p className="mt-0.5 line-clamp-2 text-2xs leading-relaxed text-muted-foreground">{event.evidence}</p>
      )}
      {event.id && (
        <div className="mt-1 flex justify-end gap-1">
          <button
            type="button"
            onClick={onReject}
            disabled={disabled}
            className="rounded border border-border px-1.5 py-0.5 text-2xs hover:bg-accent disabled:opacity-40"
            data-testid="write-proposal-reject"
          >
            {busy ? "处理中" : "驳回"}
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={disabled}
            className="rounded bg-primary px-1.5 py-0.5 text-2xs text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            data-testid="write-proposal-approve"
          >
            {busy ? "处理中" : "确认"}
          </button>
        </div>
      )}
    </li>
  );
}
