/**
 * 中间全宽「AI 写章筹备台」（ChapterPrepWorkspace）
 *
 * 定位：只服务于「待写/准备写的章节」，不侵入已写章节的正文信纸模式。
 * 左右宽屏双栏布局：
 * - 左栏：本章在全书大纲中的位置（所属卷目标/进度、待写章节上下文、细纲摘要、近章到期伏笔）+ 写前预检（chapter.preflight）红绿灯与一键修；
 * - 右栏：血肉与弹药装配区 —— 「文风范文 & 机制卡」点菜勾选 + 情节点字数预算（BeatBudgetEditor）+ 写作目标指令 + 热梗二创转译派单 + 三大动作按钮（生成蓝图 / AI 写本章 / 铺开空白信纸手写）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Compass,
  FilePlus2,
  Flame,
  Layers,
  Loader2,
  PenLine,
  RefreshCw,
  Sparkles,
  Wand2,
  Workflow,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import type { BeatBudgetItem } from "../../handlers/beat-budget";
import type {
  PendingReviewItem,
  PendingReviewSummary,
} from "../../routes/pending-review-contract";
import { toWireToolName } from "../../engine/workflows/run-brief";
import { BeatBudgetEditor } from "./BeatBudgetEditor";
import { CreativeCompassPanel } from "./CreativeCompassPanel";
import { InlineWorkflowRunBar } from "./InlineWorkflowRunBar";
import { mutatePendingEvent } from "./narrative-pending-events";
import { PrepInjectionPreviewCard } from "./PrepInjectionPreviewCard";
import { useNarrativeStructure } from "./useNarrativeStructure";
import { buildWriteRequestMessage } from "./write-request";
import {
  buildWriteViewModel,
  planFixAction,
  type ReadyCheckItem,
  type WriteFixActionId,
} from "./write-view-state";

export interface PrepTargetChapter {
  readonly chapterNumber: number;
  readonly title?: string;
  readonly summary?: string;
}

export interface ChapterPrepWorkspaceProps {
  readonly bookId: string;
  readonly callTool?: (tool: string, input: Record<string, unknown>) => Promise<unknown>;
  readonly targetChapter?: PrepTargetChapter | null;
  readonly chapterWordTarget?: number;
  readonly narratorId?: string;
  readonly onSendToNarrator?: (message: string) => Promise<void> | void;
  readonly onCreateAndOpenChapter?: (chapterNumber?: number, title?: string) => void;
  readonly onJumpToChapter?: (chapterNumber: number) => void;
  readonly onOpenWorkflow?: () => void;
  readonly onOpenOutlineZone?: () => void;
  readonly onOpenSettingsZone?: () => void;
  readonly onOpenLoreZone?: () => void;
  readonly onOpenDissectZone?: () => void;
}

interface MechanismCardLite {
  readonly id: string;
  readonly name: string;
  readonly sourceTitle?: string;
  readonly readerDesire?: string;
  readonly emotionChain?: string;
  readonly status?: string;
  readonly needsTermSanitization?: boolean;
  readonly residualTerms?: readonly string[];
  readonly tags?: readonly string[];
}

interface StyleSampleLite {
  readonly id: string;
  readonly sourceTitle: string;
  readonly sceneType: string;
  readonly text: string;
}

const CHECK_ICON: Record<ReadyCheckItem["state"], { glyph: string; cls: string }> = {
  ok: { glyph: "✓", cls: "text-success" },
  warn: { glyph: "!", cls: "text-warning" },
  block: { glyph: "×", cls: "text-destructive" },
};

const SCENE_TYPE_LABELS: Record<string, string> = {
  dialogue: "对话",
  action: "动作",
  description: "描写",
  interiority: "心理",
  transition: "过渡",
  general: "通用",
};

export function ChapterPrepWorkspace({
  bookId,
  callTool,
  targetChapter,
  chapterWordTarget = 0,
  narratorId,
  onSendToNarrator,
  onCreateAndOpenChapter,
  onJumpToChapter,
  onOpenWorkflow,
  onOpenOutlineZone,
  onOpenSettingsZone,
  onOpenLoreZone,
  onOpenDissectZone,
}: ChapterPrepWorkspaceProps) {
  const { state: structureState, reload: reloadStructure } = useNarrativeStructure(bookId);
  const [preflightRaw, setPreflightRaw] = useState<unknown>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);

  const [directive, setDirective] = useState("");
  const [acceptFocusDefault, setAcceptFocusDefault] = useState(false);
  const [beatBudget, setBeatBudget] = useState<readonly BeatBudgetItem[]>([]);
  const [fleshNotes, setFleshNotes] = useState("");
  const [selectedMechanisms, setSelectedMechanisms] = useState<Set<string>>(() => new Set());
  const [selectedSamples, setSelectedSamples] = useState<Set<string>>(() => new Set());

  const [mechanisms, setMechanisms] = useState<readonly MechanismCardLite[]>([]);
  const [styleSamples, setStyleSamples] = useState<readonly StyleSampleLite[]>([]);
  const [primaryStyleTitle, setPrimaryStyleTitle] = useState<string | null>(null);
  const [pendingSummary, setPendingSummary] = useState<PendingReviewSummary | null>(null);
  const [pendingExpanded, setPendingExpanded] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [confirmingCardId, setConfirmingCardId] = useState<string | null>(null);
  const [fixBusy, setFixBusy] = useState<WriteFixActionId | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // 当切到新的待写大纲章节时，把细纲摘要预填进指令框（如果作者还没写过其它内容）
  useEffect(() => {
    if (targetChapter?.summary && !directive.trim()) {
      setDirective(targetChapter.summary);
    }
  }, [targetChapter?.chapterNumber, targetChapter?.summary]); // eslint-disable-line react-hooks/exhaustive-deps

  const pinnedSampleArray = useMemo(() => [...selectedSamples], [selectedSamples]);
  const preflightSeqRef = useRef(0);
  const preflightHydratedRef = useRef(false);

  const runPreflight = useCallback(async () => {
    const seq = ++preflightSeqRef.current;
    setPreflightLoading(true);
    setPreflightError(null);
    try {
      const payload: Record<string, unknown> = {
        ...(targetChapter?.chapterNumber ? { chapterNumber: targetChapter.chapterNumber } : {}),
        userDirectives: directive,
        acceptFocusDefault,
        ...(pinnedSampleArray.length > 0 ? { pinnedSampleIds: pinnedSampleArray } : {}),
        includeRecallPreview: true,
      };
      // 优先走只读 HTTP 预检入口（支持 pinnedSampleIds 与 recallSummary 注入透视，且不污染会话召回记录）；
      // HTTP 不可达（如纯单测注入 callTool 环境）时平滑回退 callTool。
      let resolved: unknown = null;
      try {
        resolved = await fetchJson<unknown>(
          `/api/books/${encodeURIComponent(bookId)}/write/preflight`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
      } catch (httpErr) {
        if (callTool) {
          resolved = await callTool("chapter.preflight", payload);
        } else {
          throw httpErr;
        }
      }
      if (seq === preflightSeqRef.current) {
        setPreflightRaw(resolved);
      }
    } catch (err) {
      if (seq === preflightSeqRef.current) {
        setPreflightError(err instanceof Error ? err.message : "预检失败");
      }
    } finally {
      if (seq === preflightSeqRef.current) {
        setPreflightLoading(false);
      }
    }
  }, [acceptFocusDefault, bookId, callTool, directive, pinnedSampleArray, targetChapter?.chapterNumber]);

  const loadSupplies = useCallback(async () => {
    try {
      const [cardsPayload, presetPayload, pendingPayload] = await Promise.all([
        fetchJson<{ cards?: readonly MechanismCardLite[] }>(
          `/api/books/${encodeURIComponent(bookId)}/mechanism-cards`,
        ).catch(() => ({ cards: [] })),
        fetchJson<{
          preset?: {
            sources?: ReadonlyArray<{
              id: string;
              title: string;
              role?: string;
              samples?: ReadonlyArray<{
                id: string;
                sceneType: string;
                text: string;
                status?: string;
              }>;
            }>;
          };
        }>(`/api/books/${encodeURIComponent(bookId)}/style/preset`).catch(() => ({ preset: undefined })),
        fetchJson<PendingReviewSummary>(
          `/api/books/${encodeURIComponent(bookId)}/pending-review?limit=20`,
        ).catch(() => null),
      ]);

      setMechanisms(Array.isArray(cardsPayload?.cards) ? cardsPayload.cards.slice(0, 12) : []);
      setPendingSummary(pendingPayload);

      const sources = presetPayload?.preset?.sources ?? [];
      const primary = sources.find((s) => s.role === "primary_voice") ?? sources[0];
      setPrimaryStyleTitle(primary?.title ?? null);
      const collectedSamples: StyleSampleLite[] = [];
      for (const src of sources) {
        for (const smp of src.samples ?? []) {
          if (smp.status === "confirmed" || !smp.status) {
            collectedSamples.push({
              id: `${src.id}:${smp.id}`,
              sourceTitle: src.title,
              sceneType: smp.sceneType,
              text: smp.text,
            });
          }
        }
      }
      setStyleSamples(collectedSamples.slice(0, 10));
    } catch {
      // 读取供料失败不阻塞筹备主界面
    }
  }, [bookId]);

  // 供料列表只随 bookId 重拉，不随写作指令按键重复请求
  useEffect(() => {
    void loadSupplies();
  }, [loadSupplies]);

  // 首次挂载立即跑一次预检；后续指令/勾选变化防抖 400ms，避免每次按键触发请求风暴
  useEffect(() => {
    if (!preflightHydratedRef.current) {
      preflightHydratedRef.current = true;
      void runPreflight();
      return;
    }
    const timer = window.setTimeout(() => {
      void runPreflight();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [runPreflight]);

  const model = useMemo(() => buildWriteViewModel(preflightRaw), [preflightRaw]);
  const effectiveChapterNumber = targetChapter?.chapterNumber ?? (model.chapterNumber > 0 ? model.chapterNumber : 1);
  const effectiveWordTarget = chapterWordTarget > 0 ? chapterWordTarget : model.wordTarget;

  const outlinePosition = useMemo(() => {
    if (structureState.status !== "ready") return null;
    const data = structureState.data;
    const vol = data.volumes.find(
      (v) => effectiveChapterNumber >= v.chapterRange.from && effectiveChapterNumber <= v.chapterRange.to,
    ) ?? data.volumes[0] ?? null;
    const scenes = data.scenes.filter((s) => s.chapterNumber === effectiveChapterNumber);
    const prevChapter = data.chapters
      .filter((c) => c.number < effectiveChapterNumber)
      .sort((a, b) => b.number - a.number)[0];
    const urgentHooks = data.foreshadows
      .filter((f) => f.urgency === "overdue" || f.urgency === "watch")
      .slice(0, 4);
    const draftedCountInVol = vol
      ? data.chapters.filter((c) => c.number >= vol.chapterRange.from && c.number <= vol.chapterRange.to).length
      : data.chapters.length;
    const span = vol ? Math.max(1, vol.chapterRange.to - vol.chapterRange.from + 1) : 0;
    return { vol, scenes, prevChapter, urgentHooks, draftedCountInVol, span };
  }, [structureState, effectiveChapterNumber]);

  const toggleMechanism = (id: string) => {
    setSelectedMechanisms((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSample = (id: string) => {
    setSelectedSamples((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const parseInfoAnchors = (): string[] =>
    fleshNotes
      .split(/\r?\n|；|;/u)
      .map((line) => line.replace(/^\s*\d+[.)、]\s*/u, "").trim())
      .filter(Boolean);

  const composeEnrichedDirective = (): string => {
    const parts: string[] = [];
    const base = directive.trim() || targetChapter?.summary || model.resolvedDirective || "";
    if (base) parts.push(base);
    if (fleshNotes.trim()) {
      parts.push(`【信息增量与细节锚点】\n${fleshNotes.trim()}`);
    }
    const chosenCards = mechanisms.filter((m) => selectedMechanisms.has(m.id));
    if (chosenCards.length > 0) {
      parts.push(
        `【指定复用机制卡】\n${chosenCards
          .map((c) => `- ${c.name}：${c.emotionChain ?? c.readerDesire ?? ""}`)
          .join("\n")}`,
      );
    }
    const chosenSmps = styleSamples.filter((s) => selectedSamples.has(s.id));
    if (chosenSmps.length > 0) {
      parts.push(
        `【参考文风片段（只学写法节奏，不抄专名）】\n${chosenSmps
          .map((s) => `- [${s.sourceTitle}·${SCENE_TYPE_LABELS[s.sceneType] ?? s.sceneType}] ${s.text.slice(0, 140)}`)
          .join("\n")}`,
      );
    }
    return parts.join("\n\n");
  };

  const dispatchWrite = (mode: "blueprint" | "chapter") => {
    if (!onSendToNarrator) {
      setActionFeedback("当前尚未连接右侧叙述者会话，请先打开或新建叙述者对话。");
      return;
    }
    const enriched = composeEnrichedDirective();
    if (!enriched.trim() && !acceptFocusDefault) {
      setActionFeedback("请先填写一句话写作目标或勾选采用当前焦点默认目标。");
      return;
    }
    const pinnedMechanismIds = [...selectedMechanisms];
    const pinnedSampleIds = [...selectedSamples];
    const infoAnchors = parseInfoAnchors();
    const msg = buildWriteRequestMessage({
      mode,
      chapterNumber: effectiveChapterNumber,
      directive: enriched,
      acceptFocusDefault,
      ...(beatBudget.length > 0 ? { beatBudget } : {}),
      ...(pinnedMechanismIds.length > 0 ? { pinnedMechanismIds } : {}),
      ...(pinnedSampleIds.length > 0 ? { pinnedSampleIds } : {}),
      ...(infoAnchors.length > 0 ? { infoAnchors } : {}),
    });
    void onSendToNarrator(msg);
    setActionFeedback(
      mode === "blueprint"
        ? `已将第 ${effectiveChapterNumber} 章蓝图筹备单派发给右侧叙述者。`
        : `已将第 ${effectiveChapterNumber} 章写章筹备单派发给右侧叙述者，正文落盘后会自动加入左栏目录。`,
    );
  };

  const handleConfirmMechanismCard = async (cardId: string, cardName: string) => {
    setConfirmingCardId(cardId);
    try {
      const updated = await fetchJson<{
        ok?: boolean;
        card?: MechanismCardLite;
        warnings?: readonly string[];
      }>(
        `/api/books/${encodeURIComponent(bookId)}/mechanism-cards/${encodeURIComponent(cardId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "confirmed" }),
        },
      );
      if (updated?.card?.status === "confirmed") {
        setMechanisms((prev) =>
          prev.map((m) => (m.id === cardId ? { ...m, ...updated.card, status: "confirmed" } : m)),
        );
        setActionFeedback(`机制卡「${cardName}」已确认为可用状态。`);
      } else {
        const warnText = updated?.warnings?.[0] ?? "机制卡仍含原著专名残留，请先到拆书与文风库清洗专名。";
        setActionFeedback(warnText);
      }
    } catch (err) {
      setActionFeedback(err instanceof Error ? err.message : "机制卡确认失败");
    } finally {
      setConfirmingCardId(null);
    }
  };

  const handleInlinePendingApprove = async (item: PendingReviewItem) => {
    setApprovingId(item.id);
    try {
      if (item.target.kind === "storyline") {
        await fetchJson(
          `/api/books/${encodeURIComponent(bookId)}/narrative-memory/storylines/${encodeURIComponent(item.target.storylineId)}/review`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision: "confirmed" }),
          },
        );
        setActionFeedback(`已就地确认剧情线：${item.summary}`);
      } else if (item.kind === "event" || item.kind === "fact") {
        const rawEventId = item.id.replace(/^(?:event|fact):/u, "");
        await mutatePendingEvent(bookId, rawEventId, "approve", {
          reason: "AI写章筹备台一键就地确认待审事件",
        });
        setActionFeedback(`已就地批准章后事实：${item.summary}`);
      }
      await Promise.all([loadSupplies(), runPreflight()]);
      reloadStructure();
    } catch (err) {
      setActionFeedback(err instanceof Error ? err.message : "就地确认失败");
    } finally {
      setApprovingId(null);
    }
  };

  const handlePendingNavigate = (item: PendingReviewItem) => {
    if (item.target.kind === "style-panel" || item.target.kind === "vault") {
      onOpenDissectZone?.();
      return;
    }
    if (item.target.kind === "jingwei-entry" || item.target.kind === "ledger-conflict") {
      onOpenLoreZone?.();
      return;
    }
    if (item.target.kind === "events") {
      onOpenOutlineZone?.();
    }
  };

  const handleFixAction = async (action: WriteFixActionId) => {
    const plan = planFixAction(action, { chapterNumber: effectiveChapterNumber });
    if (plan.kind === "view") {
      onOpenDissectZone?.();
      return;
    }
    if (plan.kind === "settings") {
      onOpenSettingsZone?.();
      return;
    }
    if (plan.kind === "story-canvas") {
      onOpenOutlineZone?.();
      return;
    }
    if (plan.kind === "lore-panel") {
      onOpenLoreZone?.();
      return;
    }
    if (!plan.message || !onSendToNarrator) return;
    setFixBusy(action);
    try {
      await onSendToNarrator(plan.message);
      setActionFeedback(`已把「${plan.label}」交给右侧叙述者处理。`);
    } finally {
      setFixBusy(null);
    }
  };

  const handleMemeAdaptation = () => {
    if (!onSendToNarrator) {
      setActionFeedback("请先开启右侧叙述者会话。");
      return;
    }
    const chapterGoal = directive.trim() || targetChapter?.summary || `第 ${effectiveChapterNumber} 章推进`;
    void onSendToNarrator(
      [
        `请为第 ${effectiveChapterNumber} 章（目标：${chapterGoal}）提供「互联网热梗 / 热门桥段同步与本书世界观二次创作方案」：`,
        `1. 先调用 ${toWireToolName("market.radar")}（action=query 或 scan），或结合当前互联网热梗/职场与社会爽点结构；`,
        "2. 禁止生硬照抄现代烂梗，必须结合本书世界观和当前出场角色口吻做「二创转译」（给出：原梗逻辑 → 本书映射规则 → 2–3 条可直接放进本章的台词或细节包袱草案）；",
        "3. 输出给我挑选，我选定后再写进正文。",
      ].join("\n"),
    );
    setActionFeedback("已派单给叙述者检索热梗并生成贴合本书世界观的二创桥段草案。");
  };

  const lightBadge =
    model.light === "green"
      ? { icon: CheckCircle2, label: "就绪绿灯", cls: "text-success border-success/40 bg-success/10" }
      : model.light === "yellow"
        ? { icon: AlertTriangle, label: "可写（有提醒）", cls: "text-warning border-warning/40 bg-warning/10" }
        : model.light === "red"
          ? { icon: XCircle, label: "存在阻断项", cls: "text-destructive border-destructive/40 bg-destructive/10" }
          : { icon: Compass, label: "等待预检", cls: "text-muted-foreground border-border bg-muted/40" };
  const LightIcon = lightBadge.icon;

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background p-4 sm:p-5" data-testid="chapter-prep-workspace">
      <div className="mx-auto max-w-[1160px] space-y-4">
        {/* 顶部章头信息条 */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-2xs">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1 border-primary/40 bg-primary/8 text-primary">
                <Sparkles className="size-3" />
                AI 写章筹备 · 第 {effectiveChapterNumber} 章
              </Badge>
              <h2 className="nf-display truncate text-base font-bold text-foreground">
                {targetChapter?.title || `第 ${effectiveChapterNumber} 章（待写）`}
              </h2>
              <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium", lightBadge.cls)}>
                <LightIcon className="size-3" />
                {lightBadge.label}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {outlinePosition?.vol
                ? `所属卷：${outlinePosition.vol.title}（已写 ${outlinePosition.draftedCountInVol}/${outlinePosition.span} 章）`
                : "尚未绑定卷纲"}
              {effectiveWordTarget > 0 ? ` · 目标 ${effectiveWordTarget.toLocaleString()} 字` : ""}
              {primaryStyleTitle ? ` · 主文风：${primaryStyleTitle}` : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void runPreflight();
                void loadSupplies();
                reloadStructure();
              }}
              disabled={preflightLoading}
              className="gap-1 text-xs"
            >
              <RefreshCw className={cn("size-3.5", preflightLoading && "animate-spin")} />
              <span>刷新筹备态</span>
            </Button>
            {onOpenWorkflow ? (
              <Button type="button" size="sm" variant="outline" onClick={onOpenWorkflow} className="gap-1 text-xs">
                <Workflow className="size-3.5 text-primary" />
                <span>按工作流工序写</span>
              </Button>
            ) : null}
            {onCreateAndOpenChapter ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onCreateAndOpenChapter(effectiveChapterNumber, targetChapter?.title)}
                className="gap-1 text-xs border-primary/40 text-primary hover:bg-primary/10"
                data-testid="prep-open-blank-paper"
              >
                <FilePlus2 className="size-3.5" />
                <span>直接铺开信纸手写</span>
              </Button>
            ) : null}
          </div>
        </div>

        {/* 本章内嵌工作流进度与一键启动条（免切页查看流水线与原地审批） */}
        <InlineWorkflowRunBar
          bookId={bookId}
          chapterNumber={effectiveChapterNumber}
          {...(narratorId ? { narratorId } : {})}
          {...(onSendToNarrator ? { onSendToNarrator } : {})}
          {...(onOpenWorkflow ? { onOpenFullWorkflowStudio: onOpenWorkflow } : {})}
          onChapterCommitted={() => {
            reloadStructure();
            if (onJumpToChapter) onJumpToChapter(effectiveChapterNumber);
          }}
          showLauncherWhenIdle
        />

        {actionFeedback ? (
          <div className="rounded-md border border-primary/30 bg-primary/8 px-3 py-2 text-xs text-primary">
            {actionFeedback}
          </div>
        ) : null}

        {preflightError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            预检失败：{preflightError}
          </div>
        ) : null}

        {/* 待确认资产积压提醒条（未确认前不进入 AI 写章上下文） */}
        {pendingSummary && pendingSummary.total > 0 ? (
          <div
            className="rounded-lg border border-warning/40 bg-warning/8 px-3.5 py-2.5 space-y-2"
            data-testid="prep-pending-review-banner"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs">
                <ClipboardCheck className="size-4 shrink-0 text-warning" />
                <span className="font-medium text-foreground">
                  当前有 {pendingSummary.total} 项资产（
                  {pendingSummary.groups
                    .filter((g) => g.count > 0)
                    .map((g) => `${g.label} ${g.count}`)
                    .join(" / ") || "含声线/文风规则/剧情线"}
                  ）处于「待确认」状态，未确认前不会注入 AI 写章。
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => setPendingExpanded((prev) => !prev)}
                  className="h-6 gap-1 px-2 text-2xs"
                  data-testid="prep-pending-toggle-btn"
                >
                  {pendingExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  <span>{pendingExpanded ? "收起待审项" : "查看与就地放行"}</span>
                </Button>
                {onOpenLoreZone ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={onOpenLoreZone}
                    className="h-6 px-2 text-2xs"
                  >
                    去设定/声线
                  </Button>
                ) : null}
                {onOpenDissectZone ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={onOpenDissectZone}
                    className="h-6 px-2 text-2xs"
                  >
                    去文风规则
                  </Button>
                ) : null}
              </div>
            </div>

            {pendingExpanded ? (
              <ul className="max-h-44 space-y-1 overflow-y-auto border-t border-warning/25 pt-2">
                {pendingSummary.groups
                  .flatMap((g) => g.items)
                  .slice(0, 12)
                  .map((item) => {
                    const canInlineApprove =
                      item.target.kind === "storyline" || item.kind === "event" || item.kind === "fact";
                    const isBusy = approvingId === item.id;
                    return (
                      <li
                        key={item.id}
                        className="flex items-center justify-between gap-2 rounded border border-border/60 bg-card px-2.5 py-1.5 text-2xs"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="font-medium text-warning">[{item.typeLabel}]</span>{" "}
                          <span className="text-muted-foreground">{item.location} · </span>
                          <span className="text-foreground">{item.summary}</span>
                        </div>
                        {canInlineApprove ? (
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            disabled={approvingId !== null}
                            onClick={() => void handleInlinePendingApprove(item)}
                            className="h-5 shrink-0 gap-1 border-success/40 px-1.5 text-2xs text-success hover:bg-success/10"
                            data-testid={`prep-inline-approve-${item.id}`}
                          >
                            {isBusy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                            <span>一键确认</span>
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={() => handlePendingNavigate(item)}
                            className="h-5 shrink-0 px-1.5 text-2xs"
                          >
                            去确认 →
                          </Button>
                        )}
                      </li>
                    );
                  })}
              </ul>
            ) : null}
          </div>
        ) : null}

        {/* 主体宽屏双栏：左「大纲位置与预检」，右「血肉供料、节拍预算与派单」 */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* 左列（5 格）：大纲位置 + 写前预检 + 创作罗盘 */}
          <div className="space-y-4 lg:col-span-5">
            <section className="rounded-lg border border-border bg-card p-3.5 space-y-3" data-testid="prep-outline-position">
              <div className="flex items-center justify-between gap-2">
                <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Layers className="size-3.5 text-primary" />
                  在本书大纲中的位置
                </h3>
                {onOpenOutlineZone ? (
                  <button type="button" onClick={onOpenOutlineZone} className="text-2xs text-primary hover:underline">
                    去大纲画布 →
                  </button>
                ) : null}
              </div>

              {outlinePosition?.vol ? (
                <div className="rounded-md border border-border/70 bg-muted/25 p-2.5 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">{outlinePosition.vol.title}</span>
                    <span className="text-2xs text-muted-foreground">
                      第 {outlinePosition.vol.chapterRange.from}–{outlinePosition.vol.chapterRange.to} 章
                    </span>
                  </div>
                  {outlinePosition.vol.goal ? (
                    <p className="text-2xs leading-relaxed text-muted-foreground">卷目标：{outlinePosition.vol.goal}</p>
                  ) : null}
                </div>
              ) : (
                <p className="text-2xs text-muted-foreground">尚未规划卷纲，可先去「大纲」分区或让叙述者起第一卷。</p>
              )}

              {targetChapter?.summary ? (
                <div className="rounded-md border border-primary/25 bg-primary/5 p-2.5 text-2xs space-y-1">
                  <span className="font-semibold text-primary">本章细纲锚点</span>
                  <p className="leading-relaxed text-foreground">{targetChapter.summary}</p>
                </div>
              ) : null}

              {outlinePosition?.scenes && outlinePosition.scenes.length > 0 ? (
                <div className="space-y-1.5">
                  <span className="text-2xs font-medium text-muted-foreground">已挂载场景节拍 ({outlinePosition.scenes.length})</span>
                  <ul className="space-y-1">
                    {outlinePosition.scenes.map((sc, i) => (
                      <li key={sc.id} className="rounded border border-border/70 bg-background/60 px-2.5 py-1.5 text-2xs">
                        <span className="font-medium text-foreground">
                          {i + 1}. {sc.title}
                        </span>
                        {sc.summary ? <p className="mt-0.5 text-muted-foreground">{sc.summary}</p> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {outlinePosition?.prevChapter ? (
                <div className="flex items-center justify-between gap-2 rounded border border-border/60 bg-background/50 px-2.5 py-1.5 text-2xs">
                  <span className="truncate text-muted-foreground">
                    承接上一章：第{outlinePosition.prevChapter.number}章 {outlinePosition.prevChapter.title}
                  </span>
                  {onJumpToChapter ? (
                    <button
                      type="button"
                      onClick={() => onJumpToChapter(outlinePosition.prevChapter!.number)}
                      className="shrink-0 text-primary hover:underline"
                    >
                      翻看前章
                    </button>
                  ) : null}
                </div>
              ) : null}

              {outlinePosition?.urgentHooks && outlinePosition.urgentHooks.length > 0 ? (
                <div className="space-y-1">
                  <span className="text-2xs font-medium text-warning">到期/待收伏笔提醒</span>
                  <ul className="space-y-1">
                    {outlinePosition.urgentHooks.map((hook) => (
                      <li key={hook.entryId} className="flex items-center justify-between gap-2 rounded bg-warning/8 px-2 py-1 text-2xs text-warning">
                        <span className="truncate">{hook.title}</span>
                        <span className="shrink-0">第{hook.plantedChapter ?? "?"}章埋</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            {/* 写前预检清单 */}
            <section className="rounded-lg border border-border bg-card p-3.5 space-y-2.5" data-testid="prep-preflight-section">
              <div className="flex items-center justify-between gap-2">
                <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <BookOpen className="size-3.5 text-primary" />
                  写前预检（chapter.preflight）
                </h3>
                <span className="text-2xs text-muted-foreground">{model.headline}</span>
              </div>
              {model.checks.length > 0 ? (
                <ul className="space-y-1.5">
                  {model.checks.map((check, idx) => {
                    const icon = CHECK_ICON[check.state];
                    return (
                      <li key={`${check.code}-${idx}`} className="flex items-start gap-2 rounded border border-border/60 bg-background/60 px-2.5 py-1.5 text-2xs">
                        <span className={cn("mt-0.5 font-bold", icon.cls)}>{icon.glyph}</span>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-foreground">{check.label}</div>
                          {check.explanation?.suggestedAction || check.message ? (
                            <p className="mt-0.5 text-muted-foreground">
                              {check.explanation?.suggestedAction ?? check.message}
                            </p>
                          ) : null}
                        </div>
                        {check.fixAction ? (
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            disabled={fixBusy !== null}
                            onClick={() => void handleFixAction(check.fixAction!)}
                            className="h-5 shrink-0 px-1.5 text-2xs"
                          >
                            {fixBusy === check.fixAction ? "处理中" : "一键修"}
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-2xs text-muted-foreground">当前没有预检阻断或告警。</p>
              )}
            </section>

            {/* 本章 AI 注入透视卡片（Injection X-Ray） */}
            <PrepInjectionPreviewCard preflightRaw={preflightRaw} loading={preflightLoading} />

            {/* 创作罗盘（当前焦点） */}
            <CreativeCompassPanel bookId={bookId} onFillDirective={(goal) => setDirective(goal)} />
          </div>

          {/* 右列（7 格）：血肉供料 + 节拍预算 + 派单给叙述者 */}
          <div className="space-y-4 lg:col-span-7">
            {/* 1. 机制卡与文风范文点菜 */}
            <section className="rounded-lg border border-border bg-card p-3.5 space-y-3" data-testid="prep-supplies-section">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <Wand2 className="size-3.5 text-primary" />
                    血肉补全：机制卡 & 文风范文点菜
                  </h3>
                  <p className="text-2xs text-muted-foreground">
                    勾选后将作为本章定向写法与桥段骨架注入，避免细纲太薄导致 AI 注水凑字。
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={handleMemeAdaptation}
                    className="h-6 gap-1 px-2 text-2xs border-primary/40 text-primary hover:bg-primary/10"
                    data-testid="prep-meme-adapt-btn"
                  >
                    <Flame className="size-3" />
                    <span>同步热梗 & 二创转译</span>
                  </Button>
                  {onOpenDissectZone ? (
                    <button type="button" onClick={onOpenDissectZone} className="text-2xs text-muted-foreground hover:text-primary hover:underline">
                      去拆书/文风库
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1.5 rounded-md border border-border/70 bg-background/50 p-2.5">
                  <div className="flex items-center justify-between text-2xs font-medium text-foreground">
                    <span>可迁移机制卡 ({mechanisms.length})</span>
                    <span className="text-muted-foreground">已选 {selectedMechanisms.size}</span>
                  </div>
                  {mechanisms.length === 0 ? (
                    <p className="text-2xs text-muted-foreground">暂未提炼机制卡，可在「拆书与文风」提炼后在此点选。</p>
                  ) : (
                    <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                      {mechanisms.map((card) => {
                        const checked = selectedMechanisms.has(card.id);
                        const needsReview = card.status === "needs-review";
                        const confirming = confirmingCardId === card.id;
                        return (
                          <div
                            key={card.id}
                            className={cn(
                              "rounded border px-2 py-1.5 text-2xs transition-colors",
                              checked
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border/60 bg-card hover:border-border",
                            )}
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <button
                                type="button"
                                onClick={() => toggleMechanism(card.id)}
                                className="min-w-0 flex-1 text-left font-medium"
                              >
                                <span className="truncate">{card.name}</span>
                              </button>
                              <div className="flex shrink-0 items-center gap-1">
                                {needsReview ? (
                                  <>
                                    <Badge
                                      variant="outline"
                                      className="h-4 border-warning/40 bg-warning/10 px-1 text-2xs text-warning"
                                    >
                                      待确认
                                    </Badge>
                                    {!card.needsTermSanitization ? (
                                      <Button
                                        type="button"
                                        size="xs"
                                        variant="outline"
                                        disabled={confirmingCardId !== null}
                                        onClick={() => void handleConfirmMechanismCard(card.id, card.name)}
                                        className="h-4 border-success/40 px-1 text-2xs text-success hover:bg-success/10"
                                        data-testid={`prep-confirm-mech-${card.id}`}
                                      >
                                        {confirming ? "确认中" : "一键确认"}
                                      </Button>
                                    ) : null}
                                  </>
                                ) : null}
                                {checked ? <Badge className="h-4 px-1 text-2xs">已选</Badge> : null}
                              </div>
                            </div>
                            {card.emotionChain || card.readerDesire ? (
                              <button
                                type="button"
                                onClick={() => toggleMechanism(card.id)}
                                className="mt-0.5 block w-full text-left"
                              >
                                <p className="line-clamp-1 text-muted-foreground">
                                  {card.emotionChain ?? card.readerDesire}
                                </p>
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="space-y-1.5 rounded-md border border-border/70 bg-background/50 p-2.5">
                  <div className="flex items-center justify-between text-2xs font-medium text-foreground">
                    <span>已确认文风范文 ({styleSamples.length})</span>
                    <span className="text-muted-foreground">已选 {selectedSamples.size}</span>
                  </div>
                  {styleSamples.length === 0 ? (
                    <p className="text-2xs text-muted-foreground">暂无已确认范文，蒸馏采纳或文风金库采纳后将自动出现在此。</p>
                  ) : (
                    <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                      {styleSamples.map((smp) => {
                        const checked = selectedSamples.has(smp.id);
                        return (
                          <button
                            key={smp.id}
                            type="button"
                            onClick={() => toggleSample(smp.id)}
                            className={cn(
                              "w-full rounded border px-2 py-1.5 text-left text-2xs transition-colors",
                              checked
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border/60 bg-card hover:border-border",
                            )}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-medium text-foreground">
                                {smp.sourceTitle} · {SCENE_TYPE_LABELS[smp.sceneType] ?? smp.sceneType}
                              </span>
                              {checked ? <Badge className="h-4 px-1 text-2xs">已选</Badge> : null}
                            </div>
                            <p className="mt-0.5 line-clamp-2 text-muted-foreground">{smp.text}</p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* 2. 情节点字数预算 + 信息增量锚点 */}
            <section className="rounded-lg border border-border bg-card p-3.5 space-y-3" data-testid="prep-beats-section">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-foreground">情节点字数预算与信息增量</h3>
                {effectiveWordTarget > 0 ? (
                  <span className="text-2xs tabular-nums text-muted-foreground">目标 {effectiveWordTarget.toLocaleString()} 字</span>
                ) : null}
              </div>

              <BeatBudgetEditor
                chapterTarget={effectiveWordTarget}
                value={beatBudget}
                onChange={setBeatBudget}
              />

              <div className="space-y-1">
                <label htmlFor="prep-flesh-notes" className="text-2xs font-medium text-foreground">
                  本章信息增量 / 道具细节 / 对话包袱（防注水锚点）
                </label>
                <textarea
                  id="prep-flesh-notes"
                  rows={2}
                  value={fleshNotes}
                  onChange={(e) => setFleshNotes(e.target.value)}
                  placeholder="例：1）补灵田折旧率算法与管事贪墨账本细节；2）对话里留半句双关讽刺；3）章末抛出黑市丹炉异响。"
                  className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="prep-directive" className="text-2xs font-medium text-foreground">
                  第 {effectiveChapterNumber} 章写作目标与指令
                </label>
                <textarea
                  id="prep-directive"
                  rows={3}
                  value={directive}
                  onChange={(e) => setDirective(e.target.value)}
                  placeholder={model.resolvedDirective ?? "一句话说明本章目标，或由左侧细纲自动预填…"}
                  className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary"
                  data-testid="prep-directive-input"
                />
                {model.needsUserConfirm && !directive.trim() ? (
                  <label className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={acceptFocusDefault}
                      onChange={(e) => setAcceptFocusDefault(e.target.checked)}
                    />
                    采用当前焦点的默认目标
                  </label>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/70 pt-3">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => dispatchWrite("blueprint")}
                  className="gap-1 text-xs"
                  data-testid="prep-run-blueprint"
                >
                  <Compass className="size-3.5" />
                  <span>让叙述者先出场景蓝图</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => dispatchWrite("chapter")}
                  className="gap-1 text-xs"
                  data-testid="prep-run-chapter"
                >
                  <PenLine className="size-3.5" />
                  <span>交叙述者起草第 {effectiveChapterNumber} 章</span>
                </Button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
