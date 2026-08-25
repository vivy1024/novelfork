/**
 * 角色内核结算器（kernel reconciler）。
 *
 * 在 settleChapter 事件归约完成后，对出场角色逐个调用 LLM，把本章新增的
 * facts/events + 正文摘录归纳成"这个角色现在是谁"的内核字段覆盖。
 *
 * 自由配置：字段集合完全来自 CharacterKernelConfig.fields（llmExtract=true
 * 的才参与生成），prompt 可被 promptTemplate 覆盖；enabled=false 时整个
 * reconciler 是 no-op。
 */

import { z } from "zod";

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import {
  getCharacterKernel,
  upsertCharacterKernel,
} from "./storage.js";
import {
  buildEntityDictionary,
  resolveEntity,
} from "./entity-dictionary.js";
import {
  DEFAULT_KERNEL_FIELDS,
  type CharacterKernel,
  type CharacterKernelConfig,
  type KernelFieldSpec,
} from "./types.js";

/** 结算器可用的文本生成能力；与 chapter-event-extractor 的 generateText 同形。 */
export type KernelGenerateText = (request: {
  messages: ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  maxTokens?: number;
}) => Promise<{ text: string }>;

const DEFAULT_RECONCILE_PROMPT = [
  "你是网文小说的角色状态维护师。基于「既有内核 + 本章新增事实 + 本章正文摘录」，",
  "更新这个角色此刻的内核字段。只输出严格 JSON 对象，不要解释。",
  "",
  "规则：",
  "- 字段键必须与「待更新字段」列表完全一致，不得增删键。",
  "- short_text 字段 ≤ 30 字；long_text 字段 ≤ 200 字；list 字段输出字符串数组，每项 ≤ 20 字。",
  "- 只写「当前状态」，不写剧情过程。例：写「对 OpenQi 的态度：公开对抗」，不写「他先怀疑再决定对抗」。",
  "- 正文里没有依据的字段输出空串（list 输出空数组），不要编造。",
  "- evidence 数组给出支撑本次更新的 factId/eventId（最多 3 条）。",
].join("\n");

const KernelReconcileResponseSchema = z.object({
  fields: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  evidence: z.array(z.object({
    id: z.string(),
    excerpt: z.string().optional(),
  })).max(5).default([]),
});

export interface KernelReconcilerInput {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly characterId: string;
  readonly config: CharacterKernelConfig;
  readonly chapterExcerpt: string;
  /** 本章与该角色相关的事实/事件（id + 简述）。 */
  readonly relatedRecords: readonly { readonly id: string; readonly brief: string }[];
  readonly generateText: KernelGenerateText;
  readonly now?: () => Date;
}

export type KernelReconcilerResult =
  | { readonly ok: true; readonly kernel: CharacterKernel }
  | { readonly ok: false; readonly reason: "skipped-disabled" | "skipped-no-fields" | "llm-failed" | "parse-failed"; readonly error?: string };

function activeFields(config: CharacterKernelConfig): readonly KernelFieldSpec[] {
  const source = config.fields.length > 0 ? config.fields : DEFAULT_KERNEL_FIELDS;
  return source.filter((field) => field.llmExtract);
}

function formatExistingKernel(kernel: CharacterKernel | undefined, fields: readonly KernelFieldSpec[]): string {
  if (!kernel) return "（无既有内核，首次生成）";
  const lines: string[] = [];
  for (const field of fields) {
    const raw = kernel.fields[field.key];
    const present = typeof raw === "string" ? raw.trim().length > 0 : Array.isArray(raw) && raw.length > 0;
    if (!present) continue;
    const rendered = Array.isArray(raw) ? raw.join(" / ") : String(raw);
    lines.push(`- ${field.label}（${field.key}）：${rendered}`);
  }
  return lines.length > 0 ? lines.join("\n") : "（既有内核字段均为空）";
}

function buildUserPrompt(input: KernelReconcilerInput, fields: readonly KernelFieldSpec[], existing: CharacterKernel | undefined): string {
  const fieldLines = fields.map((field) => {
    const shape = field.kind === "list" ? "string[]" : field.kind === "long_text" ? "≤200字" : "≤30字";
    return `- ${field.key}（${field.label}，${shape}）`;
  }).join("\n");
  const relatedLines = input.relatedRecords.length > 0
    ? input.relatedRecords.map((record) => `- [${record.id}] ${record.brief}`).join("\n")
    : "（本章没有与该角色相关的新事实/事件）";
  const excerpt = input.chapterExcerpt.length > 4000 ? `${input.chapterExcerpt.slice(0, 4000)}…` : input.chapterExcerpt;
  return [
    `角色：${input.characterId}`,
    `本章：第${input.chapterNumber}章`,
    "",
    "=== 既有内核 ===",
    formatExistingKernel(existing, fields),
    "",
    "=== 本章新增事实/事件 ===",
    relatedLines,
    "",
    "=== 本章正文摘录 ===",
    excerpt,
    "",
    "=== 待更新字段（只输出这些键）===",
    fieldLines,
    "",
    "输出格式：{\"fields\": {<key>: value}, \"evidence\": [{\"id\": \"...\"}]}",
  ].join("\n");
}

function coerceFieldValue(kind: KernelFieldSpec["kind"], value: string | readonly string[]): string | string[] {
  if (kind === "list") {
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    return String(value).split(/[;；\n]/u).map((item) => item.trim()).filter(Boolean);
  }
  return Array.isArray(value) ? value.join(" / ") : String(value);
}

export async function reconcileCharacterKernel(input: KernelReconcilerInput): Promise<KernelReconcilerResult> {
  if (!input.config.enabled) {
    return { ok: false, reason: "skipped-disabled" };
  }
  const fields = activeFields(input.config);
  if (fields.length === 0) {
    return { ok: false, reason: "skipped-no-fields" };
  }

  // 实体身份链：调用方传入的 characterId 可能是别名/装饰标题（「薛小爷」「薛行之（xxx版）」），
  // 用字典归一化为 canonical 名，确保同一角色的内核不会被拆成多份。
  let characterId = input.characterId.trim();
  if (characterId) {
    try {
      const dictionary = buildEntityDictionary(input.storage, input.bookId);
      const resolution = resolveEntity(dictionary, characterId);
      if (resolution) characterId = resolution.entry.canonicalName;
    } catch {
      // 字典构建失败不阻断 kernel 重算，退回原始名。
    }
  }

  const existing = getCharacterKernel(input.storage, input.bookId, characterId);
  const system = input.config.promptTemplate?.trim() || DEFAULT_RECONCILE_PROMPT;
  const user = buildUserPrompt({ ...input, characterId }, fields, existing);

  let rawText: string;
  try {
    const response = await input.generateText({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      maxTokens: 1200,
    });
    rawText = response.text;
  } catch (error) {
    return { ok: false, reason: "llm-failed", error: error instanceof Error ? error.message : String(error) };
  }

  // LLM 可能包 markdown 代码块；剥掉再 parse。
  const stripped = rawText.replace(/^```(?:json)?\s*/u, "").replace(/```\s*$/u, "").trim();
  let parsed: z.infer<typeof KernelReconcileResponseSchema>;
  try {
    parsed = KernelReconcileResponseSchema.parse(JSON.parse(stripped));
  } catch (error) {
    return { ok: false, reason: "parse-failed", error: error instanceof Error ? error.message : String(error) };
  }

  // 只保留配置声明过且 llmExtract=true 的键；未知键丢弃（防 prompt 注入扩字段）。
  const declaredKeys = new Set(fields.map((field) => field.key));
  const mergedFields: Record<string, string | string[]> = { ...(existing?.fields ?? {}) };
  for (const [key, rawValue] of Object.entries(parsed.fields)) {
    if (!declaredKeys.has(key)) continue;
    const spec = fields.find((field) => field.key === key)!;
    let value = coerceFieldValue(spec.kind, rawValue);
    if (typeof value === "string" && input.config.stateSummaryMaxChars > 0 && spec.kind === "long_text") {
      value = value.slice(0, input.config.stateSummaryMaxChars);
    }
    mergedFields[key] = value;
  }

  const now = (input.now?.() ?? new Date()).toISOString();
  const kernel: CharacterKernel = {
    id: existing?.id ?? `kernel:${input.bookId}:${characterId}`,
    bookId: input.bookId,
    characterId,
    entryStatus: existing?.entryStatus ?? "active",
    fields: mergedFields,
    evidence: parsed.evidence,
    updatedChapter: input.chapterNumber,
    updatedAt: now,
    origin: existing?.origin === "manual" ? "manual" : "settle",
  };
  const saved = upsertCharacterKernel(input.storage, kernel);
  return { ok: true, kernel: saved };
}

/** 从本章事件里挑与该角色相关的记录（subject/object 命中即算），供 prompt 使用。 */
export function pickRelatedRecords(
  events: readonly { readonly id: string; readonly subject: string; readonly predicate: string; readonly object: string }[],
  characterId: string,
  limit = 5,
): { id: string; brief: string }[] {
  const hits: { id: string; brief: string }[] = [];
  for (const event of events) {
    // 身份链：event 的 subjectEntryId/objectEntryId 已在写入端归一化，
    // 但旧数据可能没有——同时匹配字符串名作为兜底。
    if (event.subject !== characterId && event.object !== characterId) continue;
    hits.push({ id: event.id, brief: `${event.subject} / ${event.predicate} / ${event.object}` });
    if (hits.length >= limit) break;
  }
  return hits;
}
