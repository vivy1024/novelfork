/**
 * 当前聚焦 / 本书规则的唯一权威源，以及旧文件副本的一次性迁移。
 *
 * 单一权威源（CLAUDE.md「单一权威源」）：
 *   - 当前聚焦 → 经纬 current-focus 单例条目（创作罗盘）；
 *   - 本书规则 → 经纬 rules 分类（写作规则）中已确认、参与 AI 的条目，口径与 hard 通道一致；
 *   - 作者意图在经纬里没有对应分类，仍以 story/author_intent.md 为唯一来源（不在本模块）。
 *
 * 旧版把前两者写在 story/current_focus.md、story/book_rules.md。现在不再有任何代码写这两个文件，
 * 也不再从它们读取写作上下文；存量书在首次读取时按下列规则迁移一次（幂等、绝不覆盖经纬里已有的非空值）：
 *   - 只有文件有内容 → 写进经纬（作者亲手写的内容，按已确认处理）；
 *   - 两边内容相同 → 什么都不做；
 *   - 两边都有且不同 → 保留经纬；聚焦记一条提示（附旧内容，作者可抄回罗盘），
 *     规则另建一条待确认的写作规则，作者确认后才生效；
 *   - 文件为空或只是模板 → 什么都不做。
 * 迁移结果记在 story/.layer-authority-migration.json（按文件内容 revision 记账）：文件不变就不再重跑，
 * 作者删掉待确认条目后也不会被重新建出来。
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import {
  CURRENT_FOCUS_CATEGORY,
  CURRENT_FOCUS_TITLE,
  emptyCurrentFocus,
  isPlaceholderFocusDoc,
  readCurrentFocusDocFromStorage,
  selectCurrentFocusEntry,
  serializeCurrentFocusDoc,
} from "../jingwei/current-focus.js";
import { resolveJingweiReadCategory } from "../jingwei/read-model/category-map.js";
import { createStoryJingweiEntryRepository } from "../jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../jingwei/repositories/section-repo.js";
import type { StoryJingweiEntryRecord } from "../jingwei/types.js";
import { getCategoryMeta } from "../jingwei/unified-categories.js";
import { classifyCanonScope } from "../narrative-memory/canon-scope.js";
import { writeFileAtomic } from "../writing-resource/atomic-write.js";

/** 旧版文件副本：只用于一次性迁移的读取，任何代码都不得再写入。 */
export const LEGACY_CURRENT_FOCUS_RELATIVE_PATH = join("story", "current_focus.md");
export const LEGACY_BOOK_RULES_RELATIVE_PATH = join("story", "book_rules.md");
export const LAYER_AUTHORITY_MARKER_RELATIVE_PATH = join("story", ".layer-authority-migration.json");

export const BOOK_RULES_CATEGORY = "rules";
export const MIGRATED_BOOK_RULES_TITLE = "本书规则";
export const LEGACY_BOOK_RULES_REVIEW_TITLE = "旧版本书规则（待确认）";

export type LayerAuthorityField = "currentFocus" | "bookRules";

export type LayerMigrationOutcome =
  /** 文件不存在、为空或只是模板。 */
  | "empty"
  /** 经纬原本为空，已把文件内容写入经纬。 */
  | "migrated"
  /** 两边内容一致。 */
  | "same"
  /** 两边都有且不同：保留经纬，提示作者（聚焦）。 */
  | "kept-authority"
  /** 两边都有且不同：保留经纬，文件内容进了一条待确认规则（规则）。 */
  | "review-created";

export interface LayerFieldMarker {
  /** 处理时文件内容的 revision；文件变了才会重新处理。 */
  readonly fileRevision: string;
  readonly outcome: LayerMigrationOutcome;
  /** kept-authority 时保留的旧内容，供作者手动抄回。 */
  readonly legacyText?: string;
  /** 作者在设置页点过「不再提示」。 */
  readonly dismissed?: boolean;
}

export interface LayerAuthorityMarker {
  readonly version: 1;
  readonly currentFocus?: LayerFieldMarker;
  readonly bookRules?: LayerFieldMarker;
}

export interface LayerAuthorityNotice {
  readonly field: LayerAuthorityField;
  readonly message: string;
  readonly legacyText?: string;
}

export interface AuthoritativeBookRule {
  readonly id: string;
  readonly title: string;
  readonly content: string;
}

const LEGACY_TEXT_LIMIT = 4000;
const LEGACY_FOCUS_HEADING = /^#{1,6}\s*(当前聚焦|当前重点|Current Focus|Active Focus)\s*$/iu;
const RULES_TEMPLATE_LINES = new Set(["在这里记录本书的写作约束、禁忌和统一口径。", "Record writing constraints here."]);

function sameText(left: string, right: string): boolean {
  return left.replace(/\s+/gu, " ").trim() === right.replace(/\s+/gu, " ").trim();
}

function fileRevision(content: string | null): string {
  return content === null ? "missing" : createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

/** 旧聚焦文件里作者真正写的内容：去掉模板标题；整份是模板时返回空串。 */
export function legacyFocusText(raw: string | null | undefined): string {
  if (!raw || isPlaceholderFocusDoc(raw)) return "";
  return raw
    .split(/\r?\n/u)
    .filter((line) => !LEGACY_FOCUS_HEADING.test(line.trim()))
    .join("\n")
    .trim();
}

/** 旧规则文件是否只是建书模板（只有标题与模板提示句）。 */
export function isPlaceholderRulesDoc(raw: string | null | undefined): boolean {
  const meaningful = (raw ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && !RULES_TEMPLATE_LINES.has(line));
  return meaningful.length === 0;
}

// ---------------------------------------------------------------------------
// 权威读取
// ---------------------------------------------------------------------------

/** 当前聚焦：经纬创作罗盘正文；没有有效内容时返回空串。 */
export function readAuthoritativeCurrentFocus(storage: StorageDatabase, bookId: string): string {
  return readCurrentFocusDocFromStorage(storage, bookId) ?? "";
}

/**
 * 本书规则：经纬写作规则分类里已确认、参与 AI、未归档的条目。
 * 判定与 hard 通道完全一致（同一套分类解析与 canon 口径），设置页看到的就是写章注入的。
 */
export async function listAuthoritativeBookRules(storage: StorageDatabase, bookId: string): Promise<AuthoritativeBookRule[]> {
  const sections = await createStoryJingweiSectionRepository(storage).listEnabledForAi(bookId);
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const entries = await createStoryJingweiEntryRepository(storage).listByBook(bookId);
  return entries
    .filter((entry) => entry.participatesInAi && entry.status === "confirmed" && (!entry.lifecycle || entry.lifecycle === "active"))
    .filter((entry) => {
      const section = sectionById.get(entry.sectionId);
      return resolveJingweiReadCategory(entry, section) === BOOK_RULES_CATEGORY && classifyCanonScope(entry, section) === "book-rule";
    })
    .filter((entry) => entry.contentMd.trim().length > 0)
    .map((entry) => ({ id: entry.id, title: entry.title, content: entry.contentMd.trim() }));
}

/**
 * 拼成可交给 parseBookRules 的原文：带 frontmatter 的条目排最前（parseBookRules 只认第一段 frontmatter，
 * 其后的文字都算正文）。
 */
export function joinBookRulesRaw(rules: readonly AuthoritativeBookRule[]): string {
  const withFrontmatter = rules.filter((rule) => /^---\s*\n/u.test(rule.content));
  const rest = rules.filter((rule) => !withFrontmatter.includes(rule));
  return [...withFrontmatter, ...rest].map((rule) => rule.content).join("\n\n").trim();
}

// ---------------------------------------------------------------------------
// 迁移记账
// ---------------------------------------------------------------------------

async function readLegacyFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;
    throw error;
  }
}

export async function readLayerAuthorityMarker(bookRoot: string): Promise<LayerAuthorityMarker> {
  try {
    const parsed = JSON.parse(await readFile(join(bookRoot, LAYER_AUTHORITY_MARKER_RELATIVE_PATH), "utf8")) as Partial<LayerAuthorityMarker>;
    return {
      version: 1,
      ...(parsed.currentFocus ? { currentFocus: parsed.currentFocus } : {}),
      ...(parsed.bookRules ? { bookRules: parsed.bookRules } : {}),
    };
  } catch {
    return { version: 1 };
  }
}

async function writeLayerAuthorityMarker(bookRoot: string, marker: LayerAuthorityMarker): Promise<void> {
  await mkdir(join(bookRoot, "story"), { recursive: true });
  await writeFileAtomic(join(bookRoot, LAYER_AUTHORITY_MARKER_RELATIVE_PATH), `${JSON.stringify(marker, null, 2)}\n`);
}

/** 作者在设置页确认看过提示后不再显示。 */
export async function dismissLayerAuthorityNotice(bookRoot: string, field: LayerAuthorityField): Promise<LayerAuthorityMarker> {
  const marker = await readLayerAuthorityMarker(bookRoot);
  const current = marker[field];
  if (!current) return marker;
  const next: LayerAuthorityMarker = { ...marker, [field]: { ...current, dismissed: true } };
  await writeLayerAuthorityMarker(bookRoot, next);
  return next;
}

/** 迁移留下、作者还没确认看过的提示。 */
export function layerAuthorityNotices(marker: LayerAuthorityMarker): LayerAuthorityNotice[] {
  const notices: LayerAuthorityNotice[] = [];
  const focus = marker.currentFocus;
  if (focus?.outcome === "kept-authority" && !focus.dismissed) {
    notices.push({
      field: "currentFocus",
      message: "旧版设置里还有一份不同的当前聚焦，没有自动合并，写章只按创作罗盘推进。需要的话把下面的内容抄进创作罗盘。",
      ...(focus.legacyText ? { legacyText: focus.legacyText } : {}),
    });
  }
  const rules = marker.bookRules;
  if (rules?.outcome === "review-created" && !rules.dismissed) {
    notices.push({
      field: "bookRules",
      message: "旧版设置里的本书规则和写作规则不一致，已作为一条待确认的写作规则放进设定，确认后写章才会遵守。",
    });
  }
  return notices;
}

// ---------------------------------------------------------------------------
// 迁移
// ---------------------------------------------------------------------------

async function ensureSection(storage: StorageDatabase, bookId: string, key: string, fallbackName: string): Promise<string> {
  const repo = createStoryJingweiSectionRepository(storage);
  const existing = await repo.listByBook(bookId);
  const found = existing.find((section) => section.key === key || section.builtinKind === key);
  if (found) return found.id;
  const meta = getCategoryMeta(key);
  const now = new Date();
  const created = await repo.create({
    id: randomUUID(),
    bookId,
    key,
    name: meta?.name ?? fallbackName,
    description: meta?.recommendedWhen ?? "",
    icon: meta?.icon ?? null,
    order: existing.length,
    enabled: true,
    showInSidebar: true,
    participatesInAi: true,
    defaultVisibility: "global",
    fieldsJson: [],
    builtinKind: meta ? key : null,
    sourceTemplate: "manual",
    createdAt: now,
    updatedAt: now,
  });
  return created.id;
}

function migrationEntryBase(input: { bookId: string; sectionId: string; title: string; contentMd: string; legacyPath: string }) {
  const now = new Date();
  return {
    id: randomUUID(),
    bookId: input.bookId,
    sectionId: input.sectionId,
    title: input.title,
    contentMd: input.contentMd,
    tags: [],
    aliases: [],
    customFields: {},
    relatedChapterNumbers: [],
    relatedEntryIds: [],
    visibilityRule: { type: "global" as const },
    participatesInAi: true,
    tokenBudget: null,
    source: "user" as const,
    sourceRefs: [{ chapterNumber: 0, excerpt: input.contentMd.slice(0, 120), path: input.legacyPath.replaceAll("\\", "/") }],
    createdAt: now,
    updatedAt: now,
  };
}

async function migrateCurrentFocus(storage: StorageDatabase, bookId: string, fileRaw: string | null): Promise<Omit<LayerFieldMarker, "fileRevision">> {
  const legacy = legacyFocusText(fileRaw);
  if (!legacy) return { outcome: "empty" };
  const authority = readAuthoritativeCurrentFocus(storage, bookId);
  const asCompass = serializeCurrentFocusDoc({ ...emptyCurrentFocus(), goal: legacy });
  if (authority) {
    if (sameText(authority, legacy) || sameText(authority, asCompass)) return { outcome: "same" };
    return { outcome: "kept-authority", legacyText: legacy.slice(0, LEGACY_TEXT_LIMIT) };
  }
  // 经纬为空：旧聚焦整段放进「本章目标」，罗盘面板与写章读到的是同一份字段。
  const entryRepo = createStoryJingweiEntryRepository(storage);
  const existing = selectCurrentFocusEntry(
    (await entryRepo.listByBook(bookId)).map((entry) => ({ category: entry.category, updatedAt: entry.updatedAt.toISOString(), entry })),
  );
  const fields = { ...emptyCurrentFocus(), goal: legacy };
  if (existing) {
    // 已有空罗盘条目（作者开过罗盘但没填）：填进去，不另建第二条单例。
    await entryRepo.update(bookId, existing.entry.id, { contentMd: asCompass, fieldsPatch: fields, source: "user", updatedAt: new Date() });
  } else {
    const sectionId = await ensureSection(storage, bookId, CURRENT_FOCUS_CATEGORY, CURRENT_FOCUS_TITLE);
    await entryRepo.create({
      ...migrationEntryBase({ bookId, sectionId, title: CURRENT_FOCUS_TITLE, contentMd: asCompass, legacyPath: LEGACY_CURRENT_FOCUS_RELATIVE_PATH }),
      category: CURRENT_FOCUS_CATEGORY,
      fields,
      priorityTier: "core",
      layer: "dynamic",
    });
  }
  return { outcome: "migrated" };
}

function liveRulesEntries(entries: readonly StoryJingweiEntryRecord[]): StoryJingweiEntryRecord[] {
  return entries.filter((entry) => resolveJingweiReadCategory(entry) === BOOK_RULES_CATEGORY);
}

async function migrateBookRules(storage: StorageDatabase, bookId: string, fileRaw: string | null): Promise<Omit<LayerFieldMarker, "fileRevision">> {
  if (!fileRaw || isPlaceholderRulesDoc(fileRaw)) return { outcome: "empty" };
  const legacy = fileRaw.trim();
  const entryRepo = createStoryJingweiEntryRepository(storage);
  const authoritative = await listAuthoritativeBookRules(storage, bookId);
  const live = liveRulesEntries(await entryRepo.listByBook(bookId));
  const alreadyPresent = live.some((entry) => sameText(entry.contentMd, legacy));

  if (authoritative.length > 0) {
    if (authoritative.some((rule) => sameText(rule.content, legacy)) || sameText(joinBookRulesRaw(authoritative), legacy)) {
      return { outcome: "same" };
    }
    if (!alreadyPresent) {
      const sectionId = await ensureSection(storage, bookId, BOOK_RULES_CATEGORY, "写作规则");
      await entryRepo.create({
        ...migrationEntryBase({ bookId, sectionId, title: LEGACY_BOOK_RULES_REVIEW_TITLE, contentMd: legacy, legacyPath: LEGACY_BOOK_RULES_RELATIVE_PATH }),
        category: BOOK_RULES_CATEGORY,
        fields: {},
        status: "needs-review",
        participatesInAi: false,
        priorityTier: "core",
        layer: "canon",
      });
    }
    return { outcome: "review-created" };
  }

  // 经纬没有生效的写作规则：作者在旧版设置里亲手写的规则，按已确认迁入（此前它一直在写章时生效）。
  // 同内容的条目已存在（例如还待确认）就不重复建，也不替作者把它改成已确认。
  if (alreadyPresent) return { outcome: "same" };
  const sectionId = await ensureSection(storage, bookId, BOOK_RULES_CATEGORY, "写作规则");
  await entryRepo.create({
    ...migrationEntryBase({ bookId, sectionId, title: MIGRATED_BOOK_RULES_TITLE, contentMd: legacy, legacyPath: LEGACY_BOOK_RULES_RELATIVE_PATH }),
    category: BOOK_RULES_CATEGORY,
    fields: {},
    status: "confirmed",
    priorityTier: "core",
    importance: 90,
    layer: "canon",
  });
  return { outcome: "migrated" };
}

const MIGRATORS: Record<LayerAuthorityField, { path: string; run: typeof migrateCurrentFocus }> = {
  currentFocus: { path: LEGACY_CURRENT_FOCUS_RELATIVE_PATH, run: migrateCurrentFocus },
  bookRules: { path: LEGACY_BOOK_RULES_RELATIVE_PATH, run: migrateBookRules },
};

/** 同一进程内同一本书只迁移一次（按存储实例 + 书 + 书根）。 */
const inFlight = new WeakMap<object, Map<string, Promise<LayerAuthorityMarker>>>();

export interface EnsureLayerAuthorityInput {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  readonly bookRoot: string;
}

/**
 * 惰性迁移入口：任何读取当前聚焦 / 本书规则的服务端路径在读之前调用。永不抛错——
 * 迁移失败（书不在库里、文件被占用）只是这次不迁，下次读取再试，写作照常只读经纬。
 */
export async function ensureLayerAuthorityMigrated(input: EnsureLayerAuthorityInput): Promise<LayerAuthorityMarker> {
  const absolute = resolve(input.bookRoot);
  const key = `${input.bookId}\0${process.platform === "win32" ? absolute.toLowerCase() : absolute}`;
  let perStorage = inFlight.get(input.storage.sqlite);
  if (!perStorage) {
    perStorage = new Map();
    inFlight.set(input.storage.sqlite, perStorage);
  }
  const existing = perStorage.get(key);
  // 已迁过：记账可能被作者「知道了」改过，每次从盘上重读（很小的一份 JSON）。
  if (existing) return existing.then(() => readLayerAuthorityMarker(input.bookRoot));
  const task = runLayerAuthorityMigration(input)
    .then((result) => {
      // 没迁完（文件被占用、书还没进库）：不缓存，下次读取再试。
      if (!result.complete) perStorage!.delete(key);
      return result.marker;
    })
    .catch(() => {
      perStorage!.delete(key);
      return { version: 1 } as LayerAuthorityMarker;
    });
  perStorage.set(key, task);
  return task;
}

/** 不走进程内缓存的迁移本体（测试与重跑用）。complete=false 表示有字段这次没处理成。 */
export async function runLayerAuthorityMigration(input: EnsureLayerAuthorityInput): Promise<{ readonly marker: LayerAuthorityMarker; readonly complete: boolean }> {
  let marker = await readLayerAuthorityMarker(input.bookRoot);
  let changed = false;
  let incomplete = false;
  for (const field of Object.keys(MIGRATORS) as LayerAuthorityField[]) {
    const migrator = MIGRATORS[field];
    let fileRaw: string | null;
    try {
      fileRaw = await readLegacyFile(join(input.bookRoot, migrator.path));
    } catch {
      incomplete = true; // 文件读不出（占用 / 权限）：这次不处理，也不记账。
      continue;
    }
    const revision = fileRevision(fileRaw);
    if (marker[field]?.fileRevision === revision) continue;
    try {
      const result = await migrator.run(input.storage, input.bookId, fileRaw);
      marker = { ...marker, [field]: { fileRevision: revision, ...result } };
      changed = true;
    } catch {
      incomplete = true;
    }
  }
  if (changed) {
    await writeLayerAuthorityMarker(input.bookRoot, marker).catch(() => {
      incomplete = true;
    });
  }
  return { marker, complete: !incomplete };
}
