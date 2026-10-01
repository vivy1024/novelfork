/**
 * 构建时脚本：扫描 docs/learning/ 的两条教程线，生成
 * packages/novel-plugin/src/learning-contribution.generated.ts（接进 Runtime 学习中心）。
 *
 * 目录即分类：
 *   docs/learning/book/   「用 NovelFork 写书」——按作者任务讲功能
 *   docs/learning/craft/  「网文写作课」——讲写作本身，每课末尾链到练习它的功能
 * 文档 id = <目录>-<去掉序号的文件名>，例如 book/04-write-next-chapter.md → book-write-next-chapter。
 * 目录前缀保证不与 Runtime 自带文档（overview、skills 等）重名；重名的贡献文档会被 Runtime 静默丢弃。
 *
 * Frontmatter：
 *   title / summary 必填；tags: [a, b]；routes 每行一个入口，可带按钮文字：
 *     routes:
 *       - /next/books | 打开「我的作品」
 *       - /next/learn?doc=book-style-preset | 教程：文风预设
 *   入口必须以 /next 开头、不能带 :bookId 这类占位符；/next/learn?doc=<id> 必须指向存在的文档。
 *
 * 正文按「## 标题」切节。以下标题有固定去处，其余都是普通小节：
 *   推荐使用流程 → workflow（有序列表）；最佳实践 → bestPractices；
 *   常见坑 / 常见问题 / 常见毛病 → pitfalls；Agent 查阅提示 → agentHints；可跳转功能入口 → 忽略（用 routes）。
 * 学习中心把小节正文当纯文本显示（不渲染 Markdown、不保留换行），所以这里会去掉强调、代码、链接标记，
 * 表格行转成「列一：列二。」，列表项转成「・」开头。超出上限直接报错，不静默截断。
 *
 * 用法：bun scripts/generate-learning-contribution.ts
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const LEARNING_DIR = join(import.meta.dir, "../docs/learning");
const OUTPUT = join(import.meta.dir, "../packages/novel-plugin/src/learning-contribution.generated.ts");

/** 两条线：目录名、分类 id、分类名、分类说明。顺序即学习中心里的顺序。 */
const LINES = [
  {
    dir: "book",
    category: "novelfork-book",
    label: "用 NovelFork 写书",
    description: "按写书的顺序讲每个功能：这一步解决什么问题、在哪里点、结果去哪里、常见问题。",
  },
  {
    dir: "craft",
    category: "novelfork-craft",
    label: "网文写作课",
    description: "讲写作本身：开篇、人物、冲突、节奏、伏笔、对话、描写、去 AI 味、长篇连贯、改稿。每课末尾告诉你在 NovelFork 里怎么练。",
  },
] as const;

/** 小节数与单节字数上限：学习中心一页读得完。超了说明该拆文档，而不是截断。 */
const MAX_SECTIONS = 8;
const MAX_SECTION_CHARS = 1200;
const DEFAULT_ACTION_LABEL = "前往";

interface DocFrontmatter {
  title: string;
  summary: string;
  tags: string[];
  routes: string[];
}

interface DocAction {
  href: string;
  label: string;
}

interface ParsedDoc {
  id: string;
  file: string;
  category: string;
  frontmatter: DocFrontmatter;
  sections: { title: string; body: string }[];
  workflow: string[];
  bestPractices: string[];
  pitfalls: string[];
  agentHints: string[];
  actions: DocAction[];
}

function parseFrontmatter(raw: string): { frontmatter: DocFrontmatter; body: string } {
  const normalized = raw.replace(/\r\n?/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: { title: "", summary: "", tags: [], routes: [] }, body: normalized };
  const yamlBlock = match[1];
  const body = match[2];
  const fm: Record<string, unknown> = {};
  let lastKey: string | undefined;
  for (const line of yamlBlock.split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) {
      const [, key, val] = kv;
      lastKey = key;
      if (val.startsWith("[")) {
        fm[key] = val.slice(1, -1).split(",")
          .map(s => s.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
      } else if (val.trim()) {
        fm[key] = val.trim();
      } else {
        fm[key] = [];
      }
    } else if (line.startsWith("  - ") && lastKey) {
      if (!Array.isArray(fm[lastKey])) fm[lastKey] = [];
      (fm[lastKey] as string[]).push(line.slice(4).trim());
    }
  }
  return {
    frontmatter: {
      title: String(fm.title ?? ""),
      summary: String(fm.summary ?? ""),
      tags: Array.isArray(fm.tags) ? fm.tags : [],
      routes: Array.isArray(fm.routes) ? fm.routes : [],
    },
    body,
  };
}

/** 行内 Markdown → 纯文本：去强调、代码、链接与图片标记。 */
function inlinePlain(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

const LIST_ITEM = /^(?:[-*]|\d+[.、])\s+/;
const TABLE_SEPARATOR = /^\|[\s:|-]+\|?$/;

function endWithPunctuation(text: string): string {
  return /[。！？；：…）」』”.!?;:)]$/u.test(text) ? text : `${text}。`;
}

/** 一段 Markdown → 学习中心能读的纯文本（换行会被折叠，所以每行自带句末标点）。 */
function toPlainText(markdown: string): string {
  const out: string[] = [];
  let inTable = false;
  let tableHeaderSkipped = false;
  for (const rawLine of markdown.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("```")) continue;
    if (line.startsWith("|")) {
      if (!inTable) { inTable = true; tableHeaderSkipped = false; }
      if (TABLE_SEPARATOR.test(line)) continue;
      if (!tableHeaderSkipped) { tableHeaderSkipped = true; continue; }
      const cells = line.split("|").map(cell => inlinePlain(cell)).filter(Boolean);
      if (cells.length === 0) continue;
      const [head, ...rest] = cells;
      out.push(endWithPunctuation(rest.length > 0 ? `${head}：${rest.join("，")}` : head));
      continue;
    }
    inTable = false;
    if (!line) { out.push(""); continue; }
    const heading = line.match(/^#{3,6}\s+(.+)$/);
    if (heading) { out.push(`【${inlinePlain(heading[1])}】`); continue; }
    const quote = line.replace(/^>\s?/, "");
    const bullet = quote.match(/^[-*]\s+(.+)$/);
    if (bullet) { out.push(`・${inlinePlain(bullet[1])}`); continue; }
    out.push(inlinePlain(quote));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractListItems(text: string): string[] {
  return text.split("\n")
    .map(line => line.trim())
    .filter(line => LIST_ITEM.test(line))
    .map(line => inlinePlain(line.replace(LIST_ITEM, "")));
}

function extractTableRows(text: string): string[] {
  return toPlainText(text).split("\n").map(line => line.trim()).filter(Boolean);
}

const PITFALL_TITLES = new Set(["常见坑", "常见问题", "常见毛病"]);

function parseRoute(route: string): DocAction {
  const separator = route.indexOf("|");
  const href = (separator >= 0 ? route.slice(0, separator) : route).trim();
  const label = separator >= 0 ? route.slice(separator + 1).trim() : "";
  return { href, label: label || DEFAULT_ACTION_LABEL };
}

function parseMarkdownDoc(dir: string, category: string, filename: string, raw: string): ParsedDoc {
  const { frontmatter, body } = parseFrontmatter(raw);
  const id = `${dir}-${basename(filename, ".md").replace(/^\d+-/, "")}`;

  const sectionRegex = /^## (.+)$/gm;
  const sectionParts: { title: string; content: string }[] = [];
  let lastIndex = 0;
  let lastTitle = "";
  let m: RegExpExecArray | null;
  while ((m = sectionRegex.exec(body)) !== null) {
    if (lastTitle) sectionParts.push({ title: lastTitle, content: body.slice(lastIndex, m.index).trim() });
    lastTitle = m[1];
    lastIndex = m.index + m[0].length;
  }
  if (lastTitle) sectionParts.push({ title: lastTitle, content: body.slice(lastIndex).trim() });

  const doc: ParsedDoc = {
    id,
    file: `${dir}/${filename}`,
    category,
    frontmatter,
    sections: [],
    workflow: [],
    bestPractices: [],
    pitfalls: [],
    agentHints: [],
    actions: frontmatter.routes.map(parseRoute),
  };

  for (const part of sectionParts) {
    const t = part.title.trim();
    if (t === "推荐使用流程") { doc.workflow.push(...extractListItems(part.content)); continue; }
    if (t === "最佳实践") { doc.bestPractices.push(...extractListItems(part.content)); continue; }
    if (PITFALL_TITLES.has(t)) {
      const items = extractListItems(part.content);
      doc.pitfalls.push(...(items.length > 0 ? items : extractTableRows(part.content)));
      continue;
    }
    if (t === "Agent 查阅提示") { doc.agentHints.push(...extractListItems(part.content)); continue; }
    if (t === "可跳转功能入口") continue;
    doc.sections.push({ title: t, body: toPlainText(part.content) });
  }
  return doc;
}

function collectDocs(): ParsedDoc[] {
  const problems: string[] = [];
  for (const entry of readdirSync(LEARNING_DIR)) {
    const full = join(LEARNING_DIR, entry);
    if (statSync(full).isFile() && entry.endsWith(".md") && entry !== "README.md") {
      problems.push(`docs/learning/${entry}：教程要放进 ${LINES.map(line => `${line.dir}/`).join(" 或 ")}，否则不会进学习中心。`);
    }
  }

  const docs = LINES.flatMap(line =>
    readdirSync(join(LEARNING_DIR, line.dir))
      .filter(file => file.endsWith(".md"))
      .sort()
      .map(file => parseMarkdownDoc(line.dir, line.category, file, readFileSync(join(LEARNING_DIR, line.dir, file), "utf8"))),
  );

  const ids = new Set<string>();
  for (const doc of docs) {
    if (ids.has(doc.id)) problems.push(`${doc.file}：文档 id「${doc.id}」重复。`);
    ids.add(doc.id);
  }
  for (const doc of docs) {
    const where = doc.file;
    if (!doc.frontmatter.title.trim()) problems.push(`${where}：缺 title。`);
    if (!doc.frontmatter.summary.trim()) problems.push(`${where}：缺 summary。`);
    if (doc.sections.length === 0) problems.push(`${where}：没有正文小节。`);
    if (doc.sections.length > MAX_SECTIONS) problems.push(`${where}：普通小节 ${doc.sections.length} 个，超过 ${MAX_SECTIONS} 个，请拆分文档。`);
    for (const section of doc.sections) {
      if (section.body.length > MAX_SECTION_CHARS) {
        problems.push(`${where}「${section.title}」：${section.body.length} 字，超过 ${MAX_SECTION_CHARS} 字，请拆成两节或改用列表小节。`);
      }
    }
    for (const action of doc.actions) {
      if (!action.href.startsWith("/next")) problems.push(`${where}：入口 ${action.href} 必须以 /next 开头。`);
      if (/\/:[A-Za-z]/.test(action.href)) problems.push(`${where}：入口 ${action.href} 带占位符，点了打不开。`);
      const docLink = action.href.match(/^\/next\/learn\?doc=([^&#]+)/);
      if (docLink && !ids.has(docLink[1])) problems.push(`${where}：入口 ${action.href} 指向不存在的文档。`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`学习文档有 ${problems.length} 处问题：\n${problems.map(p => `  - ${p}`).join("\n")}`);
  }
  return docs;
}

function escapeStr(s: string): string {
  return JSON.stringify(s);
}

function generateOutput(docs: ParsedDoc[]): string {
  const lines: string[] = [
    `// Auto-generated from docs/learning/{book,craft}/*.md — do not edit manually.`,
    `// Run: bun scripts/generate-learning-contribution.ts`,
    `import type { RuntimeLearningContribution } from "@vivy1024/novelfork-core/plugins";`,
    ``,
    `const t = (zh: string) => ({ en: zh, "zh-CN": zh });`,
    ``,
    `export const GENERATED_LEARNING_CONTRIBUTION: RuntimeLearningContribution = {`,
    `  categories: [`,
    ...LINES.map(line => `    { id: ${escapeStr(line.category)}, label: t(${escapeStr(line.label)}), description: t(${escapeStr(line.description)}) },`),
    `  ],`,
    `  docs: [`,
  ];

  for (const doc of docs) {
    lines.push(`    {`);
    lines.push(`      id: ${escapeStr(doc.id)},`);
    lines.push(`      category: ${escapeStr(doc.category)},`);
    lines.push(`      tags: ${JSON.stringify(doc.frontmatter.tags)},`);
    lines.push(`      title: t(${escapeStr(doc.frontmatter.title)}),`);
    lines.push(`      summary: t(${escapeStr(doc.frontmatter.summary)}),`);
    lines.push(`      sections: [`);
    for (const s of doc.sections) {
      lines.push(`        { title: t(${escapeStr(s.title)}), body: t(${escapeStr(s.body)}) },`);
    }
    lines.push(`      ],`);
    lines.push(`      workflow: [${doc.workflow.map(w => `t(${escapeStr(w)})`).join(", ")}],`);
    lines.push(`      bestPractices: [${doc.bestPractices.map(b => `t(${escapeStr(b)})`).join(", ")}],`);
    lines.push(`      pitfalls: [${doc.pitfalls.map(p => `t(${escapeStr(p)})`).join(", ")}],`);
    lines.push(`      agentHints: [${doc.agentHints.map(h => `t(${escapeStr(h)})`).join(", ")}],`);
    lines.push(`      actions: [`);
    for (const action of doc.actions) {
      lines.push(`        { label: t(${escapeStr(action.label)}), description: t(${escapeStr(action.label)}), href: ${escapeStr(action.href)} },`);
    }
    lines.push(`      ],`);
    lines.push(`    },`);
  }

  lines.push(`  ],`);
  lines.push(`};`);
  lines.push(``);
  return lines.join("\n");
}

const docs = collectDocs();
writeFileSync(OUTPUT, generateOutput(docs), "utf8");
console.log(`✓ Generated ${OUTPUT} (${docs.length} docs: ${LINES.map(line => `${line.dir} ${docs.filter(doc => doc.category === line.category).length}`).join(", ")})`);
