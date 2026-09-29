/**
 * Pipeline Write Service (v2) — 精简管线：SceneSpec → Writer → AuditRevise
 *
 * 与旧 executePipelineGenerate 的区别：
 * - 不再内部调用 Planner/Composer（由外部 scene.spec 工具完成）
 * - 接受结构化 SceneSpec 作为输入
 * - Auditor+Reviser 合并为一步
 * - 从 5 次 LLM 调用降到 2 次（Writer + AuditRevise）
 */

import type { Logger, ContextPackage, RuleStack } from "@vivy1024/novelfork-core";
import { StateManager, buildLengthSpec, countChapterLength, isOutsideHardRange, loadRuntimeStateSnapshot, findKnowledgeViolations, findTimelineConflicts } from "@vivy1024/novelfork-core";
import type { BookConfig } from "@vivy1024/novelfork-core";
import type { RuntimeLoadedSkill } from "@vivy1024/novelfork-core/plugins";
import type { AuditResult } from "../engine/agents/continuity.js";
import { evaluateGate, selectFactContinuityIssues } from "../engine/agents/severity-gate.js";
import { createWritingResourceService } from "../engine/writing-resource/service.js";
import { resolveChapterVolumeDirectory } from "./outline-volume.js";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { SceneSpec } from "./scene-spec-handler.js";
import { renderBeatBudget, checkBeatBudget } from "./beat-budget.js";
import { handleChapterAuditV2 } from "./chapter-audit-v2.js";
import { handleWritingSkillsCheckCompliance } from "./writing-skill-handlers.js";
import type { WritingSkillAcknowledgement } from "./writing-skill-acknowledgement.js";
import { buildNarrativeContext } from "../engine/narrative-memory/build-narrative-context.js";
import { createSiliconFlowEmbeddingProvider } from "../engine/narrative-memory/embedding-provider.js";
import { loadEmbeddingConfig } from "../engine/narrative-memory/embedding-settings.js";
import { loadNarrativeMemoryConfig } from "../engine/narrative-memory/config.js";
import { resolveWritingLayers } from "../engine/writing-layers/layer-store.js";
import { loadSceneVoiceConstraints } from "../engine/writing-layers/character-voice-context.js";
import { readBookSettlementFreshness } from "../engine/narrative-memory/settlement-freshness.js";
import { saveChapterAiDraft } from "../engine/writing-layers/style-vault.js";
import { runtimeDeltaToNarrativeEvents } from "../engine/narrative-memory/runtime-delta-events.js";
import type { NarrativeContextPackage, NarrativeEvent, NarrativeRetrievalDiagnostics } from "../engine/narrative-memory/types.js";
import { listHighRiskPendingNarrativeEvents } from "../engine/narrative-memory/storage.js";
import { persistChapterAuditLog } from "../engine/tools/health/audit-log-persist.js";
import { replaceChapterScenes, sceneFromSpec } from "../engine/narrative-memory/scene-store.js";
import { selectDueHooks, type DueHookInput } from "../engine/narrative-memory/foreshadow-phase.js";
import { getJingweiCategoryAliases, sqlInPlaceholders } from "../engine/jingwei/category-compat.js";
import { loadForeshadowStates } from "../engine/narrative-taxonomy/foreshadow-states.js";
import { isPlaceholderFocusDoc, readCurrentFocusDocFromStorage } from "../engine/jingwei/current-focus.js";
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import type { ChapterSettlementResult } from "../engine/narrative-memory/settlement-risk-gate.js";
import type { ChapterEventExtractorInput } from "../engine/narrative-memory/chapter-event-extractor.js";
import type { StyleSnippet } from "../engine/narrative-memory/channels/style-channel.js";
import type { ParsedWritingSkill } from "../engine/writing-skills/types.js";
import { formatAuthorExplanation, isAuthorFacingDetail } from "./diagnostic-explanation.js";

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
  /** 当前 Runtime Agent 已完成的章节正文；pipeline.write 不再负责生成正文。 */
  readonly content: string;
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
  /** 兼容旧客户端；不再要求提交原文引用，也不参与任何门禁。 */
  readonly acknowledgedSkills?: readonly WritingSkillAcknowledgement[];
  /**
   * 当前 Runtime narrator 已成功读取的 Skill 证据（Runtime 实测的强证据）。
   * 仅用于出口合规检查里的依赖加载完整性提醒，不作为写章前的阻断条件。
   */
  readonly loadedSkills?: readonly RuntimeLoadedSkill[];
  /** 已有章节的内容指纹；提供时仅在指纹仍匹配时允许覆盖。缺省保持旧调用方兼容。 */
  readonly expectedHash?: string;
  /** 已有章节版本号；提供时仅在版本仍匹配时允许覆盖。 */
  readonly expectedVersion?: number;
  /** 更明确的兼容别名；与 expectedHash/expectedVersion 二选一即可。 */
  readonly expectedChapterHash?: string;
  readonly expectedChapterVersion?: number;
}

export interface PipelineAuditIssueCategories {
  readonly critical: number;
  readonly warning: number;
  readonly info: number;
  readonly byType: Readonly<Record<string, number>>;
}

export interface PipelineWriteOutput {
  readonly ok: true;
  readonly bookId: string;
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
  /** 轻量投稿风险提示：只提供本地线索与人工复核建议，不阻断保存。 */
  readonly publishHint?: {
    readonly status: "ready" | "has-warnings" | "needs-review" | "skipped";
    readonly warnings: readonly string[];
    readonly platform?: string;
  };
  /** 是否执行过事实专项修订 */
  readonly factCheckRevised?: boolean;
  /** 事实专项修订轮数（0 或 1） */
  readonly factCheckRound?: number;
  /** 章后结算这一步工具调用的发起结果（工具名、是否成功、是否走了宿主工具调用路径）。 */
  readonly settlementDispatch?: PipelineSettlementDispatch;
  /**
   * 章后状态结算失败原因。正文已保存，但叙事记忆未更新；
   * 让叙述者再结算这一章即可（正文已在库，重试不丢稿）。
   */
  readonly settlementError?: string;
  /**
   * 本章实际注入的上下文来源。
   *
   * 直接来自 buildPipelineContextPackage 的 selectedContext：只回传来源、入选理由与
   * 字符数，不回传正文摘录本身（摘录已经进过 prompt，再回传一遍会撑爆结果体积）。
   * 作者据此能核对「这一章到底读了什么」，而不是只看到一个黑箱结果。
   */
  readonly contextSources?: readonly {
    readonly source: string;
    readonly reason: string;
    readonly chars: number;
  }[];
  /**
   * 本次管线真实走过的阶段。
   *
   * 每一项都由函数内已经算出的真实状态推导（预检是否跳过、审计计数、门禁计数、
   * 发布检查状态、结算派发结果等），不是一条硬编码的理想流程。
   */
  readonly pipelineStages?: readonly {
    readonly stage: string;
    readonly status: "ok" | "skipped" | "warning" | "failed";
    readonly detail?: string;
  }[];
}

export interface PipelineWriteError {
  readonly ok: false;
  /**
   * `skills-not-acknowledged` 已从失败码移除：入口不再因「未提交技能引用」拒绝写章。
   * Writing Skills 的硬门只在出口按成品判定（`writing-skill-compliance-failed`）。
   */
  readonly code:
    | "book-not-found"
    | "spec-invalid"
    | "beat-budget-invalid"
    | "generation-failed"
    | "timeout"
    | "high-risk-pending"
    | "length-out-of-range"
    | "writing-skill-compliance-failed"
    | "context-not-ready"
    | "preflight-execution-failed"
    | "skill-verification-failed"
    | "fact-check-failed"
    | "volume-range-violation"
    | "chapter-conflict"
    | "book-locked";
  readonly error: string;
  readonly summary?: string;
  readonly explanation?: string;
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
  /** Project root used for state and storage resolution. */
  readonly root: string;
  /** Trusted bound book root; required for external workspace bindings. */
  readonly bookRoot?: string;
  readonly onStream?: (chunk: string) => void;
  readonly logger?: Logger;
  /** LLM 章后事件抽取器；由 Runtime host 的 generateText 能力构造，缺省时回退规则兜底。 */
  readonly llmExtractor?: ChapterEventExtractorInput["llmExtractor"];
  /**
   * 角色内核重算的文本生成能力；与 llmExtractor 同源（Runtime host generateText）。
   * 缺省时若 config.characterKernel.enabled，结算 warnings 会提示内核未重算。
   */
  readonly kernelGenerateText?: (request: {
    messages: ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }>;
    temperature?: number;
    maxTokens?: number;
  }) => Promise<{ text: string }>;
  /** 结算派发（工具调用路径）携带的同一能力，透传给 memory.settle_chapter。 */
  readonly dispatchKernelGenerateText?: (request: {
    messages: ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }>;
    temperature?: number;
    maxTokens?: number;
  }) => Promise<{ text: string }>;
  /**
   * 由宿主注入的工具调用发起器：管线用它把章后结算作为一次**显式工具调用**发出，
   * 从而在叙述者面板可见、可重试。缺省时退化为直接调用同一 handler（结算仍然发生，
   * 只是不产生独立的面板记录），保证 CLI / 测试等无宿主环境下写章闭环不断。
   */
  readonly dispatchToolCall?: PipelineToolCallDispatcher;
}

/** 章后结算这一步工具调用的结果，供 Agent 与作者判断是否需要重试。 */
export interface PipelineSettlementDispatch {
  readonly toolName: string;
  /** 该次结算工具调用是否成功。 */
  readonly ok: boolean;
  /** 结算是否作为独立工具调用发出（宿主可见），还是回退为进程内直接调用。 */
  readonly dispatched: "tool-call" | "inline-fallback";
  readonly summary: string;
  readonly error?: string;
  readonly settlement?: ChapterSettlementResult;
}

/**
 * 宿主提供的工具调用发起能力。返回值沿用领域工具的 { ok, summary, data } 形态。
 * 它只被用来发起产品自己注册的领域工具，不构成第二套 Agent 循环。
 */
export type PipelineToolCallDispatcher = (call: {
  readonly toolName: string;
  readonly input: Readonly<Record<string, unknown>>;
}) => Promise<{
  readonly ok: boolean;
  readonly summary?: string;
  readonly error?: string;
  readonly data?: unknown;
}>;

function composeAuthorSettlementError(dispatch: PipelineSettlementDispatch): string {
  const explanation = dispatch.settlement?.explanation;
  const lines = [
    explanation
      ? formatAuthorExplanation(explanation)
      : (isAuthorFacingDetail(dispatch.summary) ? dispatch.summary : undefined),
    "正文已经保存，不会丢稿。叙事记忆（谁在哪、伏笔状态）还没跟上这一章。",
    "建议：让叙述者再结算这一章；如果前后几章也空着，就按范围补结算。",
  ].filter((line): line is string => Boolean(line));
  return [...new Set(lines)].join("\n");
}

/** 从工具调用返回的 data 里取回结算摘要；宿主可能已把它 JSON 序列化过一轮。 */
function readSettlementFromToolData(data: unknown): ChapterSettlementResult | undefined {
  if (!data || typeof data !== "object") return undefined;
  const settlement = (data as { settlement?: unknown }).settlement;
  if (!settlement || typeof settlement !== "object") return undefined;
  const candidate = settlement as ChapterSettlementResult;
  return typeof candidate.status === "string" && typeof candidate.chapterNumber === "number"
    ? candidate
    : undefined;
}

/**
 * 正文落盘后发起章后结算。
 *
 * 结算被表达为一次 memory.settle_chapter 工具调用：
 * - 有宿主 dispatcher 时走真正的工具调用路径，面板可见、失败可被 agent 重试；
 * - 无宿主（CLI / 测试）时退化为进程内直接调用同一个 handler，行为一致，只是没有面板记录。
 *
 * 两条路径都不接受调用方传入正文：结算只读已落盘正文，因此「保存先于结算」是硬约束。
 * 结算失败一律不影响已保存的正文，只把失败如实报告出去。
 */
async function dispatchChapterSettlement(input: {
  readonly bookId: string;
  readonly bookRoot: string;
  readonly chapterNumber: number;
  readonly title: string;
  readonly storage: unknown;
  readonly llmExtractor?: ChapterEventExtractorInput["llmExtractor"];
  readonly kernelGenerateText?: PipelineWriteOptions["kernelGenerateText"];
  readonly dispatchToolCall?: PipelineToolCallDispatcher;
  readonly logger?: Logger;
}): Promise<PipelineSettlementDispatch> {
  const { SETTLE_CHAPTER_TOOL_NAME } = await import("./memory-settle-chapter.js");
  // 模型不可见字段（bookId/bookRoot）由可信绑定注入，这里只传领域参数。
  const toolInput = { chapterNumber: input.chapterNumber, title: input.title };

  if (input.dispatchToolCall) {
    try {
      const result = await input.dispatchToolCall({ toolName: SETTLE_CHAPTER_TOOL_NAME, input: toolInput });
      const settlement = readSettlementFromToolData(result.data);
      if (!result.ok) {
        input.logger?.warn(`[pipeline.write] ${SETTLE_CHAPTER_TOOL_NAME} failed: ${result.error ?? result.summary ?? "unknown"}`);
      }
      return {
        toolName: SETTLE_CHAPTER_TOOL_NAME,
        ok: result.ok,
        dispatched: "tool-call",
        summary: result.summary ?? (result.ok ? "章后结算完成。" : "章后结算失败。"),
        ...(result.error ? { error: result.error } : {}),
        ...(settlement ? { settlement } : {}),
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      input.logger?.warn(`[pipeline.write] ${SETTLE_CHAPTER_TOOL_NAME} dispatch threw: ${detail}`);
      return {
        toolName: SETTLE_CHAPTER_TOOL_NAME,
        ok: false,
        dispatched: "tool-call",
        summary: "章后记忆没写上：结算这一步没跑完。",
        error: detail,
      };
    }
  }

  try {
    const { handleMemorySettleChapter } = await import("./memory-settle-chapter.js");
    const result = await handleMemorySettleChapter({
      bookId: input.bookId,
      bookRoot: input.bookRoot,
      chapterNumber: input.chapterNumber,
      title: input.title,
      storage: input.storage as never,
      ...(input.llmExtractor ? { llmExtractor: input.llmExtractor } : {}),
      ...(input.kernelGenerateText ? { kernelGenerateText: input.kernelGenerateText } : {}),
    });
    if (!result.ok) {
      input.logger?.warn(`[pipeline.write] ${SETTLE_CHAPTER_TOOL_NAME} (inline) failed: ${result.error ?? result.summary}`);
    }
    return {
      toolName: SETTLE_CHAPTER_TOOL_NAME,
      ok: result.ok,
      dispatched: "inline-fallback",
      summary: result.summary,
      ...(result.error ? { error: result.error } : {}),
      ...(result.settlement ? { settlement: result.settlement } : {}),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    input.logger?.warn(`[pipeline.write] ${SETTLE_CHAPTER_TOOL_NAME} (inline) threw: ${detail}`);
    return {
      toolName: SETTLE_CHAPTER_TOOL_NAME,
      ok: false,
      dispatched: "inline-fallback",
      summary: "章后结算未能完成。",
      error: detail,
    };
  }
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

type WritingSkillComplianceWarning = Readonly<{
  skillId: string;
  skillName: string;
  checkId: string;
  rule: string;
  violation: string;
  severity: "warning" | "error";
  explanation: string;
}>;

function readWritingSkillViolations(data: unknown): WritingSkillComplianceWarning[] {
  if (!data || typeof data !== "object" || !Array.isArray((data as { violations?: unknown }).violations)) return [];
  return (data as { violations: unknown[] }).violations.filter((item): item is WritingSkillComplianceWarning => (
    Boolean(item)
    && typeof item === "object"
    && ((item as { severity?: unknown }).severity === "warning" || (item as { severity?: unknown }).severity === "error")
    && typeof (item as { skillId?: unknown }).skillId === "string"
    && typeof (item as { skillName?: unknown }).skillName === "string"
    && typeof (item as { rule?: unknown }).rule === "string"
    && typeof (item as { violation?: unknown }).violation === "string"
  ));
}

function nonEmpty(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

/**
 * Writing Skills 正文不由管线注入上下文：启用即物化到作品 `.novelfork/skills/`，
 * 由 Runtime 的 Skill 机制交给正在调用工具的 agent 自主选择读取。
 *
 * 管线只传结构化的「硬性约束摘要」（scene.spec 已把它并入 sceneSpec.constraints），
 * 摘要与出口 `writing-skills.check_compliance` 读同一份 checks，保证不出现
 * 「按摘要写却被出口拦」的分叉。
 */

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
  volumeFocusDoc?: string;
  currentFocusDoc?: string;
  narrativeContext?: NarrativeContextPackage;
  jingweiContext?: string;
  previousChapterTail?: string;
  /** T2 到期窗口伏笔（已由 collectDueHooks 筛选排序），激活 runtime/hook_debt 死管道。 */
  dueHooks?: ReadonlyArray<{ title: string; excerpt: string; dueChapter: number; armed?: boolean }>;
}>;

const NARRATIVE_SECTION_REASONS: Record<keyof NarrativeContextPackage["sections"], string> = {
  hard: "硬规则与场景约束，写的时候不能直接丢掉。",
  state: "当前角色、地点、组织和正在发生的事。",
  timeline: "最近几章与时间线，用来接上前情。",
    hooks: "还没收回的伏笔；已触发未兑现的必须本章推进。",
  facts: "已经记下的叙事事实。",
  style: "文风指南，以及按本章场景类型选出的已确认范文（只学写法）。",
  semantic: "按语义召回的相关记忆。",
  "character-kernel": "出场角色此刻的动机、情绪和矛盾。",
  "recent-summary": "最近几章的剧情摘要，用来保持前情连续。",
};

function narrativeSectionContext(narrativeContext?: NarrativeContextPackage): ContextPackage["selectedContext"] {
  if (!narrativeContext) return [];
  return (Object.entries(narrativeContext.sections) as [keyof NarrativeContextPackage["sections"], string][])
    .filter(([, excerpt]) => excerpt.trim().length > 0)
    .map(([section, excerpt]) => ({ source: `narrative-memory/${section}`, reason: NARRATIVE_SECTION_REASONS[section], excerpt }));
}

/**
 * T2 到期窗口取数：读 foreshadowing 条目，交给 selectDueHooks 纯函数筛选排序；
 * 已触发未兑现的伏笔排在最前（枪已上膛）。字典式失败容错：查不到返回空。
 */
function collectDueHooks(storage: StorageDatabase, bookId: string, currentChapter: number): Array<{ title: string; excerpt: string; dueChapter: number; armed?: boolean }> {
  try {
    const categories = getJingweiCategoryAliases("foreshadowing");
    const rows = storage.sqlite.prepare<{ title: string; content_md: string | null; fields_json: string | null }>(`
      SELECT title, content_md, fields_json
      FROM story_jingwei_entry
      WHERE book_id = ? AND category IN (${sqlInPlaceholders(categories)}) AND deleted_at IS NULL
    `).all(bookId, ...categories);

    const inputs: DueHookInput[] = rows.map((row) => {
      let fields: Record<string, unknown> = {};
      try {
        fields = JSON.parse(row.fields_json ?? "{}") as Record<string, unknown>;
      } catch {
        fields = {};
      }
      const name = typeof fields.name === "string" && fields.name.trim() ? fields.name.trim() : row.title;
      return {
        title: name,
        status: typeof fields.status === "string" ? fields.status : "已埋设",
        targetChapter: typeof fields.targetChapter === "number" ? fields.targetChapter : undefined,
        seedText: String(row.content_md ?? "").slice(0, 120) || undefined,
      };
    });
    const due = selectDueHooks(inputs, currentChapter).map((hook) => ({
      title: hook.title,
      excerpt: hook.seedText ?? "（无种子文本，详见伏笔看板）",
      dueChapter: hook.dueChapter,
    }));
    // 已触发未兑现：阶段由经纬伏笔条目 + 关联的已应用 hook 事件派生（见 foreshadow-states）
    const triggered = loadForeshadowStates(storage, bookId)
      .filter((state) => state.phase === "triggered")
      .map((state) => ({
        title: state.label,
        excerpt: state.triggerCondition || state.evidenceText || "触发条件已满足，尚未兑现",
        dueChapter: state.triggerChapter ?? currentChapter,
        armed: true,
      }));
    const seen = new Set(triggered.map((hook) => hook.title));
    return [...triggered, ...due.filter((hook) => !seen.has(hook.title))];
  } catch {
    return [];
  }
}

export function buildPipelineContextPackage(input: BuildPipelineContextPackageInput): ContextPackage {
  return {
    chapter: input.chapterNumber,
    selectedContext: [
      ...(input.authorIntentDoc ? [{ source: "story/author_intent.md", reason: "全书长视野创作意图（最高锚点，避免长篇跑偏主题）", excerpt: input.authorIntentDoc }] : []),
      // 卷目标这一层此前是空的：卷纲只进 preflight 结果与 UI 标签，从不进生成上下文，
      // 于是章节内容与本卷主线脱节。锚点顺序必须是 全书 → 本卷 → 近 1-3 章 → 本章。
      ...(input.volumeFocusDoc ? [{ source: "outline/volume", reason: "本卷目标与章号区间（本章必须服务于本卷主线，不得提前收束或越卷取材）", excerpt: input.volumeFocusDoc }] : []),
      ...(input.currentFocusDoc ? [{ source: "jingwei:current-focus", reason: "创作罗盘：本章目标 / 必须守住 / 必须避开（近 1-3 章焦点）", excerpt: input.currentFocusDoc }] : []),
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
      ...(input.dueHooks && input.dueHooks.length > 0
        ? input.dueHooks.map((hook) => ({
            source: `runtime/hook_debt#${hook.title}`,
            reason: hook.armed
              ? "已触发未兑现的伏笔（枪已上膛，本章必须推进或兑现）"
              : "本章应推进的伏笔（到期窗口内，强制关注）",
            excerpt: hook.armed
              ? `[已触发] ${hook.title} — ${hook.excerpt}`
              : `[第${hook.dueChapter}章应推进] ${hook.title} — ${hook.excerpt}`,
          }))
        : []),
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
    `- 第${event.chapterNumber}章：${event.subject} ${event.predicate} ${event.object}`,
    event.evidenceText ? `  正文依据：${event.evidenceText}` : "",
  ].filter(Boolean).join("\n")).join("\n");
  const more = highRisk.length > 5 ? `\n……另外还有 ${highRisk.length - 5} 条高风险待审。` : "";
  return `检测到 ${highRisk.length} 条高风险待审事件（只提醒，默认不拦写作；去叙事记忆面板处理）。系统不会自动改正文或经纬设定。\n${items}${more}`;
}

async function executePipelineWriteUnlocked(
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

    // 已有章节覆盖采用可选的乐观保护：旧调用方不传 hash/version 时保持兼容，
    // 传入时必须仍指向同一份正文/版本，避免并发编辑静默覆盖新稿。
    const expectedHash = nonEmpty(input.expectedHash) ?? nonEmpty(input.expectedChapterHash);
    const expectedVersion = input.expectedVersion ?? input.expectedChapterVersion;
    if (expectedHash !== undefined || expectedVersion !== undefined) {
      const { getStorageDatabase } = await import("@vivy1024/novelfork-core");
      const storage = getStorageDatabase();
      const guardedResourceService = createWritingResourceService({
        storage,
        resolveBookDir: (requestedBookId: string) => {
          if (requestedBookId !== bookId) throw new Error("Writing resource book binding mismatch");
          return bookDir;
        },
        resolveChapterVolumeDirectory: (requestedBookId, requestedChapterNumber) => resolveChapterVolumeDirectory(
          storage,
          requestedBookId,
          requestedChapterNumber,
        ),
      });
      const existing = await guardedResourceService.findAcceptedChapter(bookId, chapterNumber);
      const actualHash = existing ? createHash("sha256").update(existing.content, "utf8").digest("hex") : undefined;
      const versionMismatch = expectedVersion !== undefined && existing?.version !== expectedVersion;
      const hashMismatch = expectedHash !== undefined && actualHash !== expectedHash;
      if (!existing || versionMismatch || hashMismatch) {
        const missing = !existing;
        const reason = missing
          ? "你要覆盖的这一章已经不在正式稿里（可能被删或尚未保存成功）。"
          : "这一章的正式稿在你提交后又被改过，当前提交基于的是旧稿。";
        return {
          ok: false,
          code: "chapter-conflict",
          error: `第${chapterNumber}章没有保存。${reason}重新打开这一章看最新正文，确认后再提交。`,
          summary: "章节已被更新，未覆盖保存。",
          explanation: [
            `发生了什么：第${chapterNumber}章${missing ? "当前没有正式稿可覆盖" : "的正式稿已不是你刚才读到的那一版"}。`,
            "为什么要看：直接覆盖会丢掉别人刚改的句子，或把已删除的章节写回去。",
            "建议怎么做：重新读取这一章，核对最新正文后再提交。",
          ].join("\n"),
        };
      }
    }

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
          ...(input.acknowledgedSkills ? { acknowledgedSkills: input.acknowledgedSkills } : {}),
          ...(input.loadedSkills ? { loadedSkills: input.loadedSkills } : {}),
          taskText: sceneSpec.title ?? sceneSpec.constraints?.join(" ") ?? "",
          bookRoot: bookDir,
          cockpitState: {
            loadBookConfig: (id) => state.loadBookConfig(id),
            loadChapterIndex: (id) => state.loadChapterIndex(id),
            bookDir: (id) => state.bookDir(id),
          },
        });
        const hard = preflight.blockers.filter((item) => (
          item.code === "empty-recent-progress"
          || item.code === "book-not-found"
        ));
        if (hard.length > 0) {
          const firstBlocker = hard[0];
          const explanationText = firstBlocker?.explanation
            ? `\n${firstBlocker.explanation.whatHappened}\n${firstBlocker.explanation.whyItMatters}\n${firstBlocker.explanation.suggestedAction}`
            : "";
          const summaryMsg = hard.map((item) => item.message).join("；");
          return {
            ok: false,
            code: "context-not-ready",
            error: summaryMsg + explanationText,
            summary: summaryMsg,
            explanation: explanationText.trim(),
          };
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        logger?.error(`[pipeline.write] Context gate failed closed: ${detail}`);
        return {
          ok: false,
          code: "preflight-execution-failed",
          error: `写前上下文预检执行失败：${detail}`,
          summary: "写前上下文预检失败，已阻止生成。",
          explanation: "预检依赖未能可靠读取，继续写作可能导致章节脱离当前正史上下文；请修复存储或上下文后重试。",
        };
      }
    }
    // Writing Skills 门禁只在出口：本函数末尾按启用技能声明的 checks 校验成品，
    // 硬性违规以 writing-skill-compliance-failed 拒绝保存。入口既不要求原文引用，
    // 也不因 loadedSkills 缺失阻断——「读过」不等于「写得合规」，能判定的只有成品。
    // loadedSkills 仍会传给出口检查，用于依赖加载完整性的 warning 级提醒。


    // The persisted book setting is authoritative. SceneSpec is model-generated
    // planning input and must not lower or replace the book's hard target.
    const lengthSpec = buildLengthSpec(book.chapterWordCount, book.language === "en" ? "en" : "zh");

    // 情节点预算硬门：预算低于/超出目标必然写出不达标章节，最终撞 length-out-of-range，
    // 等于白跑一次创作生成。这里提前拒绝，让预算先修好。
    // 完全没有 beatBudget 的旧书与手写 spec 不阻断，只记 warning。
    let beatBudgetWarning: string | undefined;
    if (sceneSpec.beatBudget && sceneSpec.beatBudget.length > 0) {
      const budget = checkBeatBudget({
        chapterTarget: book.chapterWordCount,
        beats: sceneSpec.beatBudget,
      });
      const blockers = budget.findings.filter((finding) => finding.severity === "block");
      if (blockers.length > 0) {
        return {
          ok: false,
          code: "beat-budget-invalid",
          error: [
            `第${chapterNumber}章情节点预算不合规，未开始生成（${budget.budgetLine}）。`,
            ...blockers.map((finding) => [
              `- ${finding.subject}：${finding.whatHappened}`,
              `  为什么要看：${finding.whyItMatters}`,
              `  建议怎么做：${finding.suggestedAction}`,
            ].join("\n")),
            "请回到 scene.spec 重排预算后再写章；带着不合格预算进生产只会产出字数不达标的章节。",
          ].join("\n"),
        };
      }
      if (budget.findings.length > 0) {
        beatBudgetWarning = `情节点预算存在 ${budget.findings.length} 条提示：${budget.findings.map((finding) => finding.whatHappened).join(" ")}`;
        logger?.warn(`[pipeline.write] ${beatBudgetWarning}`);
      }
    } else {
      beatBudgetWarning = "本章 sceneSpec 未提供 beatBudget，章内节奏未受预算约束（旧书兼容路径）。";
      logger?.warn(`[pipeline.write] ${beatBudgetWarning}`);
    }

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
        const writingLayers = await resolveWritingLayers({ bookRoot: bookDir }).catch(() => null);
        // 结算后又被改过的章：其摘要注入时标注可能过期（现算，读失败不阻断写作）。
        const staleSummaryChapters = await readBookSettlementFreshness(storage, bookId, bookDir)
          .then((freshness) => freshness.staleChapters)
          .catch(() => [] as readonly number[]);
        // 角色声线：只注入本章出场角色、作者已确认的字段；读取失败不阻断写作。
        const sceneVoices = await loadSceneVoiceConstraints({
          storage,
          bookId,
          characterNames: sceneSpec.scenes.flatMap((scene) => scene.characters),
        }).catch((err: unknown) => {
          logger?.warn(`[pipeline.write] 角色声线读取失败，本章不注入声线：${err instanceof Error ? err.message : String(err)}`);
          return null;
        });
        if (sceneVoices && sceneVoices.corruptedIds.length > 0) {
          logger?.warn(`[pipeline.write] 角色声线数据损坏，未注入：${sceneVoices.corruptedIds.join(", ")}。请在角色卡的「声线」区块重新确认。`);
        }
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
          enabledChannels: memoryConfig?.retrieval.channels,
          waveConfig: { enabled: memoryConfig?.retrieval.waveEnabled ?? false },
          semanticConfig: { enabled: memoryConfig?.retrieval.semanticEnabled ?? false },
          ...(memoryConfig?.retrieval.semanticEnabled
            ? await (async () => {
              const embeddingConfig = await loadEmbeddingConfig(storage);
              return embeddingConfig ? { semanticProvider: createSiliconFlowEmbeddingProvider(embeddingConfig) } : {};
            })()
            : {}),
          ...(writingLayers?.bookRulesText ? { bookRulesText: writingLayers.bookRulesText } : {}),
          ...(writingLayers?.styleGuideText ? { styleGuideText: writingLayers.styleGuideText } : {}),
          ...(writingLayers?.stylePreset ? { stylePreset: writingLayers.stylePreset } : {}),
          ...(sceneVoices?.text ? { voiceConstraints: sceneVoices.text } : {}),
          ...(staleSummaryChapters.length > 0 ? { staleSummaryChapters } : {}),
          ...(writingLayers?.bookDesignText ? { bookDesignText: writingLayers.bookDesignText } : {}),
          // 角色内核：config.characterKernel.enabled=false（默认）时通道内部直接跳过。
          ...(memoryConfig?.characterKernel ? { characterKernelConfig: memoryConfig.characterKernel } : {}),
          ...(memoryConfig?.retrieval.writeProfile ? { writeProfileCaps: memoryConfig.retrieval.writeProfile } : {}),
        });
      } catch (err) {
        logger?.warn(`[pipeline.write] Failed to build NarrativeContextPackage, falling back to legacy context: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // P0-2: 加载控制文档（全书长视野意图 + 近 1-3 章焦点），注入写作上下文。
    // 此前 author_intent 只被 planner 消化成 goal，原文不进 writer 上下文 → 长篇易跑偏。
    let authorIntentDoc = "";
    let currentFocusDoc = "";
    let volumeRanges: ReadonlyArray<{ readonly from: number; readonly to: number }> | undefined;
    try {
      const { getStorageDatabase } = await import("@vivy1024/novelfork-core");
      const compass = readCurrentFocusDocFromStorage(getStorageDatabase(), bookId);
      if (compass) currentFocusDoc = truncateDoc(compass);
    } catch (err) {
      logger?.warn(`[pipeline.write] Failed to load jingwei current-focus: ${err}`);
    }
    try {
      const ctrl = await state.loadControlDocuments(bookId);
      authorIntentDoc = truncateDoc(ctrl.authorIntent);
      if (!currentFocusDoc) {
        const markdownFocus = truncateDoc(ctrl.currentFocus);
        currentFocusDoc = isPlaceholderFocusDoc(markdownFocus) ? "" : markdownFocus;
      }
    } catch (err) {
      logger?.warn(`[pipeline.write] Failed to load control documents: ${err}`);
    }

    // 卷目标层：卷纲此前只出现在 preflight 结果与 UI 标签里，从不进生成上下文。
    // 章号越界是客观可判定的，直接硬拦；卷目标本身作为上下文交给模型理解。
    let volumeFocusDoc = "";
    try {
      const { getStorageDatabase } = await import("@vivy1024/novelfork-core");
      const { loadCurrentVolumeContext, renderCurrentVolumeFocus } = await import("./outline-volume.js");
      const volumeContext = loadCurrentVolumeContext(getStorageDatabase(), bookId, chapterNumber);
      const ranges = volumeContext.volumes.map((volume) => volume.chapterRange);
      volumeRanges = ranges.length > 0 ? ranges : undefined;
      volumeFocusDoc = renderCurrentVolumeFocus(volumeContext, chapterNumber);
      if (volumeContext.inRange === false && volumeContext.current) {
        const { from, to } = volumeContext.current.chapterRange;
        const owner = volumeContext.volumes.find(
          (volume) => chapterNumber >= volume.chapterRange.from && chapterNumber <= volume.chapterRange.to,
        );
        return {
          ok: false,
          code: "volume-range-violation",
          error: [
            `发生了什么：第 ${chapterNumber} 章不在当前卷《${volumeContext.current.title}》的区间（第 ${from}-${to} 章）内。`,
            owner
              ? `为什么要看：该章号属于《${owner.title}》（第 ${owner.chapterRange.from}-${owner.chapterRange.to} 章）。带着错卷的目标写下去，本章会服务于错误的主线，卷末收束时必然对不上。`
              : `为什么要看：该章号不属于任何已规划的卷，写下去这一章不受任何卷目标约束，卷纲与正文会彻底脱节。`,
            owner
              ? `建议怎么做：用 outline.volume 把《${owner.title}》的 status 设为 active，或修正卷区间后重写本章。`
              : `建议怎么做：用 outline.volume 扩展卷区间覆盖第 ${chapterNumber} 章，或先补一卷再写。`,
          ].join("\n"),
        };
      }
    } catch (err) {
      logger?.warn(`[pipeline.write] Failed to load volume focus: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Build structured ContextPackage (优先 Narrative Memory，保留 legacy jingweiContext 兼容路径)
    // T2：到期窗口伏笔注入——激活 runtime/hook_debt 渲染管道（writer/reviser 的 Hook Debt 简报）。
    let dueHooks: ReadonlyArray<{ title: string; excerpt: string; dueChapter: number }> = [];
    try {
      const { getStorageDatabase } = await import("@vivy1024/novelfork-core");
      dueHooks = collectDueHooks(getStorageDatabase(), bookId, chapterNumber);
      if (dueHooks.length > 0) {
        logger?.info(`[pipeline.write] Due hooks in window: ${dueHooks.map((hook) => `${hook.title}@${hook.dueChapter}`).join(", ")}`);
      }
    } catch (err) {
      logger?.warn(`[pipeline.write] Due hooks lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const contextPackage = buildPipelineContextPackage({
      chapterNumber,
      sceneSpec,
      authorIntentDoc,
      volumeFocusDoc,
      currentFocusDoc,
      narrativeContext,
      jingweiContext,
      previousChapterTail,
      dueHooks,
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

    const governedContent = input.content.trim();
    if (!governedContent) {
      return { ok: false, code: "generation-failed", error: "pipeline.write 收到空正文；正文必须由当前 Runtime Agent 显式提交。" };
    }
    const writeOutput = {
      content: governedContent,
      title: sceneSpec.title?.trim() || `第${chapterNumber}章`,
      runtimeStateDelta: undefined,
    };
    const lengthWarning: string | undefined = undefined;
    logger?.info(`[pipeline.write] Runtime Agent content received: "${writeOutput.title}"`);

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

    // 3. 确定性审计：同一 Runtime Agent 已提交正文，工具只检查，不另开 Auditor/Reviser 模型。
    const auditV2 = handleChapterAuditV2({
      bookId,
      chapterNumber,
      content: governedContent,
      sceneSpec,
      wordTarget: book.chapterWordCount,
    });
    const auditResult: AuditResult = {
      passed: auditV2.passed,
      issues: [...auditV2.hardViolations, ...auditV2.softViolations].map((issue) => ({
        severity: issue.severity === "hard" ? "critical" : "warning",
        category: issue.ruleId,
        description: issue.description,
        suggestion: issue.suggestion ?? "请由当前 Runtime Agent 根据审计结果修订后重新提交。",
      })),
      summary: auditV2.summary,
    };
    let finalContent = governedContent;
    const revised = false;
    const reviseRounds = 0;
    const factCheckRevised = false;
    const factCheckRound = 0;
    // 正式保存前只做长度硬校验；超出范围时返回错误，交由同一 Runtime Agent 修订后重试。
    const finalLengthCount = countChapterLength(finalContent, lengthSpec.countingMode);
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

    let writingSkillWarnings: WritingSkillComplianceWarning[] = [];
    try {
      const compliance = await handleWritingSkillsCheckCompliance(
        {
          bookId,
          chapterNumber,
          content: finalContent,
          ...(input.loadedSkills ? { loadedSkills: input.loadedSkills } : {}),
        },
        { bookRoot: bookDir },
      );
      if (!compliance.ok) {
        return { ok: false, code: "writing-skill-compliance-failed", error: compliance.summary };
      }
      const violations = readWritingSkillViolations(compliance.data);
      const errors = violations.filter((violation) => violation.severity === "error");
      if (errors.length > 0) {
        return {
          ok: false,
          code: "writing-skill-compliance-failed",
          error: `第${chapterNumber}章触发 ${errors.length} 条写作技能硬性违规；未保存正式章节。${errors.map((violation) => ` ${violation.skillName}：${violation.violation}`).join("")}`,
        };
      }
      writingSkillWarnings = violations.filter((violation) => violation.severity === "warning");
    } catch (error) {
      return {
        ok: false,
        code: "writing-skill-compliance-failed",
        error: `写作技能合规检查失败，拒绝保存正式章节：${error instanceof Error ? error.message : String(error)}`,
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
          knowledgeWarnings = violations.map((v) => `${povCharacterId} 在第${chapterNumber}章已经用到「${v.fact}」，但这件事要到第${v.learnedAtChapter}章才学到。`);
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
    if (needsHumanReview) publishWarnings.push("审计仍有必须先改或建议修订的问题，建议人工复核后再发布。");
    if (factCheckRevised) publishWarnings.push("已执行事实/连续性专项修订，请抽查关键事实。");
    if (writingSkillWarnings.length > 0) {
      // 逐条列出违反了哪个技能的哪条要求：只报数量作者无法据此改稿。
      for (const violation of writingSkillWarnings) {
        publishWarnings.push(`写作技能「${violation.skillName}」：${violation.violation}`);
      }
    }
    if (knowledgeWarnings.length > 0) {
      publishWarnings.push(`人物不该提前知道的事（${knowledgeWarnings.length} 条）：`);
      publishWarnings.push(...knowledgeWarnings);
    }
    if (timelineWarnings.length > 0) {
      publishWarnings.push(`故事时间对不上（${timelineWarnings.length} 条）：`);
      publishWarnings.push(...timelineWarnings);
    }

    let publishStatus: "ready" | "has-warnings" | "needs-review" | "skipped" = "ready";
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
          publishWarnings.push(`${publishResult.platformLabel}：发现 ${publishResult.blockCount} 条高风险线索，建议人工复核。`);
        }
        if (publishResult.warnCount > 0) {
          publishWarnings.push(`${publishResult.platformLabel}：发现 ${publishResult.warnCount} 条投稿风险提醒。`);
        }
        if (publishResult.chapterTarget?.message) publishWarnings.push(publishResult.chapterTarget.message);
      } else {
        publishStatus = "skipped";
      }
    } catch (publishError) {
      publishStatus = "skipped";
      logger?.debug(`[pipeline.write] Publish check skipped: ${publishError instanceof Error ? publishError.message : String(publishError)}`);
    }

    // 章后结算发生在正文落盘之后，因此保存前的 publishHint 不可能包含结算结果。
    // 结算失败通过返回值的 settlementError / narrativeSettlement 字段如实报告。
    const hintWarnings = [
      ...publishWarnings,
      ...(beatBudgetWarning ? [beatBudgetWarning] : []),
    ];
    const publishHint = {
      status: (hintWarnings.length > 0 && publishStatus === "ready" ? "has-warnings" : publishStatus) as "ready" | "has-warnings" | "needs-review" | "skipped",
      warnings: hintWarnings,
      ...(publishPlatform ? { platform: publishPlatform } : {}),
    };

    // 4. Save as formal chapter result
    const chapterId = `chapter:${chapterNumber}`;
    let narrativeSettlement: ChapterSettlementResult | undefined;
    let settlementDispatch: PipelineSettlementDispatch | undefined;
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
        resolveChapterVolumeDirectory: (requestedBookId, requestedChapterNumber) => resolveChapterVolumeDirectory(
          storage,
          requestedBookId,
          requestedChapterNumber,
        ),
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
        ...(writingSkillWarnings.length > 0 ? { writingSkillWarnings } : {}),
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

      // 文风金库：留一份 AI 原稿，作者之后的修改与它逐句比对得出人工占比。失败不影响已落盘正文。
      await saveChapterAiDraft(bookDir, { chapterNumber, text: finalContent, source: "pipeline.write" }).catch((vaultErr: unknown) => {
        logger?.warn?.(`[pipeline.write] 第 ${chapterNumber} 章 AI 原稿未保存（人工占比将无法计算）: ${vaultErr instanceof Error ? vaultErr.message : String(vaultErr)}`);
      });

      // 场景落盘：写前蓝图 SceneSpec 转成持久化 narrative_scene，正文写完后场景进入承载树。
      // 重写同一章只刷新机器产出且作者没动过的场景，作者建的、确认过的、挂了线的都保留。
      // 场景是结构化附产物，失败不回滚已落盘的正文，但必须留下告警，不能静默丢掉。
      if (sceneSpec?.scenes && sceneSpec.scenes.length > 0) {
        try {
          const sceneInputs = sceneSpec.scenes.map((spec, index) =>
            sceneFromSpec(bookId, chapterNumber, index + 1, spec, {
              source: "workflow",
              layer: "dynamic",
              status: "needs-review",
            }),
          );
          const sceneResult = replaceChapterScenes(storage, bookId, chapterNumber, sceneInputs);
          if (!sceneResult.ok) {
            logger?.warn?.(`[pipeline.write] 第 ${chapterNumber} 章场景落盘失败: ${sceneResult.summary}`);
          }
        } catch (sceneErr) {
          logger?.warn?.(`[pipeline.write] 第 ${chapterNumber} 章场景落盘失败: ${sceneErr instanceof Error ? sceneErr.message : String(sceneErr)}`);
        }
      }

      // 章后结算不再是本函数内的隐式副作用：正文落盘成功后，由管线显式发起一次
      // memory.settle_chapter 工具调用。这样结算过程走工具调用路径，在叙述者面板
      // 可见（renderer: narrative-memory.admin），失败也是一次工具调用失败，agent
      // 天然会重试，而不是靠返回字段里一句人话提示。
      //
      // 顺序保证由数据依赖强制：settle_chapter 只结算已落盘正文，读不到就拒绝结算。
      // 保存成功了才可能结算成功，不存在「记忆更新了但正文没保存」。
      settlementDispatch = await dispatchChapterSettlement({
        bookId,
        bookRoot: bookDir,
        chapterNumber,
        title: writeOutput.title,
        storage,
        ...(options.llmExtractor ? { llmExtractor: options.llmExtractor } : {}),
        // 角色内核重算：优先走 dispatch 路径的宿主能力，否则退回管线直传的 kernelGenerateText。
        ...(options.kernelGenerateText ? { kernelGenerateText: options.kernelGenerateText } : {}),
        ...(options.dispatchToolCall ? { dispatchToolCall: options.dispatchToolCall } : {}),
        ...(logger ? { logger } : {}),
      });
      narrativeSettlement = settlementDispatch.settlement;

      // T4b：审计落盘——auditResult 明细+正文指纹随正式章保存写入 chapter_audit_log，
      // 激活审计 issue 生命周期（此前 persistChapterAuditLog 是死管道无人调用）。
      try {
        persistChapterAuditLog(storage, {
          bookId,
          chapterNumber,
          auditResult,
          content: finalContent,
        });
      } catch (err) {
        logger?.warn(`[pipeline.write] 审计日志落盘失败（不影响章节）：${err instanceof Error ? err.message : String(err)}`);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      logger?.error(`[pipeline.write] Failed to save formal chapter: ${detail}`);
      return {
        ok: false,
        code: "generation-failed",
        error: `正式章节落盘失败，未返回成功：${detail}`,
        summary: "正式章节保存失败。",
        explanation: "正文未能可靠写入正式章节文件/索引；请修复存储后重试，不能把未落盘结果当作成功。",
      };
    }

    const wordCount = finalLengthCount;

    // 上下文来源：把已经注入 prompt 的 selectedContext 如实回传（只给来源/理由/字符数）。
    const contextSources = contextPackage.selectedContext.map((item) => ({
      source: item.source,
      reason: item.reason,
      chars: item.excerpt?.length ?? 0,
    }));

    // 管线阶段：逐项由上面真实算出的状态推导，没有依据的阶段不输出。
    const pipelineStages: {
      readonly stage: string;
      readonly status: "ok" | "skipped" | "warning" | "failed";
      readonly detail?: string;
    }[] = [
      skipContextGate
        ? { stage: "写前预检", status: "skipped", detail: "这次按调用方要求跳过了写前检查" }
        : { stage: "写前预检", status: "ok", detail: "硬门槛已经通过" },
      beatBudgetWarning
        ? { stage: "情节点预算", status: "warning", detail: beatBudgetWarning }
        : { stage: "情节点预算", status: "ok", detail: sceneSpec.beatBudget ? `${sceneSpec.beatBudget.length} 个情节点` : undefined },
      { stage: "正文接收", status: "ok", detail: `${finalLengthCount}${lengthSpec.countingMode === "en_words" ? " words" : "字"}（目标 ${lengthSpec.target}）` },
      {
        stage: "一致性审计",
        status: auditResult.passed ? "ok" : "warning",
        detail: `严重 ${auditIssueCategories.critical} / 提醒 ${auditIssueCategories.warning} / 备忘 ${auditIssueCategories.info}`,
      },
      {
        stage: "严重度门禁",
        status: needsHumanReview ? "warning" : "ok",
        detail: `必须先改 ${finalGate.counts.S1} / 建议修订 ${finalGate.counts.S2}`,
      },
      writingSkillWarnings.length > 0
        ? { stage: "技能合规", status: "warning", detail: `${writingSkillWarnings.length} 条技能提醒` }
        : { stage: "技能合规", status: "ok" },
      ...(knowledgeWarnings.length > 0 || timelineWarnings.length > 0
        ? [{
            stage: "人物知情 / 时间线",
            status: "warning" as const,
            detail: [
              ...(knowledgeWarnings.length > 0 ? [`有人提前知道了还不该知道的事（${knowledgeWarnings.length}）`] : []),
              ...(timelineWarnings.length > 0 ? [`后面章节的时间早于前面（${timelineWarnings.length}）`] : []),
            ].join("；"),
          }]
        : []),
      {
        stage: "发布检查",
        status: publishHint.status === "skipped"
          ? "skipped"
          : publishHint.status === "ready" ? "ok" : "warning",
        detail: [
          publishHint.platform ? `平台 ${publishHint.platform}` : undefined,
          publishHint.status === "ready" ? "可以发布"
            : publishHint.status === "has-warnings" ? "有提醒"
            : publishHint.status === "needs-review" ? "需要复核"
            : "本次未检查",
        ].filter(Boolean).join(" · "),
      },
      { stage: "正文落盘", status: "ok", detail: `第${chapterNumber}章已保存` },
      ...(settlementDispatch
        ? [{
            stage: "章后结算",
            status: (settlementDispatch.ok ? "ok" : "failed") as "ok" | "failed",
            detail: settlementDispatch.ok
              ? "本章记忆已跟上"
              : (isAuthorFacingDetail(settlementDispatch.summary)
                ? settlementDispatch.summary
                : "章后记忆没写上"),
          }]
        : [{ stage: "章后结算", status: "skipped" as const, detail: "本次未派发结算" }]),
    ];

    return {
      ok: true,
      bookId,
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
      contextSources,
      pipelineStages,
      ...(needsHumanReview ? { needsHumanReview: true } : {}),
      ...(lengthWarning ? { lengthWarning } : {}),
      ...(highRiskPendingReminder ? { highRiskPendingReminder } : {}),
      ...(narrativeSettlement ? { narrativeSettlement } : {}),
      ...(settlementDispatch ? { settlementDispatch } : {}),
      ...(settlementDispatch && !settlementDispatch.ok
        ? {
            settlementError: composeAuthorSettlementError(settlementDispatch),
          }
        : {}),
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

/**
 * 书级写锁包住从取章号到正式章节保存、章后结算 dispatch 的完整临界区。
 * 旧调用方无需显式传 lock；锁竞争/获取失败返回机器可判断的 book-locked。
 */
export async function executePipelineWrite(
  input: PipelineWriteInput,
  options: PipelineWriteOptions,
): Promise<PipelineWriteResult> {
  const state = createPipelineState(options, input.bookId);
  let release: (() => Promise<void>) | undefined;
  try {
    release = await state.acquireBookLock(input.bookId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    options.logger?.warn(`[pipeline.write] book lock acquisition failed: ${detail}`);
    return {
      ok: false,
      code: "book-locked",
      error: detail,
      summary: "本书正在被另一写入任务使用，未保存章节。",
    };
  }

  try {
    return await executePipelineWriteUnlocked(input, options);
  } finally {
    if (release) {
      try {
        await release();
      } catch (error) {
        options.logger?.warn(`[pipeline.write] book lock release failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
