/**
 * Security validation utilities for Studio API.
 * Ported from PR #97 (PapainTea) — ReDoS prevention, path traversal, port parsing.
 */

const SAFE_UPLOAD_FILE_ID = /^[A-Za-z0-9-]{1,64}$/;
const MAX_IMPORT_PATTERN_LENGTH = 160;
const SAFE_IMPORT_PATTERN = /^[\p{L}\p{N}\s[\]\\.^$*+?{}\-，。:：、_]+$/u;

/** Validates fileId against whitelist to prevent path traversal. */
export function isSafeUploadFileId(fileId: string): boolean {
  return typeof fileId === "string" && SAFE_UPLOAD_FILE_ID.test(fileId);
}

/** Validates bookId — blocks traversal sequences and null bytes. */
export function isSafeBookId(bookId: string): boolean {
  return (
    typeof bookId === "string"
    && bookId.length > 0
    && bookId.trim() === bookId
    && bookId !== "."
    && bookId !== ".."
    && !bookId.includes("..")
    && !/[\\/\0]/.test(bookId)
  );
}

/**
 * Builds a regex from user-provided pattern with ReDoS prevention.
 * Blocks grouping, alternation, backreferences, and lookahead/behind.
 */
export function buildImportRegex(pattern: string): RegExp {
  const normalized = String(pattern ?? "").trim();
  if (!normalized) {
    throw new Error("Import pattern is required");
  }
  if (normalized.length > MAX_IMPORT_PATTERN_LENGTH) {
    throw new Error(`Import pattern too long (max ${MAX_IMPORT_PATTERN_LENGTH} chars)`);
  }
  if (/[()|]/.test(normalized) || /\\[1-9]/.test(normalized) || normalized.includes("(?")) {
    throw new Error("Import pattern uses unsafe regex features");
  }
  if (!SAFE_IMPORT_PATTERN.test(normalized)) {
    throw new Error("Import pattern is invalid");
  }

  try {
    return new RegExp(normalized, "g");
  } catch {
    throw new Error("Import pattern is invalid");
  }
}

/** Strips filesystem paths from upload responses — only returns relative/safe fields. */
export function createUploadResponse(input: {
  readonly fileId: string;
  readonly size: number;
  readonly chapterCount: number;
  readonly firstTitle: string;
  readonly totalChars: number;
}): {
  readonly ok: true;
  readonly fileId: string;
  readonly size: number;
  readonly chapterCount: number;
  readonly firstTitle: string;
  readonly totalChars: number;
} {
  return {
    ok: true,
    fileId: input.fileId,
    size: input.size,
    chapterCount: input.chapterCount,
    firstTitle: input.firstTitle,
    totalChars: input.totalChars,
  };
}

/** Parses port from environment with safe fallback. */
export function resolveServerPort(env: Record<string, string | undefined> = process.env): number {
  const raw = env.INKOS_STUDIO_PORT ?? env.PORT ?? "4567";
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4567;
}
