/**
 * Session API routes
 */

import { Hono } from "hono";

import { buildStructuredErrorEnvelope } from "../errors.js";
import type { CreateNarratorSessionInput, UpdateNarratorSessionChatStateInput, UpdateNarratorSessionInput } from "../../shared/session-types.js";
import {
  confirmSessionToolDecision,
  getSessionChatHistory,
  getSessionChatSnapshot,
  getSessionToolState,
  replaceSessionChatState,
  broadcastSessionError,
  broadcastCompactProgress,
  type ConfirmSessionToolDecisionInput,
} from "../lib/session-chat-service.js";
import {
  createSession,
  deleteSession,
  getSessionById,
  listSessions,
  updateSession,
  type ListSessionsOptions,
  type SessionListBinding,
  type SessionListSort,
} from "../lib/session-service.js";
import { compactSession, undoCompactSession, editCompactSummary } from "../lib/session-compact-service.js";
import { segmentCompact } from "../lib/compact/segment-compact.js";
import { getContextBreakdown } from "../lib/context-breakdown.js";
import { executeHeadlessChat, encodeHeadlessChatEventsAsNdjson, type HeadlessChatInput } from "../lib/session-headless-chat-service.js";
import { continueLatestSession, forkSession, restoreSessionForContinue } from "../lib/session-lifecycle-service.js";
import { createSessionMemoryBoundaryService, type SessionMemoryCandidate } from "../lib/session-memory-boundary-service.js";
import { generateSessionReply } from "../lib/llm-runtime-service.js";
import { loadUserConfig } from "../lib/user-config-service.js";

const app = new Hono();
const memoryBoundaryService = createSessionMemoryBoundaryService();

// ─── Shared Helpers ──────────────────────────────────────────────────────────

/** Clear contextCutoffSeq from session config (idempotent) */
async function clearContextCutoffSeq(sessionId: string): Promise<void> {
  const session = await getSessionById(sessionId);
  if (session?.sessionConfig.contextCutoffSeq) {
    const updatedConfig = { ...session.sessionConfig, contextCutoffSeq: undefined };
    await updateSession(sessionId, { sessionConfig: updatedConfig });
  }
}

/** Delete messages from cutIndex onwards and clear contextCutoffSeq */
async function deleteMessagesFrom(sessionId: string, cutIndex: number, messages: readonly unknown[]): Promise<{ ok: true; removedCount: number; remainingMessages: number } | { ok: false; error: string }> {
  const remaining = messages.slice(0, cutIndex);
  const removedCount = messages.length - cutIndex;
  const result = await replaceSessionChatState(sessionId, remaining as any[]);
  if (!result) return { ok: false, error: "Failed to update session state" };
  await clearContextCutoffSeq(sessionId);
  return { ok: true, removedCount, remainingMessages: remaining.length };
}

function parseSinceSeq(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function cleanQueryText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseSessionKind(value: string | undefined): ListSessionsOptions["kind"] {
  return value === "standalone" || value === "chapter" ? value : undefined;
}

function parseSessionStatus(value: string | undefined): ListSessionsOptions["status"] {
  return value === "active" || value === "archived" ? value : undefined;
}

function parseSessionBinding(value: string | undefined): SessionListBinding | undefined {
  return value === "standalone" || value === "book" || value === "chapter" ? value : undefined;
}

function parseSessionSort(value: string | undefined): SessionListSort | undefined {
  return value === "recent" || value === "manual" || value === "lastModified-desc" ? value : undefined;
}

function parseListSessionsOptions(c: { req: { query: (name: string) => string | undefined } }): ListSessionsOptions {
  return {
    kind: parseSessionKind(c.req.query("kind")),
    status: parseSessionStatus(c.req.query("status")),
    binding: parseSessionBinding(c.req.query("binding")),
    projectId: cleanQueryText(c.req.query("projectId")),
    chapterId: cleanQueryText(c.req.query("chapterId")),
    search: cleanQueryText(c.req.query("search") ?? c.req.query("q")),
    sort: parseSessionSort(c.req.query("sort")),
  };
}

function unsupportedSessionConfigReason(currentSessionMode: string | undefined, updates: UpdateNarratorSessionInput): string | null {
  if (currentSessionMode === "plan" && updates.sessionConfig?.permissionMode === "allow") {
    return "规划会话不允许全部允许";
  }
  if (currentSessionMode === "plan" && updates.sessionConfig?.permissionMode === "edit") {
    return "规划会话不允许直接编辑";
  }
  return null;
}

app.get("/", async (c) => {
  const sessions = await listSessions(parseListSessionsOptions(c));
  return c.json(sessions);
});

app.get("/lifecycle/latest", async (c) => {
  const result = await continueLatestSession({
    projectId: cleanQueryText(c.req.query("projectId")),
    chapterId: cleanQueryText(c.req.query("chapterId")),
  });
  if (!result.ok) {
    return c.json(result, result.status);
  }
  return c.json(result);
});

app.post("/headless-chat", async (c) => {
  const body: HeadlessChatInput = await c.req.json<HeadlessChatInput>().catch(() => ({} as HeadlessChatInput));
  const result = await executeHeadlessChat(body);
  const status = result.exitCode === 2 ? 202 : result.success ? 200 : 500;

  if (body.outputFormat === "stream-json") {
    return c.body(encodeHeadlessChatEventsAsNdjson(result.events), status, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
    });
  }

  return c.json(result, status);
});

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const session = await getSessionById(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  return c.json(session);
});

app.get("/:id/chat/state", async (c) => {
  const id = c.req.param("id");
  const snapshot = await getSessionChatSnapshot(id);
  if (!snapshot) {
    return c.json({ error: "Session not found" }, 404);
  }
  return c.json(snapshot);
});

app.get("/:id/chat/history", async (c) => {
  const id = c.req.param("id");
  const history = await getSessionChatHistory(id, parseSinceSeq(c.req.query("sinceSeq")));
  if (!history) {
    return c.json({ error: "Session not found" }, 404);
  }
  return c.json(history);
});

// GET /api/sessions/:id/context-breakdown — 上下文注入详情
app.get("/:id/context-breakdown", async (c) => {
  const id = c.req.param("id");
  const breakdown = await getContextBreakdown(id);
  if (!breakdown) return c.json({ ok: false, error: "Session not found" }, 404);
  return c.json({ ok: true, data: breakdown });
});

app.put("/:id/chat/state", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<UpdateNarratorSessionChatStateInput>();
  const snapshot = await replaceSessionChatState(id, body.messages ?? []);
  if (!snapshot) {
    return c.json({ error: "Session not found" }, 404);
  }
  return c.json(snapshot);
});

app.get("/:id/tools", async (c) => {
  const id = c.req.param("id");
  const state = await getSessionToolState(id);
  if (!state) {
    return c.json({ error: "Session not found" }, 404);
  }
  return c.json(state);
});

app.post("/:id/tools/:toolName/confirm", async (c) => {
  const id = c.req.param("id");
  const toolName = c.req.param("toolName");
  const body = await c.req.json<ConfirmSessionToolDecisionInput>();
  const result = await confirmSessionToolDecision(id, toolName, body);
  if (!result.ok) {
    return c.json({ error: result.error }, result.status);
  }
  return c.json(result);
});

app.post("/", async (c) => {
  const body = await c.req.json<CreateNarratorSessionInput>();
  const session = await createSession(body);
  return c.json(session, 201);
});

app.post("/:id/fork", async (c) => {
  const id = c.req.param("id");
  const body: { title?: string; inheritanceNote?: string; forkMode?: "full" | "compressed" } = await c.req.json<{ title?: string; inheritanceNote?: string; forkMode?: "full" | "compressed" }>().catch(() => ({}));
  const result = await forkSession({ sourceSessionId: id, title: body.title, inheritanceNote: body.inheritanceNote, forkMode: body.forkMode });
  if (!result.ok) {
    return c.json(result, result.status);
  }
  return c.json(result, 201);
});

app.post("/:id/restore", async (c) => {
  const id = c.req.param("id");
  const result = await restoreSessionForContinue(id);
  if (!result.ok) {
    return c.json(result, result.status);
  }
  return c.json(result);
});

app.post("/:id/compact", async (c) => {
  const id = c.req.param("id");
  console.log(`[route] POST /${id}/compact received`);
  const body: { preserveRecentMessages?: number; instructions?: string } = await c.req.json<{ preserveRecentMessages?: number; instructions?: string }>().catch(() => ({}));
  const result = await compactSession({ sessionId: id, preserveRecentMessages: body.preserveRecentMessages, instructions: body.instructions });
  console.log(`[route] POST /${id}/compact result: ok=${result.ok}`);
  if (!result.ok) {
    // 压缩失败时通过 WebSocket 广播 session:error 通知前端
    if (result.code === "compact_failed") {
      await broadcastSessionError(id, result.error, result.code);
    }
    return c.json(result, result.status);
  }
  return c.json(result);
});

app.post("/:id/compact/undo", async (c) => {
  const id = c.req.param("id");
  const result = await undoCompactSession(id);
  if (!result.ok) {
    return c.json(result, result.status);
  }
  return c.json(result);
});

app.post("/:id/compact/edit-summary", async (c) => {
  const id = c.req.param("id");
  const body: { summary?: string } = await c.req.json<{ summary?: string }>().catch(() => ({}));
  if (!body.summary?.trim()) {
    return c.json({ error: "Summary text is required" }, 400);
  }
  const result = await editCompactSummary(id, body.summary.trim());
  if (!result.ok) {
    return c.json(result, 404);
  }
  return c.json(result);
});

// ─── Segment Compact ────────────────────────────────────────────────────────

app.post("/:id/compact-segment", async (c) => {
  const id = c.req.param("id");
  const body: { beforeSeq?: number } = await c.req.json<{ beforeSeq?: number }>().catch(() => ({}));

  if (typeof body.beforeSeq !== "number" || body.beforeSeq <= 0) {
    return c.json({ error: "beforeSeq must be a positive number" }, 400);
  }

  const snapshot = await getSessionChatSnapshot(id);
  if (!snapshot) {
    return c.json({ error: "Session not found" }, 404);
  }

  const messages = snapshot.messages.map((m) => ({
    role: m.role,
    content: m.content,
    seq: m.seq ?? 0,
    id: m.id,
  }));

  // Resolve summary model
  let providerId = snapshot.session.sessionConfig.providerId;
  let modelId = snapshot.session.sessionConfig.modelId;
  try {
    const config = await loadUserConfig();
    if (config.modelDefaults.summaryModel) {
      const colonIdx = config.modelDefaults.summaryModel.indexOf(":");
      if (colonIdx > 0) {
        providerId = config.modelDefaults.summaryModel.slice(0, colonIdx);
        modelId = config.modelDefaults.summaryModel.slice(colonIdx + 1);
      }
    }
  } catch { /* use session model */ }

  await broadcastCompactProgress(id, "segment", 10, "开始段落压缩…");

  try {
    const result = await segmentCompact({
      messages,
      beforeSeq: body.beforeSeq,
      generateSummary: async (prompt: string, signal?: AbortSignal) => {
        await broadcastCompactProgress(id, "segment", 30, "正在生成摘要…");
        const llmResult = await generateSessionReply({
          sessionConfig: {
            providerId,
            modelId,
            permissionMode: "allow",
            reasoningEffort: "low",
          },
          messages: [
            { type: "message", id: "segment-compact-system", role: "system", content: "You are a helpful AI assistant. Respond with TEXT ONLY. Do NOT call any tools." },
            { type: "message", id: "segment-compact-user", role: "user", content: prompt },
          ],
          signal,
        });
        if (llmResult.success && llmResult.type === "message" && llmResult.content.trim()) {
          return llmResult.content.trim();
        }
        throw new Error("LLM failed to generate summary");
      },
    });

    await broadcastCompactProgress(id, "segment", 70, "正在更新消息…");

    // Mark collapsed messages with metadata flag (keep them in storage for undo)
    const collapsedSet = new Set(result.collapsedMessageIds);
    const summaryMessageId = `segment-summary-${crypto.randomUUID()}`;
    const summaryMessage = {
      id: summaryMessageId,
      role: "system" as const,
      content: result.summaryContent,
      timestamp: Date.now(),
      metadata: {
        kind: "segment-compact-summary",
        collapsedMessageIds: result.collapsedMessageIds,
        collapsedCount: result.collapsedCount,
        tokensSaved: result.tokensSaved,
      },
    };

    // Build new message list: mark collapsed messages, insert summary before them
    const newMessages = snapshot.messages.map((m) => {
      if (collapsedSet.has(m.id)) {
        return { ...m, metadata: { ...m.metadata, collapsed: true } };
      }
      return m;
    });
    // Insert summary message before the first collapsed message
    const firstCollapsedIdx = newMessages.findIndex((m) => collapsedSet.has(m.id));
    if (firstCollapsedIdx >= 0) {
      newMessages.splice(firstCollapsedIdx, 0, summaryMessage as any);
    } else {
      newMessages.unshift(summaryMessage as any);
    }
    const updated = await replaceSessionChatState(id, newMessages);
    if (!updated) {
      return c.json({ error: "Failed to update session state" }, 500);
    }

    // Build undo token: JSON-encoded info for restoration
    const undoToken = Buffer.from(JSON.stringify({
      sessionId: id,
      collapsedMessageIds: result.collapsedMessageIds,
      summaryMessageId,
    })).toString("base64url");

    await broadcastCompactProgress(id, "segment", 100, "段落压缩完成");

    return c.json({
      summaryContent: result.summaryContent,
      collapsedCount: result.collapsedCount,
      tokensSaved: result.tokensSaved,
      undoToken,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Segment compact failed";
    await broadcastSessionError(id, message, "segment_compact_failed");
    return c.json({ error: message }, 500);
  }
});

app.post("/:id/compact-segment/undo", async (c) => {
  const id = c.req.param("id");
  const body: { undoToken?: string } = await c.req.json<{ undoToken?: string }>().catch(() => ({}));

  if (!body.undoToken) {
    return c.json({ error: "undoToken is required" }, 400);
  }

  let undoData: { sessionId: string; collapsedMessageIds: string[]; summaryMessageId: string };
  try {
    undoData = JSON.parse(Buffer.from(body.undoToken, "base64url").toString("utf-8"));
  } catch {
    return c.json({ error: "Invalid undoToken" }, 400);
  }

  if (undoData.sessionId !== id) {
    return c.json({ error: "undoToken does not match this session" }, 400);
  }

  const snapshot = await getSessionChatSnapshot(id);
  if (!snapshot) {
    return c.json({ error: "Session not found" }, 404);
  }

  // Remove the summary message and clear collapsed flag from original messages
  const collapsedSet = new Set(undoData.collapsedMessageIds);
  const restoredMessages = snapshot.messages
    .filter((m) => m.id !== undoData.summaryMessageId)
    .map((m) => {
      if (collapsedSet.has(m.id) && m.metadata?.collapsed) {
        const { collapsed, ...restMetadata } = m.metadata;
        return { ...m, metadata: Object.keys(restMetadata).length > 0 ? restMetadata : undefined };
      }
      return m;
    });

  const updated = await replaceSessionChatState(id, restoredMessages);
  if (!updated) {
    return c.json({ error: "Failed to restore session state" }, 500);
  }

  return c.json({ restoredCount: undoData.collapsedMessageIds.length });
});

app.post("/:id/truncate", async (c) => {
  const id = c.req.param("id");
  const body: { messageId?: string; seq?: number; mode?: "delete" | "cutoff" } = await c.req.json<{ messageId?: string; seq?: number; mode?: "delete" | "cutoff" }>().catch(() => ({}));

  const snapshot = await getSessionChatSnapshot(id);
  if (!snapshot) {
    return c.json({ error: "Session not found" }, 404);
  }

  // Determine the mode: messageId implies destructive delete (rollback),
  // seq without messageId implies context cutoff (clear context, keep messages visible)
  const mode = body.mode ?? (body.messageId ? "delete" : "cutoff");

  if (mode === "delete") {
    // Destructive truncation: remove the target message and everything after it
    let cutIndex = -1;
    if (body.messageId) {
      cutIndex = snapshot.messages.findIndex((m) => m.id === body.messageId);
    } else if (typeof body.seq === "number") {
      cutIndex = snapshot.messages.findIndex((m) => m.seq === body.seq);
    }

    if (cutIndex < 0) {
      return c.json({ error: "Message not found" }, 404);
    }

    const remaining = snapshot.messages.slice(0, cutIndex);
    const removedCount = snapshot.messages.length - cutIndex;

    const result = await replaceSessionChatState(id, remaining);
    if (!result) {
      return c.json({ error: "Failed to truncate session" }, 500);
    }

    // Also clear any stale contextCutoffSeq
    const session = await getSessionById(id);
    if (session?.sessionConfig.contextCutoffSeq) {
      const updatedConfig = { ...session.sessionConfig, contextCutoffSeq: undefined };
      await updateSession(id, { sessionConfig: updatedConfig });
    }

    return c.json({ ok: true, mode: "delete", removedCount, remainingMessages: remaining.length });
  } else {
    // Context cutoff: mark messages as excluded from model context but keep them visible
    let cutSeq = -1;
    if (body.messageId) {
      const msg = snapshot.messages.find((m) => m.id === body.messageId);
      cutSeq = msg?.seq ?? -1;
    } else if (typeof body.seq === "number") {
      cutSeq = body.seq;
    }

    if (cutSeq < 0) {
      // For seq-based cutoff with very large seq (clear all), use max seq in messages
      const maxSeq = Math.max(...snapshot.messages.map((m) => m.seq ?? 0), 0);
      cutSeq = maxSeq > 0 ? maxSeq : 999999999;
    }

    const session = await getSessionById(id);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const updatedConfig = { ...session.sessionConfig, contextCutoffSeq: cutSeq };
    await updateSession(id, {
      sessionConfig: updatedConfig,
      cumulativeUsage: {
        ...(session.cumulativeUsage ?? { totalInputTokens: 0, totalOutputTokens: 0, totalCacheCreationInputTokens: 0, totalCacheReadInputTokens: 0, turnCount: 0 }),
        lastInputTokens: 0,
        lastContextBreakdown: undefined,
      },
    });

    return c.json({ ok: true, mode: "cutoff", contextCutoffSeq: cutSeq, totalMessages: snapshot.messages.length });
  }
});

// ─── Message Operation Endpoints ─────────────────────────────────────────────

app.post("/:id/rollback/:messageId", async (c) => {
  const id = c.req.param("id");
  const messageId = c.req.param("messageId");

  const snapshot = await getSessionChatSnapshot(id);
  if (!snapshot) {
    return c.json({ error: "Session not found" }, 404);
  }

  const cutIndex = snapshot.messages.findIndex((m) => m.id === messageId);
  if (cutIndex < 0) {
    return c.json({ error: "Message not found" }, 404);
  }

  const result = await deleteMessagesFrom(id, cutIndex, snapshot.messages);
  if (!result.ok) return c.json({ error: result.error }, 500);
  return c.json(result);
});

app.post("/:id/retry", async (c) => {
  const id = c.req.param("id");

  const snapshot = await getSessionChatSnapshot(id);
  if (!snapshot) {
    return c.json({ error: "Session not found" }, 404);
  }

  // Find the last assistant message
  let lastAssistantIdx = -1;
  for (let i = snapshot.messages.length - 1; i >= 0; i--) {
    if (snapshot.messages[i].role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }

  if (lastAssistantIdx < 0) {
    return c.json({ error: "No assistant message to retry" }, 400);
  }

  // Find the last user message before the assistant message
  let lastUserMessage: { id: string; content: string } | null = null;
  for (let i = lastAssistantIdx - 1; i >= 0; i--) {
    if (snapshot.messages[i].role === "user") {
      lastUserMessage = { id: snapshot.messages[i].id, content: snapshot.messages[i].content };
      break;
    }
  }

  if (!lastUserMessage) {
    return c.json({ error: "No user message found before assistant message" }, 400);
  }

  const result = await deleteMessagesFrom(id, lastAssistantIdx, snapshot.messages);
  if (!result.ok) return c.json({ error: result.error }, 500);
  return c.json({ ...result, retriedFromMessageId: lastUserMessage.id, lastUserContent: lastUserMessage.content });
});

app.post("/:id/continue", async (c) => {
  return c.json({ ok: true, hint: "send empty message to continue" });
});

app.post("/:id/edit-and-regenerate/:messageId", async (c) => {
  const id = c.req.param("id");
  const messageId = c.req.param("messageId");
  const body: { content?: string } = await c.req.json<{ content?: string }>().catch(() => ({}));

  if (!body.content?.trim()) {
    return c.json({ error: "content is required" }, 400);
  }

  const snapshot = await getSessionChatSnapshot(id);
  if (!snapshot) {
    return c.json({ error: "Session not found" }, 404);
  }

  const cutIndex = snapshot.messages.findIndex((m) => m.id === messageId);
  if (cutIndex < 0) {
    return c.json({ error: "Message not found" }, 404);
  }

  const result = await deleteMessagesFrom(id, cutIndex, snapshot.messages);
  if (!result.ok) return c.json({ error: result.error }, 500);
  return c.json({ ...result, newContent: body.content!.trim() });
});

app.delete("/:id/messages/:messageId", async (c) => {
  const id = c.req.param("id");
  const messageId = c.req.param("messageId");

  const snapshot = await getSessionChatSnapshot(id);
  if (!snapshot) {
    return c.json({ error: "Session not found" }, 404);
  }

  const filtered = snapshot.messages.filter((m) => m.id !== messageId);
  if (filtered.length === snapshot.messages.length) {
    return c.json({ error: "Message not found" }, 404);
  }

  const result = await replaceSessionChatState(id, filtered);
  if (!result) {
    return c.json({ error: "Failed to delete message" }, 500);
  }
  return c.json({ ok: true, remainingMessages: filtered.length });
});

app.get("/:id/memory/status", async (c) => {
  const id = c.req.param("id");
  const session = await getSessionById(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  return c.json(await memoryBoundaryService.getStatus(id));
});

app.post("/:id/memory", async (c) => {
  const id = c.req.param("id");
  const session = await getSessionById(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  const body: Partial<SessionMemoryCandidate> = await c.req.json<Partial<SessionMemoryCandidate>>().catch(() => ({}));
  const result = await memoryBoundaryService.commitMemory({
    sessionId: id,
    projectId: body.projectId ?? session.projectId,
    content: body.content ?? "",
    classification: body.classification,
    source: body.source ?? { kind: "message", messageId: "unknown" },
    confirmation: body.confirmation,
    createdBy: body.createdBy ?? "user",
    tags: body.tags,
  });
  if (!result.ok) {
    return c.json(result, result.status);
  }
  return c.json(result);
});

app.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<UpdateNarratorSessionInput>();
  const current = await getSessionById(id);
  if (!current) {
    return c.json({ error: "Session not found" }, 404);
  }
  const unsupportedReason = unsupportedSessionConfigReason(current.sessionMode, body);
  if (unsupportedReason) {
    return c.json(buildStructuredErrorEnvelope({ code: "UNSUPPORTED_PERMISSION_MODE", message: unsupportedReason, mirrorCode: true }), 400);
  }
  const updated = await updateSession(id, body);
  if (!updated) {
    return c.json({ error: "Session not found" }, 404);
  }
  return c.json(updated);
});

app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const deleted = await deleteSession(id);
  if (!deleted) {
    return c.json({ error: "Session not found" }, 404);
  }
  return c.json({ success: true });
});

export default app;
