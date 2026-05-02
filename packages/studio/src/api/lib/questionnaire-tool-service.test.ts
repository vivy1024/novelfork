import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBiblePremiseRepository,
  createBookRepository,
  createStorageDatabase,
  runStorageMigrations,
  type StorageDatabase,
} from "@vivy1024/novelfork-core";
import type { SessionToolExecutionInput } from "../../shared/agent-native-workspace.js";
import { createQuestionnaireToolService } from "./questionnaire-tool-service.js";
import { createSessionToolExecutor } from "./session-tool-executor.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-questionnaire-tools-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage);
  await createBookRepository(storage).create({
    id: "book-1",
    name: "凡人修仙录",
    bibleMode: "static",
    currentChapter: 1,
    createdAt: new Date("2026-05-03T00:00:00.000Z"),
    updatedAt: new Date("2026-05-03T00:00:00.000Z"),
  });
  return storage;
}

function input(overrides: Partial<SessionToolExecutionInput> = {}): SessionToolExecutionInput {
  return {
    sessionId: "session-1",
    toolName: "questionnaire.list_templates",
    input: { bookId: "book-1", purpose: "建立书籍前提" },
    permissionMode: "read",
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })));
});

describe("questionnaire session tools", () => {
  it("lists seeded questionnaire templates and starts a template as structured question cards", async () => {
    const storage = await createStorage();
    try {
      const executor = createSessionToolExecutor({ questionnaireService: createQuestionnaireToolService({ storage }) });

      const listed = await executor.execute(input());
      const started = await executor.execute(input({
        toolName: "questionnaire.start",
        input: { bookId: "book-1", templateId: "tier1-common-premise", goal: "建立核心卖点" },
      }));

      expect(listed).toMatchObject({
        ok: true,
        renderer: "questionnaire.templates",
        summary: expect.stringContaining("问卷模板"),
        data: {
          status: "available",
          bookId: "book-1",
          templates: expect.arrayContaining([
            expect.objectContaining({ id: "tier1-common-premise", questions: expect.any(Array) }),
          ]),
        },
      });
      expect(started).toMatchObject({
        ok: true,
        renderer: "questionnaire.questions",
        summary: expect.stringContaining("tier1-common-premise"),
        data: {
          status: "available",
          bookId: "book-1",
          templateId: "tier1-common-premise",
          goal: "建立核心卖点",
          questions: expect.arrayContaining([
            expect.objectContaining({ id: "logline", source: "questionnaire", required: true }),
          ]),
        },
      });
    } finally {
      storage.close();
    }
  });

  it("submits questionnaire responses through the existing transactional Bible mapping after approval", async () => {
    const storage = await createStorage();
    try {
      const executor = createSessionToolExecutor({
        questionnaireService: createQuestionnaireToolService({
          storage,
          createResponseId: () => "response-1",
          now: () => new Date("2026-05-03T01:00:00.000Z"),
        }),
      });

      const result = await executor.execute(input({
        toolName: "questionnaire.submit_response",
        permissionMode: "edit",
        confirmationDecision: {
          confirmationId: "confirm-1",
          decision: "approved",
          decidedAt: "2026-05-03T01:00:00.000Z",
          sessionId: "session-1",
        },
        input: {
          bookId: "book-1",
          templateId: "tier1-common-premise",
          answers: {
            logline: "凡人靠小瓶求长生",
            theme: "谨慎,长生",
            tone: "热血",
            "target-readers": "修仙升级流读者",
            "unique-hook": "小瓶催熟资源",
            "genre-tags": "玄幻,修仙",
          },
        },
      }));
      const premise = await createBiblePremiseRepository(storage).getByBook("book-1");

      expect(premise).not.toBeNull();
      expect(result).toMatchObject({
        ok: true,
        renderer: "jingwei.mutationPreview",
        summary: expect.stringContaining("已提交问卷回答"),
        data: {
          status: "submitted",
          response: expect.objectContaining({ id: "response-1", status: "submitted" }),
          targetObjectId: premise?.id,
        },
      });
      expect(premise).toMatchObject({
        logline: "凡人靠小瓶求长生",
        tone: "热血",
        targetReaders: "修仙升级流读者",
      });
    } finally {
      storage.close();
    }
  });

  it("returns explicit unsupported state for AI suggestions when no provider/model execution is configured", async () => {
    const storage = await createStorage();
    try {
      const executor = createSessionToolExecutor({ questionnaireService: createQuestionnaireToolService({ storage }) });

      const result = await executor.execute(input({
        toolName: "questionnaire.suggest_answer",
        input: {
          bookId: "book-1",
          templateId: "tier1-common-premise",
          questionId: "logline",
          providerId: "provider-1",
          modelId: "model-1",
          existingAnswers: {},
        },
      }));

      expect(result).toMatchObject({
        ok: false,
        renderer: "questionnaire.suggestion",
        error: "unsupported-model",
        summary: expect.stringContaining("需要配置支持模型"),
        data: {
          status: "unsupported",
          providerId: "provider-1",
          modelId: "model-1",
        },
      });
    } finally {
      storage.close();
    }
  });

  it("passes provider and model context to the questionnaire suggestion provider", async () => {
    const storage = await createStorage();
    try {
      const suggestionProvider = vi.fn(async () => ({
        answer: "主角以小瓶催熟灵草，在宗门夹缝中稳健成长。",
        reason: "结合已有主题与修仙题材生成。",
      }));
      const executor = createSessionToolExecutor({
        questionnaireService: createQuestionnaireToolService({ storage, suggestionProvider }),
      });

      const result = await executor.execute(input({
        toolName: "questionnaire.suggest_answer",
        input: {
          bookId: "book-1",
          templateId: "tier1-common-premise",
          questionId: "logline",
          providerId: "provider-1",
          modelId: "model-1",
          existingAnswers: { theme: "谨慎长生" },
          context: "用户想写凡人修仙升级流。",
        },
      }));

      expect(result).toMatchObject({
        ok: true,
        renderer: "questionnaire.suggestion",
        data: {
          status: "available",
          suggestion: {
            answer: "主角以小瓶催熟灵草，在宗门夹缝中稳健成长。",
            degraded: false,
          },
        },
      });
      expect(suggestionProvider).toHaveBeenCalledWith(expect.objectContaining({
        providerId: "provider-1",
        modelId: "model-1",
        question: expect.objectContaining({ id: "logline" }),
        existingAnswers: { theme: "谨慎长生" },
        context: expect.objectContaining({ bookId: "book-1", templateId: "tier1-common-premise", userContext: "用户想写凡人修仙升级流。" }),
      }));
    } finally {
      storage.close();
    }
  });
});
