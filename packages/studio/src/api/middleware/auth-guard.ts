/**
 * Auth Guard Middleware
 *
 * Protects API routes based on the configured auth mode:
 * - none: all requests pass through (backward compatible)
 * - builtin: verify access token from Authorization header
 * - external: verify external JWT from Authorization header
 */

import type { Context, Next } from "hono";
import {
  verifyAccessToken,
  verifyExternalJwt,
  extractBearerToken,
  getOrGenerateAuthSecret,
  type AuthUser,
} from "../lib/user-auth.js";
import { getAuthMode, getExternalJwtSecret } from "../lib/auth-config.js";

// Augment Hono context to carry authenticated user
declare module "hono" {
  interface ContextVariableMap {
    authUser: AuthUser | null;
  }
}

/**
 * Auth guard middleware.
 * When auth mode is "none", sets authUser to null and passes through.
 * Otherwise, requires a valid Bearer token.
 */
export async function authGuard(c: Context, next: Next): Promise<Response | void> {
  const mode = getAuthMode();

  if (mode === "none") {
    c.set("authUser", null);
    return next();
  }

  const token = extractBearerToken(c.req.header("authorization"));
  if (!token) {
    return c.json({ error: "Authorization required" }, 401);
  }

  let user: AuthUser | null = null;

  if (mode === "builtin") {
    const secret = getOrGenerateAuthSecret();
    user = verifyAccessToken(token, secret);
  } else if (mode === "external") {
    const externalSecret = getExternalJwtSecret();
    if (!externalSecret) {
      return c.json({ error: "External auth not configured" }, 503);
    }
    user = verifyExternalJwt(token, externalSecret);
  }

  if (!user) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  c.set("authUser", user);
  return next();
}

/**
 * Admin-only guard. Must be used after authGuard.
 */
export async function adminGuard(c: Context, next: Next): Promise<Response | void> {
  const mode = getAuthMode();
  if (mode === "none") return next();

  const user = c.get("authUser");
  if (!user || user.role !== "admin") {
    return c.json({ error: "Admin access required" }, 403);
  }

  return next();
}
