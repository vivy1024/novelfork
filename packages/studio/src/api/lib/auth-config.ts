/**
 * Auth Configuration
 *
 * Reads auth mode from environment variable or user config.
 * Defaults to "none" for backward compatibility.
 */

import type { AuthMode } from "./user-auth.js";

let cachedMode: AuthMode | undefined;

export function getAuthMode(): AuthMode {
  if (cachedMode !== undefined) return cachedMode;

  const envMode = process.env.NOVELFORK_AUTH_MODE?.trim().toLowerCase();
  if (envMode === "builtin" || envMode === "external") {
    cachedMode = envMode;
    return envMode;
  }

  cachedMode = "none";
  return "none";
}

export function getExternalJwtSecret(): string | undefined {
  return process.env.NOVELFORK_EXTERNAL_JWT_SECRET?.trim() || undefined;
}

/** Reset cached mode (for testing) */
export function resetAuthModeCache(): void {
  cachedMode = undefined;
}
