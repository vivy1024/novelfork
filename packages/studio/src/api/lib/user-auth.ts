/**
 * User Authentication Module
 *
 * Provides password hashing (PBKDF2), JWT generation/verification (HMAC-SHA256),
 * and external JWT verification for multi-user support.
 *
 * Three auth modes:
 * - none: no authentication (current default, preserves backward compatibility)
 * - builtin: self-managed email+password authentication
 * - external: verify external JWT tokens
 */

import { createHmac, pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2Async = promisify(pbkdf2);

// --- Types ---

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  role: "admin" | "user";
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

export type AuthMode = "none" | "builtin" | "external";

export interface AuthConfig {
  mode: AuthMode;
  secret: string;
  externalSecret?: string;
  adminEmail?: string;
}

// --- Password Hashing (PBKDF2) ---

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LENGTH = 64;
const PBKDF2_DIGEST = "sha512";
const SALT_LENGTH = 32;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await pbkdf2Async(plain, salt as unknown as string, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST);
  // Format: iterations:salt:hash (all base64url)
  return `${PBKDF2_ITERATIONS}:${salt.toString("base64url")}:${derived.toString("base64url")}`;
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  const parts = hash.split(":");
  if (parts.length !== 3) return false;

  const [iterStr, saltB64, hashB64] = parts;
  const iterations = parseInt(iterStr, 10);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;

  const salt = Buffer.from(saltB64, "base64url");
  const expectedHash = Buffer.from(hashB64, "base64url");
  const derived = await pbkdf2Async(plain, salt as unknown as string, iterations, expectedHash.length, PBKDF2_DIGEST);

  return timingSafeEqual(new Uint8Array(derived), new Uint8Array(expectedHash));
}

// --- JWT (HMAC-SHA256) ---

const ACCESS_TOKEN_EXPIRY = 60 * 60; // 1 hour
const REFRESH_TOKEN_EXPIRY = 60 * 60 * 24 * 30; // 30 days

function signJwt(payload: object, secret: string, expiresInSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({ ...payload, iat: now, exp: now + expiresInSeconds }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verifyJwt<T extends object>(token: string, secret: string): T | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerSegment, payloadSegment, signatureSegment] = parts;

  // Verify signature
  const expectedSignature = createHmac("sha256", secret)
    .update(`${headerSegment}.${payloadSegment}`)
    .digest();
  const actualSignature = Buffer.from(signatureSegment, "base64url");

  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(new Uint8Array(actualSignature), new Uint8Array(expectedSignature))
  ) {
    return null;
  }

  // Parse payload
  try {
    const payload = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf-8")) as T & { exp?: number };
    // Check expiration
    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function generateTokenPair(user: AuthUser, secret: string): TokenPair {
  const accessPayload = {
    sub: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    type: "access",
  };
  const refreshPayload = {
    sub: user.id,
    type: "refresh",
  };

  return {
    accessToken: signJwt(accessPayload, secret, ACCESS_TOKEN_EXPIRY),
    refreshToken: signJwt(refreshPayload, secret, REFRESH_TOKEN_EXPIRY),
    expiresIn: ACCESS_TOKEN_EXPIRY,
  };
}

export function verifyAccessToken(token: string, secret: string): AuthUser | null {
  const payload = verifyJwt<{
    sub: string;
    email: string;
    username: string;
    role: "admin" | "user";
    type: string;
  }>(token, secret);

  if (!payload || payload.type !== "access") return null;

  return {
    id: payload.sub,
    email: payload.email,
    username: payload.username,
    role: payload.role,
  };
}

export function verifyRefreshToken(token: string, secret: string): { userId: string } | null {
  const payload = verifyJwt<{ sub: string; type: string }>(token, secret);
  if (!payload || payload.type !== "refresh") return null;
  return { userId: payload.sub };
}

export function verifyExternalJwt(token: string, secret: string): AuthUser | null {
  const payload = verifyJwt<{
    sub?: string;
    email?: string;
    username?: string;
    preferred_username?: string;
    name?: string;
    role?: "admin" | "user";
  }>(token, secret);

  if (!payload || !payload.sub) return null;

  return {
    id: payload.sub,
    email: payload.email ?? "",
    username: payload.username ?? payload.preferred_username ?? payload.name ?? payload.sub,
    role: payload.role ?? "user",
  };
}

// --- Auth Config ---

let cachedAuthSecret: string | null = null;

export function getOrGenerateAuthSecret(): string {
  if (cachedAuthSecret) return cachedAuthSecret;

  const envSecret = process.env.NOVELFORK_AUTH_SECRET?.trim();
  if (envSecret) {
    cachedAuthSecret = envSecret;
    return envSecret;
  }

  // Auto-generate a secret for this process lifetime
  cachedAuthSecret = randomBytes(32).toString("base64url");
  return cachedAuthSecret;
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}
