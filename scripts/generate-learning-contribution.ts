/**
 * 构建时脚本：扫描 docs/learning/*.md 并生成
 * packages/novel-plugin/src/learning-contribution.generated.ts
 *
 * 用法：bun scripts/generate-learning-contribution.ts
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";

const LEARNING_DIR = join(import.meta.dir, "../docs/learning");
const OUTPUT = join(import.meta.dir, "../packages/novel-plugin/src/learning-contribution.generated.ts");

/* PLACEHOLDER_MAIN */

interface DocFrontmatter {
  title: string;
  summary: string;
  tags: string[];
  routes: string[];
}

interface ParsedDoc {
  id: string;
  frontmatter: DocFrontmatter;
  sections: { title: string; body: string }[];
  workflow: string[];
  bestPractices: string[];
  pitfalls: string[];
  agentHints: string[];
}

function parseFrontmatter(raw: string): { frontmatter: DocFrontmatter; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: { title: "", summary: "", tags: [], routes: [] }, body: raw };
  const yamlBlock = match[1];
  const body = match[2];
  const fm: Record<string, unknown> = {};
  for (const line of yamlBlock.split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) {
      const [, key, val] = kv;
      if (val.startsWith("[")) {
        fm[key] = val.slice(1, -1).split(",").map(s => s.trim().replace(/^['"]|['"]$/g, ""));
      } else {
        fm[key] = val.trim();
      }
    } else if (line.startsWith("  - ")) {
      const lastKey = Object.keys(fm).pop();
      if (lastKey) {
        if (!Array.isArray(fm[lastKey])) fm[lastKey] = [];
        (fm[lastKey] as string[]).push(line.slice(4).trim());
      }
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

function extractListItems(text: string): string[] {
  return text.split("\n").filter(l => l.match(/^[-*]\s/)).map(l => l.replace(/^[-*]\s+/, "").trim());
}

function extractTableRows(text: string): string[] {
  return text.split("\n")
    .filter(l => l.startsWith("|") && !l.includes("---"))
    .slice(1) // skip header
    .map(l => l.split("|").filter(Boolean).map(c => c.trim()).join(" → "));
}

function parseMarkdownDoc(filename: string, raw: string): ParsedDoc {
  const { frontmatter, body } = parseFrontmatter(raw);
  const id = basename(filename, ".md").replace(/^\d+-/, "");

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

  const workflow: string[] = [];
  const bestPractices: string[] = [];
  const pitfalls: string[] = [];
  const agentHints: string[] = [];
  const sections: { title: string; body: string }[] = [];

  for (const part of sectionParts) {
    const t = part.title.trim();
    if (t === "推荐使用流程") { workflow.push(...extractListItems(part.content)); continue; }
    if (t === "最佳实践") { bestPractices.push(...extractListItems(part.content)); continue; }
    if (t === "常见坑") {
      const items = extractListItems(part.content);
      if (items.length) pitfalls.push(...items);
      else pitfalls.push(...extractTableRows(part.content));
      continue;
    }
    if (t === "Agent 查阅提示") { agentHints.push(...extractListItems(part.content)); continue; }
    if (t === "可跳转功能入口") continue; // skip, mapped to actions via routes
    sections.push({ title: t, body: part.content });
  }

  return { id, frontmatter, sections, workflow, bestPractices, pitfalls, agentHints };
}

// Category mapping based on filename prefix
function categoryForDoc(filename: string): string {
  const num = parseInt(basename(filename), 10);
  if (num <= 4) return "novelfork-writing";
  if (num <= 8) return "novelfork-context";
  if (num <= 18) return "novelfork-settings";
  return "novelfork-advanced";
}

function escapeStr(s: string): string {
  return JSON.stringify(s);
}

function generateOutput(docs: ParsedDoc[], filenames: string[]): string {
  const lines: string[] = [
    `// Auto-generated from docs/learning/*.md — do not edit manually.`,
    `// Run: bun scripts/generate-learning-contribution.ts`,
    `import type { RuntimeLearningContribution } from "@vivy1024/novelfork-core/plugins";`,
    ``,
    `const t = (zh: string) => ({ en: zh, "zh-CN": zh });`,
    ``,
    `export const GENERATED_LEARNING_CONTRIBUTION: RuntimeLearningContribution = {`,
    `  categories: [`,
    `    { id: "novelfork-writing", label: t("NovelFork 写作"), description: t("创建作品、书籍管理、写作管线与叙述者协作。") },`,
    `    { id: "novelfork-context", label: t("NovelFork 设定与记忆"), description: t("经纬/Lore、叙事记忆、写作分析工具与 Agent 管线。") },`,
    `    { id: "novelfork-settings", label: t("NovelFork 设置与管理"), description: t("AI 供应商、套路、代理、安全、终端与运行环境配置。") },`,
    `    { id: "novelfork-advanced", label: t("NovelFork 进阶"), description: t("子代理、模型配置、调试、写作规范与平台合规。") },`,
    `  ],`,
    `  docs: [`,
  ];

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const category = categoryForDoc(filenames[i]);
    const actions = doc.frontmatter.routes.map(r => `      { label: t("前往"), description: t(${escapeStr(r)}), href: ${escapeStr(r)} },`);

    lines.push(`    {`);
    lines.push(`      id: ${escapeStr(doc.id)},`);
    lines.push(`      category: ${escapeStr(category)},`);
    lines.push(`      tags: ${JSON.stringify(doc.frontmatter.tags)},`);
    lines.push(`      title: t(${escapeStr(doc.frontmatter.title)}),`);
    lines.push(`      summary: t(${escapeStr(doc.frontmatter.summary)}),`);
    lines.push(`      sections: [`);
    for (const s of doc.sections.slice(0, 6)) {
      lines.push(`        { title: t(${escapeStr(s.title)}), body: t(${escapeStr(s.body.slice(0, 800))}) },`);
    }
    lines.push(`      ],`);
    lines.push(`      workflow: [${doc.workflow.map(w => `t(${escapeStr(w)})`).join(", ")}],`);
    lines.push(`      bestPractices: [${doc.bestPractices.map(b => `t(${escapeStr(b)})`).join(", ")}],`);
    lines.push(`      pitfalls: [${doc.pitfalls.map(p => `t(${escapeStr(p)})`).join(", ")}],`);
    lines.push(`      agentHints: [${doc.agentHints.map(h => `t(${escapeStr(h)})`).join(", ")}],`);
    lines.push(`      actions: [`);
    lines.push(...actions);
    lines.push(`      ],`);
    lines.push(`    },`);
  }

  lines.push(`  ],`);
  lines.push(`};`);
  lines.push(``);
  return lines.join("\n");
}

// Main
const files = readdirSync(LEARNING_DIR)
  .filter(f => f.endsWith(".md") && f !== "README.md")
  .sort();

const docs = files.map(f => parseMarkdownDoc(f, readFileSync(join(LEARNING_DIR, f), "utf8")));
const output = generateOutput(docs, files);
writeFileSync(OUTPUT, output, "utf8");
console.log(`✓ Generated ${OUTPUT} (${docs.length} docs from ${files.length} files)`);

