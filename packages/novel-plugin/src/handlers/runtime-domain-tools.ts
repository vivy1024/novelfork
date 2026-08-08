import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  splitChapters,
  StateManager,
  getStorageDatabase,
  type ChapterMeta,
  type LLMClient,
} from "@vivy1024/novelfork-core";
import type {
  RuntimeTextGenerator,
  RuntimeToolResult,
  ToolExecutionContext,
} from "@vivy1024/novelfork-core/plugins";
import { analyzeStyle } from "../engine/index.js";
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
import { executePipelineWrite, type PipelineWriteInput } from "./pipeline-write-service.js";
import { handleSceneSpec, type SceneSpec } from "./scene-spec-handler.js";
import {
  DEFAULT_VOLUME_DIRECTORY,
  chapterRelativePath,
  readChapterIndex as readChapterLayoutIndex,
  writeChapterIndex,
  type ChapterIndexRecord,
} from "../engine/writing-resource/chapter-layout.js";

export interface TrustedRuntimeBookBinding {
  readonly bookId: string;
  readonly root: string;
}

function fail(error: string, summary: string): RuntimeToolResult {
  return { ok: false, error, summary };
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

function requireGenerator(context: ToolExecutionContext): RuntimeTextGenerator | RuntimeToolResult {
  return context.generateText ?? fail(
    "runtime-model-unavailable",
    "当前 Runtime 会话没有可用的文本生成能力，请先配置模型。",
  );
}

function hostClient(generateText: RuntimeTextGenerator): LLMClient {
  return {
    provider: "host",
    apiFormat: "chat",
    stream: false,
    completion: async (_model, messages, options) => {
      const generated = await generateText({
        messages,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      });
      options.onStreamProgress?.({
        elapsedMs: 0,
        totalChars: generated.text.length,
        chineseChars: (generated.text.match(/[\u4e00-\u9fff]/g) ?? []).length,
        status: "done",
      });
      return {
        content: generated.text,
        usage: {
          promptTokens: generated.usage?.promptTokens ?? 0,
          completionTokens: generated.usage?.completionTokens ?? 0,
          totalTokens: generated.usage?.totalTokens ?? 0,
        },
      };
    },
    defaults: {
      temperature: 0.7,
      maxTokens: 8192,
      maxTokensCap: null,
      thinkingBudget: 0,
      extra: {},
    },
  };
}

async function readBookConfig(binding: TrustedRuntimeBookBinding): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(join(binding.root, "book.json"), "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("book.json 不是有效对象。");
  }
  return parsed as Record<string, unknown>;
}

async function readChapterIndex(binding: TrustedRuntimeBookBinding): Promise<ChapterIndexRecord[]> {
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
  const audit = handleChapterAuditV2({
    bookId: binding.bookId,
    chapterNumber,
    content,
    ...(record(input.sceneSpec) ? { sceneSpec: input.sceneSpec as never } : {}),
    ...(Array.isArray(input.canonEntries) ? { canonEntries: input.canonEntries as never } : {}),
    ...(typeof input.povCharacter === "string" ? { povCharacter: input.povCharacter } : {}),
    ...(typeof input.wordTarget === "number" ? { wordTarget: input.wordTarget } : {}),
    ...(Array.isArray(input.checks) ? { checks: stringArray(input.checks) } : {}),
  });
  return ok(audit.summary, audit);
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
      "需要有效的 chapterNumber、selection.start/end 和改写模式（continue | expand | restyle）。去 AI 味已统一由 Writer 写作纪律与 story-deslop Writing Skill 承担，不再单独提供 reduce_ai 模式。",
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
    { bookRoot: binding.root, purpose: "revision" },
  );
  if (!written.ok) return fail(written.error, written.summary);
  return ok(
    mode === "insert_after"
      ? `已在第 ${end} 行后插入 ${inserted.length} 行。`
      : `已替换第 ${start}-${end} 行。`,
    { bookId: binding.bookId, chapterNumber, mode, linesAffected: inserted.length },
  );
}

/** 只允许单段安全目录名；空结果由调用方回退到内容哈希。 */
function writingSkillSlugFrom(value: string): string {
  return value.trim().toLowerCase()
    .replace(/[^a-z0-9-_]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64);
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

async function styleImport(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult> {
  const referenceText = typeof input.referenceText === "string" ? input.referenceText : "";
  const sourceName = typeof input.sourceName === "string" ? input.sourceName : undefined;
  // 默认保存为 Writing Skill：governed 写作路径下 styleGuide 字段已固定为空占位，
  // 只返回一段文本的旧路径没有任何下游注入点，等于静默无效。
  const saveAsWritingSkill = input.saveAsWritingSkill !== false;
  const enableOnBook = input.enableOnBook !== false;
  const skillName = typeof input.skillName === "string" && input.skillName.trim()
    ? input.skillName.trim()
    : `导入文风${sourceName ? `·${sourceName}` : ""}`.slice(0, 40);
  if (referenceText.length < 2000) return fail("text-too-short", "参考文本至少需要 2000 字。");
  const generator = requireGenerator(context);
  if (typeof generator !== "function") return generator;
  const profile = analyzeStyle(referenceText, sourceName);
  const generated = await generator({
    messages: [
      {
        role: "system",
        content: "你是小说文风分析师。输出 Markdown 文风指南，覆盖叙事声音、对话、场景描写、节奏、词汇、情绪表达和禁止漂移方向。不得模仿在世作者的独特风格，只提炼高层写作特征。",
      },
      {
        role: "user",
        content: `${sourceName ? `参考来源：${sourceName}\n\n` : ""}统计特征：${JSON.stringify(profile)}\n\n参考文本：\n${referenceText.slice(0, 12000)}`,
      },
    ],
    temperature: 0.3,
    maxTokens: 3000,
  });
  const styleGuide = generated.text.trim();
  if (!styleGuide) return fail("empty-model-output", "Runtime 模型没有返回文风指南。");

  let createdWritingSkill: {
    id: string;
    slug: string;
    path: string;
    enabled: boolean;
    projectSkillSlugs?: readonly string[];
  } | undefined;
  if (saveAsWritingSkill) {
    const { writeAuthorWritingSkill } = await import("../engine/writing-skills/loader.js");
    const { handleWritingSkillsWrite, loadActiveWritingSkillsForBook } = await import("./writing-skill-handlers.js");
    const baseSlug = writingSkillSlugFrom(sourceName ?? skillName);
    const slug = `imported-style-${baseSlug || Date.now().toString(36)}`;
    const skillId = `writing-skill-${slug}`;
    const description = sourceName
      ? `从「${sourceName}」参考文本导入的文风指南。`
      : "由 style.import 从参考文本生成的文风指南。";
    const content = [
      "---",
      `id: ${yamlString(skillId)}`,
      `name: ${yamlString(skillName)}`,
      `description: ${yamlString(description)}`,
      "kind: prose",
      "mode: manual",
      "---",
      "",
      styleGuide,
      "",
    ].join("\n");
    let path: string;
    try {
      path = await writeAuthorWritingSkill(slug, content, undefined);
    } catch (error) {
      return fail(
        "writing-skill-write-failed",
        `文风 Skill 写入失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    createdWritingSkill = { id: skillId, slug, path, enabled: false };

    if (enableOnBook) {
      const active = await loadActiveWritingSkillsForBook(binding.bookId, { bookRoot: binding.root })
        .catch(() => ({ projectSkillSlugs: [] as readonly string[] }));
      const enabled = await handleWritingSkillsWrite(
        {
          bookId: binding.bookId,
          ...(active.projectSkillSlugs.includes(slug) ? {} : { addSkillIds: [skillId] }),
        },
        { bookRoot: binding.root },
      );
      if (!enabled.ok) {
        return fail(
          enabled.error ?? "writing-skill-enable-failed",
          `${enabled.summary} SKILL.md 已写入 ${path}，可在 Writing Skills 面板手动添加。`,
        );
      }
      const data = enabled.data as { projectSkillSlugs?: readonly string[] } | undefined;
      createdWritingSkill = {
        ...createdWritingSkill,
        enabled: Boolean(data?.projectSkillSlugs?.includes(slug)),
        ...(data?.projectSkillSlugs ? { projectSkillSlugs: data.projectSkillSlugs } : {}),
      };
    }
  }

  return ok(
    saveAsWritingSkill
      ? `已生成并${createdWritingSkill?.enabled ? "启用" : "创建"}文风 Writing Skill${sourceName ? `（${sourceName}）` : ""}。`
      : `已生成文风指南建议${sourceName ? `（${sourceName}）` : ""}，但它不会影响写作：文风只能通过已启用的 Writing Skill 进入写作上下文。要真正生效，请用 saveAsWritingSkill=true 重新导入，或用 writing-skills.write 手动落盘并启用。`,
    {
      bookId: binding.bookId,
      kind: saveAsWritingSkill ? "writing-skill-created" : "style-suggestion",
      profile,
      styleGuide,
      guidePreview: styleGuide.slice(0, 500),
      createdWritingSkill,
      ...(saveAsWritingSkill
        ? {}
        : {
            notAppliedReason:
              "写作管线只从已启用的 Writing Skills 读取文风；未保存为 Skill 的文风指南没有注入路径。",
          }),
      nextActions: saveAsWritingSkill
        ? ["write.preflight", "pipeline.write"]
        : ["writing-skills.write", "style.import(saveAsWritingSkill=true)"],
    },
  );
}

async function importChapters(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult> {
  const content = typeof input.content === "string" ? input.content : "";
  const sourceName = typeof input.sourceName === "string" ? input.sourceName : "导入文本";
  const maxChapters = Math.min(optionalPositiveInteger(input.maxChapters) ?? 500, 500);
  if (content.length < 1000) return fail("text-too-short", "导入文本至少需要 1000 字。");
  let chapters;
  try {
    chapters = splitChapters(content, typeof input.splitPattern === "string" ? input.splitPattern : undefined).slice(0, maxChapters);
  } catch (error) {
    return fail("invalid-split-pattern", `章节分割规则无效：${error instanceof Error ? error.message : String(error)}`);
  }
  if (chapters.length === 0) return fail("no-chapters", "未能识别出章节，请检查文本格式或 splitPattern。");

  return withBookLock(binding, async () => {
    const chaptersDir = join(binding.root, "chapters");
    const storyDir = join(binding.root, "story");
    await mkdir(chaptersDir, { recursive: true });
    await mkdir(storyDir, { recursive: true });
    const existing = await readChapterIndex(binding);
    const startNumber = existing.reduce((max, entry) => Math.max(max, Number(entry.number) || 0), 0) + 1;
    const now = new Date().toISOString();
    let totalWords = 0;
    const imported: ChapterIndexRecord[] = [];
    for (let index = 0; index < chapters.length; index += 1) {
      const chapter = chapters[index]!;
      const number = startNumber + index;
      const title = chapter.title || `第${number}章`;
      const fileName = chapterRelativePath(DEFAULT_VOLUME_DIRECTORY, number, title);
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
    const profile = analyzeStyle(content.slice(0, 50000), sourceName);
    await writeFile(join(storyDir, "style_profile.json"), `${JSON.stringify(profile, null, 2)}\n`, "utf8");

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
      const { handleBookDissect } = await import("./book-dissect.js");
      const generator = context.generateText
        ? async (request: {
            messages: Array<{ role: "system" | "user"; content: string }>;
            temperature?: number;
            maxTokens?: number;
          }) => {
            const generated = await context.generateText!({
              messages: request.messages,
              temperature: request.temperature,
              maxTokens: request.maxTokens,
            });
            return { text: generated.text };
          }
        : undefined;
      const dissected = await handleBookDissect({
        bookId: binding.bookId,
        bookRoot: binding.root,
        fromChapter: firstChapter,
        toChapter: lastChapter,
        settle: autoSettle,
        apply: applyDissectDraft,
        targets: ["all"],
        generateText: generator,
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
      ].join("；"),
      {
        bookId: binding.bookId,
        importedChapters: chapters.length,
        totalWords,
        firstChapter,
        nextChapter: lastChapter + 1,
        lastChapter,
        styleProfileWritten: true,
        autoSettle,
        extractBrief,
        applyDissectDraft,
        settlementSummary,
        dissectSummary,
        dissectDraft,
        writtenFiles,
        preflight,
        nextActions: [
          "write.preflight",
          "book.dissect",
          "style.import",
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
  const generator = context.generateText
    ? async (request: {
        messages: Array<{ role: "system" | "user"; content: string }>;
        temperature?: number;
        maxTokens?: number;
      }) => {
        const generated = await context.generateText!({
          messages: request.messages,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
        });
        return { text: generated.text };
      }
    : undefined;
  const result = await handleBookDissect({
    bookId: binding.bookId,
    bookRoot: binding.root,
    ...(typeof input.fromChapter === "number" ? { fromChapter: input.fromChapter } : {}),
    ...(typeof input.toChapter === "number" ? { toChapter: input.toChapter } : {}),
    ...(targets ? { targets: targets as never } : {}),
    apply: input.apply === true,
    settle: input.settle === true,
    generateText: generator,
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
  const generator = context.generateText
    ? async (request: {
        messages: Array<{ role: "system" | "user"; content: string }>;
        temperature?: number;
        maxTokens?: number;
      }) => {
        const generated = await context.generateText!({
          messages: request.messages,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
        });
        return { text: generated.text };
      }
    : undefined;
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
    generateText: generator,
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
    generateText: context.generateText,
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

function parseSuggestions(text: string): unknown[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.match(/\[[\s\S]*\]/)?.[0] ?? text;
  try {
    const parsed = JSON.parse(candidate.trim()) as unknown;
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [{ title: "建议", summary: text.trim() }];
  }
}

async function outlineSuggestNext(
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult> {
  const generator = requireGenerator(context);
  if (typeof generator !== "function") return generator;
  const storage = getStorageDatabase();
  const index = await readChapterIndex(binding);
  const recentEntries = [...index]
    .sort((left, right) => Number(left.number) - Number(right.number))
    .slice(-2);
  const recent: string[] = [];
  for (const entry of recentEntries) {
    const chapterNumber = positiveInteger(entry.number);
    if (!chapterNumber) continue;
    const chapter = await readBoundChapter(binding, chapterNumber);
    if (chapter.ok && chapter.data) recent.push(`第${chapterNumber}章\n${chapter.data.content.slice(0, 2500)}`);
  }

  // 权威源：读取经纬 outline 与 foreshadowing，章摘要/章节索引，Narrative Memory
  const outlineEntries = listLedgerEntries(storage, binding.bookId, "outline");
  const foreshadowingEntries = listLedgerEntries(storage, binding.bookId, "foreshadowing");
  const chapterSummaryEntries = listLedgerEntries(storage, binding.bookId, "chapter-summaries");

  const storyContext: string[] = [];
  if (outlineEntries.length > 0) {
    storyContext.push(`## 卷纲/大纲\n${outlineEntries.map((e) => `### ${e.title}\n${e.contentMd}\n${JSON.stringify(e.fields)}`).join("\n\n")}`);
  }
  if (foreshadowingEntries.length > 0) {
    const activeHooks = foreshadowingEntries.filter((e) => e.fields.status !== "paid_off" && e.fields.status !== "resolved");
    storyContext.push(`## 待回收伏笔\n${activeHooks.map((e) => `- ${e.title} (${JSON.stringify(e.fields)})`).join("\n")}`);
  }
  if (chapterSummaryEntries.length > 0) {
    const recentSummaries = chapterSummaryEntries.slice(-5);
    storyContext.push(`## 近期章节摘要\n${recentSummaries.map((e) => `- ${e.title}: ${e.contentMd}`).join("\n")}`);
  }

  // 读取 Narrative Memory 事实与事件
  try {
    const { ensureNarrativeMemorySchema, queryNarrativeFacts, listPendingNarrativeEvents } = await import("../engine/narrative-memory/storage.js");
    ensureNarrativeMemorySchema(storage);
    const facts = queryNarrativeFacts(storage, { bookId: binding.bookId, limit: 10 });
    if (facts.length > 0) {
      storyContext.push(`## Narrative Memory 动态事实\n${facts.map((f) => `- [${f.category}] ${f.subject} ${f.predicate} ${f.object}`).join("\n")}`);
    }
    const events = listPendingNarrativeEvents(storage, { bookId: binding.bookId, limit: 5 });
    if (events.length > 0) {
      storyContext.push(`## Narrative Memory 未决事件\n${events.map((e) => `- 第${e.chapterNumber}章: ${e.subject} ${e.predicate} ${e.object}`).join("\n")}`);
    }
  } catch {
    // 允许忽略 Narrative Memory 异常
  }

  const generated = await generator({
    messages: [
      { role: "system", content: "你是网文大纲编辑。返回严格 JSON 数组，每项包含 title、summary、hooks 三个字段。" },
      {
        role: "user",
        content: `基于以下信息推荐下一章的 2-3 个方向。每个方向说明标题、50 字内摘要、推进的伏笔。\n\n${storyContext.join("\n\n") || "暂无经纬大纲信息"}\n\n## 最近章节\n${recent.join("\n\n---\n\n") || "暂无章节"}`,
      },
    ],
    temperature: 0.6,
    maxTokens: 2000,
  });
  const suggestions = parseSuggestions(generated.text);
  return ok(`推荐 ${suggestions.length} 个下一章方向。`, { suggestions });
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

async function pipelineWrite(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult> {
  const generator = requireGenerator(context);
  if (typeof generator !== "function") return generator;
  const sceneSpec = record(input.sceneSpec) as SceneSpec | undefined;
  if (!sceneSpec) return fail("invalid-input", "sceneSpec 必填。");
  context.emitOutput?.("正在执行 Writer → Audit → Revise 写作管线…");
  const result = await executePipelineWrite(
    {
      bookId: binding.bookId,
      sceneSpec,
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
      ...(typeof input.requireFactCheckPass === "boolean" ? { requireFactCheckPass: input.requireFactCheckPass } : {}),
      ...(typeof input.factCheckAutoRevise === "boolean" ? { factCheckAutoRevise: input.factCheckAutoRevise } : {}),
    },
    {
      // root 是项目根（books/ 的父目录），bookRoot 才是这本书的目录。
      // 过去两者都传 binding.root，导致 StateManager 把书目录当项目根，
      // 凡是走 booksDir 的下游就会拼出 <bookRoot>/books/<bookId> 而找不到 book.json。
      root: context.projectRoot || binding.root,
      bookRoot: binding.root,
      client: hostClient(generator),
      model: context.model?.id ?? "runtime-current",
      onStream: context.emitOutput,
    },
  );
  if (!result.ok) return fail(result.code, result.error);
  const settlementSummary = result.narrativeSettlement
    ? ` Narrative Memory：抽取 ${result.narrativeSettlement.extracted} 条，自动沉淀 ${result.narrativeSettlement.autoApplied} 条，pending ${result.narrativeSettlement.pending} 条。`
    : "";
  const auditCat = result.auditIssueCategories;
  const auditSummary = auditCat
    ? ` critical=${auditCat.critical} warning=${auditCat.warning}`
    : "";
  return ok(
    `第${result.chapterNumber}章「${result.title}」生成完成（${result.wordCount}字）。审计：${result.auditResult.passed ? "通过" : "未通过"}${auditSummary}${result.revised ? "，已自动修订" : ""}。${settlementSummary}${result.highRiskPendingReminder ? `\n${result.highRiskPendingReminder}` : ""}`,
    {
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
      highRiskPendingReminder: result.highRiskPendingReminder,
      publishHint: result.publishHint,
      needsHumanReview: result.needsHumanReview,
      settlementError: result.settlementError,
      artifact: result.artifact,
    },
  );
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
    case "scene.spec":
      return okResult(await handleSceneSpec({
        ...(input as unknown as Parameters<typeof handleSceneSpec>[0]),
        bookId: binding.bookId,
        bookRoot: binding.root,
        generateText: context.generateText,
      }));
    case "chapter_audit":
    case "chapter.audit":
      return chapterAudit(input, binding);
    case "rewrite_segment":
    case "rewrite.segment":
      return rewriteSegment(input, binding, context);
    case "rewrite_apply":
    case "rewrite.apply":
      return rewriteApply(input, binding);
    case "style_import":
    case "style.import":
      return styleImport(input, binding, context);
    case "pipeline_import_chapters":
    case "pipeline.import_chapters":
      return importChapters(input, binding, context);
    case "book_dissect":
    case "book.dissect":
      return bookDissect(input, binding, context);
    case "outline_suggest_next":
    case "outline.suggest_next":
      return outlineSuggestNext(binding, context);
    case "outline_volume":
    case "outline.volume":
      return outlineVolume(input, binding, context);
    case "arc_character":
    case "arc.character":
      return arcCharacter(input, binding, context);
    case "publish_check":
    case "publish.check":
      return publishCheck(input, binding);
    case "character_check_consistency":
    case "character.check_consistency":
      return characterConsistency(input, binding);
    case "hooks_manage":
    case "hooks.manage":
      return hooksManage(input, binding);
    case "pipeline_write":
    case "pipeline.write":
      return pipelineWrite(input, binding, context);
    default:
      return null;
  }
}

function okResult(result: Awaited<ReturnType<typeof handleSceneSpec>>): RuntimeToolResult {
  if (!result.ok) return fail(result.error, result.summary);
  return ok(result.summary, result.data);
}
