/**
 * book.dissect / import 闭环辅助：从已有正文抽取续写所需的最小草案。
 * 默认只出草案；apply=true 时写入经纬 dynamic 账本（hooks 文本 / focus / 章摘要旁路导出）。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { getStorageDatabase } from "@vivy1024/novelfork-core";

import { handleChapterRead } from "./chapter-read.js";
import { handleMemorySettleRange } from "./memory-settle-range.js";
import { handleWritePreflight } from "./write-preflight.js";
import {
  DISSECT_LLM_SYSTEM_PROMPT,
  buildDissectLlmUserPrompt,
  extractKnowledgePack,
  mergeLlmKnowledgePack,
  type DissectKnowledgePack,
  type DissectWorldCategory,
} from "./dissect-knowledge.js";
import { upsertLedgerEntry, type LedgerKind } from "./jingwei-ledger-store.js";

/** 世界要素分类 → 经纬分类。 */
const WORLD_CATEGORY_MAP: Record<DissectWorldCategory, LedgerKind> = {
  location: "locations",
  faction: "factions",
  "power-system": "power-system",
  rules: "rules",
  props: "props",
  timeline: "world-model",
};

export type DissectTarget = "characters" | "world" | "hooks" | "summaries" | "style" | "all";

export interface BookDissectInput {
  readonly bookId: string;
  readonly bookRoot: string;
  readonly fromChapter?: number;
  readonly toChapter?: number;
  readonly targets?: readonly DissectTarget[];
  /** 默认 false：只返回草案；true 时写入 story 草稿文件（非 canon lore）。 */
  readonly apply?: boolean;
  readonly settle?: boolean;
  readonly storage?: StorageDatabase;
  readonly generateText?: (input: {
    messages: Array<{ role: "system" | "user"; content: string }>;
    temperature?: number;
    maxTokens?: number;
  }) => Promise<{ text: string }>;
  /** settle=true 时叙事事件抽取器；缺失时对应章节结算失败（不落假账），可重试。 */
  readonly llmExtractor?: import("../engine/narrative-memory/chapter-event-extractor.js").ChapterEventExtractorInput["llmExtractor"];
}

export interface DissectDraft {
  readonly characters: readonly string[];
  readonly locations: readonly string[];
  readonly hooks: readonly string[];
  readonly chapterSummaries: readonly { readonly number: number; readonly summary: string }[];
  readonly suggestedFocus: string | null;
  readonly notes: readonly string[];
}

export interface BookDissectResult {
  readonly ok: boolean;
  readonly bookId: string;
  readonly fromChapter: number;
  readonly toChapter: number;
  readonly applied: boolean;
  readonly settled: boolean;
  /** 兼容字段：扁平草案（等于 knowledge 的兼容视图） */
  readonly draft: DissectDraft;
  /** 结构化续写知识包 */
  readonly knowledge?: DissectKnowledgePack;
  readonly preflight?: Awaited<ReturnType<typeof handleWritePreflight>>;
  readonly settlementSummary?: string;
  readonly writtenFiles: readonly string[];
  readonly summary: string;
  readonly error?: string;
}

const EMPTY_DRAFT: DissectDraft = {
  characters: [],
  locations: [],
  hooks: [],
  chapterSummaries: [],
  suggestedFocus: null,
  notes: [],
};

function targetsOf(input: BookDissectInput): Set<DissectTarget | "all"> {
  const list = input.targets?.length ? input.targets : (["all"] as const);
  return new Set(list);
}

function uniqueStrings(values: readonly string[], limit = 40): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= limit) break;
  }
  return out;
}

/** 兼容入口：返回扁平草案（内部走结构化知识包）。 */
export function extractDissectDraftFromTexts(
  chapters: readonly { number: number; title: string; content: string }[],
): DissectDraft {
  return toFlatDraft(extractKnowledgePack(chapters));
}

function toFlatDraft(pack: DissectKnowledgePack): DissectDraft {
  return {
    characters: pack.characters,
    locations: pack.locations,
    hooks: pack.hooks,
    chapterSummaries: pack.chapterSummaries,
    suggestedFocus: pack.suggestedFocus,
    notes: pack.notes,
  };
}

async function listChapterRange(
  bookId: string,
  bookRoot: string,
  fromChapter: number,
  toChapter: number,
  storage?: StorageDatabase,
): Promise<Array<{ number: number; title: string; content: string }>> {
  const chapters: Array<{ number: number; title: string; content: string }> = [];
  for (let n = fromChapter; n <= toChapter; n++) {
    const read = await handleChapterRead(
      { bookId, chapterNumber: n },
      undefined,
      { bookRoot, storage },
    );
    if (!read.ok || !read.data?.content?.trim()) continue;
    chapters.push({
      number: n,
      title: `第${n}章`,
      content: read.data.content,
    });
  }
  return chapters;
}

async function resolveRange(
  bookRoot: string,
  fromChapter?: number,
  toChapter?: number,
): Promise<{ from: number; to: number }> {
  try {
    const raw = await readFile(join(bookRoot, "chapters", "index.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const numbers = Array.isArray(parsed)
      ? parsed
          .map((entry) => Number((entry as { number?: unknown }).number))
          .filter((n) => Number.isFinite(n) && n > 0)
      : [];
    const max = numbers.length ? Math.max(...numbers) : 1;
    const from = typeof fromChapter === "number" && fromChapter > 0 ? Math.trunc(fromChapter) : 1;
    const to = typeof toChapter === "number" && toChapter >= from ? Math.trunc(toChapter) : max;
    return { from, to: Math.max(from, to) };
  } catch {
    const from = typeof fromChapter === "number" && fromChapter > 0 ? Math.trunc(fromChapter) : 1;
    const to = typeof toChapter === "number" && toChapter >= from ? Math.trunc(toChapter) : from;
    return { from, to };
  }
}

async function maybeLlmEnrichPack(
  pack: DissectKnowledgePack,
  chapters: readonly { number: number; title: string; content: string }[],
  range: { from: number; to: number },
  generateText: BookDissectInput["generateText"],
): Promise<DissectKnowledgePack> {
  if (!generateText || chapters.length === 0) return pack;
  const sampleChapters = chapters.slice(-4);
  const totalChars = sampleChapters.reduce((sum, chapter) => sum + chapter.content.length, 0);
  if (totalChars < 200) return pack;
  try {
    const generated = await generateText({
      messages: [
        { role: "system", content: DISSECT_LLM_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildDissectLlmUserPrompt({
            heuristic: pack,
            chapters: sampleChapters,
            fromChapter: range.from,
            toChapter: range.to,
          }),
        },
      ],
      temperature: 0.2,
      maxTokens: 4000,
    });
    return mergeLlmKnowledgePack(pack, generated.text);
  } catch {
    return {
      ...pack,
      notes: [...pack.notes, "LLM 增补失败，保留规则抽取结果。"],
    };
  }
}

export async function handleBookDissect(input: BookDissectInput): Promise<BookDissectResult> {
  const bookId = input.bookId?.trim();
  if (!bookId) {
    return {
      ok: false,
      bookId: "",
      fromChapter: 0,
      toChapter: 0,
      applied: false,
      settled: false,
      draft: EMPTY_DRAFT,
      writtenFiles: [],
      summary: "缺少 bookId。",
      error: "missing-book-id",
    };
  }
  if (!input.bookRoot?.trim()) {
    return {
      ok: false,
      bookId,
      fromChapter: 0,
      toChapter: 0,
      applied: false,
      settled: false,
      draft: EMPTY_DRAFT,
      writtenFiles: [],
      summary: "缺少可信 bookRoot。",
      error: "missing-book-root",
    };
  }

  const range = await resolveRange(input.bookRoot, input.fromChapter, input.toChapter);
  if (range.to - range.from > 200) {
    return {
      ok: false,
      bookId,
      fromChapter: range.from,
      toChapter: range.to,
      applied: false,
      settled: false,
      draft: EMPTY_DRAFT,
      writtenFiles: [],
      summary: "单次 dissect 最多 200 章。",
      error: "range-too-large",
    };
  }

  const storage = input.storage ?? getStorageDatabase();
  const want = targetsOf(input);
  const chapters = await listChapterRange(bookId, input.bookRoot, range.from, range.to, storage);
  if (chapters.length === 0) {
    return {
      ok: false,
      bookId,
      fromChapter: range.from,
      toChapter: range.to,
      applied: false,
      settled: false,
      draft: EMPTY_DRAFT,
      writtenFiles: [],
      summary: "指定范围内无正文可读。",
      error: "no-chapters",
    };
  }

  let knowledge = extractKnowledgePack(chapters);
  if (want.has("all") || want.has("characters") || want.has("hooks") || want.has("world") || want.has("summaries")) {
    knowledge = await maybeLlmEnrichPack(knowledge, chapters, range, input.generateText);
  }
  const draft = toFlatDraft(knowledge);

  let settled = false;
  let settlementSummary: string | undefined;
  if (input.settle) {
    const settlement = await handleMemorySettleRange({
      bookId,
      bookRoot: input.bookRoot,
      fromChapter: range.from,
      toChapter: range.to,
      storage,
      ...(input.llmExtractor ? { llmExtractor: input.llmExtractor } : {}),
    });
    settled = settlement.ok && settlement.chaptersSettled > 0;
    settlementSummary = settlement.summary;
  }

  const writtenFiles: string[] = [];
  if (input.apply) {
    const createdAt = new Date().toISOString();
    const now = () => new Date(createdAt);

    // 权威写入：StorageDatabase SQLite 真实事务包裹经纬批量写。
    // 若数据库事务提交失败，取消权威提交；DB权威提交成功后，派生文件导出失败不影响/不污染权威 DB 状态。
    const applyDBWrite = () => {
      if (want.has("all") || want.has("hooks")) {
        for (const [index, hook] of knowledge.openHooks.entries()) {
          upsertLedgerEntry(storage, {
            bookId,
            category: "foreshadowing",
            title: hook.description.slice(0, 60) || `伏笔 ${index + 1}`,
            contentMd: [
              `- 埋设章：第${hook.plantedChapter}章`,
              `- 状态：${hook.status === "progressed" ? "已有进展" : "未回收"}`,
              hook.evidence ? `- 证据：${hook.evidence}` : "",
              hook.speculation ? `- 续写建议：${hook.speculation}` : "",
            ].filter(Boolean).join("\n"),
            fields: {
              hookStatus: hook.status === "progressed" ? "progressed" : "pending",
              plantedChapter: hook.plantedChapter,
              evidence: hook.evidence,
              speculation: hook.speculation,
              source: "book.dissect",
            },
            status: "needs-review",
            now,
          });
        }
        if (knowledge.openHooks.length > 0) writtenFiles.push(`jingwei:foreshadowing × ${knowledge.openHooks.length}`);
      }

      if (want.has("all") || want.has("summaries")) {
        for (const summary of knowledge.detailedSummaries) {
          upsertLedgerEntry(storage, {
            bookId,
            category: "chapter-summaries",
            title: `第${summary.number}章摘要`,
            contentMd: [
              summary.summary,
              summary.keyEvents.length > 0 ? `\n关键事件：\n${summary.keyEvents.map((item) => `- ${item}`).join("\n")}` : "",
            ].filter(Boolean).join("\n"),
            fields: {
              chapterNumber: summary.number,
              keyEvents: summary.keyEvents,
              source: "book.dissect",
            },
            status: "needs-review",
            now,
          });
        }
        if (knowledge.detailedSummaries.length > 0) {
          writtenFiles.push(`jingwei:chapter-summaries × ${knowledge.detailedSummaries.length}`);
        }
      }

      if (want.has("all") || want.has("characters")) {
        for (const card of knowledge.characterCards) {
          upsertLedgerEntry(storage, {
            bookId,
            category: "characters",
            title: card.name,
            contentMd: [
              `- 身份：${card.identity}`,
              card.aliases.length > 0 ? `- 别名：${card.aliases.join("、")}` : "",
              `- 首次出现：第${card.firstAppearance}章`,
              card.relationships.length > 0
                ? `- 关系：${card.relationships.map((rel) => `${rel.target}（${rel.relation}）`).join("、")}`
                : "",
            ].filter(Boolean).join("\n"),
            fields: {
              aliases: card.aliases,
              role: card.role,
              firstAppearance: card.firstAppearance,
              frequency: card.frequency,
              confidence: card.confidence,
              relationships: card.relationships,
              source: "book.dissect",
            },
            status: "needs-review",
            now,
          });
        }
        if (knowledge.characterCards.length > 0) {
          writtenFiles.push(`jingwei:characters × ${knowledge.characterCards.length}`);
        }
      }

      if (want.has("all") || want.has("world")) {
        for (const element of knowledge.worldElements) {
          upsertLedgerEntry(storage, {
            bookId,
            category: WORLD_CATEGORY_MAP[element.category] ?? "world-model",
            title: element.name,
            contentMd: [
              element.description,
              element.sourceChapters.length > 0 ? `\n出处章节：${element.sourceChapters.join("、")}` : "",
            ].filter(Boolean).join("\n"),
            fields: {
              worldCategory: element.category,
              sourceChapters: element.sourceChapters,
              source: "book.dissect",
            },
            status: "needs-review",
            now,
          });
        }
        if (knowledge.worldElements.length > 0) {
          writtenFiles.push(`jingwei:world × ${knowledge.worldElements.length}`);
        }

        for (const edge of knowledge.relationshipGraph) {
          upsertLedgerEntry(storage, {
            bookId,
            category: "relationships",
            title: `${edge.source} ↔ ${edge.target}`,
            contentMd: edge.description,
            fields: { source: edge.source, target: edge.target, origin: "book.dissect" },
            status: "needs-review",
            now,
          });
        }
        if (knowledge.relationshipGraph.length > 0) {
          writtenFiles.push(`jingwei:relationships × ${knowledge.relationshipGraph.length}`);
        }
      }
    };

    try {
      const runInTx = storage.sqlite.transaction(applyDBWrite);
      runInTx();
    } catch (txError) {
      return {
        ok: false,
        bookId,
        fromChapter: range.from,
        toChapter: range.to,
        applied: false,
        settled,
        draft,
        writtenFiles: [],
        summary: `经纬权威事务写入失败，数据已完全回滚：${txError instanceof Error ? txError.message : String(txError)}`,
        error: "dissect-transaction-failed",
      };
    }

    // DB 权威提交已成功。派生文件导出为可重建补偿导出，导出失败捕获记录，不污染/回滚权威 DB。
    try {
      const storyDir = join(input.bookRoot, "story");
      await mkdir(storyDir, { recursive: true });

      if (want.has("all") || want.has("hooks")) {
        const hooksPath = join(storyDir, "pending_hooks.md");
        const existing = await readFile(hooksPath, "utf8").catch(() => "");
        const lines = knowledge.openHooks.map((hook, index) =>
          `- [${hook.status === "progressed" ? "~" : " "}] [dissect-${index + 1}] 第${hook.plantedChapter}章：${hook.description}`,
        );
        const next = existing.trim()
          ? `${existing.trimEnd()}\n\n# dissect ${createdAt}（导出）\n${lines.join("\n")}\n`
          : `# 伏笔追踪（导出；权威源在经纬 foreshadowing）\n\n${lines.join("\n")}\n`;
        await writeFile(hooksPath, next, "utf8");
        writtenFiles.push("story/pending_hooks.md（导出）");
      }

      if ((want.has("all") || want.has("summaries") || want.has("characters")) && knowledge.suggestedFocus) {
        const focusPath = join(storyDir, "current_focus.md");
        const existingFocus = await readFile(focusPath, "utf8").catch(() => "");
        if (!existingFocus.trim()) {
          await writeFile(focusPath, `${knowledge.suggestedFocus}\n`, "utf8");
          writtenFiles.push("story/current_focus.md（导出）");
        }
      }

      // 调试快照（非权威源）
      await writeFile(
        join(storyDir, "dissect_draft.json"),
        `${JSON.stringify({ bookId, range, createdAt, note: "调试快照；权威源在经纬", draft, knowledge }, null, 2)}\n`,
        "utf8",
      );
      writtenFiles.push("story/dissect_draft.json（快照）");
    } catch (exportError) {
      writtenFiles.push(`export:warning - 派生导出文件写入失败（可随时从 DB 经纬重建）: ${exportError instanceof Error ? exportError.message : String(exportError)}`);
    }
  }

  const preflight = await handleWritePreflight({
    bookId,
    bookRoot: input.bookRoot,
    storage,
    userDirectives: knowledge.suggestedFocus ?? undefined,
    acceptFocusDefault: true,
  });

  return {
    ok: true,
    bookId,
    fromChapter: range.from,
    toChapter: range.to,
    applied: Boolean(input.apply),
    settled,
    draft,
    knowledge,
    preflight,
    settlementSummary,
    writtenFiles,
    summary: [
      `已拆解第 ${range.from}-${range.to} 章（有效正文 ${chapters.length} 章）`,
      `角色卡 ${knowledge.characterCards.length} / 设定 ${knowledge.worldElements.length} / 钩子 ${knowledge.openHooks.length} / 摘要 ${knowledge.detailedSummaries.length}`,
      settled ? "已 settle" : "未 settle",
      input.apply
        ? `已写入经纬 needs-review（${writtenFiles.length} 项，待作者确认）`
        : "仅草案未落盘",
      preflight.ok ? "preflight 就绪" : `preflight 未就绪：${preflight.blockers.map((item) => item.code).join(",") || "unknown"}`,
    ].join("；"),
  };
}
