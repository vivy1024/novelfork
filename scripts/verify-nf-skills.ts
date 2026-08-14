/**
 * 体检 packages/novel-plugin/skills/ 下所有 nf-* 技能。
 *
 * 检查项：
 * 1. 缺失 SKILL.md
 * 2. 外部死路径残留（.github / .claude / read_file）
 * 3. 破损 references 引用（正文提到但附件不存在）
 * 4. 空壳死路由（路由到不存在的通用技能）
 * 5. frontmatter 完整性（id/name/description/kind/mode）
 *
 * 用法：bun scripts/verify-nf-skills.ts [slug前缀过滤，可选]
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const SKILLS_DIR = join("packages", "novel-plugin", "skills");

interface Issue {
  slug: string;
  type: "missing-skill" | "dead-path" | "broken-ref" | "hollow-route" | "bad-frontmatter";
  detail: string;
}

function parseFrontmatter(content: string): Record<string, string> {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const fields: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

function main() {
  const filter = process.argv[2];
  const dirs = readdirSync(SKILLS_DIR)
    .filter((d) => d.startsWith("nf-"))
    .filter((d) => statSync(join(SKILLS_DIR, d)).isDirectory())
    .filter((d) => !filter || d.includes(filter));

  const issues: Issue[] = [];
  const allSlugs = new Set(dirs);

  for (const slug of dirs) {
    const dir = join(SKILLS_DIR, slug);
    const skillFile = join(dir, "SKILL.md");

    // 1. 缺失 SKILL.md
    if (!existsSync(skillFile)) {
      issues.push({ slug, type: "missing-skill", detail: "缺少 SKILL.md" });
      continue;
    }

    const content = readFileSync(skillFile, "utf8");

    // 2. 死路径
    const dead = content.match(/\.github|\.claude|read_file/g);
    if (dead) {
      issues.push({ slug, type: "dead-path", detail: `残留外部标记: ${[...new Set(dead)].join(", ")}` });
    }

    // 3. 破损 references 引用（只检查当前技能自己的列表项引用，如 `- \`references/xxx.md\``）
    // 跨技能引用（如 ../其他技能/references/xxx.md）跳过，由相对路径解析规则处理
    const refMatches = content.matchAll(/^\s*[-*]\s*`references\/([a-zA-Z0-9_.\-\u4e00-\u9fa5]+\.md)`/gm);
    for (const rm of refMatches) {
      const refFile = join(dir, "references", rm[1]);
      if (!existsSync(refFile)) {
        issues.push({ slug, type: "broken-ref", detail: `引用不存在: references/${rm[1]}` });
      }
    }

    // 4. 空壳死路由
    const route = content.match(/对应通用 Skill[\s\S]*?`通用-([^`]+)`/);
    if (route) {
      const targetSlug = `nf-lornshrimp--通用-${route[1]}`;
      if (!allSlugs.has(targetSlug)) {
        issues.push({ slug, type: "hollow-route", detail: `路由到不存在的: ${targetSlug}` });
      }
    }

    // 5. frontmatter 完整性
    const fm = parseFrontmatter(content);
    const required = ["id", "name", "description", "kind", "mode"];
    const missing = required.filter((k) => !fm[k]);
    if (missing.length > 0) {
      issues.push({ slug, type: "bad-frontmatter", detail: `缺失字段: ${missing.join(", ")}` });
    }
  }

  // 输出报告
  console.log(`=== nf-* 技能体检报告（共 ${dirs.length} 个）===`);
  const byType: Record<string, Issue[]> = {};
  for (const issue of issues) {
    (byType[issue.type] ??= []).push(issue);
  }

  const labels: Record<string, string> = {
    "missing-skill": "缺失 SKILL.md",
    "dead-path": "外部死路径残留",
    "broken-ref": "破损 references 引用",
    "hollow-route": "空壳死路由",
    "bad-frontmatter": "frontmatter 不完整",
  };

  for (const [type, list] of Object.entries(byType)) {
    console.log(`\n[${labels[type] ?? type}] ${list.length} 个`);
    for (const issue of list.slice(0, 10)) {
      console.log(`  - ${issue.slug}: ${issue.detail}`);
    }
    if (list.length > 10) console.log(`  ... 其余 ${list.length - 10} 个略`);
  }

  if (issues.length === 0) {
    console.log("\n✅ 全部通过，无问题");
  } else {
    console.log(`\n❌ 共 ${issues.length} 个问题`);
    process.exitCode = 1;
  }
}

main();
