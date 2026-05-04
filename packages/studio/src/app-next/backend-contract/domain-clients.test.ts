import { describe, expect, it, vi } from "vitest";

import { createContractClient } from "./contract-client";
import { createFetchJsonContractClient } from "./fetch-json-contract-client";
import { createProviderClient } from "./provider-client";
import { createResourceClient } from "./resource-client";
import { buildChatWebSocketUrl, createSessionClient } from "./session-client";
import { createWritingActionClient } from "./writing-action-client";
import type { BookDetailResponse, BookListResponse, ChapterContentResponse } from "../../shared/contracts";
import type { ContractResult } from "./contract-client";
import type { ProviderRuntimeStatus, RuntimeModelPoolEntry, RuntimeProviderView } from "../../shared/provider-catalog";
import type { NarratorSessionChatHistory, NarratorSessionChatSnapshot, NarratorSessionRecord } from "../../shared/session-types";

describe("domain contract clients", () => {
  it("defaults domain client response types to shared contracts", () => {
    const contract = createContractClient({ fetch: vi.fn() });
    const resources = createResourceClient(contract);
    const sessions = createSessionClient(contract);
    const providers = createProviderClient(contract);

    const listBooks = resources.listBooks();
    const getBook = resources.getBook("book-1");
    const getChapter = resources.getChapter("book-1", 1);
    const activeSessions = sessions.listActiveSessions();
    const chatState = sessions.getChatState("session-1");
    const chatHistory = sessions.getChatHistory("session-1");
    const providerStatus = providers.getStatus();
    const modelPool = providers.listModels();
    const providerSummary = providers.getSummary();
    const modelTest = providers.testProviderModel("p1", "m1");

    const typedListBooks: Promise<ContractResult<BookListResponse>> = listBooks;
    const typedGetBook: Promise<ContractResult<BookDetailResponse>> = getBook;
    const typedGetChapter: Promise<ContractResult<ChapterContentResponse>> = getChapter;
    const typedActiveSessions: Promise<ContractResult<readonly NarratorSessionRecord[]>> = activeSessions;
    const typedChatState: Promise<ContractResult<NarratorSessionChatSnapshot>> = chatState;
    const typedChatHistory: Promise<ContractResult<NarratorSessionChatHistory>> = chatHistory;
    const typedProviderStatus: Promise<ContractResult<{ status: ProviderRuntimeStatus }>> = providerStatus;
    const typedModelPool: Promise<ContractResult<{ models: readonly RuntimeModelPoolEntry[] }>> = modelPool;
    const typedProviderSummary: Promise<ContractResult<{ summary: Record<string, unknown> }>> = providerSummary;
    const typedModelTest: Promise<ContractResult<{ success: true; model?: RuntimeProviderView["models"][number] }>> = modelTest;

    void [typedListBooks, typedGetBook, typedGetChapter, typedActiveSessions, typedChatState, typedChatHistory, typedProviderStatus, typedModelPool, typedProviderSummary, typedModelTest];
  });

  it("converts fetchJson failures into contract error results without losing status", async () => {
    const error = Object.assign(new Error("真实后端失败"), { status: 409, code: "ai-gate" });
    const fetchJsonMock = vi.fn(async () => {
      throw error;
    });
    const contract = createFetchJsonContractClient(fetchJsonMock as unknown as <T>(path: string, init?: RequestInit) => Promise<T>);

    const result = await contract.get("/api/providers/models");

    expect(fetchJsonMock).toHaveBeenCalledWith("/api/providers/models");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected contract failure");
    expect(result.httpStatus).toBe(409);
    expect(result.code).toBe("ai-gate");
    expect(result.error).toEqual({ error: { message: "真实后端失败", code: "ai-gate" } });
  });

  it("wraps first-screen resource/provider/session routes with registered capabilities", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const contract = createContractClient({ fetch: fetchMock });

    await createResourceClient(contract).listBooks();
    await createSessionClient(contract).listActiveSessions();
    await createProviderClient(contract).getStatus();

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/books", expect.objectContaining({ method: "GET" }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/sessions?sort=recent&status=active", expect.objectContaining({ method: "GET" }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/providers/status", expect.objectContaining({ method: "GET" }));
  });

  it("marks create-status as process-memory capability", async () => {
    const contract = createContractClient({ fetch: vi.fn(async () => new Response(JSON.stringify({ status: "creating" }), { status: 200 })) });

    const result = await createResourceClient(contract).getBookCreateStatus("book one");

    expect(result.capability.status).toBe("process-memory");
    expect(result.capability.ui.recoveryNoteVisible).toBe(true);
  });

  it("adds session mutation and tool confirmation helpers without hiding backend envelopes", async () => {
    const fetchMock = vi.fn(async (_path: RequestInfo | URL, init?: RequestInit) => {
      if (!init) throw new Error("expected request init");
      if (init.method === "DELETE") return new Response(JSON.stringify({ success: true, gate: null }), { status: 200 });
      return new Response(JSON.stringify({ id: "s1", error: null, gate: { mode: "chat" } }), { status: init.method === "POST" ? 201 : 200 });
    });
    const session = createSessionClient(createContractClient({ fetch: fetchMock }));

    const created = await session.createSession({ title: "新会话", agentId: "writer" });
    const updated = await session.updateSession("session/1", { title: "改名" });
    const confirmed = await session.confirmTool("session/1", "guided.exit", { decision: "approve", confirmationId: "c1", reason: null });
    const deleted = await session.deleteSession("session/1");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/sessions", expect.objectContaining({ method: "POST", body: JSON.stringify({ title: "新会话", agentId: "writer" }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/sessions/session%2F1", expect.objectContaining({ method: "PUT" }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/sessions/session%2F1/tools/guided.exit/confirm", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenNthCalledWith(4, "/api/sessions/session%2F1", expect.objectContaining({ method: "DELETE" }));
    expect(created.ok && created.data).toMatchObject({ error: null, gate: { mode: "chat" } });
    expect(updated.capability.id).toBe("sessions.update");
    expect(confirmed.capability.id).toBe("sessions.tools.confirm");
    expect(deleted.ok && deleted.data).toEqual({ success: true, gate: null });
  });

  it("builds encoded chat WebSocket URLs from absolute or relative bases", () => {
    expect(buildChatWebSocketUrl("session/1", { baseUrl: "http://localhost:4567/studio" })).toBe("ws://localhost:4567/api/sessions/session%2F1/chat");
    expect(buildChatWebSocketUrl("s 2", { baseUrl: "https://novelfork.local" })).toBe("wss://novelfork.local/api/sessions/s%202/chat");
    expect(buildChatWebSocketUrl("s 3")).toBe("ws://localhost:3000/api/sessions/s%203/chat");
  });

  it("wraps chapter, draft and candidate resources with non-destructive routes", async () => {
    const fetchMock = vi.fn(async (_path: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify({ ok: true, gate: null, method: init?.method }), { status: 200 }));
    const resources = createResourceClient(createContractClient({ fetch: fetchMock }));

    await resources.getChapter("book/1", 12);
    await resources.saveChapter("book/1", 12, { content: "正式正文" });
    await resources.listDrafts("book/1");
    await resources.getDraft("book/1", "draft/1");
    await resources.saveDraft("book/1", { title: "草稿", content: "草稿正文" });
    await resources.saveDraft("book/1", { id: "draft/1", title: "草稿", content: "更新" });
    await resources.deleteDraft("book/1", "draft/1");
    await resources.listCandidates("book/1");
    await resources.acceptCandidate("book/1", "cand/1", { action: "draft" });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/books/book%2F1/chapters/12", expect.objectContaining({ method: "GET" }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/books/book%2F1/chapters/12", expect.objectContaining({ method: "PUT", body: JSON.stringify({ content: "正式正文" }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/books/book%2F1/drafts", expect.objectContaining({ method: "GET" }));
    expect(fetchMock).toHaveBeenNthCalledWith(4, "/api/books/book%2F1/drafts/draft%2F1", expect.objectContaining({ method: "GET" }));
    expect(fetchMock).toHaveBeenNthCalledWith(5, "/api/books/book%2F1/drafts", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenNthCalledWith(6, "/api/books/book%2F1/drafts/draft%2F1", expect.objectContaining({ method: "PUT" }));
    expect(fetchMock).toHaveBeenNthCalledWith(7, "/api/books/book%2F1/drafts/draft%2F1", expect.objectContaining({ method: "DELETE" }));
    expect(fetchMock).toHaveBeenNthCalledWith(8, "/api/books/book%2F1/candidates", expect.objectContaining({ method: "GET" }));
    expect(fetchMock).toHaveBeenNthCalledWith(9, "/api/books/book%2F1/candidates/cand%2F1/accept", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "draft" }) }));
  });

  it("marks writing mode prompt preview as prompt-preview capability", async () => {
    const contract = createContractClient({ fetch: vi.fn(async () => new Response(JSON.stringify({ mode: "prompt-preview", promptPreview: "写下一章" }), { status: 200 })) });

    const result = await createWritingActionClient(contract).previewWritingMode<{ mode: string; promptPreview: string }>("b1", { modeId: "x" });

    expect(result.capability.status).toBe("prompt-preview");
    expect(result.capability.ui.previewOnly).toBe(true);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected writing preview success");
    expect(result.data).toMatchObject({ mode: "prompt-preview", promptPreview: "写下一章" });
  });

  it("keeps provider model and summary capability metadata explicit about redaction", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ providers: [{ id: "sub2api", apiKey: null }], error: null }), { status: 200 }));
    const provider = createProviderClient(createContractClient({ fetch: fetchMock }));

    const models = await provider.listModels();
    const summary = await provider.getSummary();

    expect(models.capability.metadata).toMatchObject({ redaction: "provider-secret-fields-omitted" });
    expect(summary.capability.metadata).toMatchObject({ redaction: "provider-secret-fields-omitted" });
    expect(models.ok && models.data).toMatchObject({ providers: [{ id: "sub2api", apiKey: null }], error: null });
  });

  it("keeps unsupported provider model test envelope visible", async () => {
    const contract = createContractClient({
      fetch: vi.fn(async () => new Response(JSON.stringify({ error: { code: "unsupported", message: "adapter 不支持" } }), { status: 400 })),
    });

    const result = await createProviderClient(contract).testProviderModel("p1", "m1");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected provider model test failure");
    expect(result.capability.status).toBe("current");
    expect(result.error).toEqual({ error: { code: "unsupported", message: "adapter 不支持" } });
  });

  it("covers async writing actions without fabricating synchronous chapter body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "queued", resourceId: null, gate: null }), { status: 202 }));
    const writing = createWritingActionClient(createContractClient({ fetch: fetchMock }));

    const applied = await writing.applyWritingMode("book/1", { target: "candidate", generatedContent: "候选正文" });
    const next = await writing.startWriteNext<{ status: string; resourceId: string | null; gate: null }>("book/1", { chapterNumber: 2 });
    const draft = await writing.startDraft<Record<string, unknown>>("book/1", { prompt: "写草稿" });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/books/book%2F1/writing-modes/apply", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/books/book%2F1/write-next", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/books/book%2F1/draft", expect.objectContaining({ method: "POST" }));
    expect(applied.capability.id).toBe("writing-modes.apply");
    expect(next.ok && next.data).toEqual({ status: "queued", resourceId: null, gate: null });
    expect(draft.ok && draft.data).not.toHaveProperty("content");
  });
});
