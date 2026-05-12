/**
 * 学习中心 API — 提供文档列表、搜索和内容获取
 * 同时作为 AI Agent 的内部检索工具
 */

import { Hono } from "hono";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

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

// ── 文档元数据（分类+标签） ──

const DOC_CATALOG: LearningDocMeta[] = [
  { id: "00-overview", title: "一页理解 NovelFork", summary: "核心心智模型、三栏布局、推荐使用流程", tags: ["入门", "概览", "工作流"], category: "从这里开始" },
  { id: "01-book-management", title: "作品与章节管理", summary: "创建作品、资源树、章节 CRUD、驾驶舱、导入导出", tags: ["作品", "章节", "管理", "导入导出"], category: "从这里开始" },
  { id: "02-ai-writing", title: "AI 写作功能", summary: "写作模式、AI 动作、选区变换、候选稿流程", tags: ["AI", "写作", "候选稿", "模式"], category: "AI 写作" },
  { id: "03-guided-generation", title: "引导式生成", summary: "PGI 追问、Guided Plan、问卷引导", tags: ["PGI", "引导", "生成", "计划"], category: "AI 写作" },
  { id: "04-narrator-conversation", title: "叙述者对话", summary: "会话界面、模型切换、权限、Slash 命令、确认门", tags: ["对话", "叙述者", "会话", "权限"], category: "AI 写作" },
  { id: "08-agent-pipeline", title: "Agent 写作管线", summary: "PipelineRunner、Agent 角色、工具链、编排", tags: ["Agent", "管线", "编排", "工具链"], category: "AI 写作" },
  { id: "05-story-jingwei", title: "故事经纬", summary: "分区/条目、可见性规则、模板、AI 上下文参与", tags: ["经纬", "设定", "世界观", "模板"], category: "工具与分析" },
  { id: "07-writing-tools", title: "写作工具", summary: "钩子、节奏、对话比例、健康、矛盾、弧线、文风", tags: ["工具", "分析", "检测", "健康度"], category: "工具与分析" },
  { id: "06-settings-and-routines", title: "设置与套路", summary: "供应商配置、套路系统、继承机制", tags: ["设置", "套路", "配置", "供应商"], category: "设置与配置" },
  { id: "09-agent-settings", title: "AI 代理配置", summary: "权限模式、上下文窗口管理、重试策略、白黑名单、调试选项", tags: ["AI代理", "权限", "上下文", "重试", "白名单", "调试"], category: "设置与配置" },
  { id: "10-proxy-settings", title: "代理管理与网络配置", summary: "HTTP/SOCKS 代理配置、按供应商独立代理、Sub2API 网关集成", tags: ["代理", "网络", "proxy", "Sub2API"], category: "设置与配置" },
  { id: "11-usage-history", title: "使用历史与成本监控", summary: "请求趋势图、筛选器、请求明细表、Token 用量分析、成本追踪", tags: ["使用历史", "Token", "成本", "趋势", "监控"], category: "设置与配置" },
  { id: "12-appearance", title: "外观与个性化", summary: "主题模式、OLED纯黑、终端配置、字体、动画、语言设置", tags: ["外观", "主题", "OLED", "终端", "字体"], category: "设置与配置" },
];

const CATEGORIES = ["从这里开始", "AI 写作", "工具与分析", "设置与配置"];

// ── 文件加载 ──

function getLearningDocsDir(): string {
  // 从项目根目录的 docs/learning/ 加载
  return resolve(process.cwd(), "docs", "learning");
}

async function loadDocContent(docId: string): Promise<string | null> {
  try {
    const filePath = join(getLearningDocsDir(), `${docId}.md`);
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

// ── 搜索逻辑 ──

function searchDocs(query: string): LearningDocMeta[] {
  const q = query.toLowerCase().trim();
  if (!q) return DOC_CATALOG;

  return DOC_CATALOG.filter((doc) => {
    const haystack = [doc.title, doc.summary, ...doc.tags, doc.category].join(" ").toLowerCase();
    // 支持多词搜索（AND 逻辑）
    const terms = q.split(/\s+/);
    return terms.every((term) => haystack.includes(term));
  });
}

// ── Router ──

export function createLearningRouter() {
  const app = new Hono();

  // GET /learn/docs — 列出所有文档（按分类分组）
  app.get("/docs", (c) => {
    const grouped = CATEGORIES.map((category) => ({
      category,
      docs: DOC_CATALOG.filter((d) => d.category === category).map(({ id, title, summary, tags }) => ({ id, title, summary, tags })),
    }));
    return c.json({ categories: grouped, total: DOC_CATALOG.length });
  });

  // GET /learn/search?q=xxx — 搜索文档
  app.get("/search", (c) => {
    const query = c.req.query("q") || "";
    const results = searchDocs(query);
    return c.json({
      query,
      results: results.map(({ id, title, summary, tags, category }) => ({ id, title, summary, tags, category })),
      total: results.length,
    });
  });

  // GET /learn/doc/:id — 获取单篇文档内容
  app.get("/doc/:id", async (c) => {
    const docId = c.req.param("id");
    const meta = DOC_CATALOG.find((d) => d.id === docId);
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
  const results = searchDocs(query);
  return results.slice(0, 5).map((doc) => ({
    id: doc.id,
    title: doc.title,
    summary: doc.summary,
    relevance: doc.tags.join(", "),
  }));
}

export async function agentGetLearningDoc(docId: string): Promise<{ title: string; content: string } | null> {
  const meta = DOC_CATALOG.find((d) => d.id === docId);
  if (!meta) return null;
  const content = await loadDocContent(docId);
  return {
    title: meta.title,
    content: content ?? `# ${meta.title}\n\n${meta.summary}`,
  };
}
