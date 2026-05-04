import { describe, expect, it, vi } from "vitest";

import { createContractClient } from "./contract-client";
import { createSessionClient } from "./session-client";
import { createWritingActionClient } from "./writing-action-client";
import {
  createWritingActionAdapter,
  listWritingActionDescriptors,
  normalizeWritingActionResult,
} from "./writing-action-adapter";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function createFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = input.toString();
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    if (path === "/api/books/book%2F1/inline-write") {
      return json({ mode: "prompt-preview", promptPreview: "请继续写", reason: "no-session-llm" });
    }
    if (path === "/api/books/book%2F1/writing-modes/apply") {
      return json({ target: "candidate", requestedTarget: body.target, resourceId: "wm-candidate-1", status: "candidate", metadata: { nonDestructive: true } }, 201);
    }
    if (path === "/api/books/book%2F1/write-next") {
      return json({ status: "writing", bookId: "book/1" }, 202);
    }
    if (path === "/api/books/book%2F1/draft") {
      return json({ status: "drafting", bookId: "book/1" }, 202);
    }
    if (path === "/api/books/book%2F1/hooks/generate") {
      return json({ gate: { ok: false, reason: "model-not-configured" }, error: { code: "MODEL_NOT_CONFIGURED", message: "未配置模型" } }, 409);
    }
    if (path === "/api/books/book%2F1/hooks/apply") {
      return json({ persisted: true, file: "pending_hooks.md", hookId: body.hookId ?? "hook-1" });
    }
    if (path === "/api/books/book%2F1/audit/1") {
      return json({ passed: false, issues: [{ type: "continuity", message: "时间线冲突" }] });
    }
    if (path === "/api/books/book%2F1/detect/1") {
      return json({ chapterNumber: 1, aiTasteScore: null, metrics: [{ name: "unknown", value: null }] });
    }
    if (path === "/api/sessions/session%2F1/tools") {
      return json({
        pending: [
          { id: "confirm-1", toolName: "guided.exit", target: "第二章候选稿", risk: "confirmed-write", summary: "等待确认", options: ["approve", "reject"], sessionId: "session/1" },
        ],
      });
    }
    if (path === "/api/sessions/session%2F1/tools/guided.exit/confirm") {
      return json({
        ok: true,
        result: {
          ok: true,
          renderer: "candidate.created",
          summary: "已创建候选稿",
          data: { status: "candidate", candidate: { id: "candidate-1", bookId: "book/1", title: "第二章候选稿" } },
          artifact: { id: "candidate:book/1:candidate-1", kind: "chapter-candidate", title: "第二章候选稿" },
        },
      });
    }
    if (path === "/api/sessions/session%2F1/tools/candidate.create_chapter/confirm") {
      return json({ error: { code: "unsupported-model", message: "当前模型不支持工具调用" } }, 409);
    }
    return json({ error: `Unhandled path: ${path}` }, 404);
  });
}

describe("writing action contract adapter", () => {
  it("describes session-native chain and non-destructive fallback actions", () => {
    const descriptors = listWritingActionDescriptors();

    expect(descriptors.map((descriptor) => descriptor.id)).toEqual([
      "session-native.write-next",
      "ai.write-next.async",
      "ai.draft.async",
      "writing-modes.preview",
      "writing-modes.apply",
      "hooks.generate",
      "hooks.apply",
      "ai.audit",
      "ai.detect",
    ]);
    expect(descriptors[0]).toMatchObject({
      outputBoundary: "candidate-artifact",
      chain: ["cockpit.get_snapshot", "pgi.generate_questions", "guided.enter", "guided.exit", "candidate.create_chapter"],
      writesFormalChapter: false,
      capability: { status: "current" },
    });
    expect(descriptors.find((descriptor) => descriptor.id === "writing-modes.preview")).toMatchObject({ capability: { status: "prompt-preview" }, writesFormalChapter: false });
  });

  it("normalizes prompt-preview and async responses without fabricating formal chapter content", async () => {
    const fetchMock = createFetch();
    const adapter = createWritingActionAdapter({
      writing: createWritingActionClient(createContractClient({ fetch: fetchMock })),
      sessions: createSessionClient(createContractClient({ fetch: fetchMock })),
    });

    const preview = await adapter.previewWritingMode("book/1", { mode: "continuation" });
    const applied = await adapter.applyWritingMode("book/1", { target: "chapter-replace", content: "候选正文" });
    const writeNext = await adapter.startAsyncWriteNext("book/1", { wordCount: 3000 });
    const draft = await adapter.startAsyncDraft("book/1", { context: "先写草稿" });

    expect(preview).toMatchObject({ kind: "prompt-preview", formalChapterWrite: false, candidateArtifact: null, draftArtifact: null, nextStep: "copy-or-explicit-apply" });
    expect(applied).toMatchObject({ kind: "candidate", formalChapterWrite: false, candidateArtifact: { id: "wm-candidate-1" }, nextStep: "review-candidate" });
    expect(writeNext).toMatchObject({ kind: "async-started", formalChapterWrite: false, status: "writing", nextStep: "wait-for-events-or-refresh" });
    expect(draft).toMatchObject({ kind: "async-started", formalChapterWrite: false, status: "drafting", nextStep: "wait-for-events-or-refresh" });
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/books/book%2F1/inline-write",
      "/api/books/book%2F1/writing-modes/apply",
      "/api/books/book%2F1/write-next",
      "/api/books/book%2F1/draft",
    ]);
  });

  it("routes session-native confirmation into candidate artifacts and preserves unsupported tool failures", async () => {
    const fetchMock = createFetch();
    const adapter = createWritingActionAdapter({
      writing: createWritingActionClient(createContractClient({ fetch: fetchMock })),
      sessions: createSessionClient(createContractClient({ fetch: fetchMock })),
    });

    const pending = await adapter.listSessionNativeConfirmations("session/1");
    const approved = await adapter.confirmSessionNativeStep("session/1", "guided.exit", { confirmationId: "confirm-1", decision: "approved", reason: "可执行", decidedAt: "2026-05-04T00:00:00.000Z", sessionId: "session/1" });
    const unsupported = await adapter.confirmSessionNativeStep("session/1", "candidate.create_chapter", { confirmationId: "confirm-2", decision: "approved", reason: "试生成", decidedAt: "2026-05-04T00:00:00.000Z", sessionId: "session/1" });

    expect(pending).toMatchObject({ kind: "confirmation-required", confirmations: [{ toolName: "guided.exit" }], formalChapterWrite: false });
    expect(approved).toMatchObject({ kind: "candidate", formalChapterWrite: false, candidateArtifact: { id: "candidate-1" }, nextStep: "review-candidate" });
    expect(unsupported).toMatchObject({ kind: "unsupported", formalChapterWrite: false, error: { error: { code: "unsupported-model" } }, nextStep: "show-provider-or-tool-error" });
  });

  it("preserves hooks gate 409, explicit hook apply, and audit/detect metrics", async () => {
    const adapter = createWritingActionAdapter({
      writing: createWritingActionClient(createContractClient({ fetch: createFetch() })),
      sessions: createSessionClient(createContractClient({ fetch: createFetch() })),
    });

    const hookGate = await adapter.generateHooks("book/1", { chapterNumber: 1 });
    const hookApply = await adapter.applyHook("book/1", { chapterNumber: 1, hookId: "hook-1", hook: { text: "门外脚步声" } });
    const audit = await adapter.auditChapter("book/1", 1);
    const detect = await adapter.detectChapter("book/1", 1);

    expect(hookGate).toMatchObject({ kind: "gate-blocked", formalChapterWrite: false, gate: { ok: false, reason: "model-not-configured" }, nextStep: "show-gate" });
    expect(hookApply).toMatchObject({ kind: "draft-write", formalChapterWrite: false, draftArtifact: { file: "pending_hooks.md", id: "hook-1" } });
    expect(audit).toMatchObject({ kind: "analysis", formalChapterWrite: false, analysis: { passed: false } });
    expect(detect).toMatchObject({ kind: "analysis", formalChapterWrite: false, analysis: { aiTasteScore: null, metrics: [{ name: "unknown", value: null }] } });
  });

  it("normalizes raw generated and unsupported envelopes for callers that already have a contract result", () => {
    const generated = normalizeWritingActionResult({ ok: true, data: { mode: "generated", content: "生成内容" }, raw: { mode: "generated", content: "生成内容" }, httpStatus: 200, capability: { id: "writing-modes.preview", status: "prompt-preview", ui: { disabled: false } as never } });
    const unsupported = normalizeWritingActionResult({ ok: false, error: { error: { code: "unsupported-tools", message: "工具不可用" } }, httpStatus: 409, capability: { id: "session-native.write-next", status: "current", ui: { disabled: false } as never } });

    expect(generated).toMatchObject({ kind: "generated", formalChapterWrite: false, generatedContent: "生成内容", nextStep: "explicit-apply-required" });
    expect(unsupported).toMatchObject({ kind: "unsupported", formalChapterWrite: false, nextStep: "show-provider-or-tool-error" });
  });
});
