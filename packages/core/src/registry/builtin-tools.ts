/**
 * builtin-tools — 18 个内置工具的注册表实现
 * 从 agent.ts 提取，保持原有逻辑不变
 */

import type { PipelineRunner, PipelineConfig } from "../pipeline/runner.js";
import type { StateManager } from "../state/manager.js";
import type { Platform, Genre } from "../models/book.js";
import type { RegisteredTool, ToolDefinition } from "./tool-registry.js";
import type { ReviseMode } from "../agents/reviser.js";
import { DEFAULT_REVISE_MODE } from "../agents/reviser.js";

// --- Helper functions (从 agent.ts 提取) ---

async function getSequentialWriteGuardError(
  state: StateManager,
  bookId: string,
  toolName: "write_draft" | "write_full_pipeline",
): Promise<string | null> {
  const nextNum = await state.getNextChapterNumber(bookId);
  const index = await state.loadChapterIndex(bookId);
  if (index.length === 0) return null;
  const lastIndexedChapter = index[index.length - 1]!.number;
  if (lastIndexedChapter === nextNum - 1) return null;
  return `${toolName} 只能续写下一章（当前应写第${nextNum}章）。检测到章节索引与运行时进度不一致，请先用 get_book_status 确认状态。`;
}

function containsProgressManipulation(content: string): boolean {
  const patterns = [
    /\blastAppliedChapter\b/i,
    /\|\s*Current Chapter\s*\|\s*\d+\s*\|/i,
    /\|\s*当前章(?:节)?\s*\|\s*\d+\s*\|/,
    /\bCurrent Chapter\b\s*[:：]\s*\d+/i,
    /当前章(?:节)?\s*[:：]\s*\d+/,
    /\bprogress\b\s*[:：]\s*\d+/i,
    /进度\s*[:：]\s*\d+/,
  ];
  return patterns.some((pattern) => pattern.test(content));
}

// --- Tool definitions (从 agent.ts TOOLS 数组提取) ---

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "plan_chapter",
    description: "为指定书籍规划下一章节的大纲和关键情节点",
    parameters: [
      { name: "bookId", type: "string", description: "书籍ID", required: true },
      { name: "guidance", type: "string", description: "规划指导意见", required: false },
    ],
  },
  {
    name: "compose_chapter",
    description: "为指定章节生成完整的章节内容（基于已有大纲）",
    parameters: [
      { name: "bookId", type: "string", description: "书籍ID", required: true },
      { name: "guidance", type: "string", description: "撰写指导意见", required: false },
    ],
  },
  {
    name: "write_draft",
    description: "续写下一章（自动规划+撰写）",
    parameters: [
      { name: "bookId", type: "string", description: "书籍ID", required: true },
      { name: "guidance", type: "string", description: "写作指导意见", required: false },
    ],
  },
  {
    name: "audit_chapter",
    description: "审查指定章节的质量问题（情节、人设、文笔等）",
    parameters: [
      { name: "bookId", type: "string", description: "书籍ID", required: true },
      { name: "chapterNumber", type: "number", description: "章节编号", required: false },
    ],
  },
  {
    name: "revise_chapter",
    description: "根据审查意见修订指定章节",
    parameters: [
      { name: "bookId", type: "string", description: "书籍ID", required: true },
      { name: "chapterNumber", type: "number", description: "章节编号", required: false },
      { name: "mode", type: "string", description: "修订模式", required: false },
    ],
  },
  {
    name: "scan_market",
    description: "扫描市场热点和读者偏好，生成市场分析报告",
    parameters: [],
  },
  {
    name: "create_book",
    description: "创建新书籍项目",
    parameters: [
      { name: "title", type: "string", description: "书名", required: true },
      { name: "platform", type: "string", description: "目标平台", required: false },
      { name: "genre", type: "string", description: "题材类型", required: false },
      { name: "brief", type: "string", description: "简介或初始设定", required: false },
    ],
  },
  {
    name: "get_book_status",
    description: "获取书籍当前状态（章节进度、字数统计等）",
    parameters: [
      { name: "bookId", type: "string", description: "书籍ID", required: true },
    ],
  },
  {
    name: "update_author_intent",
    description: "更新作者意图文档（story/author_intent.md）",
    parameters: [
      { name: "bookId", type: "string", description: "书籍ID", required: true },
      { name: "content", type: "string", description: "文档内容", required: true },
    ],
  },
  {
    name: "update_current_focus",
    description: "更新当前关注点文档（story/current_focus.md）",
    parameters: [
      { name: "bookId", type: "string", description: "书籍ID", required: true },
      { name: "content", type: "string", description: "文档内容", required: true },
    ],
  },
  {
    name: "read_truth_files",
    description: "读取书籍的所有真相文件（story/*.md）",
    parameters: [
      { name: "bookId", type: "string", description: "书籍ID", required: true },
    ],
  },
  {
    name: "list_books",
    description: "列出所有书籍项目",
    parameters: [],
  },
  {
    name: "write_full_pipeline",
    description: "执行完整写作流程（规划+撰写+审查+修订）",
    parameters: [
      { name: "bookId", type: "string", description: "书籍ID", required: true },
      { name: "count", type: "number", description: "连续写作章节数", required: false, default: 1 },
    ],
  },
  {
    name: "web_fetch",
    description: "抓取指定URL的网页内容",
    parameters: [
      { name: "url", type: "string", description: "目标URL", required: true },
      { name: "maxChars", type: "number", description: "最大字符数", required: false, default: 8000 },
    ],
  },
  {
    name: "import_style",
    description: "从参考文本导入文风特征",
    parameters: [
      { name: "bookId", type: "string", description: "书籍ID", required: true },
      { name: "referenceText", type: "string", description: "参考文本", required: true },
    ],
  },
  {
    name: "import_canon",
    description: "从父书籍导入世界观设定",
    parameters: [
      { name: "targetBookId", type: "string", description: "目标书籍ID", required: true },
      { name: "parentBookId", type: "string", description: "父书籍ID", required: true },
    ],
  },
  {
    name: "import_chapters",
    description: "批量导入章节文本（整书重导工具）",
    parameters: [
      { name: "bookId", type: "string", description: "书籍ID", required: true },
      { name: "text", type: "string", description: "章节文本", required: true },
      { name: "splitPattern", type: "string", description: "章节分割正则", required: false },
    ],
  },
  {
    name: "write_truth_file",
    description: "写入真相文件（story/*.md）",
    parameters: [
      { name: "bookId", type: "string", description: "书籍ID", required: true },
      { name: "fileName", type: "string", description: "文件名", required: true },
      { name: "content", type: "string", description: "文件内容", required: true },
    ],
  },
];

// --- Tool handlers (从 agent.ts executeAgentTool 提取) ---

const planChapterHandler: RegisteredTool["handler"] = async (pipeline, _state, _config, args) => {
  const result = await pipeline.planChapter(
    args.bookId as string,
    args.guidance as string | undefined,
  );
  return JSON.stringify(result);
};

const composeChapterHandler: RegisteredTool["handler"] = async (pipeline, _state, _config, args) => {
  const result = await pipeline.composeChapter(
    args.bookId as string,
    args.guidance as string | undefined,
  );
  return JSON.stringify(result);
};

const writeDraftHandler: RegisteredTool["handler"] = async (pipeline, state, _config, args) => {
  const bookId = args.bookId as string;
  const writeGuardError = await getSequentialWriteGuardError(state, bookId, "write_draft");
  if (writeGuardError) {
    return JSON.stringify({ error: writeGuardError });
  }
  const result = await pipeline.writeDraft(
    bookId,
    args.guidance as string | undefined,
  );
  return JSON.stringify(result);
};

const auditChapterHandler: RegisteredTool["handler"] = async (pipeline, _state, _config, args) => {
  const result = await pipeline.auditDraft(
    args.bookId as string,
    args.chapterNumber as number | undefined,
  );
  return JSON.stringify(result);
};

const reviseChapterHandler: RegisteredTool["handler"] = async (pipeline, state, _config, args) => {
  const bookId = args.bookId as string;
  const chapterNum = args.chapterNumber as number | undefined;
  if (chapterNum !== undefined) {
    const index = await state.loadChapterIndex(bookId);
    const chapter = index.find((ch) => ch.number === chapterNum);
    if (!chapter) {
      return JSON.stringify({ error: `第${chapterNum}章不存在。revise_chapter 只能修订已有章节，不能用来补写缺失章节。请用 get_book_status 确认。` });
    }
    if (chapter.wordCount === 0) {
      return JSON.stringify({ error: `第${chapterNum}章内容为空（0字）。revise_chapter 不能修订空章节。` });
    }
  }
  const result = await pipeline.reviseDraft(
    bookId,
    chapterNum,
    (args.mode as ReviseMode) ?? DEFAULT_REVISE_MODE,
  );
  return JSON.stringify(result);
};

const scanMarketHandler: RegisteredTool["handler"] = async (pipeline, _state, _config, _args) => {
  const result = await pipeline.runRadar();
  return JSON.stringify(result);
};

const createBookHandler: RegisteredTool["handler"] = async (pipeline, _state, config, args) => {
  const now = new Date().toISOString();
  const title = args.title as string;
  const bookId = title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 30);

  const book = {
    id: bookId,
    title,
    platform: ((args.platform as string) ?? "tomato") as Platform,
    genre: ((args.genre as string) ?? "xuanhuan") as Genre,
    status: "outlining" as const,
    targetChapters: 200,
    chapterWordCount: 3000,
    createdAt: now,
    updatedAt: now,
  };

  const brief = args.brief as string | undefined;
  if (brief) {
    const contextPipeline = new (await import("../pipeline/runner.js")).PipelineRunner({
      ...config,
      externalContext: brief,
    });
    await contextPipeline.initBook(book);
  } else {
    await pipeline.initBook(book);
  }

  return JSON.stringify({ bookId, title, status: "created" });
};

const getBookStatusHandler: RegisteredTool["handler"] = async (pipeline, _state, _config, args) => {
  const result = await pipeline.getBookStatus(args.bookId as string);
  return JSON.stringify(result);
};

const updateAuthorIntentHandler: RegisteredTool["handler"] = async (_pipeline, state, _config, args) => {
  await state.ensureControlDocuments(args.bookId as string);
  const { writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const storyDir = join(state.bookDir(args.bookId as string), "story");
  await writeFile(join(storyDir, "author_intent.md"), args.content as string, "utf-8");
  return JSON.stringify({ bookId: args.bookId, file: "story/author_intent.md", written: true });
};

const updateCurrentFocusHandler: RegisteredTool["handler"] = async (_pipeline, state, _config, args) => {
  await state.ensureControlDocuments(args.bookId as string);
  const { writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const storyDir = join(state.bookDir(args.bookId as string), "story");
  await writeFile(join(storyDir, "current_focus.md"), args.content as string, "utf-8");
  return JSON.stringify({ bookId: args.bookId, file: "story/current_focus.md", written: true });
};

const readTruthFilesHandler: RegisteredTool["handler"] = async (pipeline, _state, _config, args) => {
  const result = await pipeline.readTruthFiles(args.bookId as string);
  return JSON.stringify(result);
};

const listBooksHandler: RegisteredTool["handler"] = async (pipeline, state, _config, _args) => {
  const bookIds = await state.listBooks();
  const books = await Promise.all(
    bookIds.map(async (id) => {
      try {
        return await pipeline.getBookStatus(id);
      } catch {
        return { bookId: id, error: "failed to load" };
      }
    }),
  );
  return JSON.stringify(books);
};

const writeFullPipelineHandler: RegisteredTool["handler"] = async (pipeline, state, _config, args) => {
  const bookId = args.bookId as string;
  const writeGuardError = await getSequentialWriteGuardError(state, bookId, "write_full_pipeline");
  if (writeGuardError) {
    return JSON.stringify({ error: writeGuardError });
  }
  const count = (args.count as number) ?? 1;
  const results = [];
  for (let i = 0; i < count; i++) {
    const result = await pipeline.writeNextChapter(bookId);
    results.push(result);
  }
  return JSON.stringify(results);
};

const webFetchHandler: RegisteredTool["handler"] = async (_pipeline, _state, _config, args) => {
  const { fetchUrl } = await import("../utils/web-search.js");
  const text = await fetchUrl(args.url as string, (args.maxChars as number) ?? 8000);
  return JSON.stringify({ url: args.url, content: text });
};

const importStyleHandler: RegisteredTool["handler"] = async (pipeline, _state, _config, args) => {
  const guide = await pipeline.generateStyleGuide(
    args.bookId as string,
    args.referenceText as string,
  );
  return JSON.stringify({
    bookId: args.bookId,
    statsProfile: "story/style_profile.json",
    styleGuide: "story/style_guide.md",
    guidePreview: guide.slice(0, 500),
  });
};

const importCanonHandler: RegisteredTool["handler"] = async (pipeline, _state, _config, args) => {
  const canon = await pipeline.importCanon(
    args.targetBookId as string,
    args.parentBookId as string,
  );
  return JSON.stringify({
    targetBookId: args.targetBookId,
    parentBookId: args.parentBookId,
    output: "story/parent_canon.md",
    canonPreview: canon.slice(0, 500),
  });
};

const importChaptersHandler: RegisteredTool["handler"] = async (pipeline, _state, _config, args) => {
  const { splitChapters } = await import("../utils/chapter-splitter.js");
  const chapters = splitChapters(
    args.text as string,
    args.splitPattern as string | undefined,
  );
  if (chapters.length === 0) {
    return JSON.stringify({ error: "No chapters found. Check text format or provide a splitPattern." });
  }
  if (chapters.length === 1) {
    return JSON.stringify({ error: "import_chapters 是整书重导工具，需要至少 2 个章节。如果只想补一章，请用 write_draft 续写或 revise_chapter 修订。" });
  }
  const result = await pipeline.importChapters({
    bookId: args.bookId as string,
    chapters: [...chapters],
  });
  return JSON.stringify(result);
};

const writeTruthFileHandler: RegisteredTool["handler"] = async (_pipeline, _state, config, args) => {
  const bookId = args.bookId as string;
  const fileName = args.fileName as string;
  const content = args.content as string;

  const ALLOWED_FILES = [
    "story_bible.md", "volume_outline.md", "book_rules.md",
    "current_state.md", "particle_ledger.md", "pending_hooks.md",
    "chapter_summaries.md", "subplot_board.md", "emotional_arcs.md",
    "character_matrix.md", "style_guide.md",
  ];

  if (!ALLOWED_FILES.includes(fileName)) {
    return JSON.stringify({ error: `不允许修改文件 "${fileName}"。允许的文件：${ALLOWED_FILES.join(", ")}` });
  }

  if (fileName === "current_state.md" && containsProgressManipulation(content)) {
    return JSON.stringify({ error: "不允许通过 write_truth_file 修改 current_state.md 中的章节进度。章节进度由系统自动管理。" });
  }

  const { writeFile, mkdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const bookDir = new (await import("../state/manager.js")).StateManager(config.projectRoot).bookDir(bookId);
  const storyDir = join(bookDir, "story");
  await mkdir(storyDir, { recursive: true });
  await writeFile(join(storyDir, fileName), content, "utf-8");

  return JSON.stringify({
    bookId,
    file: `story/${fileName}`,
    written: true,
    size: content.length,
  });
};

// --- 注册所有内置工具 ---

export const BUILTIN_TOOLS: RegisteredTool[] = [
  { definition: TOOL_DEFINITIONS[0]!, handler: planChapterHandler },
  { definition: TOOL_DEFINITIONS[1]!, handler: composeChapterHandler },
  { definition: TOOL_DEFINITIONS[2]!, handler: writeDraftHandler },
  { definition: TOOL_DEFINITIONS[3]!, handler: auditChapterHandler },
  { definition: TOOL_DEFINITIONS[4]!, handler: reviseChapterHandler },
  { definition: TOOL_DEFINITIONS[5]!, handler: scanMarketHandler },
  { definition: TOOL_DEFINITIONS[6]!, handler: createBookHandler },
  { definition: TOOL_DEFINITIONS[7]!, handler: getBookStatusHandler },
  { definition: TOOL_DEFINITIONS[8]!, handler: updateAuthorIntentHandler },
  { definition: TOOL_DEFINITIONS[9]!, handler: updateCurrentFocusHandler },
  { definition: TOOL_DEFINITIONS[10]!, handler: readTruthFilesHandler },
  { definition: TOOL_DEFINITIONS[11]!, handler: listBooksHandler },
  { definition: TOOL_DEFINITIONS[12]!, handler: writeFullPipelineHandler },
  { definition: TOOL_DEFINITIONS[13]!, handler: webFetchHandler },
  { definition: TOOL_DEFINITIONS[14]!, handler: importStyleHandler },
  { definition: TOOL_DEFINITIONS[15]!, handler: importCanonHandler },
  { definition: TOOL_DEFINITIONS[16]!, handler: importChaptersHandler },
  { definition: TOOL_DEFINITIONS[17]!, handler: writeTruthFileHandler },
];

