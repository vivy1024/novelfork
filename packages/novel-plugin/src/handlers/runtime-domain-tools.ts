import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  splitChapters,
  splitChaptersWithVolumes,
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
import { handleChapterAuditV2 } from "./chapter-audit-v2.js";
import { handleChapterRead } from "./chapter-read.js";
import { handleChapterWrite } from "./chapter-write.js";
import { createWritingResourceService } from "../engine/writing-resource/service.js";
import { executePipelineWrite, type PipelineWriteInput, type PipelineWriteOptions } from "./pipeline-write-service.js";
import { createRuntimeChapterEventExtractor } from "../engine/narrative-memory/chapter-event-extractor.js";
import { handleSceneSpec, type SceneSpec } from "./scene-spec-handler.js";
import { executeWorkflowRecipeTool } from "./workflow-recipe-tools.js";
import { executeWorkflowRunTool } from "./workflow-run-tools.js";
import { executeStyleDistillationTool } from "./style-distill-tools.js";
import { executeCharacterVoiceTool } from "./character-voice-tools.js";
import { proposeSelectionCandidate } from "./selection-candidate-tools.js";
import { handleStorylinePropose } from "./storyline-tools.js";
import {
  DEFAULT_VOLUME_DIRECTORY,
  chapterRelativePath,
  readChapterIndex as readChapterLayoutIndex,
  volumeDirectoryName,
  writeChapterIndex,
  type ChapterIndexRecord,
} from "../engine/writing-resource/chapter-layout.js";
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
  } catch {
    // 兼容读取继续走文件索引；写入路径会显式报告落盘错误。
  }
  const indexed = await readChapterLayoutIndex(binding.root);
  if (indexed.length > 0) return indexed;

  // 兼容主迁移完成前缺少标准字段的旧索引；新写入始终走 chapter-layout 的标准记录。
  const raw = await readFile(join(binding.root, "chapters", "index.json"), "utf8").catch(() => "[]");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  return Array.isArray(parsed)
    ? parsed.filter((entry): entry is ChapterIndexRecord => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    : [];
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
    return await task();
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
  const audit = handleChapterAuditV2({
    bookId: binding.bookId,
    chapterNumber,
    content,
    ...(record(input.sceneSpec) ? { sceneSpec: input.sceneSpec as never } : {}),
    ...(Array.isArray(input.canonEntries) ? { canonEntries: input.canonEntries as never } : {}),
    ...(typeof input.povCharacter === "string" ? { povCharacter: input.povCharacter } : {}),
    ...(typeof effectiveWordTarget === "number" ? { wordTarget: effectiveWordTarget } : {}),
    ...(Array.isArray(input.checks) ? { checks: stringArray(input.checks) } : {}),
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

async function rewriteSegment(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult> {
  const chapterNumber = positiveInteger(input.chapterNumber);
  const selection = record(input.selection);
  const start = positiveInteger(selection?.start);
  const end = positiveInteger(selection?.end);
  const mode = typeof input.mode === "string" ? input.mode : "";
  if (!chapterNumber || !start || !end || start > end || !["continue", "expand", "restyle"].includes(mode)) {
    return fail(
      "invalid-input",
      "需要有效的 chapterNumber、selection.start/end 和改写模式（continue | expand | restyle）。去 AI 味已统一由 story-deslop Writing Skill 承担，不再单独提供 reduce_ai 模式。",
    );
  }
  const generator = requireGenerator(context);
  if (typeof generator !== "function") return generator;
  const chapter = await readBoundChapter(binding, chapterNumber);
  if (!chapter.ok || !chapter.data) return fail(chapter.error ?? "chapter-not-found", chapter.summary);
  const lines = chapter.data.content.split("\n");
  if (end > lines.length) return fail("invalid-range", `行号范围无效（1-${lines.length}）。`);
  const originalText = lines.slice(start - 1, end).join("\n");
  if (!originalText.trim()) return fail("empty-selection", "选中内容为空。");

  const instructions: Record<string, string> = {
    continue: "续写以下段落，保持风格一致并自然衔接。",
    expand: "扩写以下段落，增加有效细节和描写，保持原意。",
    restyle: `按指定风格改写以下段落：${typeof input.styleHint === "string" ? input.styleHint : "更生动自然"}。`,
  };
  const generated = await generator({
    messages: [
      { role: "system", content: "你是中文网文改写编辑。只输出改写后的正文，不解释，不加 Markdown 围栏。" },
      { role: "user", content: `${instructions[mode]}\n\n${originalText}` },
    ],
    temperature: 0.7,
    maxTokens: 8192,
  });
  const rewrittenText = generated.text.trim();
  if (!rewrittenText) return fail("empty-model-output", "Runtime 模型没有返回改写文本。");
  return ok(`已完成第 ${chapterNumber} 章第 ${start}-${end} 行改写。`, {
    mode,
    originalText,
    rewrittenText,
    lineRange: { start, end },
  });
}

async function rewriteApply(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
): Promise<RuntimeToolResult> {
  const chapterNumber = positiveInteger(input.chapterNumber);
  const lineRange = record(input.lineRange);
  const start = positiveInteger(lineRange?.start);
  const end = positiveInteger(lineRange?.end);
  const newText = typeof input.newText === "string" ? input.newText : null;
  const mode = input.mode === "insert_after" ? "insert_after" : "replace";
  if (!chapterNumber || !start || !end || start > end || newText === null) {
    return fail("invalid-input", "需要有效的 chapterNumber、lineRange.start/end 和 newText。");
  }
  const chapter = await readBoundChapter(binding, chapterNumber);
  if (!chapter.ok || !chapter.data) return fail(chapter.error ?? "chapter-not-found", chapter.summary);
  const expectedHash = createHash("sha256").update(chapter.data.content, "utf8").digest("hex");
  const lines = chapter.data.content.split("\n");
  if (end > lines.length) return fail("invalid-range", `行号范围无效（1-${lines.length}）。`);
  const inserted = newText.split("\n");
  const next = mode === "insert_after"
    ? [...lines.slice(0, end), ...inserted, ...lines.slice(end)]
    : [...lines.slice(0, start - 1), ...inserted, ...lines.slice(end)];
  const written = await handleChapterWrite(
    { bookId: binding.bookId, chapterNumber, content: next.join("\n"), expectedHash },
    { bookRoot: binding.root, storage: getStorageDatabase(), purpose: "revision" },
  );
  if (!written.ok) return fail(written.error, written.summary);
  return ok(
    mode === "insert_after"
      ? `已在第 ${end} 行后插入 ${inserted.length} 行。`
      : `已替换第 ${start}-${end} 行。`,
    { bookId: binding.bookId, chapterNumber, mode, linesAffected: inserted.length },
  );
}

/**
 * T5.3：整章改动候选。本工具不改正文——交出 before/after 摘要与原文预览，
 * 由作者在叙述者面板的候选卡里核对后再决定是否采用；应用时校验 originalHash 防覆盖。
 */
async function proposeChapterRevision(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
): Promise<RuntimeToolResult> {
  const chapterNumber = positiveInteger(input.chapterNumber);
  const content = typeof input.content === "string" ? input.content : null;
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!chapterNumber || content === null || !content.trim() || !reason) {
    return fail("invalid-input", "需要有效的 chapterNumber、content（改后的完整正文）与 reason（为什么这么改）。候选没有写入章节。");
  }
  if (content.length > 60_000) return fail("content-too-large", "单章候选正文不能超过 6 万字；请拆成多个候选分别提交。");
  const chapter = await readBoundChapter(binding, chapterNumber);
  const originalText = chapter.ok && chapter.data ? chapter.data.content : "";
  const originalHash = createHash("sha256").update(originalText, "utf8").digest("hex");

  // 段落级对照（空行分段）：算一致/删除/新增数量，不整段差分。
  const splitParagraphs = (text: string) => text.split(/\r?\n\r?\n/).map((item) => item.trim()).filter((item) => item.length > 0);
  const originalParas = splitParagraphs(originalText);
  const newParas = splitParagraphs(content);
  const originalSet = new Set(originalParas);
  const newSet = new Set(newParas);
  const unchanged = originalParas.filter((item) => newSet.has(item)).length;
  const removed = originalParas.length - unchanged;
  const added = newParas.filter((item) => !originalSet.has(item)).length;

  const artifact = {
    kind: "chapter-revision",
    id: crypto.randomUUID(),
    bookId: binding.bookId,
    chapterNumber,
    reason,
    originalHash,
    originalExists: chapter.ok === true,
    originalPreview: originalText.slice(0, 600),
    newPreview: content.slice(0, 600),
    stats: {
      originalChars: originalText.length,
      newChars: content.length,
      unchangedParagraphs: unchanged,
      removedParagraphs: removed,
      addedParagraphs: added,
    },
    newText: content,
  };
  return ok(
    `已生成第 ${chapterNumber} 章改动候选（原 ${originalText.length} 字 → 新 ${content.length} 字；保持 ${unchanged} 段、删 ${removed} 段、增 ${added} 段）。请作者在候选卡核对后决定；候选尚未写入正文。`,
    { artifact },
  );
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
  const content = typeof input.content === "string" ? input.content : "";
  const sourceName = typeof input.sourceName === "string" ? input.sourceName : "导入文本";
  // 默认 500 章防误贴整本；允许的调用方可显式提高到 2000（如整书旧稿导入）。单次 dissect 上限另算。
  const maxChapters = Math.min(optionalPositiveInteger(input.maxChapters) ?? 500, 2000);
  if (content.length < 1000) return fail("text-too-short", "导入文本至少需要 1000 字。");
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
      await writeFile(chapterPath, chapterContent, "utf8");
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
  upsertLedgerEntry(getStorageDatabase(), {
          bookId: binding.bookId,
          category: "outline",
          title: "导入卷纲",
          contentMd: "",
          fields: { volumes: outlineVolumes, importedFrom: sourceName },
          status: "confirmed",
        });
      }
    }
    // 导入章节只接纳正文；不能顺带覆盖作者已确认的文风预设或旧统计基线。

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
          "write.preflight",
          "book.dissect",
          "skills.write",
          "scene.spec",
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

async function publishExport(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
): Promise<RuntimeToolResult> {
  const { handlePublishExport } = await import("./publish-export.js");
  const result = await handlePublishExport({
    bookId: binding.bookId,
    bookRoot: binding.root,
    ...(typeof input.fromChapter === "number" ? { fromChapter: input.fromChapter } : {}),
    ...(typeof input.toChapter === "number" ? { toChapter: input.toChapter } : {}),
    ...(typeof input.includeAdvice === "boolean" ? { includeAdvice: input.includeAdvice } : {}),
    ...(typeof input.platform === "string" ? { platform: input.platform } : {}),
  });
  if (!result.ok) return fail(result.error ?? "publish-export-failed", result.summary);
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
        fields: {
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
 * memory.settle_chapter — 单章章后结算。
 *
 * bookId / bookRoot 只来自可信绑定；模型只能指定 chapterNumber。
 */
async function memorySettleChapter(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult> {
  const chapterNumber = positiveInteger(input.chapterNumber);
  if (chapterNumber === null) return fail("invalid-input", "chapterNumber 必须是 ≥1 的整数。");

  const { handleMemorySettleChapter } = await import("./memory-settle-chapter.js");
  const result = await handleMemorySettleChapter({
    bookId: binding.bookId,
    bookRoot: binding.root,
    chapterNumber,
    ...(typeof input.title === "string" ? { title: input.title } : {}),
    // 章后结算同样走 LLM 抽取：用 host 的 generateText 能力构造，缺省时回退规则兜底。
    ...(context.generateText ? { llmExtractor: createRuntimeChapterEventExtractor(context.generateText) } : {}),
    // 角色内核重算与事件抽取同源（同一 generateText）；config.characterKernel.enabled=false 时 reconciler 内部直接跳过。
    ...(context.generateText ? { kernelGenerateText: context.generateText } : {}),
  });

  if (!result.ok) return fail(result.error ?? "settle-chapter-failed", result.summary);
  return ok(result.summary, {
    chapterNumber: result.chapterNumber,
    settlement: result.settlement,
  });
}

/**
 * 把管线的章后结算表达成一次真实的领域工具调用。
 *
 * 复用 executeRuntimeDomainTool 的同一分派入口，因此结算与 agent 自己调用
 * memory.settle_chapter 走完全相同的代码路径、权限与渲染约定，不是旁路。
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

async function pipelineWrite(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult> {
  const sceneSpec = record(input.sceneSpec) as SceneSpec | undefined;
  if (!sceneSpec) {
    return fail("invalid-input", "sceneSpec 必填。", {
      ok: false,
      code: "invalid-input",
      error: "sceneSpec 必填。",
    });
  }
  if (typeof input.content !== "string" || !input.content.trim()) {
    return fail("content-required", "pipeline.write 必须接收当前 Runtime Agent 已完成的正文 content；工具不会在内部生成正文。", {
      ok: false,
      code: "content-required",
      error: "pipeline.write 必须接收当前 Runtime Agent 已完成的正文 content；工具不会在内部生成正文。",
    });
  }
  context.emitOutput?.("正在校验并保存 Runtime Agent 提交的章节正文…");
  // 章后叙事记忆结算的 LLM 抽取器：用 host 的 generateText 能力构造，缺省时回退规则兜底。
  const llmExtractor = context.generateText ? createRuntimeChapterEventExtractor(context.generateText) : undefined;
  const result = await executePipelineWrite(
    {
      bookId: binding.bookId,
      sceneSpec,
      content: input.content,
      ...(typeof input.jingweiContext === "string" ? { jingweiContext: input.jingweiContext } : {}),
      ...(typeof input.previousChapterTail === "string" ? { previousChapterTail: input.previousChapterTail } : {}),
      autoRevise: input.autoRevise !== false,
      ...(typeof input.continueWithHighRiskPending === "boolean"
        ? { continueWithHighRiskPending: input.continueWithHighRiskPending }
        : {}),
      ...(typeof input.adversarialAudit === "boolean" ? { adversarialAudit: input.adversarialAudit } : {}),
      ...(typeof input.maxReviseRounds === "number" ? { maxReviseRounds: input.maxReviseRounds } : {}),
      ...(writingSkillAcknowledgements(input.acknowledgedSkills)
        ? { acknowledgedSkills: writingSkillAcknowledgements(input.acknowledgedSkills) }
        : {}),
      ...(context.loadedSkills ? { loadedSkills: context.loadedSkills } : {}),
      ...(typeof input.requireFactCheckPass === "boolean" ? { requireFactCheckPass: input.requireFactCheckPass } : {}),
      ...(typeof input.factCheckAutoRevise === "boolean" ? { factCheckAutoRevise: input.factCheckAutoRevise } : {}),
      ...(typeof input.expectedHash === "string" ? { expectedHash: input.expectedHash } : {}),
      ...(typeof input.expectedVersion === "number" ? { expectedVersion: input.expectedVersion } : {}),
      ...(typeof input.expectedChapterHash === "string" ? { expectedChapterHash: input.expectedChapterHash } : {}),
      ...(typeof input.expectedChapterVersion === "number" ? { expectedChapterVersion: input.expectedChapterVersion } : {}),
    },
    {
      // root 是项目根（books/ 的父目录），bookRoot 才是这本书的目录。
      // 过去两者都传 binding.root，导致 StateManager 把书目录当项目根，
      // 凡是走 booksDir 的下游就会拼出 <bookRoot>/books/<bookId> 而找不到 book.json。
      root: context.projectRoot || binding.root,
      bookRoot: binding.root,
      onStream: context.emitOutput,
      llmExtractor,
      // 正文落盘后由管线显式发起 memory.settle_chapter，使结算在叙述者面板可见且可重试。
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
    auditPassed: result.auditResult.passed,
    auditIssueCategories: result.auditIssueCategories,
    factCheckRevised: result.factCheckRevised,
    factCheckRound: result.factCheckRound,
    revised: result.revised,
    chapterId: result.chapterId,
    narrativeSettlement: result.narrativeSettlement,
    settlementDispatch: result.settlementDispatch,
    highRiskPendingReminder: result.highRiskPendingReminder,
    publishHint: result.publishHint,
    needsHumanReview: result.needsHumanReview,
    settlementError: result.settlementError,
    // 上下文来源与真实阶段：让作者在结果卡里核对本章读了什么、管线走过哪几步。
    contextSources: result.contextSources,
    pipelineStages: result.pipelineStages,
    artifact: result.artifact,
    ...(settlementFailed ? { code: "settlement-pending", needsSettlementRetry: true } : {}),
  };
  const summary = `第${result.chapterNumber}章「${result.title}」生成完成（${result.wordCount}字）。审计：${result.auditResult.passed ? "通过" : "未通过"}${auditSummary}${result.revised ? "，已自动修订" : ""}。${settlementSummary}${result.highRiskPendingReminder ? `\n${result.highRiskPendingReminder}` : ""}`;
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
    case "scene_spec":
    case "scene.spec": {
      const sceneSpec = record(input.sceneSpec);
      if (!sceneSpec) return fail("scene-spec-required", "scene.spec 必须接收当前 Runtime Agent 显式提交的 sceneSpec 蓝图；工具不会在内部调用模型生成。");
      return okResult(await handleSceneSpec({
        ...(input as unknown as Parameters<typeof handleSceneSpec>[0]),
        sceneSpec,
        bookId: binding.bookId,
        bookRoot: binding.root,
      }));
    }
    case "chapter_audit":
    case "chapter.audit":
      return chapterAudit(input, binding);
    case "chapter_propose_selection":
      return proposeSelectionCandidate(input, binding.bookId);
    case "chapter_propose_revision":
      return proposeChapterRevision(input, binding);
    case "lore_propose_update":
      return proposeLoreUpdate(input, binding);
    case "storyline_propose":
    case "storyline.propose": {
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
    case "rewrite_apply":
    case "rewrite.apply":
      return rewriteApply(input, binding);
    case "pipeline_import_chapters":
    case "pipeline.import_chapters":
      return importChapters(input, binding, context);
    case "book_dissect":
    case "book.dissect":
      return bookDissect(input, binding, context);
    case "style_distill_preview":
    case "style.distill_preview":
    case "style_distill_start":
    case "style.distill_start":
    case "style_distill_status":
    case "style.distill_status":
    case "style_distill_adopt":
    case "style.distill_adopt":
      return executeStyleDistillationTool(toolName, input, binding, context);
    case "outline_volume":
    case "outline.volume":
      return outlineVolume(input, binding, context);
    case "arc_character":
    case "arc.character":
      return arcCharacter(input, binding, context);
    case "publish_check":
    case "publish.check":
      return publishCheck(input, binding);
    case "publish_export":
    case "publish.export":
      return publishExport(input, binding);
    case "character_check_consistency":
    case "character.check_consistency":
      return characterConsistency(input, binding);
    case "character_voice_read":
    case "character_voice_draft":
      return executeCharacterVoiceTool(toolName, input, binding, context);
    case "hooks_manage":
    case "hooks.manage":
      return hooksManage(input, binding);
    case "memory_settle_chapter":
    case "memory.settle_chapter":
      return memorySettleChapter(input, binding, context);
    case "pipeline_write":
    case "pipeline.write":
      return pipelineWrite(input, binding, context);
    case "workflow_get_current_step":
    case "workflow_submit_step_output":
    case "workflow_report_blocker":
      return executeWorkflowRunTool(toolName, input, binding, context);
    case "workflow_list_recipes":
    case "workflow_get_recipe":
    case "workflow_edit_recipe":
    case "workflow_start_run":
      return executeWorkflowRecipeTool(toolName, input, binding, context);
    default:
      return null;
  }
}

function okResult(result: Awaited<ReturnType<typeof handleSceneSpec>>): RuntimeToolResult {
  if (!result.ok) return fail(result.error, result.summary);
  return ok(result.summary, result.data);
}
