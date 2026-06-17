/**
 * Turn Memory Extractor — rule-based extraction of decisions and learnings
 * from assistant messages. Runs at turn-end with zero cost (no LLM).
 *
 * Captures:
 * - Decisions: "I chose X because Y", "我选择了 X", "方案 A 优于 B"
 * - Learnings: "踩坑", "根因是", "the root cause is", "lesson learned"
 * - Discoveries: "发现", "原来是", "turns out"
 */

import { appendFile, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

// ── Types ────────────────────────────────────────────────────────────────

export interface MemoryEntry {
  timestamp: string;
  type: "decision" | "learning" | "discovery";
  content: string;
  context?: string;
  /** Decay score: 1.0 = fresh, decays over time */
  score?: number;
}

export interface TurnMemoryConfig {
  /** Working directory (used to resolve .narrafork/memory/) */
  workDir: string;
  /** Max entries per file before aging kicks in */
  maxEntries?: number;
  /** Whether to skip extraction (e.g., in tests) */
  disabled?: boolean;
}

// ── Pattern Matching ─────────────────────────────────────────────────────

const DECISION_PATTERNS: RegExp[] = [
  // Chinese
  /(?:我|我们)?选择了?(.{5,80})(?:因为|原因是|考虑到)/u,
  /方案\s*([A-Za-z\d]).*(?:优于|胜出|更适合)/u,
  /决定(.{5,80})(?:而不是|而非|放弃)/u,
  /不做(.{5,60})(?:原因|因为)/u,
  // English
  /I (?:chose|picked|decided on|went with)\s+(.{5,80})(?:\s+because|\s+since|\s+as)/i,
  /(?:choosing|using)\s+(.{5,80})\s+(?:over|instead of)\s+(.{5,80})/i,
];

const LEARNING_PATTERNS: RegExp[] = [
  // Chinese
  /踩坑[：:]\s*(.{5,120})/u,
  /根因[是为：:]\s*(.{5,120})/u,
  /教训[是：:]\s*(.{5,120})/u,
  /关键发现[：:]\s*(.{5,120})/u,
  // English
  /root cause[:\s]+(.{5,120})/i,
  /lesson learned[:\s]+(.{5,120})/i,
  /(?:the|a) bug (?:was|is) (?:caused by|due to)\s+(.{5,120})/i,
  /turns out[:\s]+(.{5,120})/i,
];

const DISCOVERY_PATTERNS: RegExp[] = [
  // Chinese
  /发现(.{5,80})(?:原来|其实|实际上)/u,
  /原来(?:是)?(.{5,80})/u,
  // English
  /(?:I |we )?(?:found|discovered|noticed) (?:that )?(.{5,120})/i,
  /(?:it turns out|apparently|interestingly)[,:\s]+(.{5,120})/i,
];

// ── Extraction Logic ─────────────────────────────────────────────────────

export function extractMemories(assistantContent: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  const timestamp = new Date().toISOString();

  // Split into paragraphs for context
  const paragraphs = assistantContent.split(/\n\n+/);

  for (const para of paragraphs) {
    if (para.length < 10) continue;

    for (const pattern of DECISION_PATTERNS) {
      const match = pattern.exec(para);
      if (match) {
        entries.push({
          timestamp,
          type: "decision",
          content: match[0].slice(0, 200),
          context: para.slice(0, 300),
        });
        break; // one match per paragraph
      }
    }

    for (const pattern of LEARNING_PATTERNS) {
      const match = pattern.exec(para);
      if (match) {
        entries.push({
          timestamp,
          type: "learning",
          content: match[0].slice(0, 200),
          context: para.slice(0, 300),
        });
        break;
      }
    }

    for (const pattern of DISCOVERY_PATTERNS) {
      const match = pattern.exec(para);
      if (match) {
        entries.push({
          timestamp,
          type: "discovery",
          content: match[0].slice(0, 200),
          context: para.slice(0, 300),
        });
        break;
      }
    }
  }

  // Deduplicate by content similarity
  return deduplicateEntries(entries);
}

function deduplicateEntries(entries: MemoryEntry[]): MemoryEntry[] {
  const seen = new Set<string>();
  return entries.filter(entry => {
    const key = entry.content.slice(0, 50).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Persistence ──────────────────────────────────────────────────────────

function getMemoryDir(workDir: string): string {
  return join(workDir, ".narrafork", "memory");
}

function getFilePath(workDir: string, type: "decision" | "learning" | "discovery"): string {
  const dir = getMemoryDir(workDir);
  if (type === "decision") return join(dir, "decisions.jsonl");
  if (type === "learning") return join(dir, "learnings.jsonl");
  return join(dir, "discoveries.jsonl");
}

export async function persistMemories(entries: MemoryEntry[], config: TurnMemoryConfig): Promise<number> {
  if (config.disabled || entries.length === 0) return 0;

  const dir = getMemoryDir(config.workDir);

  // Ensure directory exists
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  let persisted = 0;

  // Group entries by type and append to respective files
  for (const entry of entries) {
    const filePath = getFilePath(config.workDir, entry.type);
    const line = JSON.stringify(entry) + "\n";
    await appendFile(filePath, line, "utf-8");
    persisted++;
  }

  return persisted;
}

// ── Memory Aging ─────────────────────────────────────────────────────────

/**
 * Age existing memories: assign decay scores based on age, prune old entries.
 * Call periodically (e.g., on session start or after N turns).
 */
export async function ageMemories(config: TurnMemoryConfig): Promise<{ pruned: number; remaining: number }> {
  const maxEntries = config.maxEntries ?? 100;
  const dir = getMemoryDir(config.workDir);
  let pruned = 0;
  let remaining = 0;

  for (const type of ["decision", "learning", "discovery"] as const) {
    const filePath = getFilePath(config.workDir, type);
    let lines: string[];
    try {
      const content = await readFile(filePath, "utf-8");
      lines = content.trim().split("\n").filter(Boolean);
    } catch {
      continue; // file doesn't exist yet
    }

    if (lines.length <= maxEntries) {
      remaining += lines.length;
      continue;
    }

    // Parse, score, and prune
    const entries: (MemoryEntry & { _line: string })[] = [];
    const now = Date.now();
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as MemoryEntry;
        const age = now - new Date(entry.timestamp).getTime();
        const dayAge = age / (1000 * 60 * 60 * 24);
        // Half-life of 30 days
        entry.score = Math.exp(-0.693 * dayAge / 30);
        entries.push({ ...entry, _line: line });
      } catch {
        // skip malformed lines
      }
    }

    // Sort by score descending, keep top maxEntries
    entries.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const kept = entries.slice(0, maxEntries);
    const keptLines = kept.map(e => e._line);

    pruned += entries.length - kept.length;
    remaining += kept.length;

    await writeFile(filePath, keptLines.join("\n") + "\n", "utf-8");
  }

  return { pruned, remaining };
}

// ── Integration Hook ─────────────────────────────────────────────────────

/**
 * Main entry point: extract and persist memories from an assistant turn.
 * Designed to be called fire-and-forget at turn-end.
 */
export async function extractAndPersistTurnMemories(
  assistantContent: string,
  config: TurnMemoryConfig,
): Promise<void> {
  if (config.disabled) return;
  try {
    const entries = extractMemories(assistantContent);
    if (entries.length > 0) {
      await persistMemories(entries, config);
      console.log(JSON.stringify({
        component: "turn-memory-extractor",
        event: "extracted",
        count: entries.length,
        types: entries.map(e => e.type),
      }));
    }
  } catch (err) {
    // Non-fatal — memory extraction should never break the main flow
    console.warn(`[turn-memory-extractor] Failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
