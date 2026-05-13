/**
 * Agent 写作上下文构建
 * 根据 bookId 聚合当前作品的关键状态信息，注入到 Agent 的 system prompt 中。
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BookDetail } from "../../shared/contracts.js";
import { StateManager } from "@vivy1024/novelfork-core";

function getProjectRoot(): string {
  return process.env.NOVELFORK_PROJECT_ROOT || process.cwd();
}

// --- Phase 4.2: Project Rules File Support ---

const PROJECT_RULES_CANDIDATES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
] as const;

const PROJECT_RULES_MAX_CHARS = 2000;

/**
 * 检测并加载项目规则文件（AGENTS.md / CLAUDE.md / .cursorrules 等）。
 * 按优先级返回第一个找到的文件内容（截断到 2000 字符）。
 */
export async function loadProjectRulesFile(workDir: string): Promise<string | null> {
  for (const name of PROJECT_RULES_CANDIDATES) {
    const filePath = join(workDir, name);
    try {
      if (existsSync(filePath)) {
        const content = await readFile(filePath, "utf-8");
        if (content.trim()) {
          return content.slice(0, PROJECT_RULES_MAX_CHARS);
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

// --- Phase 4.1: Project Info (package.json) ---

const PROJECT_INFO_MAX_CHARS = 500;

interface ProjectInfo {
  name?: string;
  description?: string;
  scripts?: Record<string, string>;
}

/**
 * 从 package.json 加载项目基本信息（名称、描述、脚本列表）。
 */
export async function loadProjectInfo(workDir: string): Promise<string | null> {
  const pkgPath = join(workDir, "package.json");
  try {
    if (!existsSync(pkgPath)) return null;
    const raw = await readFile(pkgPath, "utf-8");
    const pkg: ProjectInfo = JSON.parse(raw);
    const lines: string[] = [];
    if (pkg.name) lines.push(`- 项目名称：${pkg.name}`);
    if (pkg.description) lines.push(`- 描述：${pkg.description}`);
    if (pkg.scripts && Object.keys(pkg.scripts).length > 0) {
      const scriptEntries = Object.entries(pkg.scripts).slice(0, 10);
      lines.push(`- 脚本：${scriptEntries.map(([k]) => k).join(", ")}`);
    }
    if (lines.length === 0) return null;
    const result = lines.join("\n");
    return result.slice(0, PROJECT_INFO_MAX_CHARS);
  } catch {
    return null;
  }
}

/**
 * 构建项目探索上下文块（规则文件 + package.json 信息）。
 * 用于注入到 Agent 的 runtime context 中。
 */
export async function buildProjectExplorationContext(workDir: string): Promise<string> {
  const [rulesContent, projectInfo] = await Promise.all([
    loadProjectRulesFile(workDir),
    loadProjectInfo(workDir),
  ]);

  const blocks: string[] = [];

  if (projectInfo) {
    blocks.push(`## 项目信息\n\n${projectInfo}`);
  }

  if (rulesContent) {
    blocks.push(`## 项目规则\n\n${rulesContent}`);
  }

  return blocks.join("\n\n");
}

interface ContextInput {
  book: {
    id: string;
    title: string;
    genre?: string;
    platform?: string;
    chapterCount: number;
    targetChapters?: number;
  };
  chapterSummaries: Array<{ number: number; summary?: string }>;
  pendingHooks: string;
  currentFocus: string | null;
  auditIssues: Array<{ chapterNumber: number; count: number }>;
}

interface BuildContextResult {
  /** 注入到 system prompt 末尾的上下文字符串 */
  contextBlock: string;
  /** 上下文是否为空（书籍没有任何数据） */
  isEmpty: boolean;
}

export function buildBookContextBlock(input: ContextInput): BuildContextResult {
  const lines: string[] = [];

  // 基本信息
  lines.push(`- 作品：${input.book.title}`);
  if (input.book.genre) lines.push(`- 题材：${input.book.genre}`);
  if (input.book.platform) lines.push(`- 平台：${input.book.platform}`);
  const targetStr = input.book.targetChapters
    ? `${input.book.chapterCount}/${input.book.targetChapters}`
    : `${input.book.chapterCount}`;
  lines.push(`- 章节进度：${targetStr} 章`);

  // 当前焦点
  const focus = input.currentFocus?.trim();
  if (focus) {
    lines.push("");
    lines.push("### 当前焦点");
    lines.push(focus.length > 500 ? focus.slice(0, 500) + "..." : focus);
  }

  // 章节摘要
  const recentSummaries = input.chapterSummaries.slice(-3);
  if (recentSummaries.length > 0) {
    lines.push("");
    lines.push("### 最近章节摘要");
    for (const s of recentSummaries) {
      const summary = s.summary?.trim();
      if (summary) {
        lines.push(`- 第${s.number}章: ${summary.length > 120 ? summary.slice(0, 120) + "..." : summary}`);
      } else {
        lines.push(`- 第${s.number}章: （暂无摘要）`);
      }
    }
  }

  // 待回收伏笔
  const hooks = input.pendingHooks?.trim();
  if (hooks) {
    lines.push("");
    lines.push("### 待处理伏笔（pending_hooks.md 内容摘要）");
    // 只取前 1000 字符避免 token 过多
    lines.push(hooks.length > 1000 ? hooks.slice(0, 1000) + "..." : hooks);
  }

  // 审计问题
  const issues = input.auditIssues.filter((i) => i.count > 0);
  if (issues.length > 0) {
    lines.push("");
    lines.push("### 需要关注的审计问题");
    for (const issue of issues) {
      lines.push(`- 第${issue.chapterNumber}章: ${issue.count} 个审计问题`);
    }
  }

  const contextBlock = lines.join("\n");
  const isEmpty = lines.length <= 1; // 只有基本进度信息也算有上下文

  return { contextBlock, isEmpty };
}

/**
 * 从 Studio API 响应构建 Agent 上下文。
 * 当只传入 bookId 时，自动从存储加载书籍数据。
 */
export async function buildAgentContext(params: {
  bookId: string;
  book?: BookDetail;
  chapterSummaries?: Array<{ number: number; summary?: string }>;
  pendingHooks?: string;
  currentFocus?: string | null;
  auditIssues?: Array<{ chapterNumber: number; count: number }>;
  /** 叙事线快照：节点、边、警告 */
  narrativeLine?: {
    nodes?: Array<{ id: string; label: string; type?: string }>;
    warnings?: Array<{ message: string; severity?: string }>;
    openForeshadowing?: Array<{ id: string; description: string }>;
  };
  /** 经纬核心设定 */
  jingwei?: {
    sections?: Array<{ name: string; entries: Array<{ key: string; value: string }> }>;
  };
}): Promise<string> {
  let book = params.book;

  // 自动加载书籍数据
  if (!book && params.bookId) {
    try {
      const projectRoot = getProjectRoot();
      const state = new StateManager(projectRoot);
      const config = await state.loadBookConfig(params.bookId);
      const chapters = await state.loadChapterIndex(params.bookId).catch(() => []);
      book = {
        id: params.bookId,
        title: (config as { title?: string }).title ?? params.bookId,
        genre: (config as { genre?: string }).genre,
        platform: (config as { platform?: string }).platform,
        chapterCount: chapters.length,
        targetChapters: (config as { targetChapters?: number }).targetChapters,
      } as BookDetail;
    } catch {
      return "";
    }
  }

  if (!book) return "";

  const baseContext = buildBookContextBlock({
    book: {
      id: params.bookId,
      title: book.title,
      genre: book.genre,
      platform: book.platform,
      chapterCount: book.chapterCount,
      targetChapters: book.targetChapters,
    },
    chapterSummaries: params.chapterSummaries ?? [],
    pendingHooks: params.pendingHooks ?? "",
    currentFocus: params.currentFocus ?? null,
    auditIssues: params.auditIssues ?? [],
  }).contextBlock;

  const extraBlocks: string[] = [];

  // 叙事线注入
  if (params.narrativeLine) {
    const nl = params.narrativeLine;
    const nlLines: string[] = ["", "### 叙事线状态"];
    if (nl.nodes?.length) {
      nlLines.push(`- 节点数：${nl.nodes.length}`);
      const keyNodes = nl.nodes.slice(0, 5);
      for (const node of keyNodes) {
        nlLines.push(`  - [${node.type ?? "node"}] ${node.label}`);
      }
      if (nl.nodes.length > 5) nlLines.push(`  - ...（共 ${nl.nodes.length} 个节点）`);
    }
    if (nl.openForeshadowing?.length) {
      nlLines.push(`- 未回收伏笔：${nl.openForeshadowing.length} 个`);
      for (const f of nl.openForeshadowing.slice(0, 3)) {
        nlLines.push(`  - ${f.description}`);
      }
    }
    if (nl.warnings?.length) {
      nlLines.push(`- 叙事线警告：${nl.warnings.length} 个`);
      for (const w of nl.warnings.slice(0, 3)) {
        nlLines.push(`  - [${w.severity ?? "info"}] ${w.message}`);
      }
    }
    extraBlocks.push(nlLines.join("\n"));
  }

  // 经纬注入
  if (params.jingwei?.sections?.length) {
    const jwLines: string[] = ["", "### 经纬核心设定"];
    for (const section of params.jingwei.sections.slice(0, 5)) {
      jwLines.push(`- **${section.name}**`);
      for (const entry of section.entries.slice(0, 5)) {
        const value = entry.value.length > 80 ? entry.value.slice(0, 80) + "..." : entry.value;
        jwLines.push(`  - ${entry.key}：${value}`);
      }
    }
    extraBlocks.push(jwLines.join("\n"));
  }

  return extraBlocks.length > 0 ? `${baseContext}\n${extraBlocks.join("\n")}` : baseContext;
}
