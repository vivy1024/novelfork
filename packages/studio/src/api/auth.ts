import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { getSignedCookie, setSignedCookie } from "hono/cookie";
import { ApiError } from "./errors.js";

const SESSION_COOKIE_NAME = "inkos_session";
const DEFAULT_SUBAPI_ISSUER = "sub2api";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

// --- Nonce store (防 replay 攻击) ---

const usedNonces = new Map<string, number>();

setInterval(() => {
  const now = Date.now();
  for (const [jti, exp] of usedNonces) {
    if (now >= exp) usedNonces.delete(jti);
  }
}, 60_000).unref();

export function consumeNonce(jti: string, expMs: number): boolean {
  if (usedNonces.has(jti)) return false;
  usedNonces.set(jti, expMs);
  return true;
}

export interface InkosSession {
  userId: number;
  email: string;
  role: string;
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
  llmProvider?: string;
}

export interface PublicInkosSession {
  userId: number;
  email: string;
  role: string;
}

interface LaunchClaims {
  user_id: number;
  email: string;
  role: string;
  iss: string;
  iat: number;
  exp: number;
  jti?: string;
  llm_base_url?: string;
  llm_api_key?: string;
  llm_model?: string;
  llm_provider?: string;
}

function decodeBase64Url(value: string): string {
  try {
    return Buffer.from(value, "base64url").toString("utf-8");
  } catch {
    throw new Error("Invalid launch token.");
  }
}

function parseJsonSegment<T>(value: string): T {
  try {
    return JSON.parse(decodeBase64Url(value)) as T;
  } catch {
    throw new Error("Invalid launch token.");
  }
}

function parseNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid launch token ${field}.`);
  }
  return value;
}

function parseString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid launch token ${field}.`);
  }
  return value.trim();
}

function parseUserId(value: unknown): number {
  const userId = parseNumber(value, "user_id");
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("Invalid launch token user_id.");
  }
  return userId;
}

function verifySignature(token: string, secret: string): LaunchClaims {
  const normalizedSecret = secret.trim();
  if (!normalizedSecret) {
    throw new Error("Launch token secret is required.");
  }

  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error("Invalid launch token.");
  }

  const [headerSegment, payloadSegment, signatureSegment] = parts;
  const header = parseJsonSegment<{ alg?: string; typ?: string }>(headerSegment);
  if (header.alg !== "HS256") {
    throw new Error("Invalid launch token.");
  }

  const expectedSignature = createHmac("sha256", normalizedSecret)
    .update(`${headerSegment}.${payloadSegment}`)
    .digest();
  const actualSignature = Buffer.from(signatureSegment, "base64url");
  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(new Uint8Array(actualSignature), new Uint8Array(expectedSignature))
  ) {
    throw new Error("Invalid launch token.");
  }

  return parseJsonSegment<LaunchClaims>(payloadSegment);
}

function getExpectedIssuer(): string {
  return process.env.SUBAPI_ISSUER?.trim() || DEFAULT_SUBAPI_ISSUER;
}

function getCookieSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) {
    throw new ApiError(503, "SESSION_SECRET_MISSING", "Session storage is not configured.");
  }
  return secret;
}

function getLaunchSecret(): string {
  const secret = process.env.SUBAPI_SHARED_SECRET?.trim();
  if (!secret) {
    throw new ApiError(503, "SUBAPI_SHARED_SECRET_MISSING", "Launch authentication is not configured.");
  }
  return secret;
}

export function verifyLaunchToken(token: string, secret: string): InkosSession {
  const claims = verifySignature(token, secret);
  const issuer = parseString(claims.iss, "issuer");
  if (issuer !== getExpectedIssuer()) {
    throw new Error("Invalid launch token issuer.");
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = parseNumber(claims.exp, "exp");
  if (exp <= now) {
    throw new Error("Launch token expired.");
  }

  parseNumber(claims.iat, "iat");

  if (typeof claims.jti !== "string" || !claims.jti.trim()) {
    throw new Error("Launch token missing jti.");
  }
  if (!consumeNonce(claims.jti, exp * 1000)) {
    throw new Error("Launch token already used.");
  }

  return {
    userId: parseUserId(claims.user_id),
    email: parseString(claims.email, "email"),
    role: parseString(claims.role, "role"),
    llmBaseUrl: typeof claims.llm_base_url === "string" && claims.llm_base_url.trim() ? claims.llm_base_url.trim() : undefined,
    llmApiKey: typeof claims.llm_api_key === "string" && claims.llm_api_key.trim() ? claims.llm_api_key.trim() : undefined,
    llmModel: typeof claims.llm_model === "string" && claims.llm_model.trim() ? claims.llm_model.trim() : undefined,
    llmProvider: typeof claims.llm_provider === "string" && claims.llm_provider.trim() ? claims.llm_provider.trim() : undefined,
  };
}

export function toPublicSession(session: InkosSession): PublicInkosSession {
  return {
    userId: session.userId,
    email: session.email,
    role: session.role,
  };
}

export async function establishLaunchSession(c: Context, token: string): Promise<InkosSession> {
  const session = verifyLaunchToken(token, getLaunchSecret());
  // Persist full session (including llmApiKey/llmBaseUrl) for multi-user isolation
  await setSignedCookie(
    c,
    SESSION_COOKIE_NAME,
    JSON.stringify(session),
    getCookieSecret(),
    {
      httpOnly: true,
      path: "/",
      sameSite: "Lax",
      maxAge: SESSION_MAX_AGE_SECONDS,
      secure: process.env.NODE_ENV === "production",
    },
  );
  return session;
}

export async function readSessionFromCookie(c: Context): Promise<InkosSession | null> {
  const raw = await getSignedCookie(c, getCookieSecret(), SESSION_COOKIE_NAME);
  if (typeof raw !== "string" || !raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<InkosSession>;
    return {
      userId: parseUserId(parsed.userId),
      email: parseString(parsed.email, "email"),
      role: parseString(parsed.role, "role"),
      llmBaseUrl: typeof parsed.llmBaseUrl === "string" && parsed.llmBaseUrl.trim() ? parsed.llmBaseUrl.trim() : undefined,
      llmApiKey: typeof parsed.llmApiKey === "string" && parsed.llmApiKey.trim() ? parsed.llmApiKey.trim() : undefined,
      llmModel: typeof parsed.llmModel === "string" && parsed.llmModel.trim() ? parsed.llmModel.trim() : undefined,
      llmProvider: typeof parsed.llmProvider === "string" && parsed.llmProvider.trim() ? parsed.llmProvider.trim() : undefined,
    };
  } catch {
    return null;
  }
}

export async function requireSession(c: Context): Promise<InkosSession> {
  const session = await readSessionFromCookie(c);
  if (!session) {
    throw new ApiError(401, "UNAUTHORIZED", "Authentication required.");
  }
  return session;
}

export async function refreshSession(c: Context, session: InkosSession): Promise<void> {
  await setSignedCookie(c, SESSION_COOKIE_NAME, JSON.stringify(session), getCookieSecret(), {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: process.env.NODE_ENV === "production",
  });
}
