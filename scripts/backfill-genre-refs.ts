/**
 * 兜底补全题材壳缺失的 references 附件（源题材目录 + 通用层 双兜底）。
 *
 * 题材壳引用的 references 是「通用层共享附件 + 题材专属附件」混合。
 * 本脚本对每个引用的 references/X.md，依次在目标目录、源题材目录、通用层
 * 查找，找到即拷贝。
 *
 * 用法：bun scripts/backfill-genre-refs.ts [--dry-run]
 */

import { readFileSync, existsSync, readdirSync, statSync, copyFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const ROOT = resolve(".");
const TARGET = join(ROOT, "packages", "novel-plugin", "skills");
const SOURCE = join(ROOT, "reference-skills", "lornshrimp_Lorn.NovelWriteSkills");

const dryRun = process.argv.includes("--dry-run");

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

function extractReferencedFiles(content: string): string[] {
  const refs = new Set<string>();
  const re = /references\/([A-Za-z0-9_.\-\u4e00-\u9fa5]+\.md)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    refs.add(m[1].trim());
  }
  return [...refs];
}

function main() {
  const slugs = readdirSync(TARGET).filter((d) => {
    const p = join(TARGET, d);
    return d.startsWith("nf-lornshrimp--") && !d.includes("通用-") && statSync(p).isDirectory();
  });

  let copied = 0;
  let stillMissing = 0;
  const missingList: string[] = [];

  for (const slug of slugs) {
    const targetDir = join(TARGET, slug);
    const skillFile = join(targetDir, "SKILL.md");
    if (!existsSync(skillFile)) continue;

    const content = readFileSync(skillFile, "utf8");
    const refs = extractReferencedFiles(content);
    if (refs.length === 0) continue;

    // 解析题材名和技能名
    const rest = slug.slice("nf-lornshrimp--".length);
    let srcGenre: string | null = null;
    let skillName: string | null = null;
    for (const [sg, tg] of Object.entries(GENRE_MAP)) {
      if (rest.startsWith(tg + "-")) {
        srcGenre = sg;
        skillName = rest.slice(tg.length + 1);
        break;
      }
    }

    // 解析通用层技能名
    const commonMatch = content.match(/通用-([^\s`，。、\n]+)/);
    const commonSlug = commonMatch ? `nf-lornshrimp--通用-${commonMatch[1]}` : null;
    const commonRefDir = commonSlug ? join(TARGET, commonSlug, "references") : null;

    const srcRefDir = srcGenre && skillName
      ? join(SOURCE, srcGenre, "skills", `${srcGenre}-${skillName}`, "references")
      : null;

    for (const ref of refs) {
      const targetRef = join(targetDir, "references", ref);
      if (existsSync(targetRef)) continue; // 已有

      // 兜底1：源题材目录
      if (srcRefDir) {
        const srcRef = join(srcRefDir, ref);
        if (existsSync(srcRef)) {
          if (!dryRun) {
            mkdirSync(dirname(targetRef), { recursive: true });
            copyFileSync(srcRef, targetRef);
          }
          copied++;
          continue;
        }
      }

      // 兜底2：通用层目录
      if (commonRefDir) {
        const srcRef = join(commonRefDir, ref);
        if (existsSync(srcRef)) {
          if (!dryRun) {
            mkdirSync(dirname(targetRef), { recursive: true });
            copyFileSync(srcRef, targetRef);
          }
          copied++;
          continue;
        }
      }

      // 两处都没有 → 真缺失
      stillMissing++;
      if (missingList.length < 40) {
        missingList.push(`${slug} → references/${ref}`);
      }
    }
  }

  console.log(`=== 共享 references 兜底拷贝 ===`);
  console.log(`成功拷贝: ${copied} 个`);
  console.log(`真缺失（源/通用层都没有）: ${stillMissing} 个`);
  if (missingList.length > 0) {
    console.log(`缺失清单:`);
    for (const ex of missingList) console.log(`  - ${ex}`);
  }
}

main();
