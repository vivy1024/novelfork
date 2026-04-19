/**
 * Session API routes
 */

import { Hono } from "hono";
import type { Session } from "../../hooks/useSession.js";

const app = new Hono();

// In-memory session storage (for server-side operations if needed)
const sessions = new Map<string, Session>();

app.get("/", (c) => {
  const allSessions = Array.from(sessions.values()).sort(
    (a, b) => b.lastModified.getTime() - a.lastModified.getTime()
  );
  return c.json(allSessions);
});

app.get("/:id", (c) => {
  const id = c.req.param("id");
  const session = sessions.get(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  return c.json(session);
});

app.post("/", async (c) => {
  const body = await c.req.json();
  const session: Session = {
    id: crypto.randomUUID(),
    title: body.title || "Untitled Session",
    createdAt: new Date(),
    lastModified: new Date(),
    messageCount: 0,
    model: body.model || "claude-opus-4-7",
    worktree: body.worktree,
  };
  sessions.set(session.id, session);
  return c.json(session, 201);
});

app.put("/:id", async (c) => {
  const id = c.req.param("id");
  const session = sessions.get(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  const body = await c.req.json();
  const updated: Session = {
    ...session,
    ...body,
    id,
    lastModified: new Date(),
  };
  sessions.set(id, updated);
  return c.json(updated);
});

app.delete("/:id", (c) => {
  const id = c.req.param("id");
  if (!sessions.has(id)) {
    return c.json({ error: "Session not found" }, 404);
  }
  sessions.delete(id);
  return c.json({ success: true });
});

export default app;
