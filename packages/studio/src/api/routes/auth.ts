/**
 * Auth routes — mounted in all modes (standalone + relay).
 * 4 endpoints: launch, me, llm-settings (get/put).
 */

import { Hono } from "hono";
import {
  establishLaunchSession,
  readSessionFromCookie,
  refreshSession,
  toPublicSession,
} from "../auth.js";
import { ApiError } from "../errors.js";
import type { InkosSession } from "../auth.js";

/**
 * Safely read session — returns null when SESSION_SECRET is missing
 * (standalone mode without multi-user auth configured).
 */
async function safeReadSession(c: import("hono").Context): Promise<InkosSession | null> {
  try {
    return await readSessionFromCookie(c);
  } catch (e) {
    if (e instanceof ApiError && e.code === "SESSION_SECRET_MISSING") {
      return null;
    }
    throw e;
  }
}

export function createAuthRouter(): Hono {
  const app = new Hono();

  app.post("/api/auth/launch", async (c) => {
    const body: { token?: string } = await c.req.json<{ token?: string }>().catch(() => ({}));
    if (!body.token?.trim()) {
      throw new ApiError(400, "TOKEN_REQUIRED", "Launch token is required.");
    }
    const session = await establishLaunchSession(c, body.token);
    return c.json({ ok: true, session: toPublicSession(session) });
  });

  app.get("/api/auth/me", async (c) => {
    const session = await safeReadSession(c);
    if (!session) throw new ApiError(401, "UNAUTHORIZED", "Not authenticated.");
    return c.json({ session: toPublicSession(session) });
  });

  app.get("/api/auth/llm-settings", async (c) => {
    const session = await safeReadSession(c);
    if (!session) throw new ApiError(401, "UNAUTHORIZED", "Not authenticated.");
    return c.json({
      apiKey: session.llmApiKey ? `${session.llmApiKey.slice(0, 8)}...${session.llmApiKey.slice(-4)}` : "",
      baseUrl: session.llmBaseUrl ?? "",
      model: session.llmModel ?? "",
      provider: session.llmProvider ?? "",
      hasApiKey: Boolean(session.llmApiKey),
    });
  });

  app.put("/api/auth/llm-settings", async (c) => {
    const session = await safeReadSession(c);
    if (!session) throw new ApiError(401, "UNAUTHORIZED", "Not authenticated.");

    const body = await c.req.json<{
      apiKey?: string; baseUrl?: string; model?: string; provider?: string;
    }>();

    // Update session with new LLM settings
    if (typeof body.apiKey === "string") session.llmApiKey = body.apiKey.trim() || undefined;
    if (typeof body.baseUrl === "string") session.llmBaseUrl = body.baseUrl.trim() || undefined;
    if (typeof body.model === "string") session.llmModel = body.model.trim() || undefined;
    if (typeof body.provider === "string") session.llmProvider = body.provider.trim() || undefined;

    await refreshSession(c, session);
    return c.json({ ok: true });
  });

  return app;
}
