/**
 * 写作注入保留件（T4.7 尾巴）：memory.read 的 write/revise 与 pipeline.write 成功装配后，
 * 把当次真正进上下文的 sections 原样写一份到每书一份的快照文件。
 *
 * 会话压缩只折叠历史消息，prompt 扩展每趟重建——产品侧把保留件挂成扩展（与资料索引卡同条
 * 通道），压缩后模型案头仍有最近一次写作注入的原文，不必先凭摘要猜再重取。
 *
 * 纪律对齐 T4.7：原文原样保留，不二次打包、不静默裁剪（空通道只是无内容，渲染时略过并
 * 在头部写明）；它只是快照，库内权威原文可能已更新，重取指针仍归资料索引卡。
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type { NarrativeContextPackage, NarrativeRetrievalPurpose } from "./types.js";

export const WRITING_INJECTION_PRESERVE_FILE = "writing-injection-preserved.json";

type SectionKey = keyof NarrativeContextPackage["sections"];

/** 与 diagnostics 的 SECTION_ORDER 同序，渲染顺序稳定。 */
const SECTION_KEYS: readonly SectionKey[] = [
  "hard", "state", "timeline", "hooks", "facts", "style", "semantic",
  "character-kernel", "recent-summary", "knowledge",
];

export interface WritingInjectionPreserveSnapshot {
  readonly version: 1;
  readonly bookId: string;
  readonly purpose: NarrativeRetrievalPurpose;
  readonly chapterNumber?: number;
  readonly capturedAt: string;
  readonly totalEstimatedTokens: number;
  /** 当次注入的 sections 原文（含空通道，渲染时略过空通道）。 */
  readonly sections: Readonly<Record<SectionKey, string>>;
}

function preserveDir(bookRoot: string): string {
  return join(bookRoot, "story");
}

function preservePath(bookRoot: string): string {
  return join(preserveDir(bookRoot), WRITING_INJECTION_PRESERVE_FILE);
}

/**
 * 把一次成功装配的写作注入原样落盘（原子写：先临时文件再 rename，同 style-vault 约定）。
 * 每书一份，下一次写作注入直接覆盖。
 */
export async function preserveLatestWritingInjection(
  bookRoot: string,
  pack: NarrativeContextPackage,
): Promise<WritingInjectionPreserveSnapshot> {
  const snapshot: WritingInjectionPreserveSnapshot = {
    version: 1,
    bookId: pack.bookId,
    purpose: pack.purpose,
    ...(pack.chapterNumber !== undefined ? { chapterNumber: pack.chapterNumber } : {}),
    capturedAt: new Date().toISOString(),
    totalEstimatedTokens: pack.diagnostics.totalEstimatedTokens,
    sections: { ...pack.sections },
  };
  await mkdir(preserveDir(bookRoot), { recursive: true });
  const temporary = join(preserveDir(bookRoot), `.preserve-${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await rename(temporary, preservePath(bookRoot));
  return snapshot;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((item) => typeof item === "string");
}

function coerceSnapshot(value: unknown): WritingInjectionPreserveSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return null;
  if (typeof record.bookId !== "string" || !record.bookId.trim()) return null;
  if (typeof record.purpose !== "string") return null;
  if (typeof record.capturedAt !== "string" || !record.capturedAt) return null;
  if (typeof record.totalEstimatedTokens !== "number") return null;
  if (!isStringRecord(record.sections)) return null;
  return {
    version: 1,
    bookId: record.bookId,
    purpose: record.purpose as NarrativeRetrievalPurpose,
    ...(typeof record.chapterNumber === "number" ? { chapterNumber: record.chapterNumber } : {}),
    capturedAt: record.capturedAt,
    totalEstimatedTokens: record.totalEstimatedTokens,
    sections: { ...record.sections } as Readonly<Record<SectionKey, string>>,
  };
}

/** 读保留件快照；文件缺失/损坏或书不匹配时返回 null（无保留件，不注入）。 */
export async function loadWritingInjectionPreserve(
  bookRoot: string,
  bookId?: string,
): Promise<WritingInjectionPreserveSnapshot | null> {
  let raw: string;
  try {
    raw = await readFile(preservePath(bookRoot), "utf8");
  } catch {
    return null;
  }
  let snapshot: WritingInjectionPreserveSnapshot | null;
  try {
    snapshot = coerceSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
  if (!snapshot) return null;
  if (bookId && snapshot.bookId !== bookId) return null;
  return snapshot;
}

const PURPOSE_LABELS: Readonly<Record<string, string>> = {
  write_chapter: "写章",
  continue: "续写",
  revise: "修订",
  audit: "审计",
  outline: "大纲",
};

/** 渲染成注入给模型的保留件文本。空通道（无内容）略过并在头部写明。 */
export function renderWritingInjectionPreserve(snapshot: WritingInjectionPreserveSnapshot): string {
  const filledKeys = SECTION_KEYS.filter((key) => (snapshot.sections[key] ?? "").trim().length > 0);
  const skipped = SECTION_KEYS.length - filledKeys.length;
  const chapter = snapshot.chapterNumber !== undefined ? `第 ${snapshot.chapterNumber} 章` : "未标章";
  const header = [
    "【写作注入保留件 · 上次写作召回的原文快照】",
    `最近一次写作注入（${PURPOSE_LABELS[snapshot.purpose] ?? snapshot.purpose}，${chapter}，${snapshot.capturedAt}，约 ${snapshot.totalEstimatedTokens} 估算 token）成功装配、真正进过上下文的原文如下。`,
    "会话压缩只折叠历史消息，本保留件随每趟重建、不被摘要掉；案头若只剩摘要版，以此原件为准对照。",
    ...(skipped > 0 ? [`${skipped} 个通道当时无注入内容，已整栏略过（不是裁剪）。`] : []),
    "它只是快照：此后若有结算/修改，库中原文可能已更新——按资料索引卡的通道指针可重取活本。",
  ].join("\n");
  const body = filledKeys.map((key) => snapshot.sections[key]).join("\n\n");
  return `${header}\n\n${body}`;
}
