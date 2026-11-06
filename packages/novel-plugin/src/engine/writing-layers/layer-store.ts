import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { writeFileAtomic } from "../writing-resource/atomic-write.js";
import {
  ensureLayerAuthorityMigrated,
  joinBookRulesRaw,
  layerAuthorityNotices,
  listAuthoritativeBookRules,
  readAuthoritativeCurrentFocus,
  type AuthoritativeBookRule,
  type LayerAuthorityNotice,
} from "./layer-authority.js";
import { loadStylePreset } from "./style-preset-store.js";
import type { StylePreset } from "./style-preset.js";

import {
  parseBookRules,
  type ParsedBookRules,
} from "@vivy1024/novelfork-core";

export const BOOK_DESIGN_RELATIVE_PATHS = {
  authorIntent: join("story", "author_intent.md"),
  volumeOutline: join("story", "volume_outline.md"),
} as const;

export type WritingLayerKind = "book-design" | "book-rules";

export interface BookDesignDocuments {
  /** 唯一来源 story/author_intent.md（经纬里没有对应分类）。 */
  readonly authorIntent: string;
  /** 唯一来源经纬创作罗盘；调用方没有传存储时为空串。 */
  readonly currentFocus: string;
  readonly volumeOutline: string;
  readonly styleProfileRaw: string;
  readonly styleGuideText?: string;
  readonly stylePresetSource?: "preset" | "legacy" | "none";
}

export interface ResolvedWritingLayers {
  readonly bookDesign: BookDesignDocuments;
  readonly bookDesignText: string;
  readonly bookRules: ParsedBookRules | null;
  /** 经纬「写作规则」里生效条目拼成的原文（只读视图，不对应任何文件）。 */
  readonly bookRulesRaw: string;
  readonly bookRulesText: string;
  /** 生效的写作规则条目（经纬唯一权威）。 */
  readonly bookRuleEntries: readonly AuthoritativeBookRule[];
  /** 旧版文件迁移留下、作者还没确认看过的提示。 */
  readonly notices: readonly LayerAuthorityNotice[];
  readonly styleGuideText: string;
  /** 新预设（source=preset）才有；范文检索只读它。不进书籍设计接口的返回体。 */
  readonly stylePreset: StylePreset | null;
}

async function tryReadFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * 作者可在书籍设置里编辑的层字段：只剩作者意图。
 * 卷纲权威在经纬 outline 条目；当前聚焦权威在经纬创作罗盘；本书规则权威在经纬「写作规则」分类。
 */
export type EditableWritingLayerField = "authorIntent";

export const EDITABLE_WRITING_LAYER_PATHS: Record<EditableWritingLayerField, string> = {
  authorIntent: BOOK_DESIGN_RELATIVE_PATHS.authorIntent,
};

export type WritingLayerRevisions = Record<EditableWritingLayerField, string>;

export interface WritingLayerExplanation {
  readonly whatHappened: string;
  readonly whyItMatters: string;
  readonly suggestedAction: string;
}

export type WritingLayerSaveErrorCode =
  | "WRITING_LAYER_REVISION_CONFLICT"
  | "VOLUME_OUTLINE_READ_ONLY"
  | "WRITING_LAYER_MOVED"
  | "WRITING_LAYER_UNREADABLE";

/** 书籍设计保存被拒绝。路由按 statusCode 返回，并原样带上 explanation。 */
export class WritingLayerSaveError extends Error {
  constructor(
    readonly code: WritingLayerSaveErrorCode,
    readonly statusCode: 409 | 422 | 503,
    readonly explanation: WritingLayerExplanation,
    readonly details: { readonly fields?: readonly EditableWritingLayerField[]; readonly revisions?: Partial<WritingLayerRevisions> } = {},
  ) {
    super(explanation.whatHappened);
    this.name = "WritingLayerSaveError";
  }
}

const FIELD_LABELS: Record<EditableWritingLayerField, string> = {
  authorIntent: "作者意图",
};

/** 内容 revision：文件内容的 sha256 前 16 位；文件不存在记为 "missing"。 */
export function writingLayerRevision(content: string | null): string {
  return content === null ? "missing" : createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

async function readLayerFileForRevision(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;
    throw error;
  }
}

/** 读取可编辑层文件的 revision，供前端保存时带回做乐观并发。 */
export async function loadWritingLayerRevisions(bookRoot: string): Promise<WritingLayerRevisions> {
  const entries = await Promise.all((Object.keys(EDITABLE_WRITING_LAYER_PATHS) as EditableWritingLayerField[]).map(async (field) => {
    const content = await readLayerFileForRevision(join(bookRoot, EDITABLE_WRITING_LAYER_PATHS[field])).catch(() => null);
    return [field, writingLayerRevision(content)] as const;
  }));
  return Object.fromEntries(entries) as WritingLayerRevisions;
}

function withTrailingNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

/** 按书串行的层文件读改写；同书的两次保存不会在「校验 revision → 写入」之间交错。 */
const layerLockTails = new Map<string, Promise<void>>();

async function withWritingLayerLock<T>(bookRoot: string, task: () => Promise<T>): Promise<T> {
  const absolute = resolve(bookRoot);
  const key = process.platform === "win32" ? absolute.toLowerCase() : absolute;
  const previous = layerLockTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolveRelease) => { release = resolveRelease; });
  const tail = previous.then(() => mine);
  layerLockTails.set(key, tail);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (layerLockTails.get(key) === tail) layerLockTails.delete(key);
  }
}

/**
 * 保存作者在书籍设置里改过的层字段（目前只有作者意图）。
 *
 * - 乐观并发：字段带上读取时拿到的 revision；与磁盘当前内容不一致说明别处（叙述者、
 *   另一个窗口、外部编辑器）改过，整次保存拒绝，不覆盖。不带 revision 视为无条件写（兼容旧调用方）。
 * - 原子写：tmp + fsync + rename，不留半截。
 * - 卷纲、当前聚焦、本书规则都不可经此写入：权威都在经纬。
 */
export async function saveWritingLayerFields(
  bookRoot: string,
  patch: Partial<Record<EditableWritingLayerField, string>>,
  baseRevisions: Partial<WritingLayerRevisions> = {},
): Promise<{ readonly saved: readonly EditableWritingLayerField[]; readonly revisions: WritingLayerRevisions }> {
  const fields = (Object.keys(patch) as EditableWritingLayerField[])
    .filter((field) => Object.prototype.hasOwnProperty.call(EDITABLE_WRITING_LAYER_PATHS, field) && typeof patch[field] === "string");
  return withWritingLayerLock(bookRoot, async () => {
    const conflicts: EditableWritingLayerField[] = [];
    const current: Partial<WritingLayerRevisions> = {};
    for (const field of fields) {
      let content: string | null;
      try {
        content = await readLayerFileForRevision(join(bookRoot, EDITABLE_WRITING_LAYER_PATHS[field]));
      } catch (error) {
        throw new WritingLayerSaveError("WRITING_LAYER_UNREADABLE", 503, {
          whatHappened: `读取${FIELD_LABELS[field]}失败（${error instanceof Error ? error.message : String(error)}），本次没有保存任何字段。`,
          whyItMatters: "读不到当前内容就无法确认别处是否改过；直接写入可能覆盖别人刚保存的内容。",
          suggestedAction: "多半是文件被同步盘或编辑器临时占用，稍后再改一下内容触发保存即可。",
        });
      }
      current[field] = writingLayerRevision(content);
      const base = baseRevisions[field];
      if (base !== undefined && base !== current[field]) conflicts.push(field);
    }
    if (conflicts.length > 0) {
      const labels = conflicts.map((field) => FIELD_LABELS[field]).join("、");
      throw new WritingLayerSaveError("WRITING_LAYER_REVISION_CONFLICT", 409, {
        whatHappened: `「${labels}」在你打开设置之后已经被别处改过（叙述者、另一个窗口或外部编辑器），这次保存已拒绝，磁盘上的内容没有被覆盖。`,
        whyItMatters: "直接保存会用你手上的旧版本覆盖别处刚写入的内容。",
        suggestedAction: "先复制你这次的改动，重新载入书籍设置看到最新内容后，再把改动合并进去。",
      }, { fields: conflicts, revisions: current });
    }
    for (const field of fields) {
      await writeFileAtomic(join(bookRoot, EDITABLE_WRITING_LAYER_PATHS[field]), withTrailingNewline(patch[field]!));
    }
    return { saved: fields, revisions: await loadWritingLayerRevisions(bookRoot) };
  });
}

/** 卷纲写入被拒绝时的统一说明：服务端拦截与前端只读提示共用这份文案来源。 */
export function volumeOutlineReadOnlyError(): WritingLayerSaveError {
  return new WritingLayerSaveError("VOLUME_OUTLINE_READ_ONLY", 422, {
    whatHappened: "分卷大纲不能在书籍设置里修改，这次请求里的卷纲内容没有保存（其余字段也未保存）。",
    whyItMatters: "卷纲的唯一权威在经纬「卷纲/大纲」条目；story/volume_outline.md 只是它的导出物，下次导出会整份覆盖，在这里改的内容会丢失。",
    suggestedAction: "到经纬的「卷纲/大纲」分类里编辑卷纲，或让叙述者生成/调整卷纲；保存后这里会显示最新导出。",
  });
}

/** 当前聚焦 / 本书规则不能在书籍设置里写：权威在经纬，写到别处会造出第二份。 */
export function writingLayerMovedError(fields: readonly ("currentFocus" | "bookRulesRaw")[]): WritingLayerSaveError {
  const labels = fields.map((field) => (field === "currentFocus" ? "当前聚焦" : "本书规则")).join("、");
  return new WritingLayerSaveError("WRITING_LAYER_MOVED", 422, {
    whatHappened: `「${labels}」不能在书籍设置里修改，这次请求没有保存任何字段。`,
    whyItMatters: "当前聚焦只认创作罗盘，本书规则只认设定里的「写作规则」；写在别处的内容写章时不会生效。",
    suggestedAction: fields.includes("currentFocus")
      ? "到写作视图的创作罗盘里改当前聚焦；本书规则到设定的「写作规则」分类里改。"
      : "到设定的「写作规则」分类里新建或修改规则条目。",
  });
}

function nonEmpty(value: string | undefined | null): string {
  return value?.trim() ?? "";
}

/** 读取书根之外的权威来源所需的上下文。缺省时当前聚焦 / 本书规则为空（不再回退旧文件）。 */
export interface WritingLayerAuthorityInput {
  readonly storage?: StorageDatabase | null;
  readonly bookId?: string;
}

interface AuthorityLayers {
  readonly currentFocus: string;
  readonly rules: readonly AuthoritativeBookRule[];
  readonly notices: readonly LayerAuthorityNotice[];
}

/** 读经纬里的当前聚焦与写作规则；读之前先跑一次旧文件迁移（幂等，失败不阻断）。 */
async function loadAuthorityLayers(bookRoot: string, input: WritingLayerAuthorityInput): Promise<AuthorityLayers> {
  const storage = input.storage;
  const bookId = input.bookId?.trim();
  if (!storage || !bookId) return { currentFocus: "", rules: [], notices: [] };
  const marker = await ensureLayerAuthorityMigrated({ storage, bookId, bookRoot });
  let currentFocus = "";
  try {
    currentFocus = readAuthoritativeCurrentFocus(storage, bookId);
  } catch {
    currentFocus = "";
  }
  const rules = await listAuthoritativeBookRules(storage, bookId).catch(() => [] as AuthoritativeBookRule[]);
  return { currentFocus, rules, notices: layerAuthorityNotices(marker) };
}

/** 本书规则（结构化，供审稿 / 修稿用）：来自经纬「写作规则」里生效的条目。 */
export async function loadBookRules(bookRoot: string, input: WritingLayerAuthorityInput = {}): Promise<ParsedBookRules | null> {
  const { rules } = await loadAuthorityLayers(bookRoot, input);
  const raw = joinBookRulesRaw(rules);
  return raw ? parseBookRules(raw) : null;
}

export async function loadBookDesign(bookRoot: string, input: WritingLayerAuthorityInput = {}): Promise<BookDesignDocuments> {
  const authority = await loadAuthorityLayers(bookRoot, input);
  return (await loadBookDesignWithPreset(bookRoot, authority.currentFocus)).design;
}

async function loadBookDesignWithPreset(bookRoot: string, currentFocus: string): Promise<{ design: BookDesignDocuments; preset: StylePreset | null }> {
  const [authorIntent, volumeOutline, style] = await Promise.all([
    tryReadFile(join(bookRoot, BOOK_DESIGN_RELATIVE_PATHS.authorIntent)),
    tryReadFile(join(bookRoot, BOOK_DESIGN_RELATIVE_PATHS.volumeOutline)),
    loadStylePreset(bookRoot),
  ]);
  const design: BookDesignDocuments = { authorIntent, currentFocus, volumeOutline,
    styleProfileRaw: style.preset?.fingerprint ? JSON.stringify(style.preset.fingerprint) : "",
    styleGuideText: style.guideText, stylePresetSource: style.source,
  };
  return { design, preset: style.source === "preset" ? style.preset : null };
}

/** 保存作者意图（原子写）。当前聚焦、卷纲、本书规则都不经此写入。 */
export async function saveBookDesign(
  bookRoot: string,
  patch: Partial<Pick<BookDesignDocuments, "authorIntent">>,
): Promise<void> {
  if (patch.authorIntent === undefined) return;
  await saveWritingLayerFields(bookRoot, { authorIntent: patch.authorIntent });
}

export function formatBookDesignForInjection(design: BookDesignDocuments): string {
  const sections: string[] = [];
  const intent = nonEmpty(design.authorIntent);
  const focus = nonEmpty(design.currentFocus);
  const outline = nonEmpty(design.volumeOutline);
  if (intent) sections.push(`### 作者意图\n${intent}`);
  if (focus) sections.push(`### 当前聚焦\n${focus}`);
  if (outline) sections.push(`### 分卷大纲\n${outline}`);
  return sections.join("\n\n").trim();
}

export function formatBookRulesForInjection(parsed: ParsedBookRules | null): string {
  if (!parsed) return "";
  const parts: string[] = [];
  const protagonist = parsed.rules.protagonist;
  if (protagonist?.name) parts.push(`主角：${protagonist.name}`);
  if (protagonist?.personalityLock?.length) parts.push(`性格锁定：${protagonist.personalityLock.join("、")}`);
  if (protagonist?.behavioralConstraints?.length) parts.push(`行为约束：${protagonist.behavioralConstraints.join("、")}`);
  if (parsed.rules.prohibitions.length > 0) {
    parts.push("禁忌：");
    for (const item of parsed.rules.prohibitions) parts.push(`- ${item}`);
  }
  if (parsed.rules.genreLock?.forbidden?.length) {
    parts.push(`风格禁区：${parsed.rules.genreLock.forbidden.join("、")}`);
  }
  const body = nonEmpty(parsed.body);
  if (body) parts.push(body);
  return parts.join("\n").trim();
}

/** 只注入作者确认的写法指南；统计指纹（含旧 style_profile.json）只作写后对照，不再当写作指令。 */
export function formatStyleGuideForInjection(design: BookDesignDocuments): string {
  if (design.stylePresetSource === "preset") return nonEmpty(design.styleGuideText);
  return "";
}

/**
 * 组装本书设计与规则。文风只走书内导入/拆书，不再注入跨书作者习惯。
 * 当前聚焦与本书规则只读经纬（需要 storage + bookId）；旧 story/current_focus.md、story/book_rules.md 不再参与。
 * 写作召回的 hard 通道已直接从经纬注入写作规则条目：召回调用方不要再把 bookRulesText 传进去，否则同一份规则会注入两次。
 */
export async function resolveWritingLayers(input: {
  readonly bookRoot: string;
} & WritingLayerAuthorityInput): Promise<ResolvedWritingLayers> {
  const authority = await loadAuthorityLayers(input.bookRoot, input);
  const { design: bookDesign, preset: stylePreset } = await loadBookDesignWithPreset(input.bookRoot, authority.currentFocus);
  const bookRulesRaw = joinBookRulesRaw(authority.rules);
  const bookRules = bookRulesRaw ? parseBookRules(bookRulesRaw) : null;
  return {
    bookDesign,
    bookDesignText: formatBookDesignForInjection(bookDesign),
    bookRules,
    bookRulesRaw,
    bookRulesText: formatBookRulesForInjection(bookRules),
    bookRuleEntries: authority.rules,
    notices: authority.notices,
    styleGuideText: formatStyleGuideForInjection(bookDesign),
    stylePreset,
  };
}
