/**
 * Session API routes
 */

import { Hono } from "hono";

import type { CreateNarratorSessionInput, UpdateNarratorSessionChatStateInput, UpdateNarratorSessionInput } from "../../shared/session-types.js";
import {
  confirmSessionToolDecision,
  getSessionChatHistory,
  getSessionChatSnapshot,
  getSessionToolState,
  replaceSessionChatState,
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
import { compactSession } from "../lib/session-compact-service.js";
import { executeHeadlessChat, encodeHeadlessChatEventsAsNdjson, type HeadlessChatInput } from "../lib/session-headless-chat-service.js";
import { continueLatestSession, forkSession, restoreSessionForContinue } from "../lib/session-lifecycle-service.js";
import { createSessionMemoryBoundaryService, type SessionMemoryCandidate } from "../lib/session-memory-boundary-service.js";

const app = new Hono();
const memoryBoundaryService = createSessionMemoryBoundaryService();

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
  return value === "recent" || value === "manual" ? value : undefined;
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
  const body: { title?: string; inheritanceNote?: string } = await c.req.json<{ title?: string; inheritanceNote?: string }>().catch(() => ({}));
  const result = await forkSession({ sourceSessionId: id, title: body.title, inheritanceNote: body.inheritanceNote });
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
  const body: { preserveRecentMessages?: number; instructions?: string } = await c.req.json<{ preserveRecentMessages?: number; instructions?: string }>().catch(() => ({}));
  const result = await compactSession({ sessionId: id, preserveRecentMessages: body.preserveRecentMessages, instructions: body.instructions });
  if (!result.ok) {
    return c.json(result, result.status);
  }
  return c.json(result);
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
