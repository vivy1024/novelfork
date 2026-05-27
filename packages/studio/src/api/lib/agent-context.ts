/**
 * Agent 写作上下文构建
 * 根据 bookId 聚合当前作品的关键状态信息，注入到 Agent 的 system prompt 中。
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BookDetail } from "../../shared/contracts.js";
import { StateManager } from "@vivy1024/novelfork-core";
import { resolveRuntimeStoragePath } from "./runtime-storage-paths.js";

// --- Project Awareness Context (auto-read key project files) ---

const PROJECT_AWARENESS_FILES = [
  { path: "CLAUDE.md", label: "项目指令", maxChars: 4000 },
  { path: "AGENTS.md", label: "Agent 指令", maxChars: 2000 },
  { path: ".kiro/steering/README.md", label: "Steering", maxChars: 2000 },
] as const;

/**
 * Auto-discover project context files for the agent.
 * Reads: CLAUDE.md, AGENTS.md, .kiro/steering/README.md
 * Returns a context string to prepend to the system prompt.
 */
export async function buildProjectAwarenessContext(workDir: string): Promise<string> {
  const sections: string[] = [];

  const reads = PROJECT_AWARENESS_FILES.map(async ({ path, label, maxChars }) => {
    const fullPath = join(workDir, path);
    if (!existsSync(fullPath)) return null;
    try {
      let content = await readFile(fullPath, "utf-8");
      if (content.length > maxChars) {
        content = content.slice(0, maxChars) + "\n\n[... 已截断]";
      }
      return { label, content };
    } catch {
      return null;
    }
  });

  const results = await Promise.all(reads);
  for (const result of results) {
    if (result) {
      sections.push(`<${result.label}>\n${result.content}\n</${result.label}>`);
    }
  }

  return sections.length > 0 ? sections.join("\n\n") : "";
}

function getProjectRoot(): string {
  return process.env.NOVELFORK_PROJECT_ROOT || resolveRuntimeStoragePath();
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

  // 基本信息 — bookId 必须明确告知 agent，避免从路径推断
  lines.push(`- bookId：${input.book.id}`);
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
 *
 * P0: 使用完整的 buildJingweiContext（global/tracked/nested + 时间轴 + 优先级 + token 预算）
 * P1: 注入 Chapter Briefing + 递归摘要
 */
export async function buildAgentContext(params: {
  bookId: string;
  book?: BookDetail;
  /** 最近用户消息内容，用于 tracked 条目的关键词匹配 */
  sceneText?: string;
  /** 模型上下文窗口大小（tokens），用于动态调整 token 预算 */
  modelContextWindow?: number;
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
  /** 经纬核心设定（传入时跳过自动加载） */
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

  // --- P0: 完整经纬注入（替代粗暴 SQL） ---
  // 使用 buildJingweiBrief：核心包 + 分类目录（默认 4000 tokens）
  if (params.jingwei?.sections?.length) {
    // 如果外部传入了 jingwei sections，直接使用（兼容旧调用方式）
    const jwLines: string[] = ["", "### 经纬核心设定"];
    for (const section of params.jingwei.sections.slice(0, 5)) {
      jwLines.push(`- **${section.name}**`);
      for (const entry of section.entries.slice(0, 5)) {
        const value = entry.value.length > 80 ? entry.value.slice(0, 80) + "..." : entry.value;
        jwLines.push(`  - ${entry.key}：${value}`);
      }
    }
    extraBlocks.push(jwLines.join("\n"));
  } else {
    // 自动从 SQLite 加载：使用核心包 + 目录协议（替代旧全量注入）
    try {
      const { buildJingweiBrief, buildChapterBriefing, buildRecursiveSummaryContext } =
        await import("@vivy1024/novelfork-novel-plugin/engine");

      const currentChapter = book.chapterCount ?? 1;

      // 经纬核心包（默认 4000 tokens，大窗口可适当放大但不超 8000）
      const modelWindow = params.modelContextWindow ?? 200_000;
      const jingweiBudget = modelWindow >= 500_000 ? 8_000 : 4_000;

      const briefResult = await buildJingweiBrief({
        bookId: params.bookId,
        chapterNumber: currentChapter,
        sceneText: params.sceneText,
        tokenBudget: jingweiBudget,
      });

      if (briefResult.coreBrief.length > 0) {
        const jwLines: string[] = ["", "### 经纬核心包"];
        for (const item of briefResult.coreBrief) {
          jwLines.push(`【${item.sectionName}】${item.title}：${item.summaryMd}`);
        }

        // 附加分类目录摘要，让模型知道可以补读
        if (briefResult.index.categories.length > 0) {
          jwLines.push("");
          jwLines.push("### 经纬分类目录（可按需调用 jingwei.read_category 读取细节）");
          for (const cat of briefResult.index.categories.slice(0, 10)) {
            jwLines.push(`- ${cat.title}：${cat.count} 条（约 ${cat.estimatedTokens} tokens）`);
          }
        }

        if (briefResult.droppedEntryIds.length > 0) {
          jwLines.push(`\n（因预算限制，${briefResult.droppedEntryIds.length} 条低优先级条目未注入核心包。如需详细信息，调用 jingwei.read_category 或 jingwei.search）`);
        }
        extraBlocks.push(jwLines.join("\n"));
      }

      // P1: Chapter Briefing（活跃角色/伏笔/硬约束）
      try {
        const briefing = await buildChapterBriefing(params.bookId, currentChapter);
        if (briefing?.trim()) {
          extraBlocks.push(`\n${briefing}`);
        }
      } catch { /* non-fatal */ }

      // P1: 递归摘要（卷摘要 + 近 5 章摘要）
      try {
        const summaryContext = await buildRecursiveSummaryContext(params.bookId, currentChapter);
        if (summaryContext?.trim()) {
          extraBlocks.push(`\n### 章节摘要\n${summaryContext}`);
        }
      } catch { /* non-fatal */ }

      // 大窗口模式不再注入前一章全文（防止 token 膨胀）
      // 模型如需前一章内容，应通过 chapter.read 工具按需读取

    } catch {
      // buildJingweiBrief 不可用时的 fallback：保持基本信息
    }
  }

  return extraBlocks.length > 0 ? `${baseContext}\n${extraBlocks.join("\n")}` : baseContext;
}
