/**
 * character-kernel 通道：把已结算的角色内核转为 ContextCard 注入写作 prompt。
 *
 * 按时态切片只读最新的 open 值（内核表本身就没有历史行），由调用方决定是否注入；
 * 预算裁剪由上层 channelBudgetPolicy 决定。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { listCharacterKernels } from "../storage.js";
import type { KernelFieldSpec } from "../types.js";
import type { NarrativeContextCard, NarrativeContextChannel } from "../types.js";

const CHANNEL: NarrativeContextChannel = "character-kernel";

export interface KernelChannelInput {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  readonly characterIds: readonly string[];
  readonly fields: readonly KernelFieldSpec[];
  readonly stateSummaryMaxChars: number;
  readonly defaultPriority?: number;
}

function truncateText(text: string, maxChars: number): string {
  if (maxChars <= 0) return text;
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}…`;
}

function renderKernelFields(
  kernelFields: Readonly<Record<string, string | readonly string[]>>,
  spec: readonly KernelFieldSpec[],
): { summary: string; injectedFieldKeys: string[] } {
  const lines: string[] = [];
  const ordered = [...spec].sort((a, b) => b.injectPriority - a.injectPriority);
  for (const field of ordered) {
    if (!field.injectOnWrite) continue;
    const raw = kernelFields[field.key];
    const present =
      (typeof raw === "string" && raw.trim().length > 0) ||
      (Array.isArray(raw) && raw.length > 0);
    if (!present) continue;
    const rendered = Array.isArray(raw) ? raw.map((item) => String(item)).join(" / ") : String(raw);
    lines.push(`【${field.label}】${rendered}`);
  }
  return { summary: lines.join("\n"), injectedFieldKeys: ordered.filter((f) => kernelFields[f.key]).map((f) => f.key) };
}

export function buildKernelCards(input: KernelChannelInput): NarrativeContextCard[] {
  const kernels = listCharacterKernels(input.storage, {
    bookId: input.bookId,
    characterIds: input.characterIds,
  });
  const now = new Date().toISOString();
  const priority = input.defaultPriority ?? 500;

  const cards: NarrativeContextCard[] = [];
  for (const kernel of kernels) {
    if (kernel.entryStatus !== "active") continue;
    const { summary } = renderKernelFields(kernel.fields, input.fields);
    const trimmed = truncateText(summary, Math.max(input.stateSummaryMaxChars, 120));
    if (!trimmed) continue;
    cards.push({
      id: `kernel:${kernel.characterId}`,
      bookId: input.bookId,
      sourceType: "character-kernel",
      sourceId: `character_kernel:${kernel.characterId}`,
      channel: CHANNEL,
      title: `角色内核·${kernel.characterId}`,
      content: trimmed,
      brief: trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed,
      tags: ["character-kernel"],
      entities: [kernel.characterId],
      priority,
      importance: 80,
      accessCount: 0,
      reason: "结算沉淀的角色当前心理结构（动机/情绪/矛盾轴），写作必读",
      estimatedTokens: Math.ceil(trimmed.length / 1.5),
      validFromChapter: kernel.updatedChapter,
      lastAccessedAt: now,
    });
  }
  return cards;
}
