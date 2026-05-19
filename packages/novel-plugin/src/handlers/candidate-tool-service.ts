import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type { CanvasArtifact, SessionToolExecutionResult } from "@vivy1024/novelfork-studio/shared/agent-native-workspace";
import { getStorageDatabase } from "@vivy1024/novelfork-core";
import { getPreset, type Preset } from "../engine/presets/index.js";
import { checkPresetCompliance, type ComplianceCheckResult } from "../engine/presets/compliance-checker.js";
import { createWritingResourceService } from "../engine/writing-resource/service.js";

export type CandidateGenerationInput = {
  readonly bookId: string;
  readonly chapterIntent: string;
  readonly chapterNumber?: number;
  readonly title?: string;
  readonly pgiInstructions?: string;
  readonly guidedPlanId?: string;
  readonly guidedPlan?: unknown;
};

export type CandidateToolServiceOptions = {
  readonly root: string;
  readonly now?: () => Date;
  readonly createCandidateId?: () => string;
};

export type CandidateToolService = {
  readonly createChapter: (input: Record<string, unknown>) => Promise<SessionToolExecutionResult>;
};

type CandidatePayload = {
  readonly id: string;
  readonly bookId: string;
  readonly targetChapterId?: string;
  readonly chapterNumber?: number;
  readonly title: string;
  readonly source: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: "candidate";
  readonly metadata?: Record<string, unknown>;
  readonly content: string;
  readonly artifact: CanvasArtifact;
};

const SOURCE = "session-tool:candidate.create_chapter";

export function createCandidateToolService(options: CandidateToolServiceOptions): CandidateToolService {
  return {
    createChapter: async (input) => {
      const bookId = stringInput(input.bookId, "bookId");
      const chapterIntent = stringInput(input.chapterIntent, "chapterIntent");
      const chapterNumber = optionalNumber(input.chapterNumber);
      const title = optionalString(input.title) ?? (chapterNumber ? `第 ${chapterNumber} 章候选稿` : "章节候选稿");
      const pgiInstructions = optionalString(input.pgiInstructions);
      const guidedPlanId = optionalString(input.guidedPlanId);
      const content = stringInput(input.content, "content");
      const promptPreview = buildCandidatePrompt({ bookId, chapterIntent, chapterNumber, title, pgiInstructions, guidedPlanId, guidedPlan: input.guidedPlan });

      if (!content.trim()) {
        return {
          ok: false,
          renderer: "candidate.created",
          error: "empty-content",
          summary: "候选稿内容为空。请由 Agent 先生成章节正文，再调用 candidate.create_chapter 保存。",
          data: { status: "empty-content", bookId, chapterNumber, title, promptPreview },
        };
      }

      // --- Post-write compliance check ---
      const complianceResult = await runPostWriteComplianceCheck(content, bookId, options.root);

      const id = options.createCandidateId?.() ?? `candidate-${randomUUID()}`;
      const timestampDate = options.now?.() ?? new Date();
      const timestamp = timestampDate.toISOString();
      const timestampMs = timestampDate.getTime();
      const metadata: Record<string, unknown> = {
        chapterIntent,
        ...(pgiInstructions ? { pgiInstructions } : {}),
        ...(guidedPlanId ? { guidedPlanId } : {}),
        ...(input.guidedPlan ? { guidedPlan: input.guidedPlan } : {}),
        nonDestructive: true,
        createdBy: SOURCE,
        promptPreview,
        ...(complianceResult ? { compliance: complianceResult } : {}),
      };
      const service = createWritingResourceService({ storage: getStorageDatabase(), now: () => timestampMs });
      const resource = service.create({
        id,
        bookId,
        type: "candidate",
        status: "candidate",
        title,
        content,
        chapterNumber: chapterNumber ?? null,
        parentId: null,
        source: SOURCE,
        metadata,
        createdAt: timestampMs,
        updatedAt: timestampMs,
      });
      const artifact = candidateArtifact(bookId, id, title);
      const candidate: CandidatePayload = {
        id,
        bookId,
        ...(chapterNumber ? { targetChapterId: String(chapterNumber), chapterNumber } : {}),
        title,
        source: SOURCE,
        createdAt: timestamp,
        updatedAt: timestamp,
        status: "candidate",
        metadata,
        content: resource.content,
        artifact,
      };
      return {
        ok: true,
        renderer: "candidate.created",
        summary: `已创建${chapterNumber ? `第 ${chapterNumber} 章` : "章节"}候选稿：${title}。`,
        data: {
          status: "candidate",
          candidate,
        },
        artifact,
      };
    },
  };
}


function candidateArtifact(bookId: string, id: string, title: string): CanvasArtifact {
  return {
    id: `candidate:${bookId}:${id}`,
    kind: "candidate",
    title,
    resourceRef: { kind: "candidate", id, bookId, title },
    renderer: "candidate.created",
    openInCanvas: true,
  };
}

function buildCandidatePrompt(input: CandidateGenerationInput): string {
  const lines = [
    "请生成一份章节候选稿，结果只进入候选区，不覆盖正式章节。",
    `书籍 ID：${input.bookId}`,
    ...(input.chapterNumber ? [`目标章节：第 ${input.chapterNumber} 章`] : []),
    ...(input.title ? [`候选标题：${input.title}`] : []),
    `章节意图：${input.chapterIntent}`,
    ...(input.pgiInstructions ? ["", input.pgiInstructions] : []),
    ...(input.guidedPlanId ? [``, `关联 GuidedGenerationPlan：${input.guidedPlanId}`] : []),
  ];
  return lines.join("\n");
}


/** Run post-write compliance check against enabled presets */
async function runPostWriteComplianceCheck(
  content: string,
  bookId: string,
  root: string,
): Promise<ComplianceCheckResult | null> {
  try {
    const bookJsonPath = join(root, "books", bookId, "book.json");
    const raw = JSON.parse(await readFile(bookJsonPath, "utf-8")) as { enabledPresetIds?: string[] };
    const enabledIds = raw.enabledPresetIds ?? [];
    if (enabledIds.length === 0) return null;

    const enabledPresets = enabledIds
      .map((id) => getPreset(id))
      .filter((p): p is Preset => Boolean(p))
      .map((p) => ({
        id: p.id,
        name: p.name,
        rules: p.promptInjection,
        antiPatterns: p.postWriteChecks?.map((c: { name: string }) => c.name) ?? undefined,
      }));

    if (enabledPresets.length === 0) return null;

    const result = checkPresetCompliance(content, enabledPresets);
    return result.violations.length > 0 ? result : null;
  } catch {
    return null;
  }
}


function stringInput(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`candidate.create_chapter input must include a non-empty ${field}.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

