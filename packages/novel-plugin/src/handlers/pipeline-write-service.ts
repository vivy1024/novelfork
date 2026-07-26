/**
 * Pipeline Write Service (v2) — 精简管线：SceneSpec → Writer → AuditRevise
 *
 * 与旧 executePipelineGenerate 的区别：
 * - 不再内部调用 Planner/Composer（由外部 scene.spec 工具完成）
 * - 接受结构化 SceneSpec 作为输入
 * - Auditor+Reviser 合并为一步
 * - 从 5 次 LLM 调用降到 2 次（Writer + AuditRevise）
 */

import type { LLMClient, Logger, ContextPackage, RuleStack } from "@vivy1024/novelfork-core";
import { StateManager, buildLengthSpec, countChapterLength, chooseNormalizeMode, isOutsideHardRange, loadRuntimeStateSnapshot, findKnowledgeViolations, findTimelineConflicts } from "@vivy1024/novelfork-core";
import type { BookConfig } from "@vivy1024/novelfork-core";
import type { AgentContext } from "../engine/agents/base.js";
import type { AuditResult } from "../engine/agents/continuity.js";
import { WriterAgent } from "../engine/agents/writer.js";
import { LengthNormalizerAgent } from "../engine/agents/length-normalizer.js";
import { ContinuityAuditor } from "../engine/agents/continuity.js";
import { auditChapterAdversarial, type AdversarialAuditResult } from "../engine/agents/adversarial-audit.js";
import { evaluateGate, selectFactContinuityIssues } from "../engine/agents/severity-gate.js";
import { ReviserAgent } from "../engine/agents/reviser.js";
import { createWritingResourceService } from "../engine/writing-resource/service.js";
import { dirname, join } from "node:path";
import type { SceneSpec } from "./scene-spec-handler.js";
import { renderBeatBudget } from "./beat-budget.js";
import { handleChapterAuditV2 } from "./chapter-audit-v2.js";
import {
  handlePresetsCheckCompliance,
  loadAccessiblePresetBeatStore,
} from "./preset-beat-handlers.js";
import { buildNarrativeContext } from "../engine/narrative-memory/build-narrative-context.js";
import { createLLMChapterEventExtractor } from "../engine/narrative-memory/chapter-event-extractor.js";
import { loadNarrativeMemoryConfig } from "../engine/narrative-memory/config.js";
import { runtimeDeltaToNarrativeEvents } from "../engine/narrative-memory/runtime-delta-events.js";
import type { NarrativeContextPackage, NarrativeEvent, NarrativeRetrievalDiagnostics } from "../engine/narrative-memory/types.js";
import { listHighRiskPendingNarrativeEvents } from "../engine/narrative-memory/storage.js";
import type { ChapterSettlementResult } from "../engine/narrative-memory/settlement-risk-gate.js";
import type { StyleSnippet } from "../engine/narrative-memory/channels/style-channel.js";
import type { BeatTemplate, Preset } from "../engine/presets/types.js";
import { getBeatTemplate, getPreset } from "../engine/presets/index.js";
import { registerBuiltinPresets } from "../engine/presets/builtin.js";

export interface PipelineCanvasArtifact {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly summary?: string;
  readonly resourceRef?: {
    readonly kind: string;
    readonly id: string;
    readonly bookId?: string;
    readonly title?: string;
    readonly chapterNumber?: number;
    readonly path?: string;
  };
  readonly payloadRef?: string;
  readonly renderer?: string;
  readonly openInCanvas?: boolean;
  readonly createdAt?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface PipelineWriteInput {
  readonly bookId: string;
  readonly sceneSpec: SceneSpec;
  readonly narrativeContext?: NarrativeContextPackage;
  readonly jingweiContext?: string;
  readonly previousChapterTail?: string;
  readonly autoRevise?: boolean;
  /** 存在 high-risk pending NarrativeEvents 时仍明确继续写作。默认 false，会在写作前返回提醒。 */
  readonly continueWithHighRiskPending?: boolean;
  /** 对抗式审查：3 视角独立审查 + 交叉合成（默认 false，回退单 agent） */
  readonly adversarialAudit?: boolean;
  /** 多轮自愈：审查→修订最多 N 轮（默认 1） */
  readonly maxReviseRounds?: number;
  /** 仅测试/迁移：跳过 empty-recent-progress 写前硬门 */
  readonly skipContextGate?: boolean;
  /**
   * 若仍有 critical 事实/连续性类 issue 未清，则拒绝保存正式章。
   * 默认 false：只标 needsHumanReview。
   */
  readonly requireFactCheckPass?: boolean;
  /**
   * 普通审修轮结束后，若仍有 critical 事实/连续性问题，触发一次事实专项 spot-fix + 复审。
   * 独立于 maxReviseRounds，默认 false。
   */
  readonly factCheckAutoRevise?: boolean;
}

export interface PipelineAuditIssueCategories {
  readonly critical: number;
  readonly warning: number;
  readonly info: number;
  readonly byType: Readonly<Record<string, number>>;
}

export interface PipelineWriteOutput {
  readonly ok: true;
  readonly content: string;
  readonly title: string;
  readonly wordCount: number;
  readonly chapterNumber: number;
  readonly auditResult: AuditResult;
  readonly auditIssueCategories: PipelineAuditIssueCategories;
  readonly revised: boolean;
  readonly chapterId: string;
  readonly artifact: PipelineCanvasArtifact;
  /** 长度归一化过程的诊断警告；hard 区间最终越界会直接拒绝保存。 */
  readonly lengthWarning?: string;
  /** 多轮自愈达上限仍有 critical → 需人工复核（Human Review Gate） */
  readonly needsHumanReview?: boolean;
  /** 实际执行的修订轮数 */
  readonly reviseRounds?: number;
  /** 正式章节确认后的 Narrative Memory 自动结算摘要 */
  readonly narrativeSettlement?: ChapterSettlementResult;
  /** 写作前发现的高风险 pending NarrativeEvents 提醒 */
  readonly highRiskPendingReminder?: string;
  /** 轻量发布向提示（默认只 warn；敏感 block 且平台要求时才拒绝保存） */
  readonly publishHint?: {
    readonly status: "ready" | "has-warnings" | "blocked" | "skipped";
    readonly warnings: readonly string[];
    readonly platform?: string;
  };
  /** 是否执行过事实专项修订 */
  readonly factCheckRevised?: boolean;
  /** 事实专项修订轮数（0 或 1） */
  readonly factCheckRound?: number;
}

export interface PipelineWriteError {
  readonly ok: false;
  readonly code:
    | "book-not-found"
    | "spec-invalid"
    | "generation-failed"
    | "timeout"
    | "high-risk-pending"
    | "length-out-of-range"
    | "preset-compliance-failed"
    | "context-not-ready"
    | "fact-check-failed"
    | "publish-blocked";
  readonly error: string;
}

export function summarizeAuditIssueCategories(issues: readonly { severity?: string; type?: string; category?: string; ruleId?: string }[]): PipelineAuditIssueCategories {
  const byType: Record<string, number> = {};
  let critical = 0;
  let warning = 0;
  let info = 0;
  for (const issue of issues) {
    const severity = String(issue.severity ?? "info").toLowerCase();
    if (severity === "critical" || severity === "error" || severity === "s1") critical += 1;
    else if (severity === "warning" || severity === "s2") warning += 1;
    else info += 1;
    const type = String(issue.type ?? issue.category ?? issue.ruleId ?? "unknown");
    byType[type] = (byType[type] ?? 0) + 1;
  }
  return { critical, warning, info, byType };
}

export type PipelineWriteResult = PipelineWriteOutput | PipelineWriteError;

export interface PipelineWriteOptions {
  /** Project root used for optional project-level agent resources. */
  readonly root: string;
  /** Trusted bound book root; required for external workspace bindings. */
  readonly bookRoot?: string;
  readonly client: LLMClient;
  readonly model: string;
  readonly onStream?: (chunk: string) => void;
  readonly logger?: Logger;
}

function buildAgentCtx(options: PipelineWriteOptions, agentName: string, bookId: string): AgentContext {
  return {
    client: options.client,
    model: options.model,
    projectRoot: options.root,
    bookId,
    logger: options.logger,
  };
}

/**
 * 可信绑定下，这本书的目录只由 bookRoot 决定（外部工作区不在 <root>/books 下）。
 * root 仅用于 StateManager 需要项目级路径的少数场景。
 */
function createPipelineState(options: PipelineWriteOptions, bookId: string): StateManager {
  return new StateManager(options.root, options.bookRoot
    ? {
        resolveBookDir: (requestedBookId) => {
          if (requestedBookId !== bookId) {
            throw new Error("The requested book does not match the trusted pipeline binding.");
          }
          return options.bookRoot!;
        },
      }
    : undefined);
}

type BookStyleConfig = Readonly<{
  enabledPresetIds?: readonly string[];
  beatTemplateId?: string;
}>;

type PresetComplianceViolation = Readonly<{
  presetName: string;
  rule: string;
  violation: string;
  severity: "warning" | "error";
}>;

function readPresetComplianceViolations(data: unknown): PresetComplianceViolation[] {
  if (!data || typeof data !== "object" || !Array.isArray((data as { violations?: unknown }).violations)) return [];
  return (data as { violations: unknown[] }).violations.filter((item): item is PresetComplianceViolation => (
    Boolean(item)
    && typeof item === "object"
    && (item as { severity?: unknown }).severity !== undefined
    && ((item as { severity?: unknown }).severity === "warning" || (item as { severity?: unknown }).severity === "error")
    && typeof (item as { presetName?: unknown }).presetName === "string"
    && typeof (item as { rule?: unknown }).rule === "string"
    && typeof (item as { violation?: unknown }).violation === "string"
  ));
}

function nonEmpty(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function ensureBuiltinPresetStores(): void {
  try {
    registerBuiltinPresets();
  } catch {
    // Builtin preset registration is idempotent; failure should not block writing.
  }
}

export function presetToStyleSnippet(preset: Preset): StyleSnippet | null {
  const text = nonEmpty(preset.promptInjection);
  if (!text) return null;
  return {
    id: preset.id,
    title: preset.name,
    text,
    tags: ["preset", preset.category, ...(preset.tags ?? [])],
  };
}

export function beatTemplateToStyleSnippet(template: BeatTemplate): StyleSnippet | null {
  if (template.beats.length === 0) return null;
  const body = template.beats.map((beat) => [
    `- ${beat.index}. ${beat.name}`,
    `  purpose: ${beat.purpose}`,
    `  emotionalTone: ${beat.emotionalTone}`,
    `  wordRatio: ${beat.wordRatio}`,
    beat.networkNovelTip ? `  networkNovelTip: ${beat.networkNovelTip}` : "",
  ].filter(Boolean).join("\n")).join("\n");
  return {
    id: template.id,
    title: template.name,
    text: `${template.description}\n${body}`.trim(),
    tags: ["beat-template", "beat"],
  };
}

type BookStyleSource = Readonly<{
  presets: readonly Preset[];
  beatTemplate?: BeatTemplate;
}>;

export function resolveBookStyleChannelSnippets(
  config: BookStyleConfig,
  source?: BookStyleSource,
): { readonly presets: readonly StyleSnippet[]; readonly beats: readonly StyleSnippet[] } {
  ensureBuiltinPresetStores();
  const selectedPresets = source
    ? source.presets
    : (config.enabledPresetIds ?? [])
      .map((id) => getPreset(id))
      .filter((preset): preset is Preset => Boolean(preset));
  const presets = selectedPresets
    .map(presetToStyleSnippet)
    .filter((snippet): snippet is StyleSnippet => Boolean(snippet));
  const beatTemplate = source
    ? source.beatTemplate
    : (config.beatTemplateId ? getBeatTemplate(config.beatTemplateId) : undefined);
  const beatSnippet = beatTemplate ? beatTemplateToStyleSnippet(beatTemplate) : null;
  return {
    presets,
    beats: beatSnippet ? [beatSnippet] : [],
  };
}

/** 截断控制文档到合理预算（~800 字），避免长视野文档占用过多上下文 */
function truncateDoc(text: string, maxChars = 800): string {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars).trimEnd() + "…";
}

type BuildPipelineContextPackageInput = Readonly<{
  chapterNumber: number;
  sceneSpec: SceneSpec;
  authorIntentDoc?: string;
  currentFocusDoc?: string;
  narrativeContext?: NarrativeContextPackage;
  jingweiContext?: string;
  previousChapterTail?: string;
}>;

const NARRATIVE_SECTION_REASONS: Record<keyof NarrativeContextPackage["sections"], string> = {
  hard: "Narrative Memory hard constraints：canon/硬规则/SceneSpec constraints，不可直接丢弃。",
  state: "Narrative Memory state：当前角色、地点、组织、动态事实与场景状态。",
  timeline: "Narrative Memory timeline：最近章节、前章尾部与时间线连续性。",
  hooks: "Narrative Memory hooks：当前活跃/长期未推进伏笔。",
  facts: "Narrative Memory facts：结构化叙事事实与一跳扩展。",
  style: "Narrative Memory style：文风、预设、节拍与合规风格提示。",
  semantic: "Narrative Memory semantic：语义记忆召回。",
};

function narrativeSectionContext(narrativeContext?: NarrativeContextPackage): ContextPackage["selectedContext"] {
  if (!narrativeContext) return [];
  return (Object.entries(narrativeContext.sections) as [keyof NarrativeContextPackage["sections"], string][])
    .filter(([, excerpt]) => excerpt.trim().length > 0)
    .map(([section, excerpt]) => ({ source: `narrative-memory/${section}`, reason: NARRATIVE_SECTION_REASONS[section], excerpt }));
}

export function buildPipelineContextPackage(input: BuildPipelineContextPackageInput): ContextPackage {
  return {
    chapter: input.chapterNumber,
    selectedContext: [
      ...(input.authorIntentDoc ? [{ source: "story/author_intent.md", reason: "全书长视野创作意图（最高锚点，避免长篇跑偏主题）", excerpt: input.authorIntentDoc }] : []),
      ...(input.currentFocusDoc ? [{ source: "story/current_focus.md", reason: "近 1-3 章焦点，本章应优先推进的方向", excerpt: input.currentFocusDoc }] : []),
      { source: "scene.spec", reason: "本章结构化写作蓝图", excerpt: JSON.stringify(input.sceneSpec) },
      // 预算单独给一段可读文本：JSON 里的数字模型容易忽略，
      // 显式列出「哪一拍该展开、哪一拍带过」才能真正约束章内节奏。
      ...(input.sceneSpec.beatBudget && input.sceneSpec.beatBudget.length > 0
        ? [{
            source: "scene.spec/beatBudget",
            reason: "章内节奏预算：密点必须展开到指定字数，疏点必须带过，不要平均用力",
            excerpt: renderBeatBudget(input.sceneSpec.beatBudget),
          }]
        : []),
      ...narrativeSectionContext(input.narrativeContext),
      ...(input.jingweiContext ? [{ source: "jingwei", reason: "经纬上下文：人物/设定/伏笔/前情（legacy compatibility）", excerpt: input.jingweiContext }] : []),
      ...(input.previousChapterTail ? [{ source: "prev_chapter_tail", reason: "前章末尾，保持开篇连贯", excerpt: input.previousChapterTail }] : []),
    ],
  };
}

export function buildPipelineChapterResultMetadata(input: { readonly narrativeContext?: NarrativeContextPackage }): NarrativeRetrievalDiagnostics | undefined {
  return input.narrativeContext?.diagnostics;
}

export function buildHighRiskPendingReminder(events: readonly NarrativeEvent[]): string {
  const highRisk = events.filter((event) => event.status === "pending" && event.riskLevel === "high");
  if (highRisk.length === 0) return "";
  const items = highRisk.slice(0, 5).map((event) => [
    `- ${event.id}｜第${event.chapterNumber}章｜${event.subject} ${event.predicate} ${event.object}`,
    `  evidence: ${event.evidenceText}`,
  ].join("\n")).join("\n");
  const more = highRisk.length > 5 ? `\n...以及另外 ${highRisk.length - 5} 条高风险 pending。` : "";
  return `检测到 ${highRisk.length} 条高风险 pending NarrativeEvents（仅提醒，默认不阻断写作；作者可在叙事记忆历史查看/处理）。系统不会自动修改正文或经纬 canon。\n${items}${more}`;
}

export async function executePipelineWrite(
  input: PipelineWriteInput,
  options: PipelineWriteOptions,
): Promise<PipelineWriteResult> {
  // 产品口径：章后结算默认自动；是否阻断高风险 pending 由本书 narrativeMemory 配置决定。
  const {
    bookId,
    sceneSpec,
    jingweiContext,
    previousChapterTail,
    autoRevise = true,
    adversarialAudit = false,
    maxReviseRounds = 1,
    skipContextGate = false,
    requireFactCheckPass = false,
    factCheckAutoRevise = false,
  } = input;
  let continueWithHighRiskPending = input.continueWithHighRiskPending;
  let narrativeContext = input.narrativeContext;
  const { root, logger } = options;

  // Validate scene spec (H4)
  if (!sceneSpec.scenes || sceneSpec.scenes.length === 0) {
    return { ok: false, code: "spec-invalid", error: "Scene spec must have at least one scene." };
  }
  for (const scene of sceneSpec.scenes) {
    if (!scene.characters?.length || !scene.location || !scene.conflict || !scene.outcome) {
      return { ok: false, code: "spec-invalid", error: "Each scene must have characters, location, conflict, and outcome." };
    }
  }

  try {
    // 1. Load book config
    const state = createPipelineState(options, bookId);
    let book: BookConfig;
    try {
      book = await state.loadBookConfig(bookId);
    } catch {
      return { ok: false, code: "book-not-found", error: `Book "${bookId}" not found` };
    }

    const bookDir = state.bookDir(bookId);
    const memoryConfig = await loadNarrativeMemoryConfig(bookId, bookDir).catch(() => null);
    if (continueWithHighRiskPending === undefined) {
      continueWithHighRiskPending = !(memoryConfig?.settlement.blockWriteOnHighRiskPending ?? false);
    }
    const chapterNumber = sceneSpec.chapter ?? await state.getNextChapterNumber(bookId);

    // 写前硬门：已有正式章但近章记忆/摘要为空时禁止继续硬写（软质量不在此拦）。
    if (!skipContextGate) {
      try {
        const { handleWritePreflight } = await import("./write-preflight.js");
        const preflight = await handleWritePreflight({
          bookId,
          chapterNumber,
          userDirectives: sceneSpec.constraints?.find((item) => item.startsWith("用户指示："))?.slice("用户指示：".length)
            ?? sceneSpec.title
            ?? "按场景蓝图推进本章",
          acceptFocusDefault: true,
          bookRoot: bookDir,
          cockpitState: {
            loadBookConfig: (id) => state.loadBookConfig(id),
            loadChapterIndex: (id) => state.loadChapterIndex(id),
            bookDir: (id) => state.bookDir(id),
          },
        });
        const hard = preflight.blockers.filter((item) => item.code === "empty-recent-progress" || item.code === "book-not-found");
        if (hard.length > 0) {
          return {
            ok: false,
            code: "context-not-ready",
            error: hard.map((item) => item.message).join("；"),
          };
        }
      } catch (err) {
        logger?.debug(`[pipeline.write] Context gate skipped: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // The persisted book setting is authoritative. SceneSpec is model-generated
    // planning input and must not lower or replace the book's hard target.
    const lengthSpec = buildLengthSpec(book.chapterWordCount, book.language === "en" ? "en" : "zh");

    logger?.info(`[pipeline.write] Starting for book=${bookId} chapter=${chapterNumber}`);

    let highRiskPendingReminder: string | undefined;
    try {
      const { getStorageDatabase } = await import("@vivy1024/novelfork-core");
      const pendingEvents = listHighRiskPendingNarrativeEvents(getStorageDatabase(), { bookId, limit: 50 });
      const reminder = buildHighRiskPendingReminder(pendingEvents);
      if (reminder) {
        highRiskPendingReminder = reminder;
        logger?.warn(`[pipeline.write] ${reminder.split("\n")[0]}`);
        if (!continueWithHighRiskPending) {
          return { ok: false, code: "high-risk-pending", error: reminder };
        }
      }
    } catch (err) {
      logger?.debug(`[pipeline.write] High-risk pending check skipped: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!narrativeContext) {
      try {
        const { getStorageDatabase } = await import("@vivy1024/novelfork-core");
        const storage = getStorageDatabase();
        const runtimeSnapshot = await loadRuntimeStateSnapshot(bookDir).catch(() => undefined);
        const accessibleStore = loadAccessiblePresetBeatStore(storage, bookId);
        const enabledPresetIds = new Set(book.enabledPresetIds ?? []);
        const selectedBeatTemplate = typeof book.beatTemplateId === "string"
          ? accessibleStore.beats.find((template) => template.id === book.beatTemplateId)
          : undefined;
        const styleSnippets = resolveBookStyleChannelSnippets(book as BookStyleConfig, {
          presets: accessibleStore.presets.filter((preset) => enabledPresetIds.has(preset.id)),
          ...(selectedBeatTemplate ? { beatTemplate: selectedBeatTemplate } : {}),
        });
        narrativeContext = await buildNarrativeContext({
          storage,
          bookId,
          purpose: "write_chapter",
          chapterNumber,
          sceneSpec,
          sceneText: sceneSpec.scenes.map((scene) => [scene.location, scene.conflict, scene.outcome, ...scene.characters].join(" ")).join("\n"),
          entities: sceneSpec.scenes.flatMap((scene) => [...scene.characters, scene.location, ...scene.hooks_used, ...scene.hooks_planted]),
          maxTokens: memoryConfig?.retrieval.maxTokens ?? 16_000,
          previousChapterTail,
          runtimeSnapshot,
          presets: styleSnippets.presets,
          beats: styleSnippets.beats,
          enabledChannels: memoryConfig?.retrieval.channels,
          waveConfig: { enabled: memoryConfig?.retrieval.waveEnabled ?? false },
          semanticConfig: { enabled: memoryConfig?.retrieval.semanticEnabled ?? false },
        });
      } catch (err) {
        logger?.warn(`[pipeline.write] Failed to build NarrativeContextPackage, falling back to legacy context: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 2. Writer — generate chapter from scene spec
    const writerCtx = buildAgentCtx(options, "writer", bookId);
    const writer = new WriterAgent(writerCtx);

    // P0-2: 加载控制文档（全书长视野意图 + 近 1-3 章焦点），注入写作上下文。
    // 此前 author_intent 只被 planner 消化成 goal，原文不进 writer 上下文 → 长篇易跑偏。
    let authorIntentDoc = "";
    let currentFocusDoc = "";
    try {
      const ctrl = await state.loadControlDocuments(bookId);
      authorIntentDoc = truncateDoc(ctrl.authorIntent);
      currentFocusDoc = truncateDoc(ctrl.currentFocus);
    } catch (err) {
      logger?.warn(`[pipeline.write] Failed to load control documents: ${err}`);
    }

    // Build structured ContextPackage (优先 Narrative Memory，保留 legacy jingweiContext 兼容路径)
    const contextPackage = buildPipelineContextPackage({
      chapterNumber,
      sceneSpec,
      authorIntentDoc,
      currentFocusDoc,
      narrativeContext,
      jingweiContext,
      previousChapterTail,
    });

    // Build structured RuleStack（此前传字符串 + as any，Writer 访问 .activeOverrides 会出错）
    const ruleStack: RuleStack = {
      layers: [{ id: "scene-constraints", name: "Scene Constraints", precedence: 0, scope: "local" }],
      sections: {
        hard: sceneSpec.constraints ?? [],
        soft: [],
        diagnostic: [],
      },
      overrideEdges: [],
      activeOverrides: [],
    };

    const chapterIntent = `按照 Scene Spec 写第${chapterNumber}章「${sceneSpec.title}」`;

    const writeOutput = await writer.writeChapter({
      book,
      bookDir,
      chapterNumber,
      chapterIntent,
      contextPackage,
      ruleStack,
      externalContext: "",
      lengthSpec,
    });

    logger?.info(`[pipeline.write] Writer done: "${writeOutput.title}" ${writeOutput.wordCount} words`);

    // 2.2. Length governance (P0-1): Writer 输出漂出 hard 区间时先归一化；最终版本还会在保存前强制复核。
    let governedContent = writeOutput.content;
    let lengthWarning: string | undefined;
    {
      const count = countChapterLength(governedContent, lengthSpec.countingMode);
      if (isOutsideHardRange(count, lengthSpec) && chooseNormalizeMode(count, lengthSpec) !== "none") {
        logger?.info(`[pipeline.write] Length ${count} outside hard range ${lengthSpec.hardMin}-${lengthSpec.hardMax}, normalizing once`);
        const normalizer = new LengthNormalizerAgent(buildAgentCtx(options, "length-normalizer", bookId));
        const norm = await normalizer.normalizeChapter({ chapterContent: governedContent, lengthSpec, chapterIntent });
        if (norm.applied) {
          governedContent = norm.normalizedContent;
          lengthWarning = norm.warning;
          logger?.info(`[pipeline.write] Normalized to ${norm.finalCount} (${norm.mode})${norm.warning ? " — still out of range" : ""}`);
        }
      }
    }

    // 2.5. Pre-audit: zero-cost hard constraint check (H2 canon + H7 POV + soft constraints)
    const preAudit = handleChapterAuditV2({
      bookId,
      chapterNumber,
      content: governedContent,
      sceneSpec,
      wordTarget: book.chapterWordCount,
    });
    if (!preAudit.passed && preAudit.hardViolations.length > 0) {
      logger?.warn(`[pipeline.write] Pre-audit hard violations: ${preAudit.hardViolations.map((v) => v.ruleId).join(", ")}`);
    }

    // 3. Audit + 多轮自愈修订（P1-1 对抗审查 / P1-3 多轮）
    const reviserCtx = buildAgentCtx(options, "reviser", bookId);
    const auditOpts = { chapterIntent, contextPackage, ruleStack };

    // 审查函数：对抗式（3 视角交叉）或单 agent（回退）
    const runAudit = async (content: string): Promise<AuditResult> => {
      if (adversarialAudit) {
        return auditChapterAdversarial(
          { bookDir, chapterContent: content, chapterNumber, genre: book.genre, ...auditOpts },
          () => new ContinuityAuditor(buildAgentCtx(options, "auditor", bookId)),
        );
      }
      return new ContinuityAuditor(buildAgentCtx(options, "auditor", bookId)).auditChapter(
        bookDir, content, chapterNumber, book.genre, auditOpts,
      );
    };

    let finalContent = governedContent;
    let revised = false;
    let reviseRounds = 0;
    let auditResult: AuditResult = await runAudit(finalContent);
    const maxRounds = Math.max(0, maxReviseRounds);

    // 多轮自愈（P1-2 门禁）：S1/S2（critical）触发修订，spot-fix → re-audit，最多 maxRounds 轮
    while (autoRevise && reviseRounds < maxRounds) {
      const gate = evaluateGate(auditResult.issues);
      if (!gate.hasRevisable) break;
      const criticalIssues = auditResult.issues.filter((i) => i.severity === "critical");
      reviseRounds += 1;
      logger?.info(`[pipeline.write] Revise round ${reviseRounds}/${maxRounds}: S1=${gate.counts.S1} S2=${gate.counts.S2}`);
      const reviseOutput = await new ReviserAgent(reviserCtx).reviseChapter(
        bookDir, finalContent, chapterNumber, criticalIssues, "spot-fix", book.genre,
        { chapterIntent, contextPackage, ruleStack, lengthSpec },
      );
      finalContent = reviseOutput.revisedContent;
      revised = true;
      auditResult = await runAudit(finalContent); // re-audit 修订后的版本
    }

    // 3.5. 事实/连续性专项修订（独立于 maxReviseRounds，最多 1 轮）
    let factCheckRevised = false;
    let factCheckRound = 0;
    if (factCheckAutoRevise) {
      const factIssues = selectFactContinuityIssues(auditResult.issues);
      if (factIssues.length > 0) {
        factCheckRound = 1;
        logger?.info(`[pipeline.write] Fact-check revise: ${factIssues.length} critical fact/continuity issue(s)`);
        const factIssuesForRevise = factIssues.map((issue) => ({
          ...issue,
          description: `[事实核查专项] ${issue.description}`,
        }));
        try {
          const factRevise = await new ReviserAgent(reviserCtx).reviseChapter(
            bookDir, finalContent, chapterNumber, factIssuesForRevise, "spot-fix", book.genre,
            { chapterIntent, contextPackage, ruleStack, lengthSpec },
          );
          if (factRevise.revisedContent.trim()) {
            finalContent = factRevise.revisedContent;
            revised = true;
            factCheckRevised = true;
            auditResult = await runAudit(finalContent);
            const remaining = selectFactContinuityIssues(auditResult.issues).length;
            logger?.info(`[pipeline.write] Fact-check revise done, remaining fact issues: ${remaining}`);
          }
        } catch (factError) {
          logger?.warn(`[pipeline.write] Fact-check revise failed: ${factError instanceof Error ? factError.message : String(factError)}`);
        }
      }
    }

    // Revisions can reintroduce length drift after the initial normalizer. The
    // book's persisted hard range is checked again before any formal resource
    // or Narrative Memory settlement is allowed.
    let finalLengthCount = countChapterLength(finalContent, lengthSpec.countingMode);
    if (isOutsideHardRange(finalLengthCount, lengthSpec)) {
      logger?.info(`[pipeline.write] Final length ${finalLengthCount} outside hard range ${lengthSpec.hardMin}-${lengthSpec.hardMax}, normalizing once more`);
      const normalizer = new LengthNormalizerAgent(buildAgentCtx(options, "length-normalizer", bookId));
      const norm = await normalizer.normalizeChapter({ chapterContent: finalContent, lengthSpec, chapterIntent });
      if (norm.applied) {
        finalContent = norm.normalizedContent;
        lengthWarning = norm.warning ?? lengthWarning;
        auditResult = await runAudit(finalContent);
      }
      finalLengthCount = countChapterLength(finalContent, lengthSpec.countingMode);
    }
    if (isOutsideHardRange(finalLengthCount, lengthSpec)) {
      return {
        ok: false,
        code: "length-out-of-range",
        error: `第${chapterNumber}章最终长度为 ${finalLengthCount}${lengthSpec.countingMode === "en_words" ? " words" : "字"}，不在本书 ${lengthSpec.target}${lengthSpec.countingMode === "en_words" ? " words" : "字"} 的硬范围 ${lengthSpec.hardMin}-${lengthSpec.hardMax} 内；未保存正式章节。`,
      };
    }

    // 门禁：剩余 S1（致命）→ 阻断采纳送人工复核；S2 也未清完同样需复核
    const finalGate = evaluateGate(auditResult.issues);
    const auditIssueCategories = summarizeAuditIssueCategories(auditResult.issues);
    const needsHumanReview = finalGate.hasRevisable;
    if (needsHumanReview) {
      logger?.warn(`[pipeline.write] ${reviseRounds} round(s) exhausted, S1=${finalGate.counts.S1} S2=${finalGate.counts.S2} remain → needs human review`);
    }
    if (requireFactCheckPass && auditIssueCategories.critical > 0) {
      const remainingFactIssues = selectFactContinuityIssues(auditResult.issues).length;
      return {
        ok: false,
        code: "fact-check-failed",
        error: `requireFactCheckPass：仍有 ${auditIssueCategories.critical} 条 critical 问题（其中事实/连续性 ${remainingFactIssues} 条）未清，拒绝保存正式章。${
          factCheckRevised ? "事实专项修订已执行仍未通过。" : ""
        }类别：${JSON.stringify(auditIssueCategories.byType)}`,
      };
    }

    let presetWarnings: PresetComplianceViolation[] = [];
    try {
      const { getStorageDatabase } = await import("@vivy1024/novelfork-core");
      const compliance = await handlePresetsCheckCompliance(
        { bookId, chapterNumber, content: finalContent },
        { bookRoot: bookDir, storage: getStorageDatabase() },
      );
      if (!compliance.ok) {
        return { ok: false, code: "preset-compliance-failed", error: compliance.summary };
      }
      const violations = readPresetComplianceViolations(compliance.data);
      const errors = violations.filter((violation) => violation.severity === "error");
      if (errors.length > 0) {
        return {
          ok: false,
          code: "preset-compliance-failed",
          error: `第${chapterNumber}章触发 ${errors.length} 条预设硬性违规；未保存正式章节。${errors.map((violation) => ` ${violation.presetName}：${violation.violation}`).join("")}`,
        };
      }
      presetWarnings = violations.filter((violation) => violation.severity === "warning");
    } catch (error) {
      return {
        ok: false,
        code: "preset-compliance-failed",
        error: `预设合规检查失败，拒绝保存正式章节：${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const narrativeEvents: NarrativeEvent[] = writeOutput.runtimeStateDelta
      ? runtimeDeltaToNarrativeEvents({
          bookId,
          delta: writeOutput.runtimeStateDelta,
          evidenceText: finalContent.slice(0, 1200),
        })
      : [];

    // 4.0. Knowledge boundary & timeline conflict checks (P2-2 / P3-1)
    let knowledgeWarnings: string[] = [];
    let timelineWarnings: string[] = [];
    try {
      const runtimeSnapshot = await loadRuntimeStateSnapshot(bookDir);
      // POV character: derive from first scene's first character (SceneSpec has no explicit pov field)
      const povCharacterId = sceneSpec.scenes[0]?.characters?.[0] ?? "";
      if (povCharacterId && runtimeSnapshot.knowledge.events.length > 0) {
        const violations = findKnowledgeViolations(runtimeSnapshot.knowledge, povCharacterId, chapterNumber);
        if (violations.length > 0) {
          knowledgeWarnings = violations.map((v) => `[知识越界] ${povCharacterId} 在第${chapterNumber}章不应知道「${v.fact}」（第${v.learnedAtChapter}章才习得）`);
          logger?.warn(`[pipeline.write] Knowledge violations: ${knowledgeWarnings.length} found for POV="${povCharacterId}"`);
        }
      }
      if (runtimeSnapshot.timeline.entries.length > 0) {
        const conflicts = findTimelineConflicts(runtimeSnapshot.timeline);
        if (conflicts.length > 0) {
          timelineWarnings = conflicts.map((c) => c.issue);
          logger?.warn(`[pipeline.write] Timeline conflicts: ${timelineWarnings.length} found`);
        }
      }
    } catch (err) {
      // 旧书可能没有 runtime state — 跳过，不阻断
      logger?.debug(`[pipeline.write] Runtime state check skipped: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 4.1. 平台发布向单章轻检（保存前）：默认只 warn；仅当 profile 要求且存在 block 级敏感命中时拒绝保存。
    const publishWarnings: string[] = [];
    if (needsHumanReview) publishWarnings.push("审计仍有 critical/S2，建议人工复核后再发布。");
    if (factCheckRevised) publishWarnings.push("已执行事实/连续性专项修订，请抽查关键事实。");
    if (presetWarnings.length > 0) publishWarnings.push(`预设警告 ${presetWarnings.length} 条。`);
    if (knowledgeWarnings.length > 0) publishWarnings.push(`知识边界警告 ${knowledgeWarnings.length} 条。`);
    if (timelineWarnings.length > 0) publishWarnings.push(`时间线警告 ${timelineWarnings.length} 条。`);

    let publishStatus: "ready" | "has-warnings" | "blocked" | "skipped" = "ready";
    let publishPlatform: string | undefined;
    try {
      const { handlePublishCheck } = await import("./publish-check.js");
      const { getStorageDatabase } = await import("@vivy1024/novelfork-core");
      const publishResult = await handlePublishCheck({
        bookId,
        bookRoot: bookDir,
        chapterNumber,
        content: finalContent,
        storage: getStorageDatabase(),
      });
      publishPlatform = publishResult.platform;
      if (publishResult.ok && publishResult.report) {
        publishStatus = publishResult.status;
        if (publishResult.blockCount > 0) {
          publishWarnings.push(`${publishResult.platformLabel}：${publishResult.blockCount} 条阻断级问题。`);
        }
        if (publishResult.warnCount > 0) {
          publishWarnings.push(`${publishResult.platformLabel}：${publishResult.warnCount} 条发布提醒。`);
        }
        if (publishResult.chapterTarget?.message) publishWarnings.push(publishResult.chapterTarget.message);

        const sensitiveBlocks = publishResult.report.sensitiveScan.totalBlockCount;
        if (sensitiveBlocks > 0 && publishResult.profile.blockOnSensitiveBlock) {
          return {
            ok: false,
            code: "publish-blocked",
            error: `第${chapterNumber}章触发 ${sensitiveBlocks} 条${publishResult.platformLabel}阻断级敏感命中；未保存正式章节。可先 pipeline.revise 处理后重试，或调整书籍平台设置。`,
          };
        }
      } else {
        publishStatus = "skipped";
      }
    } catch (publishError) {
      publishStatus = "skipped";
      logger?.debug(`[pipeline.write] Publish check skipped: ${publishError instanceof Error ? publishError.message : String(publishError)}`);
    }

    const publishHint = {
      status: (publishWarnings.length > 0 && publishStatus === "ready" ? "has-warnings" : publishStatus) as "ready" | "has-warnings" | "blocked" | "skipped",
      warnings: publishWarnings,
      ...(publishPlatform ? { platform: publishPlatform } : {}),
    };

    // 4. Save as formal chapter result
    const chapterId = `chapter:${chapterNumber}`;
    let narrativeSettlement: ChapterSettlementResult | undefined;
    try {
      const { getStorageDatabase } = await import("@vivy1024/novelfork-core");
      const storage = getStorageDatabase();
      const resourceService = createWritingResourceService({
        storage,
        resolveBookDir: (requestedBookId: string) => {
          if (requestedBookId !== bookId) {
            throw new Error("Writing resource book binding mismatch");
          }
          return bookDir;
        },
      });
      const metadata = {
        sceneSpec,
        ...(buildPipelineChapterResultMetadata({ narrativeContext }) ? { narrativeMemoryDiagnostics: buildPipelineChapterResultMetadata({ narrativeContext }) } : {}),
        auditResult: { passed: auditResult.passed, issueCount: auditResult.issues.length },
        gateResult: { counts: finalGate.counts, hasBlocking: finalGate.hasBlocking, hasRevisable: finalGate.hasRevisable },
        revised,
        reviseRounds,
        ...(needsHumanReview ? { needsHumanReview: true } : {}),
        ...(factCheckRevised ? { factCheckRevised: true, factCheckRound } : {}),
        ...(adversarialAudit ? { adversarialAudit: true } : {}),
        length: {
          actual: finalLengthCount,
          target: lengthSpec.target,
          hardMin: lengthSpec.hardMin,
          hardMax: lengthSpec.hardMax,
          countingMode: lengthSpec.countingMode,
        },
        ...(lengthWarning ? { lengthWarning } : {}),
        ...(presetWarnings.length > 0 ? { presetWarnings } : {}),
        ...(knowledgeWarnings.length > 0 ? { knowledgeWarnings } : {}),
        ...(timelineWarnings.length > 0 ? { timelineWarnings } : {}),
        publishHint,
        ...(highRiskPendingReminder ? { highRiskPendingReminder } : {}),
        ...(narrativeEvents.length > 0 ? { narrativeEvents } : {}),
        generatedAt: new Date().toISOString(),
      };
      const existing = await resourceService.findAcceptedChapter(bookId, chapterNumber);
      if (existing) {
        await resourceService.update(bookId, existing.id, { title: writeOutput.title, content: finalContent, metadata });
      } else {
        await resourceService.create(bookId, {
          id: chapterId,
          type: "chapter",
          status: "accepted",
          title: writeOutput.title,
          content: finalContent,
          chapterNumber,
          source: "pipeline.write",
          metadata,
        });
      }

      try {
        const { settleConfirmedChapter } = await import("./chapter-settlement-service.js");
        narrativeSettlement = await settleConfirmedChapter({
          bookId,
          chapterId,
          chapterNumber,
          title: writeOutput.title,
          content: finalContent,
          confirmedAt: new Date().toISOString(),
        }, {
          storage,
          bookRoot: bookDir,
          config: memoryConfig ?? undefined,
          llmExtractor: async (settlementInput) => {
            const llmExtractor = createLLMChapterEventExtractor(options.client, options.model);
            const llmDrafts = await llmExtractor(settlementInput).catch((error) => {
              logger?.warn(`[pipeline.write] LLM settlement extraction failed: ${error instanceof Error ? error.message : String(error)}`);
              return [];
            });
            return [
              ...llmDrafts,
              ...narrativeEvents.map((event) => ({
                eventType: event.eventType,
                subject: event.subject,
                predicate: event.predicate,
                object: event.object,
                evidenceText: event.evidenceText || finalContent.slice(0, 1200),
                confidence: event.confidence,
                source: "settle",
              })),
            ];
          },
        });
      } catch (settlementError) {
        logger?.warn(`[pipeline.write] Narrative Memory settlement failed: ${settlementError instanceof Error ? settlementError.message : String(settlementError)}`);
      }
    } catch (err) {
      logger?.warn(`[pipeline.write] Failed to save formal chapter: ${err}`);
    }

    const wordCount = finalLengthCount;

    return {
      ok: true,
      content: finalContent,
      title: writeOutput.title,
      wordCount,
      chapterNumber,
      auditResult,
      auditIssueCategories,
      revised,
      chapterId,
      reviseRounds,
      publishHint,
      factCheckRevised,
      factCheckRound,
      ...(needsHumanReview ? { needsHumanReview: true } : {}),
      ...(lengthWarning ? { lengthWarning } : {}),
      ...(highRiskPendingReminder ? { highRiskPendingReminder } : {}),
      ...(narrativeSettlement ? { narrativeSettlement } : {}),
      artifact: {
        id: chapterId,
        kind: "chapter",
        title: writeOutput.title,
        openInCanvas: true,
        resourceRef: { kind: "chapter", id: chapterId, bookId, chapterNumber, title: writeOutput.title },
        metadata: {
          bookId,
          chapterNumber,
          source: "pipeline.write",
          auditIssueCategories,
          publishHint,
        },
      },
    };
  } catch (err) {
    return { ok: false, code: "generation-failed", error: `写作管线执行失败: ${err instanceof Error ? err.message : String(err)}` };
  }
}
