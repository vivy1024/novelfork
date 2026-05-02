import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type { CanvasArtifact, SessionConfig, SessionToolExecutionResult } from "../../shared/agent-native-workspace.js";
import { createLlmRuntimeService, type LlmRuntimeService } from "./llm-runtime-service.js";

export type CandidateGenerationInput = {
  readonly bookId: string;
  readonly chapterIntent: string;
  readonly chapterNumber?: number;
  readonly title?: string;
  readonly pgiInstructions?: string;
  readonly guidedPlanId?: string;
  readonly guidedPlan?: unknown;
};

export type CandidateGeneratedContent =
  | string
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly reason: string };

export type CandidateContentGenerator = (input: CandidateGenerationInput & {
  readonly promptPreview: string;
  readonly sessionConfig?: SessionConfig;
}) => Promise<CandidateGeneratedContent>;

export type CandidateToolServiceOptions = {
  readonly root: string;
  readonly now?: () => Date;
  readonly createCandidateId?: () => string;
  readonly generateContent?: CandidateContentGenerator;
  readonly runtimeService?: LlmRuntimeService;
};

export type CandidateToolService = {
  readonly createChapter: (input: Record<string, unknown>) => Promise<SessionToolExecutionResult>;
};

type CandidateRecord = {
  readonly id: string;
  readonly bookId: string;
  readonly targetChapterId?: string;
  readonly title: string;
  readonly source: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: "candidate";
  readonly contentFileName: string;
  readonly metadata?: Record<string, unknown>;
};

type CandidatePayload = Omit<CandidateRecord, "contentFileName"> & {
  readonly chapterNumber?: number;
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
      const promptPreview = buildCandidatePrompt({ bookId, chapterIntent, chapterNumber, title, pgiInstructions, guidedPlanId, guidedPlan: input.guidedPlan });

      const sessionConfig = isSessionConfig(input.sessionConfig) ? input.sessionConfig : undefined;
      const generator = options.generateContent ?? createRuntimeGenerator(options.runtimeService ?? createLlmRuntimeService());
      const generated = normalizeGeneratedContent(await generator({ bookId, chapterIntent, chapterNumber, title, pgiInstructions, guidedPlanId, guidedPlan: input.guidedPlan, promptPreview, sessionConfig }));
      if (!generated.ok) {
        return {
          ok: false,
          renderer: "candidate.created",
          error: "unsupported-model",
          summary: "候选稿生成需要配置支持模型。",
          data: {
            status: "unsupported",
            bookId,
            chapterNumber,
            title,
            promptPreview,
            reason: generated.reason,
          },
        };
      }

      const content = generated.content;
      if (!content.trim()) {
        throw new Error("Candidate generator returned empty content.");
      }

      const id = options.createCandidateId?.() ?? `candidate-${randomUUID()}`;
      const timestamp = (options.now?.() ?? new Date()).toISOString();
      const contentFileName = `${safeFileName(id)}.md`;
      const metadata: Record<string, unknown> = {
        chapterIntent,
        ...(pgiInstructions ? { pgiInstructions } : {}),
        ...(guidedPlanId ? { guidedPlanId } : {}),
        ...(input.guidedPlan ? { guidedPlan: input.guidedPlan } : {}),
        nonDestructive: true,
        createdBy: SOURCE,
        promptPreview,
      };
      const record: CandidateRecord = {
        id,
        bookId,
        ...(chapterNumber ? { targetChapterId: String(chapterNumber) } : {}),
        title,
        source: SOURCE,
        createdAt: timestamp,
        updatedAt: timestamp,
        status: "candidate",
        contentFileName,
        metadata,
      };
      const bookDir = join(options.root, "books", bookId);
      await saveCandidate(bookDir, record, content);
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
        content,
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

async function saveCandidate(bookDir: string, record: CandidateRecord, content: string): Promise<void> {
  const dir = join(bookDir, "generated-candidates");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, record.contentFileName), content, "utf-8");
  const candidates = await loadCandidates(join(dir, "index.json"));
  await writeFile(join(dir, "index.json"), JSON.stringify([...candidates, record], null, 2), "utf-8");
}

async function loadCandidates(filePath: string): Promise<CandidateRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf-8")) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isCandidateRecord) : [];
  } catch {
    return [];
  }
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

function createRuntimeGenerator(runtimeService: LlmRuntimeService): CandidateContentGenerator {
  return async ({ promptPreview, sessionConfig }) => {
    if (!sessionConfig?.providerId?.trim() || !sessionConfig.modelId?.trim()) {
      return { ok: false, reason: "当前会话未配置可用模型。" };
    }
    const generated = await runtimeService.generate({
      sessionConfig,
      messages: [
        { id: "candidate-create-system", role: "system", content: "你是 NovelFork 的小说创作执行模型。请只输出可直接进入候选区的章节正文，不要复述提示词。", timestamp: 0 },
        { id: "candidate-create-user", role: "user", content: promptPreview, timestamp: 1 },
      ],
    });
    if (!generated.success || generated.type !== "message") {
      const reason = generated.success ? "模型未返回可写入候选区的正文。" : generated.error;
      return { ok: false, reason };
    }
    return { ok: true, content: generated.content };
  };
}

function normalizeGeneratedContent(value: CandidateGeneratedContent): { readonly ok: true; readonly content: string } | { readonly ok: false; readonly reason: string } {
  if (typeof value === "string") return { ok: true, content: value };
  return value;
}

function isSessionConfig(value: unknown): value is SessionConfig {
  return typeof value === "object" && value !== null
    && typeof (value as { providerId?: unknown }).providerId === "string"
    && typeof (value as { modelId?: unknown }).modelId === "string"
    && typeof (value as { permissionMode?: unknown }).permissionMode === "string"
    && typeof (value as { reasoningEffort?: unknown }).reasoningEffort === "string";
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

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || `candidate-${randomUUID()}`;
}

function isCandidateRecord(value: unknown): value is CandidateRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && typeof (value as { id?: unknown }).id === "string"
    && typeof (value as { bookId?: unknown }).bookId === "string"
    && typeof (value as { title?: unknown }).title === "string"
    && typeof (value as { contentFileName?: unknown }).contentFileName === "string";
}
