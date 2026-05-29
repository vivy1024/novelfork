/**
 * Pipeline Generate Service — 将 Pipeline Agent 能力封装为 session tool 可调用的函数。
 *
 * 内部调用顺序：
 * 1. Composer.composeChapter() — 组装上下文包
 * 2. Writer.writeChapter() — 生成正文 (creative + settle)
 * 3. Auditor.auditChapter() — 37 维度审计
 * 4. Reviser.reviseChapter() — 自动修订 (条件触发)
 * 5. StateValidator.validate() — 经纬一致性校验
 */

import type { LLMClient, OnStreamProgress, Logger } from "@vivy1024/novelfork-core";
import { createLLMClient, StateManager } from "@vivy1024/novelfork-core";
import { buildLengthSpec, countChapterLength } from "@vivy1024/novelfork-core";
import type { BookConfig, LengthSpec } from "@vivy1024/novelfork-core";
import type { AgentContext } from "../engine/agents/base.js";
import type { AuditResult, AuditIssue } from "../engine/agents/continuity.js";
import type { WriteChapterOutput } from "../engine/agents/writer.js";
import type { ValidationResult } from "../engine/agents/state-validator.js";
import { ComposerAgent } from "../engine/agents/composer.js";
import { WriterAgent } from "../engine/agents/writer.js";
import { ContinuityAuditor } from "../engine/agents/continuity.js";
import { ReviserAgent } from "../engine/agents/reviser.js";
import { StateValidatorAgent } from "../engine/agents/state-validator.js";
import { PlannerAgent } from "../engine/agents/planner.js";
import type { CanvasArtifact } from "@vivy1024/novelfork-studio/shared/agent-native-workspace";
import { createWritingResourceService } from "../engine/writing-resource/service.js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineGenerateInput {
  readonly bookId: string;
  readonly chapterIntent: string;
  readonly userDirectives?: string;
  readonly wordCount?: number;
  readonly autoRevise?: boolean;
}

export interface JingweiDeltaEntry {
  readonly title: string;
  readonly category: string;
  readonly contentMd: string;
}

export interface JingweiDelta {
  readonly updated: ReadonlyArray<JingweiDeltaEntry>;
  readonly created: ReadonlyArray<JingweiDeltaEntry>;
  readonly warnings: ReadonlyArray<string>;
}

export interface PipelineGenerateOutput {
  readonly ok: true;
  readonly content: string;
  readonly title: string;
  readonly wordCount: number;
  readonly chapterNumber: number;
  readonly auditResult: AuditResult;
  readonly revised: boolean;
  readonly validationResult: ValidationResult | null;
  readonly jingweiDelta: JingweiDelta;
  readonly candidateId: string;
  readonly artifact: CanvasArtifact;
}

export interface PipelineGenerateError {
  readonly ok: false;
  readonly code: "book-not-found" | "llm-config-missing" | "generation-failed" | "timeout";
  readonly error: string;
}

export type PipelineGenerateResult = PipelineGenerateOutput | PipelineGenerateError;

export interface PipelineGenerateOptions {
  readonly root: string;
  readonly client: LLMClient;
  readonly model: string;
  readonly onStream?: (chunk: string) => void;
  readonly logger?: Logger;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAgentCtx(
  options: PipelineGenerateOptions,
  agentName: string,
  bookId: string,
): AgentContext {
  return {
    client: options.client,
    model: options.model,
    projectRoot: options.root,
    bookId,
    logger: options.logger,
    onStreamProgress: options.onStream
      ? (progress) => {
          // Convert StreamProgress to simple string chunks for tool output stream
          if (progress.status === "streaming" && progress.totalChars > 0) {
            // onStream is called with accumulated info; we don't have per-chunk text here.
            // The actual streaming is handled by the LLM client internally.
          }
        }
      : undefined,
  };
}

function buildJingweiDeltaFromOutput(output: WriteChapterOutput): JingweiDelta {
  const created: JingweiDeltaEntry[] = [];
  const updated: JingweiDeltaEntry[] = [];
  const warnings: string[] = [];

  // Extract chapter summary as a created entry
  if (output.chapterSummary?.trim()) {
    created.push({
      title: `第${output.chapterNumber}章摘要`,
      category: "chapter-summary",
      contentMd: output.chapterSummary,
    });
  }

  // Extract state delta if available
  if (output.runtimeStateDelta) {
    const delta = output.runtimeStateDelta;
    // runtimeStateDelta contains structured changes; convert to jingwei entries
    if (typeof delta === "object" && delta !== null) {
      const deltaObj = delta as Record<string, unknown>;
      if (deltaObj.newCharacters && Array.isArray(deltaObj.newCharacters)) {
        for (const char of deltaObj.newCharacters as Array<{ name?: string; description?: string }>) {
          if (char.name) {
            created.push({
              title: char.name,
              category: "character",
              contentMd: char.description ?? `新角色：${char.name}`,
            });
          }
        }
      }
      if (deltaObj.updatedCharacters && Array.isArray(deltaObj.updatedCharacters)) {
        for (const char of deltaObj.updatedCharacters as Array<{ name?: string; changes?: string }>) {
          if (char.name) {
            updated.push({
              title: char.name,
              category: "character",
              contentMd: char.changes ?? `角色状态更新`,
            });
          }
        }
      }
      if (deltaObj.newForeshadowing && Array.isArray(deltaObj.newForeshadowing)) {
        for (const hook of deltaObj.newForeshadowing as Array<{ description?: string }>) {
          if (hook.description) {
            created.push({
              title: hook.description.slice(0, 50),
              category: "foreshadowing",
              contentMd: hook.description,
            });
          }
        }
      }
    }
  }

  // Collect post-write warnings
  for (const w of output.postWriteWarnings ?? []) {
    warnings.push(`${w.rule}: ${w.description}`);
  }
  for (const issue of output.hookHealthIssues ?? []) {
    if (issue.severity === "critical" || issue.severity === "warning") {
      warnings.push(`${issue.category}: ${issue.description}`);
    }
  }

  return { created, updated, warnings };
}

function buildCandidateArtifact(
  candidateId: string,
  title: string,
  _content: string,
  bookId: string,
  chapterNumber: number,
): CanvasArtifact {
  return {
    id: candidateId,
    kind: "candidate-chapter",
    title: `${title}（候选稿）`,
    openInCanvas: true,
    metadata: {
      bookId,
      chapterNumber,
      source: "pipeline.generate_chapter",
    },
  };
}

// ---------------------------------------------------------------------------
// Core execution
// ---------------------------------------------------------------------------

export async function executePipelineGenerate(
  input: PipelineGenerateInput,
  options: PipelineGenerateOptions,
): Promise<PipelineGenerateResult> {
  const { bookId, chapterIntent, userDirectives, wordCount, autoRevise = true } = input;
  const { root, logger } = options;

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
    const chapterNumber = await state.getNextChapterNumber(bookId);
    const lengthSpec = buildLengthSpec(wordCount ?? book.chapterWordCount);

    logger?.info(`[pipeline.generate_chapter] Starting for book=${bookId} chapter=${chapterNumber}`);

    // 2. Planner — build plan from intent
    const plannerCtx = buildAgentCtx(options, "planner", bookId);
    const planner = new PlannerAgent(plannerCtx);
    const plan = await planner.planChapter({
      book,
      bookDir,
      chapterNumber,
      externalContext: userDirectives,
    });

    // 3. Composer — assemble context package
    const composerCtx = buildAgentCtx(options, "composer", bookId);
    const composer = new ComposerAgent(composerCtx);
    const composed = await composer.composeChapter({
      book,
      bookDir,
      chapterNumber,
      plan,
    });

    // 4. Writer — generate chapter (creative + settle)
    const writerCtx = buildAgentCtx(options, "writer", bookId);
    const writer = new WriterAgent(writerCtx);
    const writeOutput = await writer.writeChapter({
      book,
      bookDir,
      chapterNumber,
      chapterIntent,
      contextPackage: composed.contextPackage,
      ruleStack: composed.ruleStack,
      externalContext: userDirectives,
      lengthSpec,
    });

    logger?.info(`[pipeline.generate_chapter] Writer done: "${writeOutput.title}" ${writeOutput.wordCount} words`);

    // 5. Auditor — 37-dimension audit
    const auditorCtx = buildAgentCtx(options, "auditor", bookId);
    const auditor = new ContinuityAuditor(auditorCtx);
    let auditResult = await auditor.auditChapter(
      bookDir,
      writeOutput.content,
      chapterNumber,
      book.genre,
      {
        chapterIntent,
        contextPackage: composed.contextPackage,
        ruleStack: composed.ruleStack,
      },
    );

    // 6. Reviser — auto-fix critical issues (if enabled)
    let finalContent = writeOutput.content;
    let revised = false;

    if (!auditResult.passed && autoRevise) {
      const criticalIssues = auditResult.issues.filter((i) => i.severity === "critical");
      if (criticalIssues.length > 0) {
        logger?.info(`[pipeline.generate_chapter] Revising: ${criticalIssues.length} critical issues`);
        const reviserCtx = buildAgentCtx(options, "reviser", bookId);
        const reviser = new ReviserAgent(reviserCtx);
        const reviseOutput = await reviser.reviseChapter(
          bookDir,
          finalContent,
          chapterNumber,
          criticalIssues,
          "spot-fix",
          book.genre,
          {
            chapterIntent,
            contextPackage: composed.contextPackage,
            ruleStack: composed.ruleStack,
            lengthSpec,
          },
        );
        finalContent = reviseOutput.revisedContent;
        revised = true;

        // Re-audit after revision
        auditResult = await auditor.auditChapter(
          bookDir,
          finalContent,
          chapterNumber,
          book.genre,
          {
            chapterIntent,
            contextPackage: composed.contextPackage,
            ruleStack: composed.ruleStack,
          },
        );
        logger?.info(`[pipeline.generate_chapter] Post-revision audit: passed=${auditResult.passed}`);
      }
    }

    // 7. StateValidator — verify jingwei consistency
    let validationResult: ValidationResult | null = null;
    if (writeOutput.updatedState && writeOutput.updatedHooks) {
      try {
        const validatorCtx = buildAgentCtx(options, "state-validator", bookId);
        const validator = new StateValidatorAgent(validatorCtx);
        const oldStatePath = join(bookDir, "jingwei", "current_state.md");
        const oldHooksPath = join(bookDir, "jingwei", "pending_hooks.md");
        let oldState = "";
        let oldHooks = "";
        try { oldState = await readFile(oldStatePath, "utf-8"); } catch { /* empty */ }
        try { oldHooks = await readFile(oldHooksPath, "utf-8"); } catch { /* empty */ }

        validationResult = await validator.validate(
          finalContent,
          chapterNumber,
          oldState,
          writeOutput.updatedState,
          oldHooks,
          writeOutput.updatedHooks,
        );
      } catch (err) {
        logger?.warn(`[pipeline.generate_chapter] StateValidator failed: ${err}`);
      }
    }

    // 8. Build jingwei delta
    const jingweiDelta = buildJingweiDeltaFromOutput(writeOutput);

    // 9. Save as candidate resource
    const candidateId = `pipeline-candidate-${randomUUID()}`;
    const timestamp = Date.now();

    try {
      const { getStorageDatabase } = await import("@vivy1024/novelfork-core");
      const storage = getStorageDatabase();
      const resourceService = createWritingResourceService({ storage });
      resourceService.create({
        id: candidateId,
        bookId,
        type: "candidate",
        status: "candidate",
        title: writeOutput.title,
        content: finalContent,
        chapterNumber,
        source: "pipeline.generate_chapter",
        metadata: {
          chapterIntent,
          jingweiDelta,
          auditResult: { passed: auditResult.passed, issueCount: auditResult.issues.length },
          revised,
          generatedAt: new Date(timestamp).toISOString(),
        },
      });
    } catch (err) {
      logger?.warn(`[pipeline.generate_chapter] Failed to persist candidate: ${err}`);
      // Non-fatal: we still return the content
    }

    // 10. Build artifact for canvas display
    const artifact = buildCandidateArtifact(
      candidateId,
      writeOutput.title,
      finalContent,
      bookId,
      chapterNumber,
    );

    const finalWordCount = countChapterLength(finalContent, lengthSpec.countingMode);

    return {
      ok: true,
      content: finalContent,
      title: writeOutput.title,
      wordCount: finalWordCount,
      chapterNumber,
      auditResult,
      revised,
      validationResult,
      jingweiDelta,
      candidateId,
      artifact,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger?.error(`[pipeline.generate_chapter] Failed: ${message}`);

    if (/api[_ -]?key|NOVELFORK_LLM/i.test(message)) {
      return { ok: false, code: "llm-config-missing", error: "模型配置未完成，请先配置 API Key。" };
    }
    if (/timeout|abort/i.test(message)) {
      return { ok: false, code: "timeout", error: `生成超时：${message}` };
    }
    return { ok: false, code: "generation-failed", error: message };
  }
}
