/**
 * 学习中心 API — 动态扫描 docs/learning/ 目录，提供文档列表、搜索和内容获取
 * 同时作为 AI Agent 的内部检索工具
 */

import { Hono } from "hono";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { resolveRuntimeStoragePath } from "../lib/runtime-storage-paths.js";

export interface LearningDoc {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  category: string;
  content?: string;
}

interface LearningDocMeta {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  category: string;
}

// ── 分类规则（根据文件名前缀） ──

const CATEGORIES = ["从这里开始", "AI 写作", "工具与分析", "设置与配置", "高级功能"] as const;

function classifyByPrefix(id: string): string {
  const num = parseInt(id.split("-")[0], 10);
  if (isNaN(num)) return "高级功能";
  if (num <= 1) return "从这里开始";
  if (num <= 4 || num === 8) return "AI 写作";
  if (num === 5 || num === 7) return "工具与分析";
  if (num === 6 || (num >= 9 && num <= 12)) return "设置与配置";
  if (num >= 13) return "高级功能";
  return "高级功能";
}

// ── Frontmatter 解析 ──

function parseFrontmatter(content: string): { title: string; summary: string; tags: string[] } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { title: "", summary: "", tags: [] };
  const yaml = match[1];
  const title = yaml.match(/title:\s*(.+)/)?.[1]?.trim() ?? "";
  const summary = yaml.match(/summary:\s*(.+)/)?.[1]?.trim() ?? "";
  const tagsMatch = yaml.match(/tags:\s*\[([^\]]*)\]/);
  const tags = tagsMatch ? tagsMatch[1].split(",").map(t => t.trim().replace(/['"]/g, "")) : [];
  return { title, summary, tags };
}

// ── 文件路径解析（exe → ~/.novelfork → cwd） ──

function getLearningDocsDir(): string {
  // 1. exe 模式：execPath 同级 docs/learning/
  const exeDir = join(dirname(process.execPath), "docs", "learning");
  if (existsSync(exeDir)) return exeDir;

  // 2. 用户目录：~/.novelfork/docs/learning/
  const userDir = resolveRuntimeStoragePath("docs", "learning");
  if (existsSync(userDir)) return userDir;

  // 3. 开发模式：cwd/docs/learning/
  return join(process.cwd(), "docs", "learning");
}

// ── 动态扫描文档目录 ──

let cachedCatalog: LearningDocMeta[] | null = null;
let catalogLoadedAt = 0;
const CACHE_TTL = 60_000; // 1 分钟缓存

async function loadCatalog(): Promise<LearningDocMeta[]> {
  const now = Date.now();
  if (cachedCatalog && now - catalogLoadedAt < CACHE_TTL) {
    return cachedCatalog;
  }

  const docsDir = getLearningDocsDir();
  const catalog: LearningDocMeta[] = [];

  try {
    const files = await readdir(docsDir);
    const mdFiles = files.filter(f => f.endsWith(".md") && f !== "README.md").sort();

    for (const file of mdFiles) {
      const id = file.replace(/\.md$/, "");
      const filePath = join(docsDir, file);
      try {
        const content = await readFile(filePath, "utf-8");
        const { title, summary, tags } = parseFrontmatter(content);
        catalog.push({
          id,
          title: title || id,
          summary: summary || "",
          tags,
          category: classifyByPrefix(id),
        });
      } catch {
        // 单个文件读取失败，跳过
        catalog.push({
          id,
          title: id,
          summary: "",
          tags: [],
          category: classifyByPrefix(id),
        });
      }
    }
  } catch {
    // 目录不存在或不可读，返回空
  }

  cachedCatalog = catalog;
  catalogLoadedAt = now;
  return catalog;
}

// ── 文件加载 ──

async function loadDocContent(docId: string): Promise<string | null> {
  try {
    const filePath = join(getLearningDocsDir(), `${docId}.md`);
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

// ── 搜索逻辑 ──

async function searchDocs(query: string): Promise<LearningDocMeta[]> {
  const catalog = await loadCatalog();
  const q = query.toLowerCase().trim();
  if (!q) return catalog;

  return catalog.filter((doc) => {
    const haystack = [doc.title, doc.summary, ...doc.tags, doc.category].join(" ").toLowerCase();
    const terms = q.split(/\s+/);
    return terms.every((term) => haystack.includes(term));
  });
}

// ── Router ──

export function createLearningRouter() {
  const app = new Hono();

  // GET /learn/docs — 列出所有文档（按分类分组）
  app.get("/docs", async (c) => {
    const catalog = await loadCatalog();
    const grouped = CATEGORIES.map((category) => ({
      category,
      docs: catalog.filter((d) => d.category === category).map(({ id, title, summary, tags }) => ({ id, title, summary, tags })),
    })).filter(g => g.docs.length > 0);
    return c.json({ categories: grouped, total: catalog.length });
  });

  // GET /learn/search?q=xxx — 搜索文档
  app.get("/search", async (c) => {
    const query = c.req.query("q") || "";
    const results = await searchDocs(query);
    return c.json({
      query,
      results: results.map(({ id, title, summary, tags, category }) => ({ id, title, summary, tags, category })),
      total: results.length,
    });
  });

  // GET /learn/doc/:id — 获取单篇文档内容
  app.get("/doc/:id", async (c) => {
    const docId = c.req.param("id");
    const catalog = await loadCatalog();
    const meta = catalog.find((d) => d.id === docId);
    if (!meta) {
      return c.json({ error: "文档不存在" }, 404);
    }

    const content = await loadDocContent(docId);
    return c.json({
      ...meta,
      content: content ?? `# ${meta.title}\n\n${meta.summary}\n\n> 文档内容尚未编写。`,
    });
  });

  return app;
}

// ── Agent 内部检索接口（供 AI Agent 调用） ──

export async function agentSearchLearning(query: string): Promise<Array<{ id: string; title: string; summary: string; relevance: string }>> {
  const results = await searchDocs(query);
  return results.slice(0, 5).map((doc) => ({
    id: doc.id,
    title: doc.title,
    summary: doc.summary,
    relevance: doc.tags.join(", "),
  }));
}

export async function agentGetLearningDoc(docId: string): Promise<{ title: string; content: string } | null> {
  const catalog = await loadCatalog();
  const meta = catalog.find((d) => d.id === docId);
  if (!meta) return null;
  const content = await loadDocContent(docId);
  return {
    title: meta.title,
    content: content ?? `# ${meta.title}\n\n${meta.summary}`,
  };
}
