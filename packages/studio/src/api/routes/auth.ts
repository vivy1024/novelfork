/**
 * Auth routes — mounted in all modes (standalone + relay).
 * Endpoints: launch, me, llm-settings (get/put), oauth2 (initiate/callback).
 */

import { Hono } from "hono";
import {
  establishLaunchSession,
  readSessionFromCookie,
  refreshSession,
  toPublicSession,
} from "../auth.js";
import { ApiError } from "../errors.js";
import type { NovelForkSession } from "../auth.js";
import { createHash, randomBytes } from "node:crypto";

/**
 * Safely read session — returns null when SESSION_SECRET is missing
 * (standalone mode without multi-user auth configured).
 */
async function safeReadSession(c: import("hono").Context): Promise<NovelForkSession | null> {
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
    // Open mode: return anonymous session if no auth cookie
    if (!session) {
      return c.json({ session: null, anonymous: true });
    }
    return c.json({ session: toPublicSession(session), anonymous: false });
  });

  app.get("/api/auth/llm-settings", async (c) => {
    const session = await safeReadSession(c);
    // Open mode: return empty config if no session
    if (!session) {
      return c.json({
        apiKey: "",
        baseUrl: "",
        model: "",
        provider: "",
        hasApiKey: false,
      });
    }
    return c.json({
      apiKey: session.llmApiKey ? `${session.llmApiKey.slice(0, 8)}...${session.llmApiKey.slice(-4)}` : "",
      baseUrl: session.llmBaseUrl ?? "",
      model: session.llmModel ?? "",
      provider: session.llmProvider ?? "",
      hasApiKey: Boolean(session.llmApiKey),
    });
  });

  app.get("/api/mode", (c) => {
    const mode = (process.env.NOVELFORK_MODE?.trim().toLowerCase() === "relay") ? "relay" : "standalone";
    return c.json({ mode });
  });

  app.put("/api/auth/llm-settings", async (c) => {
    const body = await c.req.json<{
      apiKey?: string; baseUrl?: string; model?: string; provider?: string;
    }>();

    // Open mode: allow setting LLM config without session (store in env or config)
    // For now, require session to persist settings
    const session = await safeReadSession(c);
    if (!session) {
      throw new ApiError(401, "UNAUTHORIZED", "Session required to save LLM settings. Use Sub2API login or OAuth.");
    }

    // Update session with new LLM settings
    if (typeof body.apiKey === "string") session.llmApiKey = body.apiKey.trim() || undefined;
    if (typeof body.baseUrl === "string") session.llmBaseUrl = body.baseUrl.trim() || undefined;
    if (typeof body.model === "string") session.llmModel = body.model.trim() || undefined;
    if (typeof body.provider === "string") session.llmProvider = body.provider.trim() || undefined;

    await refreshSession(c, session);
    return c.json({ ok: true });
  });

  // ── OAuth2 PKCE flow with Sub2API ──

  // In-memory PKCE verifier store (keyed by state)
  const pkceStore = new Map<string, { verifier: string; redirectUri: string; expiresAt: number }>();

  // Cleanup expired entries
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of pkceStore) {
      if (now >= entry.expiresAt) pkceStore.delete(key);
    }
  }, 60_000).unref();

  // GET /api/auth/oauth2/initiate — start OAuth2 flow
  app.get("/api/auth/oauth2/initiate", (c) => {
    const sub2apiUrl = process.env.SUB2API_URL?.trim();
    if (!sub2apiUrl) {
      throw new ApiError(503, "SUB2API_URL_MISSING", "SUB2API_URL environment variable is not configured.");
    }

    // Generate PKCE code_verifier and code_challenge
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(16).toString("hex");

    // Build redirect URI (where Sub2API sends the user back)
    const proto = c.req.header("x-forwarded-proto") ?? "http";
    const host = c.req.header("host") ?? "localhost:4567";
    const redirectUri = `${proto}://${host}/api/auth/oauth2/callback`;

    // Store verifier for later token exchange
    pkceStore.set(state, {
      verifier,
      redirectUri,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 min
    });

    // Build authorization URL
    const apiKeyId = c.req.query("api_key_id") ?? "";
    const authUrl = new URL("/v1/oauth/authorize", sub2apiUrl);
    authUrl.searchParams.set("client_id", "inkos");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    if (apiKeyId) authUrl.searchParams.set("api_key_id", apiKeyId);

    return c.redirect(authUrl.toString());
  });

  // GET /api/auth/oauth2/callback — handle redirect from Sub2API
  app.get("/api/auth/oauth2/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");

    if (!code || !state) {
      return c.html("<h1>Authorization failed</h1><p>Missing code or state parameter.</p>");
    }

    const pkceEntry = pkceStore.get(state);
    if (!pkceEntry) {
      return c.html("<h1>Authorization failed</h1><p>Invalid or expired state. Please try again.</p>");
    }
    pkceStore.delete(state);

    const sub2apiUrl = process.env.SUB2API_URL?.trim();
    if (!sub2apiUrl) {
      return c.html("<h1>Authorization failed</h1><p>SUB2API_URL not configured.</p>");
    }

    // Exchange authorization code for token
    const tokenUrl = `${sub2apiUrl}/v1/oauth/token`;
    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        code_verifier: pkceEntry.verifier,
        redirect_uri: pkceEntry.redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => "Unknown error");
      return c.html(`<h1>Authorization failed</h1><p>Token exchange failed: ${errText}</p>`);
    }

    const tokenData = await tokenRes.json() as {
      data?: {
        access_token?: string;
        user_id?: number;
        email?: string;
        llm_base_url?: string;
        llm_api_key?: string;
      };
    };

    const d = tokenData.data;
    if (!d?.llm_api_key) {
      return c.html("<h1>Authorization failed</h1><p>No API key returned. Please create an API key in Sub2API first.</p>");
    }

    // Build session from OAuth2 response
    const session: NovelForkSession = {
      userId: d.user_id ?? 0,
      email: d.email ?? "",
      role: "user",
      llmBaseUrl: d.llm_base_url,
      llmApiKey: d.llm_api_key,
      llmProvider: "custom",
    };

    await refreshSession(c, session);

    // Redirect back to config page with success
    return c.redirect("/?oauth=success");
  });

  return app;
}
