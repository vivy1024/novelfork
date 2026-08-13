/**
 * 把外部聚合的 Writing Skills 一对一转化为 NovelFork 自研技能（nf- 前缀）。
 *
 * 原则：功能不丢。
 * - frontmatter 规范化：id=nf-*、mode=manual、version=1.0.0，保留 name/description/kind/tags/argument-hint/user-invocable。
 * - 正文保留完整方法论，只做三类机械改写：
 *   1) 删除外部工作区专用"题材路由"块（.github\题材专用Skills\ 等路径依赖）；
 *   2) read_file 强制读取门禁措辞改为普通读取指引（NovelFork 由 Skill 工具加载附件）；
 *   3) 文件写入路径指令映射到 NovelFork 受控工具。
 * - 整个目录（references/ 等附件 + _source.json 溯源）拷贝到 nf-<slug>/，题材特有功能不丢。
 */

import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SKILLS_ROOT = join("packages", "novel-plugin", "skills");

interface ConvertResult {
  slug: string;
  newSlug: string;
  status: "converted" | "skipped-nf" | "failed";
  reason?: string;
}

function isSafeSlug(value: string): boolean {
  return Boolean(value) && value !== "." && value !== ".."
    && !value.includes("\0") && !value.includes("/") && !value.includes("\\") && !value.includes(":");
}

/** 解析 frontmatter 为原始文本块与字段 map。 */
function splitFrontmatter(raw: string): { data: Record<string, unknown>; body: string } | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  const lines = match[1]!.split(/\r?\n/);
  const data: Record<string, unknown> = {};
  let key: string | null = null;
  for (const line of lines) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      key = kv[1]!;
      const value = kv[2]!.trim();
      data[key] = value === "" ? null : value;
    } else if (key && line.startsWith("  ")) {
      // 列表/多行字段：保留原始行以重建
      if (!Array.isArray(data[`__lines_${key}`])) data[`__lines_${key}`] = [];
      (data[`__lines_${key}`] as string[]).push(line);
    }
  }
  return { data, body: match[2] ?? "" };
}

/** 剥掉 YAML 单引号包裹（外部技能 description/argument-hint 多为 '...' 形式）。 */
function stripYamlQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

/** 从 raw frontmatter 重建规范化 frontmatter。保留原始行保真。 */
function rebuildFrontmatter(data: Record<string, unknown>, slug: string, newSlug: string): string {
  const name = typeof data.name === "string" ? stripYamlQuotes(data.name) : "";
  const description = typeof data.description === "string" ? stripYamlQuotes(data.description) : "";
  const kind = typeof data.kind === "string" ? data.kind.trim() : "workflow";
  const argumentHint = typeof data["argument-hint"] === "string" ? stripYamlQuotes(data["argument-hint"]) : "";
  const userInvocable = data["user-invocable"] !== "false";
  const version = typeof data.version === "string" ? data.version.trim() : "1.0.0";
  const tagLines = data["__lines_tags"] as string[] | undefined;
  const inlineTags = typeof data.tags === "string" ? data.tags : "";
  const tags = (tagLines ?? [])
    .map((line) => line.trim().replace(/^-\s*/, "").trim())
    .filter(Boolean);
  const inline = inlineTags.match(/\[([^\]]*)\]/)?.[1]
    ?.split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, "").trim())
    .filter(Boolean) ?? [];

  const lines: string[] = ["---"];
  lines.push(`id: nf-${slug}`);
  if (name) lines.push(`name: ${name}`);
  if (description) lines.push(`description: ${JSON.stringify(description)}`);
  if (argumentHint) lines.push(`argument-hint: ${JSON.stringify(argumentHint)}`);
  lines.push(`user-invocable: ${userInvocable}`);
  lines.push(`kind: ${kind}`);
  lines.push("mode: manual");
  lines.push(`version: ${version}`);
  const allTags = [...new Set([...tags, ...inline])];
  lines.push("tags:");
  if (allTags.length > 0) {
    for (const tag of allTags) lines.push(`  - ${tag}`);
  } else {
    lines.push("  - novel");
  }
  lines.push("---");
  return lines.join("\n");
}

/** 删除外部工作区专用的题材路由块。 */

/** read_file 强制门禁 → 普通读取指引。 */
function stripReadGate(body: string): string {
  const gate = /\*\*以下所列 references 文件必须通过 `read_file` 工具逐文件读取[\s\S]*?\*\*\n\n/;
  return body.replace(gate, "以下 references 随本技能一起加载，需要时用 Read 工具读取：\n\n");
}

/** 行内 read_file 工具调用 → 普通读取措辞。 */
function stripInlineReadFile(body: string): string {
  return body
    .replace(/`read_file`\s*打开/gu, "读取")
    .replace(/必须通过 `read_file` 工具逐文件读取/gu, "必须逐文件读取")
    .replace(/`read_file` 工具/gu, "Read 工具");
}

/** 文件写入路径指令 → NovelFork 受控工具。 */
function mapFilePathDirectives(body: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/写回\s*`?小说正文\//gu, "用 pipeline.write / chapter.write 把对应章节落盘（原外部路径「小说正文/」在 NovelFork 中不存在）"],
    [/落盘到\s*`?小说正文\//gu, "用 pipeline.write / chapter.write 落盘对应章"],
    [/写入\s*`?人物传记\//gu, "用 lore.write（category=characters）写入角色设定"],
    [/写入\s*`?故事设定\//gu, "用 lore.write（world-model / rules）写入设定"],
    [/写入\s*`?(总大纲|分卷大纲|分部大纲)\//gu, "用 lore.write（outline）/ outline.volume 写入大纲"],
    [/落盘到\s*`?审阅意见\//gu, "直接输出审阅报告文本（不落盘）"],
    [/落盘到\s*`?(竞对分析|写作研究|调研报告)\//gu, "直接输出报告文本（不落盘）"],
    [/`?Agents\.md`?/gu, "书内已启用的 Writing Skills（NovelFork 对应物）"],
  ];
  let result = body;
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** 第二遍清理：行为指令（写回/落盘/默认工作目录）映射到 NovelFork 受控工具。 */
function mapBehaviorDirectives(body: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/默认工作目录固定为\s*`?小说正文\/`?/gu, "章节落盘由 pipeline.write / chapter.write 完成（不直接写章节文件）"],
    [/回写到\s*`?小说正文\//gu, "用 pipeline.write / chapter.write 落盘对应章"],
    [/必须写(?:回|入)\s*`?小说正文\//gu, "必须用 pipeline.write / chapter.write 落盘对应章"],
    [/写入到\s*`?小说正文\//gu, "用 pipeline.write / chapter.write 落盘对应章"],
    [/不得把提纯母稿存放、回写或新增到\s*`?小说正文\/`?/gu, "提纯母稿只作为中间产物输出，不落盘到正式章节"],
    [/`?(小说大纲|总大纲|分部大纲|分卷大纲)\/([^\s`、，。；]+\.md)`?/gu, "经纬 outline 条目（$2）"],
    [/`?CommonSkills\/[^\s`、，。；]+`?/gu, "对应 NovelFork 技能"],
    [/\.\.\/通用-([^\s`、，。；/]+)/gu, "通用技能「$1」（NovelFork nf- 版）"],
    [/`?\.prompt\.md`?/gu, "入口提示词（NovelFork 对应物）"],
  ];
  let result = body;
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** 题材路由块（含变体）→ 删除。 */
function stripTopicRoutingStrict(body: string): string {
  return body
    .replace(/\n?> \*\*题材路由\*\*[\s\S]*?(?=\n## |\n# |\n\n##)/u, "")
    .replace(/\n?>\s*若\s*\.github[^\n]*(?:\n>\s*[^\n]*)*/gu, "");
}

/** 目标目录已存在 nf- 版本则跳过（试点已手写）。 */
async function convertOne(slug: string): Promise<ConvertResult> {
  if (slug.startsWith("nf-")) return { slug, newSlug: slug, status: "skipped-nf" };
  const newSlug = `nf-${slug}`;
  const sourceDir = join(SKILLS_ROOT, slug);
  const targetDir = join(SKILLS_ROOT, newSlug);
  try {
    const targetStat = await stat(targetDir).catch(() => null);
    if (targetStat) return { slug, newSlug, status: "skipped-nf", reason: "目标已存在" };

    const raw = await readFile(join(sourceDir, "SKILL.md"), "utf8");
    const parsed = splitFrontmatter(raw);
    if (!parsed) return { slug, newSlug, status: "failed", reason: "frontmatter 解析失败" };
    if (!parsed.data.name || !parsed.data.description) {
      return { slug, newSlug, status: "failed", reason: "缺少 name/description" };
    }

    const body = mapBehaviorDirectives(mapFilePathDirectives(stripInlineReadFile(stripReadGate(stripTopicRoutingStrict(parsed.body)))));
    const frontmatter = rebuildFrontmatter(parsed.data, slug, newSlug);
    const content = `${frontmatter}\n\n${body.trim()}\n`;

    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, "SKILL.md"), content, "utf8");
    // 附件完整拷贝（references/、_source.json 等），排除 SKILL.md（已写入新版）。
    await cp(sourceDir, targetDir, {
      recursive: true,
      force: true,
      filter: (src) => !src.endsWith("SKILL.md"),
    });
    return { slug, newSlug, status: "converted" };
  } catch (error) {
    return { slug, newSlug, status: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const entries = await readdir(SKILLS_ROOT, { withFileTypes: true });
  const slugs = entries
    .filter((entry) => entry.isDirectory() && isSafeSlug(entry.name) && entry.name !== "index.json")
    .map((entry) => entry.name)
    .sort();

  const results: ConvertResult[] = [];
  for (const slug of slugs) {
    results.push(await convertOne(slug));
  }

  const converted = results.filter((r) => r.status === "converted");
  const skipped = results.filter((r) => r.status === "skipped-nf");
  const failed = results.filter((r) => r.status === "failed");
  console.log(`✓ 转化 ${converted.length} 个，跳过 ${skipped.length} 个，失败 ${failed.length} 个`);
  for (const item of failed) console.log(`  ✗ ${item.slug}: ${item.reason}`);
  for (const item of converted.slice(0, 5)) console.log(`  → ${item.slug} → ${item.newSlug}`);
}

await main();
