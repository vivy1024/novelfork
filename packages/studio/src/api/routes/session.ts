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
} from "../lib/session-service.js";

const app = new Hono();

function parseSinceSeq(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

app.get("/", async (c) => {
  const sessions = await listSessions();
  return c.json(sessions);
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
