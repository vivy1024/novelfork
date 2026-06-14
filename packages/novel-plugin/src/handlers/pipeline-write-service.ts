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
import { StateManager, buildLengthSpec, countChapterLength, chooseNormalizeMode, isOutsideHardRange } from "@vivy1024/novelfork-core";
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
import { randomUUID } from "node:crypto";
import type { CanvasArtifact } from "@vivy1024/novelfork-studio/shared/agent-native-workspace";
import type { SceneSpec } from "./scene-spec-handler.js";
import { handleChapterAuditV2 } from "./chapter-audit-v2.js";

export interface PipelineWriteInput {
  readonly bookId: string;
  readonly sceneSpec: SceneSpec;
  readonly jingweiContext?: string;
  readonly previousChapterTail?: string;
  readonly autoRevise?: boolean;
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
  readonly candidateId: string;
  readonly artifact: CanvasArtifact;
  /** 长度治理：归一化后仍漂出 hard 区间时的警告（不阻断） */
  readonly lengthWarning?: string;
  /** 多轮自愈达上限仍有 critical → 需人工复核（Human Review Gate） */
  readonly needsHumanReview?: boolean;
  /** 实际执行的修订轮数 */
  readonly reviseRounds?: number;
}

export interface PipelineWriteError {
  readonly ok: false;
  readonly code: "book-not-found" | "spec-invalid" | "generation-failed" | "timeout";
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

/** 截断控制文档到合理预算（~800 字），避免长视野文档占用过多上下文 */
function truncateDoc(text: string, maxChars = 800): string {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars).trimEnd() + "…";
}

export async function executePipelineWrite(
  input: PipelineWriteInput,
  options: PipelineWriteOptions,
): Promise<PipelineWriteResult> {
  const { bookId, sceneSpec, jingweiContext, previousChapterTail, autoRevise = true, adversarialAudit = false, maxReviseRounds = 1 } = input;
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

    // Build structured ContextPackage (修复：此前传字符串 + as any，导致 Writer 的
    // buildGovernedMemoryEvidenceBlocks 对字符串调 .selectedContext.filter 崩溃)
    const contextPackage: ContextPackage = {
      chapter: chapterNumber,
      selectedContext: [
        ...(authorIntentDoc ? [{ source: "story/author_intent.md", reason: "全书长视野创作意图（最高锚点，避免长篇跑偏主题）", excerpt: authorIntentDoc }] : []),
        ...(currentFocusDoc ? [{ source: "story/current_focus.md", reason: "近 1-3 章焦点，本章应优先推进的方向", excerpt: currentFocusDoc }] : []),
        { source: "scene.spec", reason: "本章结构化写作蓝图", excerpt: JSON.stringify(sceneSpec) },
        ...(jingweiContext ? [{ source: "jingwei", reason: "经纬上下文：人物/设定/伏笔/前情", excerpt: jingweiContext }] : []),
        ...(previousChapterTail ? [{ source: "prev_chapter_tail", reason: "前章末尾，保持开篇连贯", excerpt: previousChapterTail }] : []),
      ],
    };

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

    // 4. Save as candidate
    const candidateId = `pipeline-write-${randomUUID()}`;
    try {
      const { getStorageDatabase } = await import("@vivy1024/novelfork-core");
      const storage = getStorageDatabase();
      const resourceService = createWritingResourceService({ storage });
      resourceService.create({
        id: candidateId,
        bookId,
        type: "draft",
        status: "candidate",
        title: writeOutput.title,
        content: finalContent,
        chapterNumber,
        source: "pipeline.write",
        metadata: {
          sceneSpec,
          auditResult: { passed: auditResult.passed, issueCount: auditResult.issues.length },
          revised,
          reviseRounds,
          ...(needsHumanReview ? { needsHumanReview: true } : {}),
          ...(adversarialAudit ? { adversarialAudit: true } : {}),
          ...(lengthWarning ? { lengthWarning } : {}),
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      logger?.warn(`[pipeline.write] Failed to save candidate: ${err}`);
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
      candidateId,
      reviseRounds,
      ...(needsHumanReview ? { needsHumanReview: true } : {}),
      ...(lengthWarning ? { lengthWarning } : {}),
      artifact: {
        id: candidateId,
        kind: "candidate-chapter",
        title: `${writeOutput.title}（候选稿）`,
        openInCanvas: true,
        metadata: { bookId, chapterNumber, source: "pipeline.write" },
      },
    };
  } catch (err) {
    return { ok: false, code: "generation-failed", error: `写作管线执行失败: ${err instanceof Error ? err.message : String(err)}` };
  }
}
