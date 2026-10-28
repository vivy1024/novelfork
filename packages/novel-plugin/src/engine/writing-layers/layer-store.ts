import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { writeFileAtomic } from "../writing-resource/atomic-write.js";
import { loadStylePreset } from "./style-preset-store.js";
import type { StylePreset } from "./style-preset.js";

import {
  parseBookRules,
  type ParsedBookRules,
} from "@vivy1024/novelfork-core";

export const BOOK_RULES_RELATIVE_PATH = join("story", "book_rules.md");
export const BOOK_DESIGN_RELATIVE_PATHS = {
  authorIntent: join("story", "author_intent.md"),
  currentFocus: join("story", "current_focus.md"),
  volumeOutline: join("story", "volume_outline.md"),
} as const;

export type WritingLayerKind = "book-design" | "book-rules";

export interface BookDesignDocuments {
  readonly authorIntent: string;
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
  readonly bookRulesRaw: string;
  readonly bookRulesText: string;
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

/** 作者可在书籍设置里编辑的层字段。卷纲不在其中：它的权威在经纬 outline 条目，volume_outline.md 只是导出物。 */
export type EditableWritingLayerField = "authorIntent" | "currentFocus" | "bookRulesRaw";

export const EDITABLE_WRITING_LAYER_PATHS: Record<EditableWritingLayerField, string> = {
  authorIntent: BOOK_DESIGN_RELATIVE_PATHS.authorIntent,
  currentFocus: BOOK_DESIGN_RELATIVE_PATHS.currentFocus,
  bookRulesRaw: BOOK_RULES_RELATIVE_PATH,
};

export type WritingLayerRevisions = Record<EditableWritingLayerField, string>;

export interface WritingLayerExplanation {
  readonly whatHappened: string;
  readonly whyItMatters: string;
  readonly suggestedAction: string;
}

export type WritingLayerSaveErrorCode = "WRITING_LAYER_REVISION_CONFLICT" | "VOLUME_OUTLINE_READ_ONLY" | "WRITING_LAYER_UNREADABLE";

/** 书籍设计 / 规则保存被拒绝。路由按 statusCode 返回，并原样带上 explanation。 */
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
  currentFocus: "当前聚焦",
  bookRulesRaw: "书籍硬规则",
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

/** 读取三份可编辑层文件的 revision，供前端保存时带回做乐观并发。 */
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
 * 保存作者在书籍设置里改过的层字段（只提交真正改了的字段）。
 *
 * - 乐观并发：每个字段带上读取时拿到的 revision；与磁盘当前内容不一致说明别处（叙述者、
 *   另一个窗口、外部编辑器）改过，整次保存拒绝，不覆盖。不带 revision 的字段视为无条件写（兼容旧调用方）。
 * - 原子写：各文件 tmp + fsync + rename，不留半截。
 * - 卷纲不可经此写入：见 EditableWritingLayerField。
 */
export async function saveWritingLayerFields(
  bookRoot: string,
  patch: Partial<Record<EditableWritingLayerField, string>>,
  baseRevisions: Partial<WritingLayerRevisions> = {},
): Promise<{ readonly saved: readonly EditableWritingLayerField[]; readonly revisions: WritingLayerRevisions }> {
  const fields = (Object.keys(patch) as EditableWritingLayerField[])
    .filter((field) => field in EDITABLE_WRITING_LAYER_PATHS && typeof patch[field] === "string");
  return withWritingLayerLock(bookRoot, async () => {
    const conflicts: EditableWritingLayerField[] = [];
    const current: Partial<WritingLayerRevisions> = {};
    for (const field of fields) {
      let content: string | null;
      try {
        content = await readLayerFileForRevision(join(bookRoot, EDITABLE_WRITING_LAYER_PATHS[field]));
      } catch (error) {
        throw new WritingLayerSaveError("WRITING_LAYER_UNREADABLE", 503, {
          whatHappened: `读取 ${EDITABLE_WRITING_LAYER_PATHS[field].replaceAll("\\", "/")} 失败（${error instanceof Error ? error.message : String(error)}），本次没有保存任何字段。`,
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

function nonEmpty(value: string | undefined | null): string {
  return value?.trim() ?? "";
}

export async function loadBookRulesRaw(bookRoot: string): Promise<string> {
  return tryReadFile(join(bookRoot, BOOK_RULES_RELATIVE_PATH));
}

export async function loadBookRules(bookRoot: string): Promise<ParsedBookRules | null> {
  const raw = await loadBookRulesRaw(bookRoot);
  if (!raw.trim()) return null;
  return parseBookRules(raw);
}

export async function saveBookRules(bookRoot: string, content: string): Promise<void> {
  await saveWritingLayerFields(bookRoot, { bookRulesRaw: content });
}

export async function loadBookDesign(bookRoot: string): Promise<BookDesignDocuments> {
  return (await loadBookDesignWithPreset(bookRoot)).design;
}

async function loadBookDesignWithPreset(bookRoot: string): Promise<{ design: BookDesignDocuments; preset: StylePreset | null }> {
  const [authorIntent, currentFocus, volumeOutline, style] = await Promise.all([
    tryReadFile(join(bookRoot, BOOK_DESIGN_RELATIVE_PATHS.authorIntent)),
    tryReadFile(join(bookRoot, BOOK_DESIGN_RELATIVE_PATHS.currentFocus)),
    tryReadFile(join(bookRoot, BOOK_DESIGN_RELATIVE_PATHS.volumeOutline)),
    loadStylePreset(bookRoot),
  ]);
  const design: BookDesignDocuments = { authorIntent, currentFocus, volumeOutline,
    styleProfileRaw: style.preset?.fingerprint ? JSON.stringify(style.preset.fingerprint) : "",
    styleGuideText: style.guideText, stylePresetSource: style.source,
  };
  return { design, preset: style.source === "preset" ? style.preset : null };
}

/** 保存作者意图 / 当前聚焦（原子写）。卷纲不经此写入：见 volumeOutlineReadOnlyError。 */
export async function saveBookDesign(
  bookRoot: string,
  patch: Partial<Pick<BookDesignDocuments, "authorIntent" | "currentFocus">>,
): Promise<BookDesignDocuments> {
  await saveWritingLayerFields(bookRoot, {
    ...(patch.authorIntent !== undefined ? { authorIntent: patch.authorIntent } : {}),
    ...(patch.currentFocus !== undefined ? { currentFocus: patch.currentFocus } : {}),
  });
  return loadBookDesign(bookRoot);
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

/** 组装本书设计与规则。文风只走书内导入/拆书，不再注入跨书作者习惯。 */
export async function resolveWritingLayers(input: {
  readonly bookRoot: string;
}): Promise<ResolvedWritingLayers> {
  const [{ design: bookDesign, preset: stylePreset }, bookRulesRaw] = await Promise.all([
    loadBookDesignWithPreset(input.bookRoot),
    loadBookRulesRaw(input.bookRoot),
  ]);
  const bookRules = bookRulesRaw.trim() ? parseBookRules(bookRulesRaw) : null;
  return {
    bookDesign,
    bookDesignText: formatBookDesignForInjection(bookDesign),
    bookRules,
    bookRulesRaw,
    bookRulesText: formatBookRulesForInjection(bookRules),
    styleGuideText: formatStyleGuideForInjection(bookDesign),
    stylePreset,
  };
}
