/**
 * Auth Users Routes
 *
 * Provides user registration, login, token refresh, and profile endpoints
 * for the builtin authentication mode.
 *
 * Routes:
 * - POST /auth/register — create user (builtin mode only)
 * - POST /auth/login — verify credentials, return token pair
 * - POST /auth/refresh — exchange refresh token for new access token
 * - GET /auth/me — return current user info
 * - POST /auth/logout — invalidate session (client-side token discard)
 */

import { Hono } from "hono";
import {
  verifyPassword,
  generateTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  getOrGenerateAuthSecret,
  extractBearerToken,
  type AuthUser,
} from "../lib/user-auth.js";
import {
  createUser,
  getUserByEmail,
  getUserById,
  getUserCount,
  incrementTokenVersion,
  listUsers,
  toAuthUser,
} from "../lib/user-store.js";
import { getAuthMode } from "../lib/auth-config.js";

// --- Rate Limiting ---

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const loginAttempts = new Map<string, RateLimitEntry>();
const registerAttempts = new Map<string, RateLimitEntry>();

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const REGISTER_MAX_ATTEMPTS = 3;
const REGISTER_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    ?? c.req.header("x-real-ip")
    ?? "unknown";
}

function checkRateLimit(
  store: Map<string, RateLimitEntry>,
  key: string,
  maxAttempts: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= maxAttempts) {
    return false;
  }

  entry.count++;
  return true;
}

const authUsersRouter = new Hono();

// --- POST /auth/register ---
authUsersRouter.post("/auth/register", async (c) => {
  const mode = getAuthMode();
  if (mode !== "builtin") {
    return c.json({ error: "Registration is only available in builtin auth mode" }, 403);
  }

  // Rate limit
  const ip = getClientIp(c);
  if (!checkRateLimit(registerAttempts, ip, REGISTER_MAX_ATTEMPTS, REGISTER_WINDOW_MS)) {
    return c.json({ error: "Too many attempts, try again later" }, 429);
  }

  let email: string | undefined;
  let username: string | undefined;
  let password: string | undefined;
  try {
    const body = await c.req.json<{ email?: string; username?: string; password?: string }>();
    email = body.email;
    username = body.username;
    password = body.password;
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  if (!email?.trim() || !username?.trim() || !password) {
    return c.json({ error: "email, username, and password are required" }, 400);
  }

  if (password.length < 6) {
    return c.json({ error: "Password must be at least 6 characters" }, 400);
  }

  try {
    const stored = await createUser({ email, username, password });
    const authUser: AuthUser = toAuthUser(stored);
    const secret = getOrGenerateAuthSecret();
    const tokens = generateTokenPair(authUser, secret);

    return c.json({
      user: authUser,
      ...tokens,
    }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Registration failed";
    return c.json({ error: message }, 409);
  }
});

// --- POST /auth/login ---
authUsersRouter.post("/auth/login", async (c) => {
  const mode = getAuthMode();
  if (mode === "none") {
    return c.json({ error: "Authentication is disabled" }, 403);
  }
  if (mode !== "builtin") {
    return c.json({ error: "Login is only available in builtin auth mode" }, 403);
  }

  // Rate limit
  const ip = getClientIp(c);
  if (!checkRateLimit(loginAttempts, ip, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS)) {
    return c.json({ error: "Too many attempts, try again later" }, 429);
  }

  let email: string | undefined;
  let password: string | undefined;
  try {
    const body = await c.req.json<{ email?: string; password?: string }>();
    email = body.email;
    password = body.password;
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  if (!email?.trim() || !password) {
    return c.json({ error: "email and password are required" }, 400);
  }

  const stored = getUserByEmail(email);
  if (!stored) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const valid = await verifyPassword(password, stored.passwordHash);
  if (!valid) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const authUser: AuthUser = toAuthUser(stored);
  const secret = getOrGenerateAuthSecret();
  const tokens = generateTokenPair(authUser, secret, stored.tokenVersion);

  return c.json({
    user: authUser,
    ...tokens,
  });
});

// --- POST /auth/refresh ---
authUsersRouter.post("/auth/refresh", async (c) => {
  const mode = getAuthMode();
  if (mode !== "builtin") {
    return c.json({ error: "Token refresh is only available in builtin auth mode" }, 403);
  }

  let refreshToken: string | undefined;
  try {
    const body = await c.req.json<{ refreshToken?: string }>();
    refreshToken = body.refreshToken;
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  if (!refreshToken) {
    return c.json({ error: "refreshToken is required" }, 400);
  }

  const secret = getOrGenerateAuthSecret();
  const result = verifyRefreshToken(refreshToken, secret);
  if (!result) {
    return c.json({ error: "Invalid or expired refresh token" }, 401);
  }

  const stored = getUserById(result.userId);
  if (!stored) {
    return c.json({ error: "User not found" }, 401);
  }

  // Verify token version — reject if token was revoked
  if (result.tokenVersion !== stored.tokenVersion) {
    return c.json({ error: "Token has been revoked" }, 401);
  }

  const authUser: AuthUser = toAuthUser(stored);
  const tokens = generateTokenPair(authUser, secret, stored.tokenVersion);

  return c.json({
    user: authUser,
    ...tokens,
  });
});

// --- GET /auth/me ---
authUsersRouter.get("/auth/me", async (c) => {
  const mode = getAuthMode();
  if (mode === "none") {
    // In none mode, return a default anonymous user
    return c.json({
      user: { id: "anonymous", email: "", username: "Anonymous", role: "admin" },
      mode: "none",
    });
  }

  const token = extractBearerToken(c.req.header("authorization"));
  if (!token) {
    return c.json({ error: "Authorization header required" }, 401);
  }

  const secret = getOrGenerateAuthSecret();
  const user = verifyAccessToken(token, secret);
  if (!user) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  return c.json({ user, mode });
});

// --- POST /auth/logout ---
authUsersRouter.post("/auth/logout", async (c) => {
  // Revoke all refresh tokens by incrementing token_version
  const token = extractBearerToken(c.req.header("authorization"));
  if (token) {
    const secret = getOrGenerateAuthSecret();
    const user = verifyAccessToken(token, secret);
    if (user) {
      incrementTokenVersion(user.id);
    }
  }
  return c.json({ success: true });
});

// --- GET /auth/users (admin only) ---
authUsersRouter.get("/auth/users", async (c) => {
  const mode = getAuthMode();
  if (mode === "none") {
    return c.json({ users: [] });
  }

  const token = extractBearerToken(c.req.header("authorization"));
  if (!token) {
    return c.json({ error: "Authorization header required" }, 401);
  }

  const secret = getOrGenerateAuthSecret();
  const user = verifyAccessToken(token, secret);
  if (!user || user.role !== "admin") {
    return c.json({ error: "Admin access required" }, 403);
  }

  return c.json({ users: listUsers() });
});

// --- GET /auth/status ---
authUsersRouter.get("/auth/status", async (c) => {
  const mode = getAuthMode();
  const userCount = mode === "builtin" ? getUserCount() : 0;

  return c.json({
    mode,
    userCount,
    registrationOpen: mode === "builtin",
    needsSetup: mode === "builtin" && userCount === 0,
  });
});

export function createAuthUsersRouter() {
  return authUsersRouter;
}
