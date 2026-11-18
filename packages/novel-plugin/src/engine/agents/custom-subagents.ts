/**
 * 按书存储的自定义子代理工坊（Custom Subagents Store）。
 *
 * 允许作者从内置子代理复制或从零新建专属帮手，配置名称、职责、提示词、默认模型与安全工具集。
 * 严格沿用 ROSTER_FORBIDDEN_TOOLS 护栏：绝不允许自定义子代理直接拿到写权威源或文件系统写入工具。
 */

import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { writeFileAtomic } from "../writing-resource/atomic-write.js";
import {
  CUSTOM_SUBAGENT_ALLOWED_TOOLS,
  type CustomSubagentConfig,
} from "./custom-subagents-shared.js";
import { NOVEL_SUBAGENT_ROSTER, ROSTER_FORBIDDEN_TOOLS } from "./roster.js";

export { CUSTOM_SUBAGENT_ALLOWED_TOOLS, type CustomSubagentConfig };

export const CUSTOM_SUBAGENTS_RELATIVE_PATH = join("story", "custom_subagents.json");

const FORBIDDEN_SET = new Set(ROSTER_FORBIDDEN_TOOLS);

function sanitizeTools(tools: unknown): string[] {
  if (!Array.isArray(tools)) return ["chapter.read", "lore.read", "memory.read"];
  const cleaned = tools
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.trim())
    .filter((t) => !FORBIDDEN_SET.has(t));
  return cleaned.length > 0 ? Array.from(new Set(cleaned)) : ["chapter.read", "lore.read", "memory.read"];
}

function sanitizeId(raw: unknown, existingIds: ReadonlySet<string>): string {
  const base = typeof raw === "string"
    ? raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "")
    : "";
  const prefix = base || "custom-agent";
  if (!existingIds.has(prefix) && !NOVEL_SUBAGENT_ROSTER.some((t) => t.id === prefix)) {
    return prefix;
  }
  let idx = 2;
  while (existingIds.has(`${prefix}-${idx}`) || NOVEL_SUBAGENT_ROSTER.some((t) => t.id === `${prefix}-${idx}`)) {
    idx += 1;
  }
  return `${prefix}-${idx}`;
}

export async function readCustomSubagents(bookRoot: string): Promise<CustomSubagentConfig[]> {
  const filePath = join(bookRoot, CUSTOM_SUBAGENTS_RELATIVE_PATH);
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { subagents?: unknown };
    if (!Array.isArray(parsed?.subagents)) return [];
    const results: CustomSubagentConfig[] = [];
    for (const item of parsed.subagents) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const id = typeof rec.id === "string" ? rec.id.trim() : "";
      const nameZh = typeof rec.nameZh === "string" ? rec.nameZh.trim() : "";
      if (!id || !nameZh) continue;
      results.push({
        id,
        nameZh,
        description: typeof rec.description === "string" ? rec.description.trim() : "",
        tools: sanitizeTools(rec.tools),
        prompt: typeof rec.prompt === "string" ? rec.prompt : "",
        ...(typeof rec.defaultModel === "string" && rec.defaultModel.trim() ? { defaultModel: rec.defaultModel.trim() } : {}),
        ...(typeof rec.basedOn === "string" && rec.basedOn.trim() ? { basedOn: rec.basedOn.trim() } : {}),
        updatedAt: typeof rec.updatedAt === "number" ? rec.updatedAt : Date.now(),
      });
    }
    return results;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeCustomSubagents(bookRoot: string, subagents: readonly CustomSubagentConfig[]): Promise<void> {
  const filePath = join(bookRoot, CUSTOM_SUBAGENTS_RELATIVE_PATH);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFileAtomic(filePath, `${JSON.stringify({ schemaVersion: 1, subagents }, null, 2)}\n`);
}

export interface UpsertCustomSubagentInput {
  readonly id?: string;
  readonly nameZh: string;
  readonly description?: string;
  readonly tools?: readonly string[];
  readonly prompt?: string;
  readonly defaultModel?: string;
  readonly basedOn?: string;
}

export async function createCustomSubagent(
  bookRoot: string,
  input: UpsertCustomSubagentInput,
): Promise<CustomSubagentConfig> {
  const nameZh = input.nameZh.trim();
  if (!nameZh) throw new Error("子代理名称不能为空");
  const existing = await readCustomSubagents(bookRoot);
  const id = sanitizeId(input.id, new Set(existing.map((s) => s.id)));
  const entry: CustomSubagentConfig = {
    id,
    nameZh,
    description: (input.description ?? "").trim(),
    tools: sanitizeTools(input.tools),
    prompt: (input.prompt ?? "").trim(),
    ...(input.defaultModel?.trim() ? { defaultModel: input.defaultModel.trim() } : {}),
    ...(input.basedOn?.trim() ? { basedOn: input.basedOn.trim() } : {}),
    updatedAt: Date.now(),
  };
  await writeCustomSubagents(bookRoot, [...existing, entry]);
  return entry;
}

export async function updateCustomSubagent(
  bookRoot: string,
  id: string,
  patch: Partial<UpsertCustomSubagentInput>,
): Promise<CustomSubagentConfig | null> {
  const existing = await readCustomSubagents(bookRoot);
  const index = existing.findIndex((s) => s.id === id);
  if (index === -1) return null;
  const prev = existing[index]!;
  const nextName = patch.nameZh !== undefined ? patch.nameZh.trim() : prev.nameZh;
  if (!nextName) throw new Error("子代理名称不能为空");
  const updated: CustomSubagentConfig = {
    ...prev,
    nameZh: nextName,
    description: patch.description !== undefined ? patch.description.trim() : prev.description,
    tools: patch.tools !== undefined ? sanitizeTools(patch.tools) : prev.tools,
    prompt: patch.prompt !== undefined ? patch.prompt.trim() : prev.prompt,
    ...(patch.defaultModel !== undefined
      ? (patch.defaultModel.trim() ? { defaultModel: patch.defaultModel.trim() } : {})
      : (prev.defaultModel ? { defaultModel: prev.defaultModel } : {})),
    updatedAt: Date.now(),
  };
  const next = existing.map((item, i) => (i === index ? updated : item));
  await writeCustomSubagents(bookRoot, next);
  return updated;
}

export async function deleteCustomSubagent(bookRoot: string, id: string): Promise<boolean> {
  const existing = await readCustomSubagents(bookRoot);
  const next = existing.filter((s) => s.id !== id);
  if (next.length === existing.length) return false;
  await writeCustomSubagents(bookRoot, next);
  return true;
}
