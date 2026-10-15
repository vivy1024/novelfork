/**
 * 写作注入保留件（T4.7 尾巴）：memory.read 的 write/revise 与 pipeline.write 成功装配后，
 * 把当次真正进上下文的 sections 原样写一份到每书一份的快照文件。
 *
 * 会话压缩只折叠历史消息，prompt 扩展每趟重建——产品侧把保留件挂成扩展（与资料索引卡同条
 * 通道），压缩后模型案头仍有最近一次写作注入的原文，不必先凭摘要猜再重取。
 *
 * 纪律对齐 T4.7：原文原样保留，不二次打包、不静默裁剪（空通道只是无内容，渲染时略过并
 * 在头部写明）；它只是快照，库内权威原文可能已更新，重取指针仍归资料索引卡。
 *
 * T-05c：磁盘上的快照不可信（本机被改、旧版本未中和的快照），渲染时逐段剥掉外壳后重新定界并中和
 * 定界标签；该文件是派生物，项目档案导出导入都排除（book-archive/registry.ts）。
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { writeFileAtomic } from "../writing-resource/atomic-write.js";
import { DEFAULT_NARRATIVE_MEMORY_CONFIG } from "./config.js";
import { NARRATIVE_SECTION_TAGS, RECALL_DATA_NOTICE, wrapRecallData } from "./diagnostics.js";
import { NarrativeRetrievalPurposeSchema, type NarrativeContextPackage, type NarrativeRetrievalPurpose } from "./types.js";

export const WRITING_INJECTION_PRESERVE_FILE = "writing-injection-preserved.json";

/**
 * 保留件随每趟对话重建进系统提示，原文过大时每趟都重复付这份 token，压缩省下的空间又被占回去。
 * 超过这个估算量只注入头部与重取指引，不注入原文（整件略过并写明，不做静默裁剪）。
 *
 * 取值依据：直接引用默认召回预算（narrativeMemory.retrieval.maxTokens 的默认值）。保留件重放的就是
 * 一次完整写作注入，上限应与生成它的召回预算同一把尺。估算尺 CJK 化后默认召回预算已由 8000 迁到
 * 24000（config.ts 的口径迁移：旧 8000 ≈ 新 24000），此前写死的 8000 没跟着迁，导致默认预算内的
 * 完整注入也被判超限、只剩头部。
 */
export const WRITING_INJECTION_PRESERVE_MAX_TOKENS = DEFAULT_NARRATIVE_MEMORY_CONFIG.retrieval.maxTokens;

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
 * 把一次成功装配的写作注入原样落盘（tmp+fsync+rename，失败清理临时文件，与章节正文同一实现）。
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
  await writeFileAtomic(preservePath(bookRoot), `${JSON.stringify(snapshot, null, 2)}\n`);
  return snapshot;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((item) => typeof item === "string");
}

/** 只认严格的 ISO 时间串：capturedAt 会原样进头部（数据区之外），不能夹带任意文字。 */
function normalizeCapturedAt(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function coerceSnapshot(value: unknown): WritingInjectionPreserveSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return null;
  if (typeof record.bookId !== "string" || !record.bookId.trim()) return null;
  // purpose 也渲染在头部：只接受已知枚举值，其余视为损坏（不注入）。
  const purpose = NarrativeRetrievalPurposeSchema.safeParse(record.purpose);
  if (!purpose.success) return null;
  const capturedAt = normalizeCapturedAt(record.capturedAt);
  if (!capturedAt) return null;
  if (typeof record.totalEstimatedTokens !== "number" || !Number.isFinite(record.totalEstimatedTokens)) return null;
  if (!isStringRecord(record.sections)) return null;
  return {
    version: 1,
    bookId: record.bookId,
    purpose: purpose.data,
    ...(typeof record.chapterNumber === "number" && Number.isInteger(record.chapterNumber) ? { chapterNumber: record.chapterNumber } : {}),
    capturedAt,
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

/**
 * T-05c：取出磁盘上某段的内容本体。正常落盘的段形如 `<tag>\n声明\n内容\n</tag>`，剥掉外壳与声明；
 * 外壳不完整或被改过的段整段当作内容本体，交给 wrapRecallData 中和后重新包裹（原外壳会被中和成普通文字）。
 */
function storedSectionBody(key: SectionKey, stored: string): string {
  const tag = NARRATIVE_SECTION_TAGS[key];
  const open = `<${tag}>\n`;
  const close = `\n</${tag}>`;
  let body = stored;
  if (body.length >= open.length + close.length && body.startsWith(open) && body.endsWith(close)) {
    body = body.slice(open.length, body.length - close.length);
  }
  if (body.startsWith(`${RECALL_DATA_NOTICE}\n`)) body = body.slice(RECALL_DATA_NOTICE.length + 1);
  return body;
}

/**
 * 渲染成注入给模型的保留件文本。空通道（无内容）略过并在头部写明；超上限时整件不注入原文。
 * 不信任磁盘内容：每段都重新定界并中和定界标签，篡改的段逃不出自己的数据区。
 */
export function renderWritingInjectionPreserve(
  snapshot: WritingInjectionPreserveSnapshot,
  maxTokens: number = WRITING_INJECTION_PRESERVE_MAX_TOKENS,
): string {
  const bodies = SECTION_KEYS.map((key) => [key, storedSectionBody(key, snapshot.sections[key] ?? "")] as const);
  const filled = bodies.filter(([, body]) => body.trim().length > 0);
  const skipped = SECTION_KEYS.length - filled.length;
  const chapter = snapshot.chapterNumber !== undefined ? `第 ${snapshot.chapterNumber} 章` : "未标章";
  const oversized = snapshot.totalEstimatedTokens > maxTokens;
  const header = [
    "【写作注入保留件 · 上次写作召回的原文快照】",
    `最近一次写作注入（${PURPOSE_LABELS[snapshot.purpose] ?? snapshot.purpose}，${chapter}，${snapshot.capturedAt}，约 ${snapshot.totalEstimatedTokens} 估算 token）成功装配、真正进过上下文。`,
    ...(oversized
      ? [`原文约 ${snapshot.totalEstimatedTokens} 估算 token，超过保留件上限 ${maxTokens}，本趟整件不随系统提示重放（不是裁剪，原文完整在库）。需要对照时按资料索引卡的通道指针重取。`]
      : [
          "原文如下。会话压缩只折叠历史消息，本保留件随每趟重建、不被摘要掉；案头若只剩摘要版，以此原件为准对照。",
          ...(skipped > 0 ? [`${skipped} 个通道当时无注入内容，已整栏略过（不是裁剪）。`] : []),
        ]),
    "它只是快照：此后若有结算/修改，库中原文可能已更新——按资料索引卡的通道指针可重取活本。",
  ].join("\n");
  if (oversized) return header;
  const body = filled.map(([key, sectionBody]) => wrapRecallData(NARRATIVE_SECTION_TAGS[key], sectionBody)).join("\n\n");
  return `${header}\n\n${body}`;
}
