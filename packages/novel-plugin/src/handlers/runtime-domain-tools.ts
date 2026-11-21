import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  splitChapters,
  splitChaptersWithVolumes,
  MAX_SPLIT_TEXT_LENGTH,
  StateManager,
  getStorageDatabase,
  type ChapterMeta,
} from "@vivy1024/novelfork-core";
import type {
  RuntimeTextGenerator,
  RuntimeToolResult,
  ToolExecutionContext,
} from "@vivy1024/novelfork-core/plugins";
import {
  exportPendingHooksMarkdown,
  findLedgerEntryById,
  findLedgerEntryByTitle,
  listLedgerEntries,
  softDeleteLedgerEntry,
  upsertLedgerEntry,
} from "./jingwei-ledger-store.js";
import { recordLedgerConflict } from "../engine/jingwei/ledger-conflict-store.js";
import { handleChapterAuditV2 } from "./chapter-audit-v2.js";
import { handleChapterRead } from "./chapter-read.js";
import { handleChapterWrite } from "./chapter-write.js";
import { createWritingResourceService } from "../engine/writing-resource/service.js";
import { writeFileAtomic } from "../engine/writing-resource/atomic-write.js";
import { withChapterIndexLock } from "../engine/writing-resource/chapter-index-lock.js";
import { executePipelineWrite, type PipelineWriteInput, type PipelineWriteOptions } from "./pipeline-write-service.js";
import { createRuntimeChapterEventExtractor } from "../engine/narrative-memory/chapter-event-extractor.js";
import { handleSceneSpec, getCachedSceneSpec, type SceneSpec } from "./scene-spec-handler.js";
import { executeWorkflowRecipeTool } from "./workflow-recipe-tools.js";
import { executeWorkflowRunTool } from "./workflow-run-tools.js";
import { getApprovedProse, getApprovedSceneSpec } from "../engine/workflows/run-service.js";
import { getActiveWorkflowRunForNarrator } from "../engine/workflows/run-store.js";
import { executeStyleDistillationTool } from "./style-distill-tools.js";
import { BookTextFileError, readBookTextFile } from "../engine/writing-layers/source-file-index.js";
import { MAX_MANUSCRIPT_CHAPTERS } from "../engine/manuscript-import/manuscript-import.js";
import { executeMechanismDistillTool, executeStyleConsolidateTool } from "./mechanism-distill-tools.js";
import { executeCharacterVoiceTool } from "./character-voice-tools.js";
import { proposeSelectionCandidate } from "./selection-candidate-tools.js";
import { handleStorylinePropose } from "./storyline-tools.js";
import { handleLoreProgress, handleLoreRelate } from "./lore-story-progress.js";
import {
  CHAPTERS_DIRECTORY,
  ChapterStoreError,
  DEFAULT_VOLUME_DIRECTORY,
  chapterRelativePath,
  chapterTitleFromContent,
  listChapterFiles,
  normalizeChapterRelativePath,
  parseChapterFileName,
  readChapterIndex as readChapterLayoutIndex,
  volumeDirectoryName,
  writeChapterIndex,
  type ChapterIndexRecord,
} from "../engine/writing-resource/chapter-layout.js";
import { createChapterFileResolver } from "../engine/writing-resource/chapter-path-guard.js";
import { createStoryJingweiEntryRepository } from "../engine/jingwei/repositories/entry-repo.js";

export interface TrustedRuntimeBookBinding {
  readonly bookId: string;
  readonly root: string;
}

function fail(error: string, summary: string, data?: unknown): RuntimeToolResult {
  return {
    ok: false,
    error,
    summary,
    ...(data === undefined ? {} : { data: JSON.parse(JSON.stringify(data)) }),
  };
}

function ok(summary: string, data?: unknown): RuntimeToolResult {
  return {
    ok: true,
    summary,
    ...(data === undefined ? {} : { data: JSON.parse(JSON.stringify(data)) }),
  };
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  return value === undefined ? undefined : positiveInteger(value) ?? undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

function writingSkillAcknowledgements(
  value: unknown,
): PipelineWriteInput["acknowledgedSkills"] {
  if (!Array.isArray(value)) return undefined;
  const acknowledgements = value.flatMap((item) => {
    const entry = record(item);
    if (!entry || typeof entry.slug !== "string" || typeof entry.quote !== "string") return [];
    return [{ slug: entry.slug, quote: entry.quote }];
  });
  return acknowledgements.length > 0 ? acknowledgements : undefined;
}

function trustedBookState(binding: TrustedRuntimeBookBinding): StateManager {
  return new StateManager(binding.root, {
    resolveBookDir: (requestedBookId) => {
      if (requestedBookId !== binding.bookId) {
        throw new Error("The requested book does not match the trusted binding.");
      }
      return binding.root;
    },
  });
}

/**
 * 单项生成工具使用当前 Runtime 会话模型（context.generateText）：受权限、
 * 工具记录与会话可见性约束，与前端 inline-write 调 LLM 同构，不构成第二套 Agent。
 */
function requireGenerator(context: ToolExecutionContext): RuntimeTextGenerator | RuntimeToolResult {
  return context.generateText ?? fail(
    "runtime-model-unavailable",
    "当前 Runtime 会话没有可用的文本生成能力，请先配置模型。",
  );
}

async function readBookConfig(binding: TrustedRuntimeBookBinding): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(join(binding.root, "book.json"), "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("book.json 不是有效对象。");
  }
  return parsed as Record<string, unknown>;
}

async function readChapterIndex(binding: TrustedRuntimeBookBinding): Promise<ChapterIndexRecord[]> {
  // 读取章节列表前先把遗留 accepted writing_resource 安全物化到正式文件层。
  // 物化失败不吞掉已有文件索引，避免兼容迁移影响正常读取。
  try {
    const service = createWritingResourceService({
      storage: getStorageDatabase(),
      resolveBookDir: () => binding.root,
    });
    await service.list(binding.bookId, { type: "chapter", status: "accepted" });
  } catch (error) {
    // 物化失败可以跳过，兼容读取继续走文件索引；但索引读不出 / 已损坏（ChapterStoreError）必须抛出：
    // 损坏的索引此时已被改名留底，吞掉它会让下面读到 ENOENT 当成空索引，导入再把空索引 + 新章写回，
    // 正是 C 轨道要堵住的「读失败当空、再整份写回」。
    if (error instanceof ChapterStoreError) throw error;
  }
  const indexed = await readChapterLayoutIndex(binding.root);
  if (indexed.length > 0) return indexed;

  // 兼容主迁移完成前缺少标准字段的旧索引（如 core StateManager 写的 ChapterMeta，本身没有 fileName）；
  // 新写入始终走 chapter-layout 的标准记录。
  // T-01：回退分支同样经路径守卫。importChapters 会把这里的结果原样写回索引，
  // 不过滤就会把越界 fileName 持久化下去。带 fileName 的条目必须落在章节目录内，否则丢弃；
  // 没有 fileName 的旧条目不指向任何文件，照旧保留。
  // 走到这里说明标准解析器已读到合法、但没有标准条目的索引（读失败与坏 JSON 它都会抛 ChapterStoreError）。
  // 只有文件确实不存在才等于空；其它读错误照样抛出——importChapters 会把这里的结果整份写回索引，
  // 把「暂时读不到」当成空，就会抹掉已有章节的元数据。
  let raw: string;
  try {
    raw = await readFile(join(binding.root, "chapters", "index.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  const resolveChapterFile = createChapterFileResolver(join(binding.root, "chapters"));
  return parsed.filter((entry): entry is ChapterIndexRecord => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const fileName = (entry as Record<string, unknown>).fileName;
    if (fileName === undefined || fileName === null) return true;
    return typeof fileName === "string" && resolveChapterFile(fileName) !== null;
  });
}

async function readBoundChapter(binding: TrustedRuntimeBookBinding, chapterNumber: number) {
  return handleChapterRead(
    { bookId: binding.bookId, chapterNumber },
    undefined,
    { bookRoot: binding.root },
  );
}

async function withBookLock<T>(binding: TrustedRuntimeBookBinding, task: () => Promise<T>): Promise<T> {
  const release = await trustedBookState(binding).acquireBookLock(binding.bookId);
  try {
    // 跨进程文件锁之外再排进程内章节索引锁：写作台保存、对账不拿文件锁，只认这一把。
    return await withChapterIndexLock(binding.root, task);
  } finally {
    await release();
  }
}

async function chapterAudit(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
): Promise<RuntimeToolResult> {
  const chapterNumber = positiveInteger(input.chapterNumber);
  if (!chapterNumber) return fail("invalid-input", "chapterNumber 必须是正整数。");
  let content = typeof input.content === "string" ? input.content : "";
  if (!content) {
    const chapter = await readBoundChapter(binding, chapterNumber);
    if (!chapter.ok || !chapter.data) return fail(chapter.error ?? "chapter-not-found", chapter.summary);
    content = chapter.data.content;
  }
  // 字数目标 fallback：调用者显式 wordTarget > book.json chapterWordCount > 审计默认值。
  // 之前不读书配置，导致 book.json=2000 的书也会被硬编码 3000 误报字数不足。
  let bookWordTarget: number | undefined;
  try {
    const bookJson = JSON.parse(await readFile(join(binding.root, "book.json"), "utf8")) as { chapterWordCount?: unknown };
    if (
      typeof bookJson.chapterWordCount === "number"
      && Number.isSafeInteger(bookJson.chapterWordCount)
      && bookJson.chapterWordCount > 0
    ) {
      bookWordTarget = bookJson.chapterWordCount;
    }
  } catch {
    // book.json 缺失/损坏不阻断审计，交回默认值
  }
  const effectiveWordTarget = typeof input.wordTarget === "number" ? input.wordTarget : bookWordTarget;
  let registerGuardrail: Parameters<typeof handleChapterAuditV2>[0]["registerGuardrail"] | undefined;
  try {
    const [{ loadStylePreset }, { loadMechanismCards }] = await Promise.all([
      import("../engine/writing-layers/style-preset-store.js"),
      import("../engine/writing-layers/mechanism-cards.js"),
    ]);
    let storageEntries: Awaited<ReturnType<ReturnType<typeof createStoryJingweiEntryRepository>["listByBook"]>> = [];
    try {
      storageEntries = await createStoryJingweiEntryRepository(getStorageDatabase()).listByBook(binding.bookId);
    } catch {
      storageEntries = [];
    }
    const [loadedPreset, loadedMechanisms] = await Promise.all([
      loadStylePreset(binding.root).catch(() => null),
      loadMechanismCards(binding.root).catch(() => ({ cards: [], revision: null })),
    ]);
    registerGuardrail = {
      stylePreset: loadedPreset?.preset ?? null,
      mechanismCards: loadedMechanisms.cards,
      confirmedEntries: storageEntries,
    };
  } catch {
    registerGuardrail = undefined;
  }
  const audit = handleChapterAuditV2({
    bookId: binding.bookId,
    chapterNumber,
    content,
    ...(record(input.sceneSpec) ? { sceneSpec: input.sceneSpec as never } : {}),
    ...(Array.isArray(input.canonEntries) ? { canonEntries: input.canonEntries as never } : {}),
    ...(typeof input.povCharacter === "string" ? { povCharacter: input.povCharacter } : {}),
    ...(typeof effectiveWordTarget === "number" ? { wordTarget: effectiveWordTarget } : {}),
    ...(Array.isArray(input.checks) ? { checks: stringArray(input.checks) } : {}),
    ...(registerGuardrail ? { registerGuardrail } : {}),
  });
  const softViolations = [...audit.softViolations];
  let structureScores: unknown = [];
  try {
    const { listStructureScores, scoreAndPersistNarrativeStructure } = await import("../engine/narrative-memory/structure-score.js");
    const storage = getStorageDatabase();
    let scores = listStructureScores(storage, binding.bookId, chapterNumber);
    if (scores.length === 0) {
      scores = scoreAndPersistNarrativeStructure(storage, binding.bookId, chapterNumber);
    }
    structureScores = scores;
    const warnings = scores.filter((row) => typeof row.deviation === "number" && row.deviation > 0.2);
    if (warnings.length > 0) {
      softViolations.push({
        ruleId: "S8",
        severity: "soft",
        description: `结构打分偏高：${warnings.map((row) => `${row.value}=${row.numericValue}`).join("，")}。`,
        suggestion: warnings.some((row) => row.featureId === "PLT_TRG_001")
          ? "有已触发未兑现的伏笔，本章应推进或回收，不要只埋新坑。"
          : warnings.some((row) => row.featureId === "PLT_MOR_002")
            ? "悬置伏笔偏多，优先回收旧坑。"
            : "本章事件缺少显式因果，结算或修订时补 causedBy。",
      });
    }
  } catch {
    structureScores = [];
  }
  return ok(audit.summary, { ...audit, softViolations, structureScores });
}

/**
 * T5.3：经纬条目字段改动候选。本工具不改条目——按字段列 before/after，
 * 作者采用时走 PUT jingwei/entries 的 fieldsPatch 合并通道，不改写的字段原样保留。
 */
async function proposeLoreUpdate(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
): Promise<RuntimeToolResult> {
  const entryId = typeof input.entryId === "string" ? input.entryId.trim() : "";
  const fieldsPatch = record(input.fieldsPatch);
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!entryId || !fieldsPatch || Object.keys(fieldsPatch).length === 0 || !reason) {
    return fail("invalid-input", "需要有效的 entryId、fieldsPatch（至少一个要改的字段）与 reason。候选没有改设定。");
  }
  const storage = getStorageDatabase();
  const repo = createStoryJingweiEntryRepository(storage);
  const entry = await repo.getById(binding.bookId, entryId);
  if (!entry) return fail("entry-not-found", `找不到条目 ${entryId}；候选没有改设定。`);
  const currentFields: Record<string, unknown> = (entry.fields && typeof entry.fields === "object"
    ? entry.fields
    : {}) as Record<string, unknown>;
  // before 只投被 patch 的键，免得把整份 fields 摆进消息里
  const before: Record<string, unknown> = {};
  for (const key of Object.keys(fieldsPatch)) before[key] = currentFields[key] ?? null;

  const artifact = {
    kind: "lore-update",
    id: crypto.randomUUID(),
    bookId: binding.bookId,
    entryId,
    entryTitle: entry.title,
    category: entry.category,
    reason,
    fieldsPatch,
    before,
  };
  return ok(
    `已生成条目「${entry.title}」的改动候选，共 ${Object.keys(fieldsPatch).length} 个字段（${Object.keys(fieldsPatch).join("、")}）。请作者核对后决定；候选尚未写入。`,
    { artifact },
  );
}

/**
 * 整份导入原文快照：写章节前一次性落到 story/import-source/（之后不再改），
 * 章节索引的 imported 条目用 importSource 指到它；重名自动追加短后缀。
 */
async function saveImportSourceSnapshot(
  storyDir: string,
  sourceName: string,
  content: string,
  isoNow: string,
): Promise<string> {
  const snapshotDir = join(storyDir, "import-source");
  await mkdir(snapshotDir, { recursive: true });
  const safeTimestamp = isoNow.replace(/[:.]/g, "-");
  const baseName = (sourceName.replace(/\\/g, "/").split("/").pop() ?? "").replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_").trim();
  const stem = baseName.replace(/\.txt$/i, "") || "导入文本";
  for (let suffix = 0; ; suffix += 1) {
    const fileName = `${safeTimestamp}-${stem}${suffix > 0 ? `-${suffix}` : ""}.txt`;
    try {
      await writeFile(join(snapshotDir, fileName), content, { encoding: "utf8", flag: "wx" });
      return `story/import-source/${fileName}`;
    } catch (error) {
      if ((error as { code?: string })?.code === "EEXIST") continue;
      throw error;
    }
  }
}

async function importChapters(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult> {
  const rawFilePath = typeof input.filePath === "string" ? input.filePath.trim() : "";
  const rawContent = typeof input.content === "string" ? input.content : "";
  if (rawFilePath && rawContent) {
    return fail("ambiguous-import-source", "请只提供 content 或 filePath 其中一种导入来源。");
  }
  let content = rawContent;
  if (rawFilePath && !rawContent) {
    try {
      const read = await readBookTextFile(binding.root, rawFilePath);
      content = read.text;
    } catch (error) {
      if (error instanceof BookTextFileError) {
        return fail(
          error.code === "BOOK_FILE_TOO_LARGE" ? "import-text-too-large" : "invalid-import-file",
          error.message,
        );
      }
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return fail("import-file-not-found", "找不到指定的本地导入文件，请确认文件在本书目录内。");
      }
      throw error;
    }
  }
  const sourceName = typeof input.sourceName === "string" && input.sourceName.trim()
    ? input.sourceName.trim()
    : rawFilePath ? basename(rawFilePath) : "导入文本";
  // 默认 500 章防误贴整本；允许的调用方可显式提高到 MAX_MANUSCRIPT_CHAPTERS（6000 章）。单次 dissect 上限另算。
  const maxChapters = Math.min(optionalPositiveInteger(input.maxChapters) ?? 500, MAX_MANUSCRIPT_CHAPTERS);
  if (content.length < 1000) return fail("text-too-short", "导入文本至少需要 1000 字。");
  if (content.length > MAX_SPLIT_TEXT_LENGTH) {
    return fail("import-text-too-large", `导入文本超过 ${MAX_SPLIT_TEXT_LENGTH} 字上限，请分批导入。`);
  }
  let split;
  try {
    split = splitChaptersWithVolumes(content, typeof input.splitPattern === "string" ? input.splitPattern : undefined);
  } catch (error) {
    return fail("invalid-split-pattern", `章节分割规则无效：${error instanceof Error ? error.message : String(error)}`);
  }
  const chapters = split.chapters.slice(0, maxChapters);
  const splitVolumes = split.volumes;
  if (chapters.length === 0) return fail("no-chapters", "未能识别出章节，请检查文本格式或 splitPattern。");

  return withBookLock(binding, async () => {
    const chaptersDir = join(binding.root, "chapters");
    const storyDir = join(binding.root, "story");
    await mkdir(chaptersDir, { recursive: true });
    await mkdir(storyDir, { recursive: true });
    const now = new Date().toISOString();
    // 原文快照先于章节落盘：快照失败就整体失败，避免章节写了却找不到原稿。
    const importSource = await saveImportSourceSnapshot(storyDir, sourceName, content, now);
    const existing = await readChapterIndex(binding);
    const startNumber = existing.reduce((max, entry) => Math.max(max, Number(entry.number) || 0), 0) + 1;
    let totalWords = 0;
    const imported: ChapterIndexRecord[] = [];
    for (let index = 0; index < chapters.length; index += 1) {
      const chapter = chapters[index]!;
      const number = startNumber + index;
      const title = chapter.title || `第${number}章`;
      const volumeDir = volumeDirectoryName(chapter.volumeIndex);
      const fileName = chapterRelativePath(volumeDir, number, title);
      const chapterContent = `# ${title}\n\n${chapter.content}`;
      const chapterPath = join(chaptersDir, fileName);
      await mkdir(dirname(chapterPath), { recursive: true });
      await writeFileAtomic(chapterPath, chapterContent);
      totalWords += chapter.content.length;
      imported.push({
        number,
        title,
        fileName,
        wordCount: chapter.content.length,
        status: "imported",
        importSource,
        createdAt: now,
        updatedAt: now,
        auditIssues: [],
        lengthWarnings: [],
      });
      context.emitOutput?.(`已导入 ${index + 1}/${chapters.length} 章…`);
    }
    await writeChapterIndex(
      binding.root,
      [...existing, ...imported].sort((left, right) => left.number - right.number),
    );

    // 原文带卷标题时同步落成经纬卷纲（chapterRange 按卷内章号划），否则后续分卷定位全落空。
    if (splitVolumes.length > 0) {
      const outlineVolumes = splitVolumes.map((volume) => {
        const inVolumeChapters = chapters
          .map((chapter, index) => ({ chapter, number: startNumber + index }))
          .filter((item) => item.chapter.volumeIndex === volume.index)
          .map((item) => item.number);
        return {
          title: volume.title,
          chapterRange: {
            from: Math.min(...inVolumeChapters),
            to: Math.max(...inVolumeChapters),
          },
        };
      }).filter((volume) => Number.isFinite(volume.chapterRange.from) && Number.isFinite(volume.chapterRange.to));
      if (outlineVolumes.length > 0) {
        // T-24：导入卷纲只在经纬还没有「导入卷纲」条目时新建；作者已有就不覆盖，冲突交待处理。
        const storage = getStorageDatabase();
        const existingOutline = findLedgerEntryByTitle(storage, binding.bookId, "outline", "导入卷纲");
        upsertLedgerEntry(storage, {
          bookId: binding.bookId,
          category: "outline",
          title: "导入卷纲",
          contentMd: "",
          fields: { volumes: outlineVolumes, importedFrom: sourceName },
          status: "confirmed",
          changedBy: "chapter-settlement",
          expectedVersion: existingOutline?.version ?? 0,
          onStaleWrite: (conflict) => { recordLedgerConflict(storage, binding.bookId, conflict); },
        });
      }
    }
    // 导入章节只接纳正文；不能顺带覆盖作者已确认的文风预设或旧统计基线。

    // 原文段落检索索引：导入直接写章节文件、不经写作资源服务，这里补建；失败只留到下次检索自愈。
    try {
      const { indexChapterPassages } = await import("../engine/narrative-memory/chapter-passage-index.js");
      const passageStorage = getStorageDatabase();
      chapters.forEach((chapter, index) => {
        const title = chapter.title || `第${startNumber + index}章`;
        indexChapterPassages(passageStorage, binding.bookId, startNumber + index, `# ${title}\n\n${chapter.content}`);
      });
    } catch {
      // 派生索引，不阻断导入。
    }

    const firstChapter = startNumber;
    const lastChapter = startNumber + chapters.length - 1;
    const autoSettle = input.autoSettle !== false;
    const extractBrief = input.extractBrief !== false;
    const applyDissectDraft = input.applyDissectDraft === true;

    let settlementSummary: string | undefined;
    let dissectSummary: string | undefined;
    let dissectDraft: unknown;
    let preflight: unknown;
    let writtenFiles: readonly string[] = [];

    if (autoSettle || extractBrief) {
      const { handleBatchedBookDissect } = await import("./book-dissect.js");
      const { createRuntimeChapterEventExtractor } = await import("../engine/narrative-memory/chapter-event-extractor.js");
      // 整本导入超过单次 dissect 上限（200 章）时自动分批：≤200 章等价单次调用。
      const dissected = await handleBatchedBookDissect({
        bookId: binding.bookId,
        bookRoot: binding.root,
        fromChapter: firstChapter,
        toChapter: lastChapter,
        settle: autoSettle,
        apply: applyDissectDraft,
        targets: ["all"],
        ...(context.generateText ? { generateText: context.generateText } : {}),
        // autoSettle 的叙事事件抽取与 memory.settle_chapter 同源。
        ...(context.generateText ? { llmExtractor: createRuntimeChapterEventExtractor(context.generateText) } : {}),
      });
      settlementSummary = dissected.settlementSummary;
      dissectSummary = dissected.summary;
      dissectDraft = dissected.draft;
      preflight = dissected.preflight;
      writtenFiles = dissected.writtenFiles;
    }

    return ok(
      [
        `已从「${sourceName}」导入 ${chapters.length} 章（共 ${totalWords} 字）`,
        autoSettle ? (settlementSummary ?? "已尝试 settle") : "未 settle",
        extractBrief ? (dissectSummary ?? "已抽取草案") : "未抽取草案",
        `原文快照 ${importSource}`,
      ].join("；"),
      {
        bookId: binding.bookId,
        importedChapters: chapters.length,
        totalWords,
        firstChapter,
        nextChapter: lastChapter + 1,
        lastChapter,
        importSource,
        styleProfileWritten: true,
        autoSettle,
        extractBrief,
        applyDissectDraft,
        settlementSummary,
        dissectSummary,
        dissectDraft,
        writtenFiles: [importSource, ...writtenFiles],
        preflight,
        nextActions: [
          "chapter.preflight",
          "book.import",
          "skills.manage",
          "chapter.blueprint",
        ],
      },
    );
  });
}

async function bookDissect(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult> {
  const { handleBookDissect } = await import("./book-dissect.js");
  const targets = Array.isArray(input.targets)
    ? input.targets.filter((item): item is string => typeof item === "string")
    : undefined;
  // settle=true 时叙事事件抽取与 memory.settle_chapter 同源：会话 generateText 构造。
  const { createRuntimeChapterEventExtractor } = await import("../engine/narrative-memory/chapter-event-extractor.js");
  const result = await handleBookDissect({
    bookId: binding.bookId,
    bookRoot: binding.root,
    ...(typeof input.fromChapter === "number" ? { fromChapter: input.fromChapter } : {}),
    ...(typeof input.toChapter === "number" ? { toChapter: input.toChapter } : {}),
    ...(targets ? { targets: targets as never } : {}),
    ...(typeof input.purpose === "string" ? { purpose: input.purpose } : {}),
    apply: input.apply === true,
    settle: input.settle === true,
    ...(context.generateText ? { generateText: context.generateText } : {}),
    ...(context.generateText ? { llmExtractor: createRuntimeChapterEventExtractor(context.generateText) } : {}),
  });
  if (!result.ok) return fail(result.error ?? "dissect-failed", result.summary);
  return ok(result.summary, result);
}

async function outlineVolume(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult> {
  const { handleOutlineVolume } = await import("./outline-volume.js");
  const { getStorageDatabase } = await import("@vivy1024/novelfork-core");
  const result = await handleOutlineVolume({
    bookId: binding.bookId,
    bookRoot: binding.root,
    storage: getStorageDatabase(),
    ...(typeof input.action === "string" ? { action: input.action } : {}),
    ...(Array.isArray(input.volumes) ? { volumes: input.volumes } : {}),
    ...(typeof input.volumeCount === "number" ? { volumeCount: input.volumeCount } : {}),
    ...(typeof input.targetChapters === "number" ? { targetChapters: input.targetChapters } : {}),
    ...(input.endgameReserve !== undefined ? { endgameReserve: input.endgameReserve } : {}),
    // 卷纲建议是创作决策，按单一 Agent 契约由叙述者自己规划后用 action=save 落盘；
    // 工具内部不再起一次规划模型调用，这里只给规则草案。
    generateText: undefined,
  });
  if (!result.ok) return fail(result.error ?? "outline-volume-failed", result.summary);
  return ok(result.summary, result);
}

async function arcCharacter(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult> {
  const { handleArcCharacter } = await import("./arc-character.js");
  const { getStorageDatabase } = await import("@vivy1024/novelfork-core");
  const result = await handleArcCharacter({
    bookId: binding.bookId,
    bookRoot: binding.root,
    storage: getStorageDatabase(),
    ...(typeof input.action === "string" ? { action: input.action } : {}),
    ...(typeof input.chapterNumber === "number" ? { chapterNumber: input.chapterNumber } : {}),
    ...(typeof input.characterName === "string" ? { characterName: input.characterName } : {}),
    ...(typeof input.mode === "string" ? { mode: input.mode } : {}),
    ...(typeof input.stagnantThreshold === "number" ? { stagnantThreshold: input.stagnantThreshold } : {}),
    generateText: undefined,
  });
  if (!result.ok) return fail(result.error ?? "arc-character-failed", result.summary);
  return ok(result.summary, result);
}

async function publishCheck(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
): Promise<RuntimeToolResult> {
  const { handlePublishCheck } = await import("./publish-check.js");
  const { getStorageDatabase } = await import("@vivy1024/novelfork-core");
  const result = await handlePublishCheck({
    bookId: binding.bookId,
    bookRoot: binding.root,
    storage: getStorageDatabase(),
    ...(typeof input.platform === "string" ? { platform: input.platform } : {}),
    ...(typeof input.chapterNumber === "number" ? { chapterNumber: input.chapterNumber } : {}),
    ...(typeof input.fromChapter === "number" ? { fromChapter: input.fromChapter } : {}),
    ...(typeof input.toChapter === "number" ? { toChapter: input.toChapter } : {}),
  });
  if (!result.ok) return fail(result.error ?? "publish-check-failed", result.summary);
  return ok(result.summary, result);
}

async function characterConsistency(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
): Promise<RuntimeToolResult> {
  const target = typeof input.characterName === "string" ? input.characterName.trim() : "";
  const characterDir = join(binding.root, "jingwei", "角色");
  const characterFiles = (await readdir(characterDir).catch(() => []))
    .filter((fileName) => fileName.endsWith(".md") && (!target || fileName.includes(target)));
  const characters = await Promise.all(characterFiles.map(async (fileName) => ({
    name: fileName.replace(/\.md$/i, ""),
    profile: (await readFile(join(characterDir, fileName), "utf8")).slice(0, 1000),
  })));
  if (characters.length === 0) return ok("未找到匹配角色。", { characters: [], mentions: [] });

  const range = record(input.chapterRange);
  const from = optionalPositiveInteger(range?.from);
  const to = optionalPositiveInteger(range?.to);
  let entries = (await readChapterIndex(binding))
    .filter((entry) => positiveInteger(entry.number))
    .sort((left, right) => Number(left.number) - Number(right.number));
  if (from || to) {
    entries = entries.filter((entry) => Number(entry.number) >= (from ?? 1) && Number(entry.number) <= (to ?? Number.MAX_SAFE_INTEGER));
  } else {
    entries = entries.slice(-5);
  }
  const mentions: Array<Record<string, unknown>> = [];
  for (const entry of entries) {
    const chapterNumber = positiveInteger(entry.number);
    if (!chapterNumber) continue;
    const chapter = await readBoundChapter(binding, chapterNumber);
    if (!chapter.ok || !chapter.data) continue;
    for (const character of characters) {
      const count = chapter.data.content.split(character.name).length - 1;
      if (count < 1) continue;
      const excerpts: string[] = [];
      let cursor = chapter.data.content.indexOf(character.name);
      while (cursor >= 0 && excerpts.length < 3) {
        excerpts.push(chapter.data.content.slice(Math.max(0, cursor - 30), cursor + character.name.length + 30).replace(/\n/g, " "));
        cursor = chapter.data.content.indexOf(character.name, cursor + character.name.length);
      }
      mentions.push({ character: character.name, chapterNumber, count, excerpts });
    }
  }
  return ok(`检查了 ${characters.length} 个角色在 ${entries.length} 章中的出现情况。`, {
    characters,
    chaptersChecked: entries.length,
    mentions,
  });
}

/** hooks.manage plant 可选带的伏笔结构化字段（与 lore.write fields 同名）。 */
function pickForeshadowFields(input: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of ["triggerCondition", "targetRange", "payoffConstraint", "importance"] as const) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) picked[key] = value.trim();
    else if (key === "targetRange" && typeof value === "number" && Number.isInteger(value) && value > 0) picked[key] = String(value);
  }
  const keywords = input.triggerKeywords;
  const list = Array.isArray(keywords)
    ? keywords.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : typeof keywords === "string" ? keywords.split(/[,，、]/u).map((item) => item.trim()).filter(Boolean) : [];
  if (list.length > 0) picked.triggerKeywords = list;
  return picked;
}

async function hooksManage(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
): Promise<RuntimeToolResult> {
  const action = typeof input.action === "string" ? input.action : "";
  const storage = getStorageDatabase();
  const rawEntries = listLedgerEntries(storage, binding.bookId, "foreshadowing");
  const listed = rawEntries.map((entry, idx) => {
    const isDone = entry.fields.status === "paid_off" || entry.fields.status === "resolved";
    const plantedChapter = typeof entry.fields.plantedChapter === "number" ? entry.fields.plantedChapter : undefined;
    const payoffChapter = typeof entry.fields.payoffChapter === "number" ? entry.fields.payoffChapter : undefined;
    return {
      id: entry.id,
      legacyIndexId: `hook-${idx}`,
      done: isDone,
      text: entry.title,
      contentMd: entry.contentMd,
      fields: entry.fields,
      plantedChapter,
      payoffChapter,
      status: String(entry.fields.status ?? (isDone ? "paid_off" : "planted")),
    };
  });

  if (action === "list") {
    return ok(`共 ${listed.length} 个伏笔。`, {
      hooks: listed.map((h) => ({
        id: h.legacyIndexId,
        entryId: h.id,
        done: h.done,
        text: h.text + (h.plantedChapter ? `（埋设于第${h.plantedChapter}章）` : "") + (h.done ? (h.payoffChapter ? `（兑现于第${h.payoffChapter}章）` : "（已兑现）") : ""),
      })),
    });
  }

  if (action === "check_due") {
    const chapterNumber = optionalPositiveInteger(input.chapterNumber);
    const dueHooks = listed.filter((hook) => !hook.done && (!chapterNumber || (() => {
      if (hook.plantedChapter) {
        return chapterNumber - hook.plantedChapter >= 10;
      }
      const planted = hook.text.match(/第(\d+)章/)?.[1];
      return planted ? chapterNumber - Number(planted) >= 10 : false;
    })()));
    return ok(`${dueHooks.length} 个伏笔到期。`, {
      chapterNumber,
      dueHooks: dueHooks.map((h) => ({
        id: h.id,
        done: h.done,
        text: h.text + (h.plantedChapter ? `（埋设于第${h.plantedChapter}章）` : ""),
      })),
    });
  }

  return withBookLock(binding, async () => {
    if (action === "plant") {
      const description = typeof input.description === "string" ? input.description.trim() : "";
      const chapterNumber = optionalPositiveInteger(input.chapterNumber);
      if (!description) return fail("invalid-input", "plant 需要 description。");
      upsertLedgerEntry(storage, {
        bookId: binding.bookId,
        category: "foreshadowing",
        title: description,
        contentMd: description,
        fields: {
          status: "planted",
          ...(chapterNumber ? { plantedChapter: chapterNumber } : {}),
          ...pickForeshadowFields(input),
        },
        changedBy: "hooks.manage",
        reason: "plant-hook",
      });
      await exportPendingHooksMarkdown(storage, binding.bookId, binding.root);
      return ok(`已埋设伏笔：${description}`, { action, description, chapterNumber });
    }

    const hookId = typeof input.hookId === "string" ? input.hookId : "";
    const selected = listed.find((h) => h.id === hookId || h.legacyIndexId === hookId);
    if (!selected) return fail("hook-not-found", `伏笔 ${hookId || "(空)"} 不存在。`);

    if (action === "payoff") {
      const chapterNumber = optionalPositiveInteger(input.chapterNumber);
      upsertLedgerEntry(storage, {
        bookId: binding.bookId,
        category: "foreshadowing",
        title: selected.text,
        contentMd: selected.contentMd || selected.text,
        // 保留条目上已有字段（触发条件、预定回收区间、回收要求等），只改状态与章号
        fields: {
          ...selected.fields,
          status: "paid_off",
          ...(selected.plantedChapter ? { plantedChapter: selected.plantedChapter } : {}),
          ...(chapterNumber ? { payoffChapter: chapterNumber } : {}),
        },
        changedBy: "hooks.manage",
        reason: "payoff-hook",
      });
      await exportPendingHooksMarkdown(storage, binding.bookId, binding.root);
      return ok(`伏笔已兑现：${selected.text}`, { action, hookId: selected.id, chapterNumber });
    }

    if (action === "delete") {
      softDeleteLedgerEntry(storage, binding.bookId, selected.id);
      await exportPendingHooksMarkdown(storage, binding.bookId, binding.root);
      return ok(`已删除伏笔：${selected.text}`, { action, hookId: selected.id });
    }

    return fail("invalid-action", `不支持的 action：${action}。`);
  });
}

/**
 * memory.settle — 单章结算或历史范围补结算。
 *
 * bookId / bookRoot 只来自可信绑定。
 */
async function memorySettle(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult> {
  const explicitAction = typeof input.action === "string" ? input.action.trim().toLowerCase() : "";
  const isRange = explicitAction === "range"
    || (explicitAction !== "chapter" && (typeof input.fromChapter === "number" || typeof input.toChapter === "number"));

  if (isRange) {
    if (typeof input.fromChapter !== "number" || typeof input.toChapter !== "number") {
      return fail("invalid-input", "范围补结算需要数字类型的 fromChapter 和 toChapter。");
    }
    const { handleMemorySettleRange } = await import("./memory-settle-range.js");
    const result = await handleMemorySettleRange({
      bookId: binding.bookId,
      bookRoot: binding.root,
      fromChapter: input.fromChapter,
      toChapter: input.toChapter,
      ...(typeof input.source === "string"
        ? { source: input.source as "accepted-resources" | "chapter-files" }
        : {}),
      ...(typeof input.dryRun === "boolean" ? { dryRun: input.dryRun } : {}),
      ...(context.generateText ? { llmExtractor: createRuntimeChapterEventExtractor(context.generateText) } : {}),
    });
    if (!result.ok) return fail(result.error ?? "settle-range-failed", result.summary, result);
    return ok(result.summary, result);
  }

  const chapterNumber = positiveInteger(input.chapterNumber);
  if (chapterNumber === null) return fail("invalid-input", "单章结算需要 ≥1 的整数 chapterNumber（或传 fromChapter + toChapter 做范围补结算）。");

  const { handleMemorySettleChapter } = await import("./memory-settle-chapter.js");
  const result = await handleMemorySettleChapter({
    bookId: binding.bookId,
    bookRoot: binding.root,
    chapterNumber,
    ...(typeof input.title === "string" ? { title: input.title } : {}),
    ...(typeof input.force === "boolean" ? { force: input.force } : {}),
    ...(context.generateText ? { llmExtractor: createRuntimeChapterEventExtractor(context.generateText) } : {}),
    ...(context.generateText ? { kernelGenerateText: context.generateText } : {}),
  });

  if (!result.ok) return fail(result.error ?? "settle-chapter-failed", result.summary);
  return ok(result.summary, {
    chapterNumber: result.chapterNumber,
    settlement: result.settlement,
    ...(result.alreadySettled ? { alreadySettled: true } : {}),
  });
}

/**
 * 把管线的章后结算表达成一次真实的领域工具调用。
 *
 * 复用 executeRuntimeDomainTool 的同一分派入口，因此结算与 agent 自己调用
 * memory.settle 走完全相同的代码路径、权限与渲染约定，不是旁路。
 */
function createSettlementDispatcher(
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): PipelineWriteOptions["dispatchToolCall"] {
  return async ({ toolName, input }) => {
    context.emitOutput?.(`正在执行章后结算（${toolName}）…`);
    const result = await executeRuntimeDomainTool(toolName, input, binding, context);
    if (!result) {
      return { ok: false, error: "settlement-tool-unavailable", summary: `章后结算工具 ${toolName} 不可用。` };
    }
    return {
      ok: result.ok,
      ...(result.summary ? { summary: result.summary } : {}),
      ...(result.error ? { error: result.error } : {}),
      ...(result.data === undefined ? {} : { data: result.data }),
    };
  };
}

/**
 * chapter.commit 的 fromWorkflowRun：正文与蓝图从本叙述者进行中运行的已确认候选取，
 * 模型不必（也不应）把正文再贴一遍。运行按宿主注入的会话 id 定位，且必须属于当前绑定的书。
 */
function resolveWorkflowRunCandidates(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): { ok: true; input: Readonly<Record<string, unknown>> } | { ok: false; result: RuntimeToolResult } {
  const narratorId = context.sessionId?.trim();
  const storage = narratorId ? getStorageDatabase() : null;
  const run = storage && narratorId ? getActiveWorkflowRunForNarrator(storage, narratorId) : null;
  if (!storage || !run || run.bookId !== binding.bookId) {
    return { ok: false, result: fail("no-active-run", "fromWorkflowRun=true 只能在本书进行中的创作工作流里使用；没有运行时请先用原生 Write/Edit 写盘再调 chapter.commit。") };
  }
  const prose = getApprovedProse(storage, run);
  if (!prose) {
    return { ok: false, result: fail("prose-not-approved", "本运行还没有作者确认过的正文，不能落盘。等作者在「写作 › 工作流」确认正文后再调用。") };
  }
  const sceneSpec = record(input.sceneSpec) ?? getApprovedSceneSpec(storage, run);
  if (!sceneSpec) {
    return { ok: false, result: fail("scene-spec-required", "本运行没有已落盘的镜头蓝图；请传入 sceneSpec。") };
  }
  const { fromWorkflowRun: _from, ...rest } = input;
  return { ok: true, input: { ...rest, sceneSpec, content: prose.content } };
}

/**
 * 从磁盘解析章节正文：支持模型传入相对路径 filePath（如 chapters/卷01/0003_标题.md），
 * 或按 chapterNumber 在本书 chapters/ 目录下查找（包含刚用原生 Write 写入的新章文件）。
 */
async function readChapterContentFromDisk(
  binding: TrustedRuntimeBookBinding,
  input: Readonly<Record<string, unknown>>,
): Promise<
  | { ok: true; chapterNumber: number; content: string; title?: string; filePath?: string }
  | { ok: false; result: RuntimeToolResult }
> {
  const chaptersDir = join(binding.root, CHAPTERS_DIRECTORY);
  const resolveChapterFile = createChapterFileResolver(chaptersDir);
  const rawFilePath = typeof input.filePath === "string" ? input.filePath.trim() : "";
  let chapterNumber = positiveInteger(input.chapterNumber)
    ?? positiveInteger(record(input.sceneSpec)?.chapter);

  if (rawFilePath) {
    const normalizedRel = normalizeChapterRelativePath(rawFilePath);
    const chapterRel = normalizedRel.startsWith(`${CHAPTERS_DIRECTORY}/`)
      ? normalizedRel.slice(CHAPTERS_DIRECTORY.length + 1)
      : normalizedRel;
    const resolvedPath = resolveChapterFile(chapterRel);
    if (!resolvedPath) {
      return { ok: false, result: fail("invalid-file-path", `filePath 必须指向本书 chapters/ 目录内的章节文件（收到：${rawFilePath}）。`) };
    }
    let content: string;
    try {
      content = await readFile(resolvedPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: false, result: fail("chapter-file-not-found", `找不到章节文件 ${rawFilePath}，请先用原生 Write 写入正文后再调用 chapter.commit。`) };
      }
      throw error;
    }
    const parsed = parseChapterFileName(basename(resolvedPath));
    const resolvedNumber = chapterNumber ?? parsed?.number ?? null;
    if (!resolvedNumber) {
      return { ok: false, result: fail("invalid-input", "无法从 filePath 解析章节号，请显式传入 chapterNumber。") };
    }
    const title = (typeof input.title === "string" && input.title.trim())
      || (parsed ? chapterTitleFromContent(parsed, content) : undefined);
    return {
      ok: true,
      chapterNumber: resolvedNumber,
      content,
      ...(title ? { title } : {}),
      filePath: `${CHAPTERS_DIRECTORY}/${chapterRel}`,
    };
  }

  if (!chapterNumber) {
    return { ok: false, result: fail("invalid-input", "请传入 chapterNumber 或 filePath 指明要提交的章节。") };
  }

  // 优先扫描磁盘章节文件（兼容刚由原生 Write 写入、尚未同步到 index.json 的新章）
  try {
    const files = await listChapterFiles(binding.root);
    const matched = files.find((item) => item.number === chapterNumber);
    if (matched) {
      const resolvedPath = resolveChapterFile(matched.chapterRelativePath);
      if (resolvedPath) {
        const content = await readFile(resolvedPath, "utf8");
        const title = (typeof input.title === "string" && input.title.trim())
          || chapterTitleFromContent(matched, content);
        return {
          ok: true,
          chapterNumber,
          content,
          title,
          filePath: matched.relativePath,
        };
      }
    }
  } catch {
    // 扫描失败时退回章节读取服务
  }

  const chapter = await readBoundChapter(binding, chapterNumber);
  if (chapter.ok && chapter.data) {
    const parsed = parseChapterFileName(basename(chapter.data.fileName));
    const title = parsed ? chapterTitleFromContent(parsed, chapter.data.content) : undefined;
    return {
      ok: true,
      chapterNumber,
      content: chapter.data.content,
      ...(title ? { title } : {}),
    };
  }
  return {
    ok: false,
    result: fail("chapter-file-not-found", `未找到第 ${chapterNumber} 章的磁盘正文；请先用原生 Write 将正文写入目标章节文件（见 chapter.preflight 返回的 targetChapterPath），再调用 chapter.commit。`),
  };
}

async function chapterCommit(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult> {
  if (input.fromWorkflowRun === true) {
    const resolved = resolveWorkflowRunCandidates(input, binding, context);
    if (!resolved.ok) return resolved.result;
    input = resolved.input;
  }

  const mode = input.mode === "revision" ? "revision" : "new";
  let content = typeof input.content === "string" && input.content.trim() ? input.content : "";
  let chapterNumber = positiveInteger(input.chapterNumber)
    ?? positiveInteger(record(input.sceneSpec)?.chapter);
  let inferredTitle = typeof input.title === "string" && input.title.trim() ? input.title.trim() : undefined;

  if (!content) {
    const fromDisk = await readChapterContentFromDisk(binding, input);
    if (!fromDisk.ok) return fromDisk.result;
    content = fromDisk.content;
    chapterNumber = chapterNumber ?? fromDisk.chapterNumber;
    inferredTitle = inferredTitle ?? fromDisk.title;
  }

  if (!content.trim()) {
    return fail("content-required", "章节正文为空；请先用原生 Write/Edit 写入完整正文后再调用 chapter.commit。");
  }

  // mode="revision"：已有章节改稿提交（校验长度/技能/高风险门禁、更新索引、自动重结算）
  if (mode === "revision") {
    if (!chapterNumber) {
      return fail("invalid-input", "mode=revision 需要有效的 chapterNumber（或带章号的 filePath）。");
    }
    const written = await handleChapterWrite(
      { bookId: binding.bookId, chapterNumber, content },
      { bookRoot: binding.root, storage: getStorageDatabase(), purpose: "revision" },
    );
    if (!written.ok) return fail(written.error, written.summary, written.data);
    const settleResult = await memorySettle({ chapterNumber, ...(inferredTitle ? { title: inferredTitle } : {}) }, binding, context);
    const settlementFailed = !settleResult.ok;
    const summary = settlementFailed
      ? `第 ${chapterNumber} 章改稿已提交入库（${written.data.wordCount} 字），但章后重结算未完成，请重试 memory.settle。`
      : `第 ${chapterNumber} 章改稿已提交入库（${written.data.wordCount} 字）。${settleResult.summary ?? ""}`;
    const data = {
      saved: true,
      mode: "revision",
      bookId: binding.bookId,
      chapterNumber,
      fileName: written.data.fileName,
      title: inferredTitle ?? `第${chapterNumber}章`,
      wordCount: written.data.wordCount,
      length: written.data.length,
      settlementDispatch: {
        toolName: "memory.settle",
        ok: settleResult.ok,
        ...(settleResult.summary ? { summary: settleResult.summary } : {}),
        ...(settleResult.error ? { error: settleResult.error } : {}),
      },
      ...(settlementFailed ? { code: "settlement-pending", needsSettlementRetry: true } : {}),
    };
    return settlementFailed ? fail("settlement-pending", summary, data) : ok(summary, data);
  }

  // mode="new"：写新章入库（优先取显式 sceneSpec，缺省自动复用 chapter.blueprint 缓存）
  let sceneSpec = record(input.sceneSpec) as SceneSpec | undefined;
  if (!sceneSpec && chapterNumber) {
    sceneSpec = getCachedSceneSpec(binding.bookId, chapterNumber) ?? undefined;
  }
  if (!sceneSpec) {
    return fail("scene-spec-required", "缺少本章蓝图（sceneSpec）：请先调用 chapter.blueprint 提交并缓存本章蓝图，或在本次调用中传入 sceneSpec。", {
      ok: false,
      code: "scene-spec-required",
      error: "缺少本章蓝图（sceneSpec）：请先调用 chapter.blueprint 提交并缓存本章蓝图，或在本次调用中传入 sceneSpec。",
    });
  }

  context.emitOutput?.("正在审计校验并正式入库章节正文…");
  const llmExtractor = context.generateText ? createRuntimeChapterEventExtractor(context.generateText) : undefined;
  const result = await executePipelineWrite(
    {
      bookId: binding.bookId,
      sceneSpec,
      content,
      ...(typeof input.jingweiContext === "string" ? { jingweiContext: input.jingweiContext } : {}),
      ...(typeof input.previousChapterTail === "string" ? { previousChapterTail: input.previousChapterTail } : {}),
      ...(context.loadedSkills ? { loadedSkills: context.loadedSkills } : {}),
      ...(typeof input.requireFactCheckPass === "boolean" ? { requireFactCheckPass: input.requireFactCheckPass } : {}),
      ...(typeof input.expectedHash === "string" ? { expectedHash: input.expectedHash } : {}),
      ...(typeof input.expectedVersion === "number" ? { expectedVersion: input.expectedVersion } : {}),
      ...(typeof input.expectedChapterHash === "string" ? { expectedChapterHash: input.expectedChapterHash } : {}),
      ...(typeof input.expectedChapterVersion === "number" ? { expectedChapterVersion: input.expectedChapterVersion } : {}),
    },
    {
      root: context.projectRoot || binding.root,
      bookRoot: binding.root,
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
      onStream: context.emitOutput,
      llmExtractor,
      dispatchToolCall: createSettlementDispatcher(binding, context),
    },
  );
  if (!result.ok) {
    return fail(result.code, result.error, {
      ok: false,
      code: result.code,
      error: result.error,
      ...(result.summary ? { summary: result.summary } : {}),
      ...(result.explanation ? { explanation: result.explanation } : {}),
    });
  }
  const settlementFailed = result.settlementDispatch !== undefined && !result.settlementDispatch.ok;
  const settlementSummary = settlementFailed
    ? ` 章后结算未完成（${result.settlementDispatch.toolName}）：正文已保存，需重试结算。`
    : result.narrativeSettlement
      ? ` Narrative Memory：抽取 ${result.narrativeSettlement.extracted} 条，自动沉淀 ${result.narrativeSettlement.autoApplied} 条，pending ${result.narrativeSettlement.pending} 条。`
      : "";
  const auditCat = result.auditIssueCategories;
  const auditSummary = auditCat
    ? ` critical=${auditCat.critical} warning=${auditCat.warning}`
    : "";
  const resultData = {
    saved: true,
    chapterNumber: result.chapterNumber,
    title: result.title,
    wordCount: result.wordCount,
    ...(result.path ? { path: result.path } : {}),
    sha256: result.prose.sha256,
    bytes: result.prose.bytes,
    chars: result.prose.chars,
    excerpt: { head: result.prose.head, tail: result.prose.tail },
    auditPassed: result.auditResult.passed,
    auditIssueCategories: result.auditIssueCategories,
    factCheckRevised: result.factCheckRevised,
    factCheckRound: result.factCheckRound,
    revised: result.revised,
    chapterId: result.chapterId,
    narrativeSettlement: result.narrativeSettlement,
    settlementDispatch: result.settlementDispatch,
    publishHint: result.publishHint,
    needsHumanReview: result.needsHumanReview,
    settlementError: result.settlementError,
    contextSources: result.contextSources,
    pipelineStages: result.pipelineStages,
    artifact: result.artifact,
    ...(settlementFailed ? { code: "settlement-pending", needsSettlementRetry: true } : {}),
  };
  const summary = `第${result.chapterNumber}章「${result.title}」入库完成（${result.wordCount}字）。审计：${result.auditResult.passed ? "通过" : "未通过"}${auditSummary}。${settlementSummary}`;
  return settlementFailed
    ? fail("settlement-pending", summary, resultData)
    : ok(summary, resultData);
}

/**
 * Writing Skills 不是独立的注入概念：启用即物化到作品的 .novelfork/skills/，
 * 由 Runtime 的 Skill 机制交给正在调用工具的 agent。领域工具不再另开一条
 * prompt 注入路径，避免同一份信息出现两种表达。
 */
export async function executeRuntimeDomainTool(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult | null> {
  const normalized = toolName.replace(/\./g, "_");
  switch (normalized) {
    case "chapter_blueprint": {
      const sceneSpec = record(input.sceneSpec);
      if (!sceneSpec) return fail("scene-spec-required", "chapter.blueprint 必须接收当前 Runtime Agent 显式提交的 sceneSpec 蓝图；工具不会在内部调用模型生成。");
      return okResult(await handleSceneSpec({
        ...(input as unknown as Parameters<typeof handleSceneSpec>[0]),
        sceneSpec,
        bookId: binding.bookId,
        bookRoot: binding.root,
      }));
    }
    case "chapter_commit":
      return chapterCommit(input, binding, context);
    case "chapter_audit": {
      const mode = typeof input.mode === "string" ? input.mode.trim().toLowerCase() : "quality";
      if (mode === "publish") return publishCheck(input, binding);
      return chapterAudit(input, binding);
    }
    case "chapter_propose_selection":
      return proposeSelectionCandidate(input, binding.bookId, async (chapterNumber) => {
        const chapter = await readBoundChapter(binding, chapterNumber);
        return chapter.ok && chapter.data ? chapter.data.content : null;
      });
    case "jingwei_write": {
      const action = typeof input.action === "string" ? input.action.trim().toLowerCase() : "";
      if (action === "relate") {
        const result = await handleLoreRelate({
          ...(input as unknown as Parameters<typeof handleLoreRelate>[0]),
          bookId: binding.bookId,
        });
        return result.ok ? ok(result.summary, result) : fail(result.error ?? "jingwei-relate-failed", result.summary);
      }
      if (action === "progress") {
        const result = await handleLoreProgress({
          ...(input as unknown as Parameters<typeof handleLoreProgress>[0]),
          bookId: binding.bookId,
        });
        return result.ok ? ok(result.summary, result) : fail(result.error ?? "jingwei-progress-failed", result.summary);
      }
      if (action === "propose") {
        return proposeLoreUpdate(input, binding);
      }
      if (action === "propose_storyline") {
        const result = await handleStorylinePropose({
          bookId: binding.bookId,
          name: typeof input.name === "string" ? input.name : "",
          ...(typeof input.kind === "string" ? { kind: input.kind } : {}),
          ...(typeof input.goal === "string" ? { goal: input.goal } : {}),
          ...(Array.isArray(input.relatedEntryTitles)
            ? { relatedEntryTitles: input.relatedEntryTitles.filter((v): v is string => typeof v === "string") }
            : {}),
          ...(typeof input.evidenceNote === "string" ? { evidenceNote: input.evidenceNote } : {}),
        });
        if (!result.ok) return fail(result.error ?? "storyline-propose-failed", result.summary);
        return ok(result.summary, result.data);
      }
      // create / update / delete / retire / 缺省：交由 runtime-contribution 的 handleJingweiWrite 执行
      return null;
    }
    case "book_import": {
      const action = typeof input.action === "string" ? input.action.trim().toLowerCase() : "";
      if (action === "import_chapters") return importChapters(input, binding, context);
      if (action === "dissect") return bookDissect(input, binding, context);
      return fail("invalid-action", `未知的 book.import action：${String(input.action ?? "")}。支持 import_chapters | dissect。`);
    }
    case "style_manage": {
      const action = typeof input.action === "string" ? input.action.trim().toLowerCase() : "";
      if (action === "index" || action === "preview" || action === "start" || action === "status" || action === "adopt") {
        return executeStyleDistillationTool(`style.distill_${action}`, input, binding, context);
      }
      if (action === "consolidate" || action === "negative_override") {
        return executeStyleConsolidateTool(input, binding, context);
      }
      return fail("invalid-action", `未知的 style.manage action：${String(input.action ?? "")}。支持 index | preview | start | status | adopt | consolidate | negative_override。`);
    }
    case "mechanism_distill":
      return executeMechanismDistillTool(input, binding, context);
    case "outline_volume":
      return outlineVolume(input, binding, context);
    case "character_inspect": {
      const action = typeof input.action === "string" ? input.action.trim().toLowerCase() : "";
      if (action === "consistency") return characterConsistency(input, binding);
      if (action === "arc_status") return arcCharacter({ ...input, action: "status" }, binding, context);
      if (action === "arc_sync") return arcCharacter({ ...input, action: "sync" }, binding, context);
      if (action === "voice_read") return executeCharacterVoiceTool("character.voice.read", input, binding, context);
      if (action === "voice_draft") return executeCharacterVoiceTool("character.voice.draft", input, binding, context);
      return fail("invalid-action", `未知的 character.inspect action：${String(input.action ?? "")}。支持 consistency | arc_status | arc_sync | voice_read | voice_draft。`);
    }
    case "hooks_manage":
      return hooksManage(input, binding);
    case "memory_settle":
      return memorySettle(input, binding, context);
    case "workflow_step":
      return executeWorkflowRunTool(toolName, input, binding, context);
    case "workflow_manage":
      return executeWorkflowRecipeTool(toolName, input, binding, context);
    default:
      return null;
  }
}

function okResult(result: Awaited<ReturnType<typeof handleSceneSpec>>): RuntimeToolResult {
  if (!result.ok) return fail(result.error, result.summary);
  return ok(result.summary, result.data);
}
