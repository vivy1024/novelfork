import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  splitChapters,
  StateManager,
  type ChapterMeta,
  type LLMClient,
} from "@vivy1024/novelfork-core";
import type {
  RuntimeTextGenerator,
  RuntimeToolResult,
  ToolExecutionContext,
} from "@vivy1024/novelfork-core/plugins";
import { ContinuityAuditor, ReviserAgent, analyzeStyle } from "../engine/index.js";
import { handleChapterAuditV2 } from "./chapter-audit-v2.js";
import { handleChapterRead } from "./chapter-read.js";
import { handleChapterWrite } from "./chapter-write.js";
import { executePipelineWrite } from "./pipeline-write-service.js";
import { handleSceneSpec, type SceneSpec } from "./scene-spec-handler.js";

export interface TrustedRuntimeBookBinding {
  readonly bookId: string;
  readonly root: string;
}

const AI_MARKERS = [
  "值得注意的是",
  "不禁",
  "缓缓",
  "微微",
  "淡淡",
  "仿佛",
  "宛如",
  "与此同时",
];

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

async function readChapterIndex(binding: TrustedRuntimeBookBinding): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(join(binding.root, "chapters", "index.json"), "utf8").catch(() => "[]");
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
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
  if (!chapterNumber || !start || !end || start > end || !["continue", "expand", "reduce_ai", "restyle"].includes(mode)) {
    return fail("invalid-input", "需要有效的 chapterNumber、selection.start/end 和改写模式。");
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
    reduce_ai: "改写以下段落，删除模式化 AI 表达，保持原意并让语言更自然。",
    restyle: `按指定风格改写以下段落：${typeof input.styleHint === "string" ? input.styleHint : "更生动自然"}。`,
  };
  const generated = await generator({
    messages: [
      { role: "system", content: "你是中文网文改写编辑。只输出改写后的正文，不解释，不加 Markdown 围栏。" },
      { role: "user", content: `${instructions[mode]}\n\n${originalText}` },
    ],
    temperature: mode === "reduce_ai" ? 0.5 : 0.7,
    maxTokens: 8192,
  });
  const rewrittenText = generated.text.trim();
  if (!rewrittenText) return fail("empty-model-output", "Runtime 模型没有返回改写文本。");
  const beforeMarkers = AI_MARKERS.filter((marker) => originalText.includes(marker));
  const afterMarkers = AI_MARKERS.filter((marker) => rewrittenText.includes(marker));
  return ok(`已完成第 ${chapterNumber} 章第 ${start}-${end} 行改写。`, {
    mode,
    originalText,
    rewrittenText,
    lineRange: { start, end },
    ...(mode === "reduce_ai"
      ? { aiTasteComparison: { before: { count: beforeMarkers.length, markers: beforeMarkers }, after: { count: afterMarkers.length, markers: afterMarkers } } }
      : {}),
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
  return withBookLock(binding, async () => {
    const chapter = await readBoundChapter(binding, chapterNumber);
    if (!chapter.ok || !chapter.data) return fail(chapter.error ?? "chapter-not-found", chapter.summary);
    const lines = chapter.data.content.split("\n");
    if (end > lines.length) return fail("invalid-range", `行号范围无效（1-${lines.length}）。`);
    const inserted = newText.split("\n");
    const next = mode === "insert_after"
      ? [...lines.slice(0, end), ...inserted, ...lines.slice(end)]
      : [...lines.slice(0, start - 1), ...inserted, ...lines.slice(end)];
    const written = await handleChapterWrite(
      { bookId: binding.bookId, chapterNumber, content: next.join("\n") },
      { bookRoot: binding.root, purpose: "revision" },
    );
    if (!written.ok) return fail(written.error, written.summary);
    return ok(
      mode === "insert_after"
        ? `已在第 ${end} 行后插入 ${inserted.length} 行。`
        : `已替换第 ${start}-${end} 行。`,
      { bookId: binding.bookId, chapterNumber, mode, linesAffected: inserted.length },
    );
  });
}

async function styleImport(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult> {
  const referenceText = typeof input.referenceText === "string" ? input.referenceText : "";
  const sourceName = typeof input.sourceName === "string" ? input.sourceName : undefined;
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
  return ok(`已生成文风预设建议${sourceName ? `（${sourceName}）` : ""}。`, {
    bookId: binding.bookId,
    kind: "preset-suggestion",
    profile,
    styleGuide,
    guidePreview: styleGuide.slice(0, 500),
    nextActions: ["add-preset", "replace-preset", "manual-edit"],
  });
}

async function pipelineRevise(
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult> {
  const mode = typeof input.mode === "string" ? input.mode : "polish";
  if (!["polish", "rewrite", "rework", "spot-fix", "anti-detect"].includes(mode)) {
    return fail("invalid-input", `不支持的修订模式：${mode}。`);
  }
  const generator = requireGenerator(context);
  if (typeof generator !== "function") return generator;
  const index = await readChapterIndex(binding);
  const latest = index.reduce((max, entry) => Math.max(max, Number(entry.number) || 0), 0);
  const chapterNumber = optionalPositiveInteger(input.chapterNumber) ?? latest;
  if (!chapterNumber) return fail("no-chapters", "该书籍尚无章节可修订。");

  return withBookLock(binding, async () => {
    const chapter = await readBoundChapter(binding, chapterNumber);
    if (!chapter.ok || !chapter.data) return fail(chapter.error ?? "chapter-not-found", chapter.summary);
    const book = await readBookConfig(binding);
    const root = binding.root;
    const client = hostClient(generator);
    const model = context.model?.id ?? "runtime-current";
    const agentContext = { client, model, projectRoot: root, bookId: binding.bookId };
    context.emitOutput?.(`正在审计第 ${chapterNumber} 章…`);
    const audit = await new ContinuityAuditor(agentContext).auditChapter(
      binding.root,
      chapter.data.content,
      chapterNumber,
      typeof book.genre === "string" ? book.genre : undefined,
    );
    const shouldRevise = mode !== "spot-fix"
      || audit.issues.some((issue) => issue.severity === "critical" || issue.severity === "warning");
    if (!shouldRevise) {
      return ok(`第 ${chapterNumber} 章未发现需要定点修复的问题。`, {
        bookId: binding.bookId,
        chapterNumber,
        mode,
        auditPassed: audit.passed,
        issueCount: audit.issues.length,
        revised: false,
      });
    }
    context.emitOutput?.(`正在按 ${mode} 模式修订第 ${chapterNumber} 章…`);
    const revised = await new ReviserAgent(agentContext).reviseChapter(
      binding.root,
      chapter.data.content,
      chapterNumber,
      audit.issues,
      mode as "polish" | "rewrite" | "rework" | "spot-fix" | "anti-detect",
      typeof book.genre === "string" ? book.genre : undefined,
    );
    const written = await handleChapterWrite(
      { bookId: binding.bookId, chapterNumber, content: revised.revisedContent },
      { bookRoot: binding.root, purpose: "revision" },
    );
    if (!written.ok) return fail(written.error, written.summary);
    return ok(`第 ${chapterNumber} 章修订完成。`, {
      bookId: binding.bookId,
      chapterNumber,
      mode,
      auditPassed: audit.passed,
      issueCount: audit.issues.length,
      revised: true,
      originalWords: chapter.data.content.length,
      revisedWords: revised.revisedContent.length,
    });
  });
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
    const imported: Array<Record<string, unknown>> = [];
    for (let index = 0; index < chapters.length; index += 1) {
      const chapter = chapters[index]!;
      const number = startNumber + index;
      const padded = String(number).padStart(4, "0");
      const safeTitle = (chapter.title || `第${number}章`).replace(/[<>:"/\\|?*]/g, "_").slice(0, 50);
      const fileName = `${padded}_${safeTitle}.md`;
      const chapterContent = `# ${chapter.title || `第${number}章`}\n\n${chapter.content}`;
      await writeFile(join(chaptersDir, fileName), chapterContent, "utf8");
      totalWords += chapter.content.length;
      imported.push({
        number,
        title: chapter.title || `第${number}章`,
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
    await writeFile(
      join(chaptersDir, "index.json"),
      `${JSON.stringify([...existing, ...imported] satisfies Array<Record<string, unknown>>, null, 2)}\n`,
      "utf8",
    );
    const profile = analyzeStyle(content.slice(0, 50000), sourceName);
    await writeFile(join(storyDir, "style_profile.json"), `${JSON.stringify(profile, null, 2)}\n`, "utf8");
    return ok(`已从「${sourceName}」导入 ${chapters.length} 章（共 ${totalWords} 字）。`, {
      bookId: binding.bookId,
      importedChapters: chapters.length,
      totalWords,
      firstChapter: startNumber,
      nextChapter: startNumber + chapters.length,
    });
  });
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
  const storyFiles = ["outline.md", "volume_outline.md", "current_focus.md", "pending_hooks.md"];
  const storyContext: string[] = [];
  for (const fileName of storyFiles) {
    const text = await readFile(join(binding.root, "story", fileName), "utf8").catch(() => "");
    if (text.trim()) storyContext.push(`## ${fileName}\n${text.slice(0, 3000)}`);
  }
  const generated = await generator({
    messages: [
      { role: "system", content: "你是网文大纲编辑。返回严格 JSON 数组，每项包含 title、summary、hooks 三个字段。" },
      {
        role: "user",
        content: `基于以下信息推荐下一章的 2-3 个方向。每个方向说明标题、50 字内摘要、推进的伏笔。\n\n${storyContext.join("\n\n") || "暂无大纲文件"}\n\n## 最近章节\n${recent.join("\n\n---\n\n") || "暂无章节"}`,
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
  const hooksPath = join(binding.root, "story", "pending_hooks.md");
  const content = await readFile(hooksPath, "utf8").catch(() => "");
  const lines = content.split("\n");
  const hookLines = lines
    .map((text, lineIndex) => ({ text, lineIndex }))
    .filter((entry) => /^- \[[ x]\]/i.test(entry.text));
  const listed = hookLines.map((entry, index) => ({
    id: `hook-${index}`,
    done: /^- \[x\]/i.test(entry.text),
    text: entry.text.replace(/^- \[[ x]\]\s*/i, "").trim(),
  }));
  if (action === "list") return ok(`共 ${listed.length} 个伏笔。`, { hooks: listed });
  if (action === "check_due") {
    const chapterNumber = optionalPositiveInteger(input.chapterNumber);
    const dueHooks = listed.filter((hook) => !hook.done && (!chapterNumber || (() => {
      const planted = hook.text.match(/第(\d+)章/)?.[1];
      return planted ? chapterNumber - Number(planted) >= 10 : false;
    })()));
    return ok(`${dueHooks.length} 个伏笔到期。`, { chapterNumber, dueHooks });
  }

  return withBookLock(binding, async () => {
    await mkdir(dirname(hooksPath), { recursive: true });
    if (action === "plant") {
      const description = typeof input.description === "string" ? input.description.trim() : "";
      const chapterNumber = optionalPositiveInteger(input.chapterNumber);
      if (!description) return fail("invalid-input", "plant 需要 description。");
      const line = `- [ ] ${description}${chapterNumber ? `（埋设于第${chapterNumber}章）` : ""}`;
      const next = content.trim() ? `${content.trimEnd()}\n${line}\n` : `# 伏笔追踪\n\n${line}\n`;
      await writeFile(hooksPath, next, "utf8");
      return ok(`已埋设伏笔：${description}`, { action, description, chapterNumber });
    }
    const hookId = typeof input.hookId === "string" ? input.hookId : "";
    const index = /^hook-(\d+)$/.exec(hookId)?.[1];
    const selected = index === undefined ? undefined : hookLines[Number(index)];
    if (!selected) return fail("hook-not-found", `伏笔 ${hookId || "(空)"} 不存在。`);
    if (action === "payoff") {
      const chapterNumber = optionalPositiveInteger(input.chapterNumber);
      lines[selected.lineIndex] = selected.text.replace(/^- \[ \]/, "- [x]") + (chapterNumber ? `（兑现于第${chapterNumber}章）` : "（已兑现）");
      await writeFile(hooksPath, lines.join("\n"), "utf8");
      return ok(`伏笔已兑现：${listed[Number(index)]?.text ?? hookId}`, { action, hookId, chapterNumber });
    }
    if (action === "delete") {
      lines.splice(selected.lineIndex, 1);
      await writeFile(hooksPath, lines.join("\n"), "utf8");
      return ok(`已删除伏笔：${listed[Number(index)]?.text ?? hookId}`, { action, hookId });
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
    },
    {
      root: binding.root,
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
  return ok(
    `第${result.chapterNumber}章「${result.title}」生成完成（${result.wordCount}字）。审计：${result.auditResult.passed ? "通过" : "未通过"}${result.revised ? "，已自动修订" : ""}。${settlementSummary}${result.highRiskPendingReminder ? `\n${result.highRiskPendingReminder}` : ""}`,
    {
      chapterNumber: result.chapterNumber,
      title: result.title,
      wordCount: result.wordCount,
      auditPassed: result.auditResult.passed,
      revised: result.revised,
      chapterId: result.chapterId,
      narrativeSettlement: result.narrativeSettlement,
      highRiskPendingReminder: result.highRiskPendingReminder,
      artifact: result.artifact,
    },
  );
}

export async function executeRuntimeDomainTool(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult | null> {
  switch (toolName) {
    case "scene.spec":
      return okResult(await handleSceneSpec({
        ...(input as unknown as Parameters<typeof handleSceneSpec>[0]),
        bookId: binding.bookId,
        generateText: context.generateText,
      }));
    case "chapter.audit":
      return chapterAudit(input, binding);
    case "rewrite.segment":
      return rewriteSegment(input, binding, context);
    case "rewrite.apply":
      return rewriteApply(input, binding);
    case "style.import":
      return styleImport(input, binding, context);
    case "pipeline.revise":
      return pipelineRevise(input, binding, context);
    case "pipeline.import_chapters":
      return importChapters(input, binding, context);
    case "outline.suggest_next":
      return outlineSuggestNext(binding, context);
    case "character.check_consistency":
      return characterConsistency(input, binding);
    case "hooks.manage":
      return hooksManage(input, binding);
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
