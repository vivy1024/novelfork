/**
 * Session API routes
 */

import { Hono } from "hono";
import {
  createSession,
  deleteSession,
  getSessionById,
  listSessions,
  updateSession,
} from "../lib/session-service.js";
import { getSessionChatHistory, getSessionChatSnapshot } from "../lib/session-chat-service.js";
import type { CreateNarratorSessionInput, UpdateNarratorSessionInput } from "../../shared/session-types.js";

const app = new Hono();

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
  const history = await getSessionChatHistory(id);
  if (!history) {
    return c.json({ error: "Session not found" }, 404);
  }

  return c.json({
    sessionId: id,
    session: history.session,
    messages: history.messages,
  });
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
