/**
 * Prompt Dump — captures complete LLM request bodies for debugging.
 *
 * When enabled, saves the full messages array + system prompt + tools
 * to a timestamped file. Invaluable for diagnosing model behavior.
 *
 * Usage: Set PROMPT_DUMP=1 env var, or call enablePromptDump() programmatically.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

let dumpEnabled = process.env.PROMPT_DUMP === "1" || process.env.PROMPT_DUMP === "true";
let dumpDir = process.env.PROMPT_DUMP_DIR || "";

// Sync with user config setting (dumpApiRequests) — called on first generate
let configSynced = false;
async function syncWithConfig(): Promise<void> {
  if (configSynced) return;
  configSynced = true;
  try {
    const { loadUserConfig } = await import("./user-config-service.js");
    const config = await loadUserConfig();
    if (config.runtimeControls?.dumpApiRequests) {
      dumpEnabled = true;
    }
  } catch { /* non-fatal */ }
}
let dumpCounter = 0;

export function enablePromptDump(dir?: string): void {
  dumpEnabled = true;
  if (dir) dumpDir = dir;
}

export function disablePromptDump(): void {
  dumpEnabled = false;
}

export async function isPromptDumpEnabled(): Promise<boolean> {
  await syncWithConfig();
  return dumpEnabled;
}

export interface PromptDumpData {
  sessionId?: string;
  timestamp: string;
  systemPrompt?: string;
  messages: unknown[];
  tools?: unknown[];
  model?: string;
  maxOutputTokens?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Dump the prompt to a file if enabled. Fire-and-forget.
 * Returns the file path if dumped, null otherwise.
 */
export async function dumpPrompt(data: PromptDumpData): Promise<string | null> {
  if (!dumpEnabled) return null;

  try {
    const dir = dumpDir || join(process.cwd(), ".narrafork", "prompt-dumps");
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    dumpCounter++;
    const filename = `${data.timestamp.replace(/[:.]/g, "-")}_${dumpCounter.toString().padStart(4, "0")}.json`;
    const filePath = join(dir, filename);

    const content = JSON.stringify({
      ...data,
      _meta: {
        messageCount: data.messages.length,
        toolCount: data.tools?.length ?? 0,
        systemPromptLength: data.systemPrompt?.length ?? 0,
        totalChars: JSON.stringify(data.messages).length,
      },
    }, null, 2);

    await writeFile(filePath, content, "utf-8");
    return filePath;
  } catch (err) {
    console.warn(`[prompt-dump] Failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Lightweight version: dump only the last N messages (for quick inspection).
 */
export async function dumpPromptTail(data: PromptDumpData, tailCount: number = 10): Promise<string | null> {
  if (!dumpEnabled) return null;
  const tailMessages = data.messages.slice(-tailCount);
  return dumpPrompt({ ...data, messages: tailMessages, metadata: { ...data.metadata, tailOnly: true, originalCount: data.messages.length } });
}
