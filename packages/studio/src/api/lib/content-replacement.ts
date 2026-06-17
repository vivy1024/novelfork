/**
 * Content Replacement — store large tool results as references to save context.
 *
 * When tool results exceed a size threshold, the full content is stored
 * in a replacement map and the message content is replaced with a compact
 * reference. This dramatically reduces context window consumption for
 * tools that return large outputs (file reads, search results, etc.).
 *
 * The reference includes enough metadata for the model to know what's there
 * without needing to see the full content again.
 *
 * Based on legnacode's applyToolResultBudget / contentReplacementState.
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface ContentReference {
  id: string;
  toolName: string;
  originalSize: number;
  preview: string;
  storedAt: number;
}

export interface ContentReplacementState {
  /** Map of reference ID → full content */
  store: Map<string, string>;
  /** Metadata for each reference */
  refs: Map<string, ContentReference>;
  /** Total bytes stored */
  totalBytes: number;
}

// ── Constants ────────────────────────────────────────────────────────────

/** Threshold above which content gets replaced with a reference */
const REPLACEMENT_THRESHOLD = 8192; // 8KB

/** Max total stored content before eviction */
const MAX_STORED_BYTES = 2 * 1024 * 1024; // 2MB

/** Preview length included in the reference marker */
const PREVIEW_LENGTH = 200;

/** Tools whose output should NEVER be replaced (always shown in full) */
const NEVER_REPLACE_TOOLS = new Set([
  "Bash", // Bash output is usually short and critical for debugging
  "WebFetch", // User explicitly requested this content
]);

// ── State Management ─────────────────────────────────────────────────────

export function createContentReplacementState(): ContentReplacementState {
  return {
    store: new Map(),
    refs: new Map(),
    totalBytes: 0,
  };
}

// ── Core Logic ───────────────────────────────────────────────────────────

let refCounter = 0;

function generateRefId(): string {
  refCounter++;
  return `ref_${Date.now().toString(36)}_${refCounter.toString(36)}`;
}

/**
 * Check if a tool result should be replaced with a reference.
 */
export function shouldReplace(toolName: string, content: string): boolean {
  if (NEVER_REPLACE_TOOLS.has(toolName)) return false;
  return content.length > REPLACEMENT_THRESHOLD;
}

/**
 * Store content and return a compact reference string.
 */
export function replaceWithReference(
  state: ContentReplacementState,
  toolName: string,
  content: string,
): string {
  // Evict oldest entries if we're over the limit
  while (state.totalBytes + content.length > MAX_STORED_BYTES && state.store.size > 0) {
    const oldestId = state.refs.keys().next().value;
    if (oldestId) {
      evictReference(state, oldestId);
    } else {
      break;
    }
  }

  const id = generateRefId();
  const preview = content.slice(0, PREVIEW_LENGTH).replace(/\n/g, " ");
  const sizeKB = Math.round(content.length / 1024);

  const ref: ContentReference = {
    id,
    toolName,
    originalSize: content.length,
    preview,
    storedAt: Date.now(),
  };

  state.store.set(id, content);
  state.refs.set(id, ref);
  state.totalBytes += content.length;

  return `[${id} — ${toolName} output, ${sizeKB}KB stored]\n预览: ${preview}${content.length > PREVIEW_LENGTH ? "…" : ""}`;
}

/**
 * Expand a reference back to full content. Returns null if not found.
 */
export function expandReference(state: ContentReplacementState, refId: string): string | null {
  return state.store.get(refId) ?? null;
}

/**
 * Remove a stored reference (e.g., after it's no longer relevant).
 */
export function evictReference(state: ContentReplacementState, refId: string): void {
  const content = state.store.get(refId);
  if (content) {
    state.totalBytes -= content.length;
    state.store.delete(refId);
    state.refs.delete(refId);
  }
}

/**
 * Apply content replacement to a tool result string.
 * Returns the original content if below threshold, or a reference string if replaced.
 */
export function applyContentReplacement(
  state: ContentReplacementState,
  toolName: string,
  content: string,
): string {
  if (!shouldReplace(toolName, content)) {
    return content;
  }
  return replaceWithReference(state, toolName, content);
}

/**
 * Get stats about the replacement state.
 */
export function getReplacementStats(state: ContentReplacementState): {
  storedCount: number;
  totalBytes: number;
  totalKB: number;
} {
  return {
    storedCount: state.store.size,
    totalBytes: state.totalBytes,
    totalKB: Math.round(state.totalBytes / 1024),
  };
}
