/**
 * 批量修复 lornshrimp 题材层壳子（354 个）。
 *
 * 修复两项（纯机械，无需语义理解）：
 * 1. 大小写对齐：题材壳正文里 5 个错误的通用技能引用名 → 通用层实际 slug 名
 * 2. 补 references：从源仓库题材目录拷贝 references 附件到目标壳目录
 *
 * 用法：bun scripts/fix-genre-shells.ts [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(".");
const TARGET = join(ROOT, "packages", "novel-plugin", "skills");
const SOURCE = join(ROOT, "reference-skills", "lornshrimp_Lorn.NovelWriteSkills");

const dryRun = process.argv.includes("--dry-run");

// 大小写对齐映射：题材壳里的错误引用 → 通用层实际名
const CASE_FIXES: Array<[string, string]> = [
  ["通用-去AI味重写", "通用-去ai味重写"],
  ["通用-输出B站版", "通用-输出b站版"],
  ["通用-输出GoodNovel版", "通用-输出goodnovel版"],
  ["通用-输出My Fiction版", "通用-输出my-fiction版"],
  ["通用-输出WebNovel版", "通用-输出webnovel版"],
];

// 源题材目录名 → 目标 slug 题材名（小写）
const GENRE_MAP: Record<string, string> = {
  "AI科幻": "ai科幻",
  "都市悬疑": "都市悬疑",
  "都市职场": "都市职场",
  "女频爱情": "女频爱情",
  "赛博庞克": "赛博庞克",
  "太空科幻": "太空科幻",
  "悬疑推理": "悬疑推理",
  "异能志怪": "异能志怪",
  "小说分发": "分发",
};

interface Stats {
  caseFixed: number;
  refCopied: number;
  refSkippedNoSource: number;
  skipped: number;
}

const stats: Stats = { caseFixed: 0, refCopied: 0, refSkippedNoSource: 0, skipped: 0 };

function isGenreShell(slug: string): boolean {
  // 题材壳：nf-lornshrimp--<题材名>-<技能名>，且题材名在 GENRE_MAP 里
  if (!slug.startsWith("nf-lornshrimp--")) return false;
  const rest = slug.slice("nf-lornshrimp--".length);
  for (const targetName of Object.values(GENRE_MAP)) {
    if (rest.startsWith(targetName + "-")) return true;
  }
  return false;
}

function fixCaseInContent(content: string): { fixed: number; content: string } {
  let fixed = 0;
  let result = content;
  for (const [wrong, right] of CASE_FIXES) {
    if (result.includes(wrong)) {
      result = result.split(wrong).join(right);
      fixed++;
    }
  }
  return { fixed, content: result };
}

function copyReferences(sourceDir: string, targetDir: string): boolean {
  const srcRef = join(sourceDir, "references");
  if (!existsSync(srcRef) || !statSync(srcRef).isDirectory()) return false;
  if (dryRun) return true;
  cpSync(srcRef, join(targetDir, "references"), { recursive: true });
  return true;
}

function main() {
  const slugs = readdirSync(TARGET).filter((d) => {
    const p = join(TARGET, d);
    return d.startsWith("nf-lornshrimp--") && statSync(p).isDirectory() && isGenreShell(d);
  });

  console.log(`发现题材壳 ${slugs.length} 个${dryRun ? "（dry-run）" : ""}\n`);

  for (const slug of slugs) {
    const targetDir = join(TARGET, slug);
    const skillFile = join(targetDir, "SKILL.md");
    if (!existsSync(skillFile)) {
      stats.skipped++;
      continue;
    }

    const content = readFileSync(skillFile, "utf8");

    // 1. 大小写对齐
    const { fixed, content: fixedContent } = fixCaseInContent(content);
    if (fixed > 0) {
      stats.caseFixed++;
      if (!dryRun) writeFileSync(skillFile, fixedContent, "utf8");
    }

    // 2. 补 references（从源仓库对应题材目录拷贝）
    // 解析 slug 的题材名和技能名
    const rest = slug.slice("nf-lornshrimp--".length);
    let sourceRelDir: string | null = null;
    for (const [srcGenre, targetGenre] of Object.entries(GENRE_MAP)) {
      if (rest.startsWith(targetGenre + "-")) {
        const skillName = rest.slice(targetGenre.length + 1); // 去掉题材名和连字符
        sourceRelDir = join(SOURCE, srcGenre, "skills", `${srcGenre}-${skillName}`);
        break;
      }
    }

    if (sourceRelDir && existsSync(sourceRelDir)) {
      if (copyReferences(sourceRelDir, targetDir)) {
        stats.refCopied++;
      } else {
        stats.refSkippedNoSource++;
      }
    } else {
      stats.refSkippedNoSource++;
    }
  }

  console.log("=== 修复统计 ===");
  console.log(`大小写对齐: ${stats.caseFixed} 个`);
  console.log(`补 references: ${stats.refCopied} 个`);
  console.log(`无源 references 跳过: ${stats.refSkippedNoSource} 个`);
  console.log(`跳过（缺 SKILL.md）: ${stats.skipped} 个`);
}

main();
