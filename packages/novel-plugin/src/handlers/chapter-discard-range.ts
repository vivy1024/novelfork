/**
 * chapter.discard_range — 试写整段丢弃：抹去范围内正式章结果与章域记忆，并按策略重置伏笔。
 */

import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { getStorageDatabase } from "@vivy1024/novelfork-core";

import { rebuildNarrativeEntityIndex } from "../engine/narrative-entity/entity-index.js";
import { ensureNarrativeMemorySchema } from "../engine/narrative-memory/storage.js";
import { ensureSettlementLedgerSchema } from "../engine/narrative-memory/settlement-idempotency.js";
import { STYLE_VAULT_RELATIVE_DIR } from "../engine/writing-layers/style-vault.js";
import { writeFileAtomic } from "../engine/writing-resource/atomic-write.js";
import { withChapterIndexLock } from "../engine/writing-resource/chapter-index-lock.js";
import { createWritingResourceService } from "../engine/writing-resource/service.js";
import { listChapterFiles } from "../engine/writing-resource/chapter-layout.js";
import type { DiagnosticExplanation } from "./diagnostic-explanation.js";
import { resolveChapterVolumeDirectory } from "./outline-volume.js";

export type HookResetStrategy = "untouched" | "planned-only" | "none";

export interface ChapterDiscardRangeInput {
  readonly bookId: string;
  readonly fromChapter: number;
  readonly toChapter: number;
  /** 必须为 true，防止误触 */
  readonly confirm: true;
  readonly deleteMemory?: boolean;
  readonly resetHooks?: HookResetStrategy;
  /** false=归档正文资源（默认）；true=尽量物理删除章节文件 */
  readonly hardDelete?: boolean;
  readonly bookRoot?: string;
  readonly storage?: StorageDatabase;
  readonly now?: () => Date;
}

export interface ChapterDiscardRangeResult {
  readonly ok: boolean;
  readonly bookId: string;
  readonly fromChapter: number;
  readonly toChapter: number;
  readonly deletedChapters: number;
  readonly archivedResources: number;
  readonly deletedChapterFiles: number;
  readonly deletedEvents: number;
  readonly deletedFacts: number;
  readonly deletedLogs: number;
  readonly hooksReset: number;
  /** T-14②：关闭它的后继值来自被删章、因而恢复为当前值的旧事实条数（作者作废/纠正的不在此列）。 */
  readonly reactivatedFacts: number;
  /** T-14②④：清理掉的结算台账、证据链、章节提及、结构分、场景及其剧情线挂载等孤儿行数。 */
  readonly deletedOrphans: number;
  readonly hooksNotes: readonly string[];
  readonly summary: string;
  readonly error?: string;
  readonly details?: readonly string[];
  /** 失败时的人话三段式（发生了什么 / 为什么要看 / 建议怎么做）；前端与叙述者读它，不按 error 自造文案。 */
  readonly explanation?: DiagnosticExplanation;
}

function fail(error: string, summary: string, partial?: Partial<ChapterDiscardRangeResult>): ChapterDiscardRangeResult {
  return {
    ok: false,
    bookId: partial?.bookId ?? "",
    fromChapter: partial?.fromChapter ?? 0,
    toChapter: partial?.toChapter ?? 0,
    deletedChapters: partial?.deletedChapters ?? 0,
    archivedResources: partial?.archivedResources ?? 0,
    deletedChapterFiles: partial?.deletedChapterFiles ?? 0,
    deletedEvents: partial?.deletedEvents ?? 0,
    deletedFacts: partial?.deletedFacts ?? 0,
    deletedLogs: partial?.deletedLogs ?? 0,
    reactivatedFacts: partial?.reactivatedFacts ?? 0,
    deletedOrphans: partial?.deletedOrphans ?? 0,
    hooksReset: partial?.hooksReset ?? 0,
    hooksNotes: partial?.hooksNotes ?? [],
    summary,
    error,
    ...(partial?.details ? { details: partial.details } : {}),
    ...(partial?.explanation ? { explanation: partial.explanation } : {}),
  };
}

/**
 * 处理范围内的正文文件与章节索引（T-14⑤⑥）。整段持章节索引锁：index.json 的读改写与写作台保存、
 * 叙述者写章、对账、导入排同一把锁，不会抹掉并发写入方的条目；索引用原子写，不留半截。
 *
 * 顺序要点：写作资源服务的 softDelete 会直接删除正式章文件（并自己裁剪索引）。默认的「归档」模式必须
 * 在它之前先把正文复制进 _discarded，否则归档会变成物理删除。服务处理完后，仍留在原处的范围内正文
 * 再统一移入归档目录（hardDelete 时删除）。
 *
 * 失败直接抛出，由调用方转成结构化失败；`details` 记录已完成的每一步，供失败报告列出「哪些已做」。
 */
async function discardChapterFiles(input: Readonly<{
  storage: StorageDatabase;
  bookId: string;
  bookRoot: string;
  fromChapter: number;
  toChapter: number;
  hardDelete: boolean;
  archiveDir: string;
  details: string[];
}>): Promise<{ deletedChapterFiles: number; archivedResources: number }> {
  const { storage, bookId, bookRoot, fromChapter, toChapter, hardDelete, archiveDir, details } = input;
  const inRange = (chapterNumber: number) => chapterNumber >= fromChapter && chapterNumber <= toChapter;

  return withChapterIndexLock(bookRoot, async () => {
    const handled = new Set<string>();

    // 1) 归档模式先留底：把范围内正文复制进归档目录。
    const before = (await listChapterFiles(bookRoot)).filter((file) => inRange(file.number));
    for (const file of before) {
      handled.add(file.chapterRelativePath);
      if (hardDelete) continue;
      const archivedPath = join(archiveDir, file.chapterRelativePath);
      await mkdir(dirname(archivedPath), { recursive: true });
      await copyFile(join(bookRoot, file.relativePath), archivedPath);
      details.push(`archived ${file.chapterRelativePath}`);
    }

    // 2) 写作资源（正式章与草稿）。单条失败只记下来，不影响其余条目与文件处理。
    let archivedResources = 0;
    try {
      const service = createWritingResourceService({
        storage,
        resolveBookDir: () => bookRoot,
        resolveChapterVolumeDirectory: (requestedBookId, chapterNumber) => resolveChapterVolumeDirectory(
          storage,
          requestedBookId,
          chapterNumber,
        ),
      });
      const resources = await service.list(bookId, { type: "chapter" });
      for (const resource of resources) {
        const n = resource.chapterNumber;
        if (typeof n !== "number" || !inRange(n)) continue;
        try {
          // accepted 正式章不可 transition 到 archived；统一 softDelete / 文件归档。
          await service.softDelete(bookId, resource.id);
          details.push(`soft-deleted resource ${resource.id} ch${n}`);
          archivedResources += 1;
        } catch (error) {
          details.push(`writing-resource ${resource.id} 清理失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      details.push(`writing-resource 清理部分失败：${error instanceof Error ? error.message : String(error)}`);
    }

    // 3) 仍留在原处的范围内正文：归档模式移入归档目录（覆盖第 1 步的同内容副本），hardDelete 时删除。
    const remaining = (await listChapterFiles(bookRoot)).filter((file) => inRange(file.number));
    for (const file of remaining) {
      const full = join(bookRoot, file.relativePath);
      if (hardDelete) {
        await rm(full, { force: true });
        details.push(`deleted ${file.chapterRelativePath}`);
      } else {
        const archivedPath = join(archiveDir, file.chapterRelativePath);
        await mkdir(dirname(archivedPath), { recursive: true });
        await rename(full, archivedPath);
        if (!handled.has(file.chapterRelativePath)) details.push(`archived ${file.chapterRelativePath}`);
      }
      handled.add(file.chapterRelativePath);
    }
    if (handled.size === 0) details.push("范围内没有章节文件，跳过文件清理。");

    // 4) 裁剪 index.json 中范围内条目（若存在）。
    const indexPath = join(bookRoot, "chapters", "index.json");
    let raw: string | undefined;
    try {
      raw = await readFile(indexPath, "utf8");
    } catch {
      raw = undefined; // index 可选
    }
    if (raw !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = undefined;
        details.push("index.json 不是合法 JSON，未改动；章节列表以磁盘上的正文文件为准。");
      }
      if (Array.isArray(parsed)) {
        const next = parsed.filter((entry) => {
          if (!entry || typeof entry !== "object") return true;
          const number = Number((entry as { number?: unknown }).number);
          return !Number.isFinite(number) || !inRange(number);
        });
        if (next.length !== parsed.length) {
          await writeFileAtomic(indexPath, `${JSON.stringify(next, null, 2)}\n`);
          details.push(`index.json 移除 ${parsed.length - next.length} 条章节元数据`);
        }
      }
    }

    return { deletedChapterFiles: handled.size, archivedResources };
  });
}

/**
 * 文风金库里被删章的 AI 原稿（story/style-vault/chapter-NNNN.json）随删章移出金库（T-14④）：
 * 归档模式移进本次归档目录的 _style-vault 子目录，hardDelete 时删除。单个文件失败只记下来。
 */
async function discardStyleVaultDrafts(input: Readonly<{
  bookRoot: string;
  fromChapter: number;
  toChapter: number;
  hardDelete: boolean;
  archiveDir: string;
  details: string[];
}>): Promise<number> {
  const vaultDir = join(input.bookRoot, STYLE_VAULT_RELATIVE_DIR);
  const names = await readdir(vaultDir).catch(() => [] as string[]);
  let moved = 0;
  for (const name of names) {
    // 与 style-vault 的原稿文件名规则一致：chapter-<至少 4 位章号>.json。
    const match = /^chapter-(\d{4,})\.json$/u.exec(name);
    if (!match) continue;
    const chapterNumber = Number(match[1]);
    if (chapterNumber < input.fromChapter || chapterNumber > input.toChapter) continue;
    try {
      if (input.hardDelete) {
        await rm(join(vaultDir, name), { force: true });
        input.details.push(`deleted style-vault draft ${name}`);
      } else {
        const archivedPath = join(input.archiveDir, "_style-vault", name);
        await mkdir(dirname(archivedPath), { recursive: true });
        await rename(join(vaultDir, name), archivedPath);
        input.details.push(`archived style-vault draft ${name}`);
      }
      moved += 1;
    } catch (error) {
      input.details.push(`文风金库原稿 ${name} 未能移出金库：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return moved;
}

function assertChapterBound(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`invalid chapter bound: ${value}`);
  return value;
}

/**
 * 某行事实是否属于删除范围（SQL 片段）。章号是已校验的正整数，直接内联，避免长串位置参数排错。
 * - 来源章在范围内：章节没了，由它结算出的事实一并删除（含作者对这些事实的纠正，因为纠正继承了来源章）；
 * - 生效起点在范围内且有效期没越过范围：只针对机器来源。作者手动事实（manual）的起点只是作者录入/纠正时
 *   顺手取的「当时最新章」，不代表它出自这几章，删章不得把作者的权威值一起删掉。
 */
function factInDiscardRangeSql(alias: string, fromChapter: number, toChapter: number): string {
  const from = assertChapterBound(fromChapter);
  const to = assertChapterBound(toChapter);
  return `(
    (${alias}.source_chapter IS NOT NULL AND ${alias}.source_chapter BETWEEN ${from} AND ${to})
    OR (${alias}.source_type != 'manual'
        AND ${alias}.valid_from_chapter IS NOT NULL AND ${alias}.valid_from_chapter BETWEEN ${from} AND ${to}
        AND (${alias}.valid_until_chapter IS NULL OR ${alias}.valid_until_chapter <= ${to}))
  )`;
}

function deleteMemoryInRange(
  storage: StorageDatabase,
  bookId: string,
  fromChapter: number,
  toChapter: number,
): { deletedEvents: number; deletedFacts: number; deletedLogs: number; reactivatedFacts: number; deletedOrphans: number } {
  ensureNarrativeMemorySchema(storage);
  ensureSettlementLedgerSchema(storage);
  const from = assertChapterBound(fromChapter);
  const to = assertChapterBound(toChapter);

  // 整段清理放在一个事务里：中途失败则整体回滚，不留半删的记忆（T-14②）。
  const run = storage.sqlite.transaction(() => {
    // 1) 重新激活（必须先于删除：删除会抹掉判断关闭关系的依据）。
    //    只复活「关闭它的那条后继值本身来自被删章」的事实（T-14②）：
    //    - 同槽位存在后继值：由被删章结算产生（source_type='event' 且来源章在范围内），
    //      且后继值的起点恰是它的失效章（reducer 关闭旧值时写的就是新值的起始章）；
    //    - 自身不是作废态（valid_until < valid_from，例如改写重结算作废的旧派生）；
    //    - 没有被作者纠正过（纠正会留下 manual-correction:<id> 替代链）；作者手动作废不留后继值，自然不满足；
    //    - 复活后槽位里没有别的存活 open 值（例如作者手动录入的权威值），避免同槽位两个当前值。
    const reactivatedFacts = storage.sqlite.prepare(`
      UPDATE narrative_fact
      SET valid_until_chapter = NULL, updated_at = ?
      WHERE book_id = ?
        AND valid_until_chapter BETWEEN ${from} AND ${to}
        AND valid_until_chapter >= COALESCE(valid_from_chapter, source_chapter, 0)
        AND slot_key IS NOT NULL
        AND NOT ${factInDiscardRangeSql("narrative_fact", from, to)}
        AND NOT EXISTS (
          SELECT 1 FROM narrative_fact correction
          WHERE correction.book_id = narrative_fact.book_id
            AND correction.source_id = 'manual-correction:' || narrative_fact.id
        )
        AND EXISTS (
          SELECT 1 FROM narrative_fact successor
          WHERE successor.book_id = narrative_fact.book_id
            AND successor.slot_key = narrative_fact.slot_key
            AND successor.id != narrative_fact.id
            AND successor.source_type = 'event'
            AND successor.source_chapter BETWEEN ${from} AND ${to}
            AND successor.valid_from_chapter = narrative_fact.valid_until_chapter
        )
        AND NOT EXISTS (
          SELECT 1 FROM narrative_fact survivor
          WHERE survivor.book_id = narrative_fact.book_id
            AND survivor.slot_key = narrative_fact.slot_key
            AND survivor.id != narrative_fact.id
            AND survivor.valid_until_chapter IS NULL
            AND NOT ${factInDiscardRangeSql("survivor", from, to)}
        )
    `).run(new Date().toISOString(), bookId).changes;

    // 2) 删除范围内的事件与事实。
    const deletedEvents = storage.sqlite.prepare(`
      DELETE FROM narrative_event
      WHERE book_id = ? AND chapter_number >= ? AND chapter_number <= ?
    `).run(bookId, from, to).changes;

    // 回收站（T-28）里同范围的丢弃记录一并清掉。不清的话，作者在待确认面板点「撤销」
    // 会把它们搬回 narrative_event，成为已删除章节的孤儿事件。
    storage.sqlite.prepare(`
      DELETE FROM narrative_event_trash
      WHERE book_id = ? AND chapter_number >= ? AND chapter_number <= ?
    `).run(bookId, from, to);

    const deletedFacts = storage.sqlite.prepare(`
      DELETE FROM narrative_fact
      WHERE book_id = ? AND ${factInDiscardRangeSql("narrative_fact", from, to)}
    `).run(bookId).changes;

    let deletedLogs = 0;
    try {
      deletedLogs = storage.sqlite.prepare(`
        DELETE FROM narrative_retrieval_log
        WHERE book_id = ? AND chapter_number >= ? AND chapter_number <= ?
      `).run(bookId, from, to).changes;
    } catch {
      deletedLogs = 0;
    }

    // 3) 场景的剧情线挂载按 scene_id 关联、自身没有章号：必须在删场景之前先删，否则留下孤儿挂载（T-14④）。
    let deletedOrphans = storage.sqlite.prepare(`
      DELETE FROM narrative_scene_storyline
      WHERE scene_id IN (
        SELECT id FROM narrative_scene WHERE book_id = ? AND chapter_number >= ? AND chapter_number <= ?
      )
    `).run(bookId, from, to).changes;

    // 4) 按章号清理其余记忆表，避免留下孤儿记忆（T-14②）。
    //    narrative_context_vector / narrative_tag* 没有章号：前者是按经纬实体的向量缓存，后者每次组装上下文整本重建，不按章清理。
    for (const table of ["narrative_chapter_settlement", "narrative_settlement_artifact", "narrative_chapter_mention", "narrative_structure_score", "narrative_scene"]) {
      deletedOrphans += storage.sqlite.prepare(`
        DELETE FROM ${table}
        WHERE book_id = ? AND chapter_number >= ? AND chapter_number <= ?
      `).run(bookId, from, to).changes;
    }

    return { deletedEvents, deletedFacts, deletedLogs, reactivatedFacts, deletedOrphans };
  });

  return run();
}

async function resetHooksInRange(
  storage: StorageDatabase,
  bookId: string,
  fromChapter: number,
  toChapter: number,
  strategy: HookResetStrategy,
  bookRoot: string,
): Promise<{ hooksReset: number; hooksNotes: string[] }> {
  if (strategy === "none") return { hooksReset: 0, hooksNotes: ["resetHooks=none，未修改伏笔。"] };

  const notes: string[] = [];
  let hooksReset = 0;

  // 经纬 foreshadowing：按 related chapter 落在范围内的条目软退役或打回 planned 标记
  try {
    const rows = storage.sqlite.prepare(`
      SELECT id, title, related_chapter_numbers_json, fields_json, lifecycle
      FROM story_jingwei_entry
      WHERE book_id = ?
        AND category IN ('foreshadowing', 'hook', 'pending-hook')
        AND deleted_at IS NULL
    `).all(bookId) as Array<{
      id: string;
      title: string;
      related_chapter_numbers_json: string | null;
      fields_json: string | null;
      lifecycle: string | null;
    }>;

    for (const row of rows) {
      let chapters: number[] = [];
      try {
        const parsed = JSON.parse(row.related_chapter_numbers_json ?? "[]") as unknown;
        chapters = Array.isArray(parsed) ? parsed.map(Number).filter((n) => Number.isFinite(n)) : [];
      } catch {
        chapters = [];
      }
      const hit = chapters.some((n) => n >= fromChapter && n <= toChapter);
      if (!hit) continue;

      if (strategy === "planned-only") {
        // 仅把仍 active 的标记为 planned 语义：lifecycle 保持 active，fields 记 reset
        let fields: Record<string, unknown> = {};
        try {
          fields = row.fields_json ? JSON.parse(row.fields_json) as Record<string, unknown> : {};
        } catch {
          fields = {};
        }
        fields.hookStatus = "planned";
        fields.resetByDiscardRange = { fromChapter, toChapter };
        const columns = new Set((storage.sqlite.prepare(`PRAGMA table_info('story_jingwei_entry')`).all() as Array<{ name: string }>).map((item) => item.name));
        const setClauses = ["fields_json = ?"];
        const values: unknown[] = [JSON.stringify(fields)];
        if (columns.has("updated_at")) {
          setClauses.push("updated_at = ?");
          values.push(new Date().toISOString());
        }
        if (columns.has("version")) setClauses.push("version = COALESCE(version, 1) + 1");
        if (columns.has("entry_key")) setClauses.push("entry_key = COALESCE(entry_key, id)");
        if (columns.has("source_refs_json")) setClauses.push("source_refs_json = COALESCE(source_refs_json, '[]')");
        values.push(row.id);
        storage.sqlite.prepare(`UPDATE story_jingwei_entry SET ${setClauses.join(", ")} WHERE id = ?`).run(...values);
      } else {
        // untouched：软归档，避免假「待埋设」继续污染驾驶舱
        const columns = new Set((storage.sqlite.prepare(`PRAGMA table_info('story_jingwei_entry')`).all() as Array<{ name: string }>).map((item) => item.name));
        const nowIso = new Date().toISOString();
        const setClauses = ["lifecycle = 'archived'"];
        const values: unknown[] = [];
        if (columns.has("deleted_at")) {
          setClauses.push("deleted_at = ?");
          values.push(nowIso);
        }
        if (columns.has("updated_at")) {
          setClauses.push("updated_at = ?");
          values.push(nowIso);
        }
        if (columns.has("version")) setClauses.push("version = COALESCE(version, 1) + 1");
        if (columns.has("entry_key")) setClauses.push("entry_key = COALESCE(entry_key, id)");
        if (columns.has("source_refs_json")) setClauses.push("source_refs_json = COALESCE(source_refs_json, '[]')");
        values.push(row.id);
        storage.sqlite.prepare(`UPDATE story_jingwei_entry SET ${setClauses.join(", ")} WHERE id = ?`).run(...values);
      }
      hooksReset += 1;
      notes.push(`${strategy}: ${row.title} (${row.id})`);
    }
  } catch (error) {
    notes.push(`经纬伏笔重置跳过：${error instanceof Error ? error.message : String(error)}`);
  }

  // story/pending_hooks.md：移除「第N章」落在范围内的行（MVP 文本启发式）
  try {
    const hooksPath = join(bookRoot, "story", "pending_hooks.md");
    const content = await readFile(hooksPath, "utf8").catch(() => "");
    if (content.trim()) {
      const lines = content.split(/\r?\n/u);
      const next = lines.filter((line) => {
        const match = line.match(/第\s*(\d+)\s*章/u);
        if (!match) return true;
        const n = Number(match[1]);
        return !Number.isFinite(n) || n < fromChapter || n > toChapter;
      });
      if (next.length !== lines.length) {
        await mkdir(dirname(hooksPath), { recursive: true });
        await writeFile(hooksPath, `${next.join("\n").replace(/\n+$/u, "")}\n`, "utf8");
        notes.push(`pending_hooks.md 移除 ${lines.length - next.length} 行范围内伏笔文本`);
      }
    }
  } catch (error) {
    notes.push(`pending_hooks.md 处理跳过：${error instanceof Error ? error.message : String(error)}`);
  }

  return { hooksReset, hooksNotes: notes };
}

export async function handleChapterDiscardRange(input: ChapterDiscardRangeInput): Promise<ChapterDiscardRangeResult> {
  const bookId = input.bookId?.trim();
  if (!bookId) return fail("missing-book-id", "缺少 bookId。");
  if (input.confirm !== true) {
    return fail("confirm-required", "chapter.discard_range 必须 confirm=true。", { bookId });
  }
  if (!input.bookRoot?.trim()) {
    return fail("missing-book-root", "缺少可信 bookRoot。", { bookId });
  }

  const fromChapter = Math.trunc(input.fromChapter);
  const toChapter = Math.trunc(input.toChapter);
  if (!Number.isFinite(fromChapter) || !Number.isFinite(toChapter) || fromChapter < 1 || toChapter < fromChapter) {
    return fail("invalid-range", "fromChapter/toChapter 无效：需满足 1 ≤ from ≤ to。", { bookId, fromChapter, toChapter });
  }
  if (toChapter - fromChapter > 200) {
    return fail("range-too-large", "单次 discard_range 最多 200 章。", { bookId, fromChapter, toChapter });
  }

  const storage = input.storage ?? getStorageDatabase();
  const hardDelete = Boolean(input.hardDelete);
  const deleteMemory = input.deleteMemory !== false;
  const resetHooks = input.resetHooks ?? "untouched";
  const now = input.now?.() ?? new Date();
  const bookRoot = input.bookRoot!;
  const details: string[] = [];
  const archiveDir = join(bookRoot, "chapters", "_discarded", now.toISOString().replace(/[:.]/gu, "-"));
  const rangeLabel = fromChapter === toChapter ? `第 ${fromChapter} 章` : `第 ${fromChapter}-${toChapter} 章`;

  // 第一步：记忆（单个 SQLite 事务）。放在动任何文件之前：失败时整体回滚、什么都没动，可原样重试（T-14⑤）。
  let deletedEvents = 0;
  let deletedFacts = 0;
  let deletedLogs = 0;
  let reactivatedFacts = 0;
  let deletedOrphans = 0;
  if (deleteMemory) {
    try {
      const mem = deleteMemoryInRange(storage, bookId, fromChapter, toChapter);
      deletedEvents = mem.deletedEvents;
      deletedFacts = mem.deletedFacts;
      deletedLogs = mem.deletedLogs;
      reactivatedFacts = mem.reactivatedFacts;
      deletedOrphans = mem.deletedOrphans;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return fail("memory-cleanup-failed", `${rangeLabel}的记忆清理失败，已整体回滚，正文与章节索引都没动：${message}`, {
        bookId,
        fromChapter,
        toChapter,
        details,
        explanation: {
          whatHappened: `清理${rangeLabel}的叙事记忆时出错（${message}），这次删章已整体回滚：记忆、正文、章节索引都保持原样。`,
          whyItMatters: "记忆和正文必须一起清掉；只清一半会让写作上下文继续引用已删的章节，或让新写的章接不上前文。",
          suggestedAction: "用同样的范围再执行一次删章即可，重试是安全的；若反复失败，检查数据库文件是否被占用、磁盘空间是否不足。",
        },
      });
    }
    details.push(`记忆已清理：事件 ${deletedEvents}，事实 ${deletedFacts}，检索日志 ${deletedLogs}，按章派生行 ${deletedOrphans}，恢复旧值 ${reactivatedFacts}`);
  }

  // 第二步：正文文件、写作资源与章节索引（持章节索引锁）。失败时如实列出已做的步骤；
  // 重试同一范围是安全的：记忆不会被重复清理，已归档的文件不会再被找到。
  let fileResult: { deletedChapterFiles: number; archivedResources: number };
  try {
    fileResult = await discardChapterFiles({ storage, bookId, bookRoot, fromChapter, toChapter, hardDelete, archiveDir, details });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const done = details.filter((line) => line.startsWith("archived ") || line.startsWith("deleted ") || line.startsWith("soft-deleted "));
    return fail("chapter-files-failed", `${rangeLabel}的正文文件处理失败：${message}`, {
      bookId,
      fromChapter,
      toChapter,
      deletedEvents,
      deletedFacts,
      deletedLogs,
      reactivatedFacts,
      deletedOrphans,
      details,
      explanation: {
        whatHappened: `${deleteMemory ? `${rangeLabel}的记忆已清理（事件 ${deletedEvents} 条、事实 ${deletedFacts} 条），但` : ""}处理正文文件或章节索引时出错（${message}）。`
          + (done.length > 0 ? `出错前已处理 ${done.length} 项：${done.slice(0, 6).join("；")}${done.length > 6 ? " 等" : ""}。` : "出错前还没有处理任何文件。"),
        whyItMatters: "这几章的正文或章节索引可能还留在原处，写作台会继续显示它们；归档目录里的副本不受影响，正文不会丢。",
        suggestedAction: "关掉正在打开这些章节的编辑器、同步盘或杀毒扫描后，用同样的范围再执行一次删章；重试是安全的，已清理的记忆不会被重复处理，已归档的文件也不会再被找到。",
      },
    });
  }
  const archivedResources = fileResult.archivedResources;

  // 第三步：文风金库里被删章的 AI 原稿移出金库（T-14④）。单个文件失败只记进 details。
  await discardStyleVaultDrafts({ bookRoot, fromChapter, toChapter, hardDelete, archiveDir, details });

  // 第四步：实体索引（状态流水 / 关系边 / 事件参与者等）由经纬 + 记忆整本派生，删章后整本重建（T-14④）。
  // 失败不回滚已完成的删章：索引会在下一次结算时再次整本重建。
  if (deleteMemory) {
    try {
      const rebuilt = rebuildNarrativeEntityIndex(storage, bookId);
      if (!rebuilt.ok) details.push(`实体索引未重建：${rebuilt.explanation}`);
    } catch (error) {
      details.push(`实体索引未重建（不影响删章结果，下一次结算会自动整本重建）：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const hookResult = await resetHooksInRange(storage, bookId, fromChapter, toChapter, resetHooks, bookRoot);

  const deletedChapters = Math.max(archivedResources, fileResult.deletedChapterFiles);
  return {
    ok: true,
    bookId,
    fromChapter,
    toChapter,
    deletedChapters,
    archivedResources,
    deletedChapterFiles: fileResult.deletedChapterFiles,
    deletedEvents,
    deletedFacts,
    deletedLogs,
    reactivatedFacts,
    deletedOrphans,
    hooksReset: hookResult.hooksReset,
    hooksNotes: hookResult.hooksNotes,
    details,
    summary: `已丢弃第 ${fromChapter}-${toChapter} 章：资源 ${archivedResources}，文件 ${fileResult.deletedChapterFiles}，events ${deletedEvents}，facts ${deletedFacts}，hooks ${hookResult.hooksReset}。后续 write.preflight 应显示无该段近章记忆。`,
  };
}
