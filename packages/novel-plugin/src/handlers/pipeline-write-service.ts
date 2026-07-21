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
import { evaluateGate } from "../engine/agents/severity-gate.js";
import { ReviserAgent } from "../engine/agents/reviser.js";
import { createWritingResourceService } from "../engine/writing-resource/service.js";
import { join } from "node:path";
import type { SceneSpec } from "./scene-spec-handler.js";
import { handleChapterAuditV2 } from "./chapter-audit-v2.js";
import { buildNarrativeContext } from "../engine/narrative-memory/build-narrative-context.js";
import { createLLMChapterEventExtractor } from "../engine/narrative-memory/chapter-event-extractor.js";
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
}

export interface PipelineWriteOutput {
  readonly ok: true;
  readonly content: string;
  readonly title: string;
  readonly wordCount: number;
  readonly chapterNumber: number;
  readonly auditResult: AuditResult;
  readonly revised: boolean;
  readonly chapterId: string;
  readonly artifact: PipelineCanvasArtifact;
  /** 长度治理：归一化后仍漂出 hard 区间时的警告（不阻断） */
  readonly lengthWarning?: string;
  /** 多轮自愈达上限仍有 critical → 需人工复核（Human Review Gate） */
  readonly needsHumanReview?: boolean;
  /** 实际执行的修订轮数 */
  readonly reviseRounds?: number;
  /** 正式章节确认后的 Narrative Memory 自动结算摘要 */
  readonly narrativeSettlement?: ChapterSettlementResult;
  /** 写作前发现的高风险 pending NarrativeEvents 提醒 */
  readonly highRiskPendingReminder?: string;
}

export interface PipelineWriteError {
  readonly ok: false;
  readonly code: "book-not-found" | "spec-invalid" | "generation-failed" | "timeout" | "high-risk-pending";
  readonly error: string;
}

export type PipelineWriteResult = PipelineWriteOutput | PipelineWriteError;

export interface PipelineWriteOptions {
  readonly root: string;
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

function countWords(text: string): number {
  return text.replace(/\s+/g, "").length;
}

type BookStyleConfig = Readonly<{
  enabledPresetIds?: readonly string[];
  beatTemplateId?: string;
}>;

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

export function resolveBookStyleChannelSnippets(config: BookStyleConfig): { readonly presets: readonly StyleSnippet[]; readonly beats: readonly StyleSnippet[] } {
  ensureBuiltinPresetStores();
  const presets = (config.enabledPresetIds ?? [])
    .map((id) => getPreset(id))
    .filter((preset): preset is Preset => Boolean(preset))
    .map(presetToStyleSnippet)
    .filter((snippet): snippet is StyleSnippet => Boolean(snippet));
  const beatTemplate = config.beatTemplateId ? getBeatTemplate(config.beatTemplateId) : undefined;
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
  // 产品口径：章后结算自动进行；高风险 pending 仅提醒，不默认阻断写作（作者可在叙事记忆历史查看）。
  const { bookId, sceneSpec, jingweiContext, previousChapterTail, autoRevise = true, continueWithHighRiskPending = true, adversarialAudit = false, maxReviseRounds = 1 } = input;
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
    const state = new StateManager(root);
    let book: BookConfig;
    try {
      book = await state.loadBookConfig(bookId);
    } catch {
      return { ok: false, code: "book-not-found", error: `Book "${bookId}" not found` };
    }

    const bookDir = state.bookDir(bookId);
    const chapterNumber = sceneSpec.chapter ?? await state.getNextChapterNumber(bookId);
    const lengthSpec = buildLengthSpec(sceneSpec.wordTarget ?? book.chapterWordCount);

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
        const styleSnippets = resolveBookStyleChannelSnippets(book as BookStyleConfig);
        narrativeContext = await buildNarrativeContext({
          storage,
          bookId,
          purpose: "write_chapter",
          chapterNumber,
          sceneSpec,
          sceneText: sceneSpec.scenes.map((scene) => [scene.location, scene.conflict, scene.outcome, ...scene.characters].join(" ")).join("\n"),
          entities: sceneSpec.scenes.flatMap((scene) => [...scene.characters, scene.location, ...scene.hooks_used, ...scene.hooks_planted]),
          maxTokens: 16_000,
          previousChapterTail,
          runtimeSnapshot,
          presets: styleSnippets.presets,
          beats: styleSnippets.beats,
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

    // 2.2. Length governance (P0-1): 漂出 hard 区间则归一化一次，仍漂出则记 warning（不阻断）
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
      wordTarget: sceneSpec.wordTarget ?? book.chapterWordCount,
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

    // 门禁：剩余 S1（致命）→ 阻断采纳送人工复核；S2 也未清完同样需复核
    const finalGate = evaluateGate(auditResult.issues);
    const needsHumanReview = finalGate.hasRevisable;
    if (needsHumanReview) {
      logger?.warn(`[pipeline.write] ${reviseRounds} round(s) exhausted, S1=${finalGate.counts.S1} S2=${finalGate.counts.S2} remain → needs human review`);
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

    // 4. Save as formal chapter result
    const chapterId = `chapter:${chapterNumber}`;
    let narrativeSettlement: ChapterSettlementResult | undefined;
    try {
      const { getStorageDatabase, resolveBookStorageDir } = await import("@vivy1024/novelfork-core");
      const storage = getStorageDatabase();
      const resourceService = createWritingResourceService({ storage, resolveBookDir: (bid: string) => resolveBookStorageDir(root, bid) });
      const metadata = {
        sceneSpec,
        ...(buildPipelineChapterResultMetadata({ narrativeContext }) ? { narrativeMemoryDiagnostics: buildPipelineChapterResultMetadata({ narrativeContext }) } : {}),
        auditResult: { passed: auditResult.passed, issueCount: auditResult.issues.length },
        gateResult: { counts: finalGate.counts, hasBlocking: finalGate.hasBlocking, hasRevisable: finalGate.hasRevisable },
        revised,
        reviseRounds,
        ...(needsHumanReview ? { needsHumanReview: true } : {}),
        ...(adversarialAudit ? { adversarialAudit: true } : {}),
        ...(lengthWarning ? { lengthWarning } : {}),
        ...(knowledgeWarnings.length > 0 ? { knowledgeWarnings } : {}),
        ...(timelineWarnings.length > 0 ? { timelineWarnings } : {}),
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

    const wordCount = countWords(finalContent);

    return {
      ok: true,
      content: finalContent,
      title: writeOutput.title,
      wordCount,
      chapterNumber,
      auditResult,
      revised,
      chapterId,
      reviseRounds,
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
        metadata: { bookId, chapterNumber, source: "pipeline.write" },
      },
    };
  } catch (err) {
    return { ok: false, code: "generation-failed", error: `写作管线执行失败: ${err instanceof Error ? err.message : String(err)}` };
  }
}
