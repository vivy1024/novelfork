/**
 * Pipeline Write Service (v2) — 精简管线：SceneSpec → Writer → AuditRevise
 *
 * 与旧 executePipelineGenerate 的区别：
 * - 不再内部调用 Planner/Composer（由外部 scene.spec 工具完成）
 * - 接受结构化 SceneSpec 作为输入
 * - Auditor+Reviser 合并为一步
 * - 从 5 次 LLM 调用降到 2 次（Writer + AuditRevise）
 */

import type { LLMClient, Logger } from "@vivy1024/novelfork-core";
import { StateManager, buildLengthSpec } from "@vivy1024/novelfork-core";
import type { BookConfig } from "@vivy1024/novelfork-core";
import type { AgentContext } from "../engine/agents/base.js";
import type { AuditResult } from "../engine/agents/continuity.js";
import { WriterAgent } from "../engine/agents/writer.js";
import { ContinuityAuditor } from "../engine/agents/continuity.js";
import { ReviserAgent } from "../engine/agents/reviser.js";
import { createWritingResourceService } from "../engine/writing-resource/service.js";
import { randomUUID } from "node:crypto";
import type { CanvasArtifact } from "@vivy1024/novelfork-studio/shared/agent-native-workspace";
import type { SceneSpec } from "./scene-spec-handler.js";

export interface PipelineWriteInput {
  readonly bookId: string;
  readonly sceneSpec: SceneSpec;
  readonly jingweiContext?: string;
  readonly previousChapterTail?: string;
  readonly autoRevise?: boolean;
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

export async function executePipelineWrite(
  input: PipelineWriteInput,
  options: PipelineWriteOptions,
): Promise<PipelineWriteResult> {
  const { bookId, sceneSpec, jingweiContext, previousChapterTail, autoRevise = true } = input;
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

    // Build context package from scene spec + jingwei context
    const contextPackage = [
      `## 写作蓝图 (Scene Spec)\n${JSON.stringify(sceneSpec, null, 2)}`,
      jingweiContext ? `## 经纬上下文\n${jingweiContext}` : "",
      previousChapterTail ? `## 前章末尾\n${previousChapterTail}` : "",
      sceneSpec.constraints?.length ? `## 硬约束\n${sceneSpec.constraints.map((c) => `- ${c}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n");

    const chapterIntent = `按照 Scene Spec 写第${chapterNumber}章「${sceneSpec.title}」`;

    const writeOutput = await writer.writeChapter({
      book,
      bookDir,
      chapterNumber,
      chapterIntent,
      contextPackage: contextPackage as any,
      ruleStack: (sceneSpec.constraints?.join("\n") ?? "") as any,
      externalContext: "",
      lengthSpec,
    });

    logger?.info(`[pipeline.write] Writer done: "${writeOutput.title}" ${writeOutput.wordCount} words`);

    // 3. AuditRevise — audit + auto-fix in one step
    const auditorCtx = buildAgentCtx(options, "auditor", bookId);
    const auditor = new ContinuityAuditor(auditorCtx);
    let auditResult = await auditor.auditChapter(
      bookDir,
      writeOutput.content,
      chapterNumber,
      book.genre,
      { chapterIntent, contextPackage: contextPackage as any, ruleStack: (sceneSpec.constraints?.join("\n") ?? "") as any },
    );

    let finalContent = writeOutput.content;
    let revised = false;

    if (!auditResult.passed && autoRevise) {
      const criticalIssues = auditResult.issues.filter((i) => i.severity === "critical");
      if (criticalIssues.length > 0) {
        logger?.info(`[pipeline.write] Revising: ${criticalIssues.length} critical issues`);
        const reviserCtx = buildAgentCtx(options, "reviser", bookId);
        const reviser = new ReviserAgent(reviserCtx);
        const reviseOutput = await reviser.reviseChapter(
          bookDir,
          finalContent,
          chapterNumber,
          criticalIssues,
          "spot-fix",
          book.genre,
          { chapterIntent, contextPackage: contextPackage as any, ruleStack: (sceneSpec.constraints?.join("\n") ?? "") as any, lengthSpec },
        );
        finalContent = reviseOutput.revisedContent;
        revised = true;
      }
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
        type: "candidate",
        status: "candidate",
        title: writeOutput.title,
        content: finalContent,
        chapterNumber,
        source: "pipeline.write",
        metadata: {
          sceneSpec,
          auditResult: { passed: auditResult.passed, issueCount: auditResult.issues.length },
          revised,
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
