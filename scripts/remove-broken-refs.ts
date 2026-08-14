/**
 * 删除题材壳正文里指向不存在附件的破损 references 列表项引用。
 *
 * 只删除列表项形式（`- \`references/不存在文件.md\``），不动行内文字提及。
 * 这些附件在源仓库和通用层都不存在，留着引用会让模型读到后报"文件不存在"。
 *
 * 用法：bun scripts/remove-broken-refs.ts [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(".");
const TARGET = join(ROOT, "packages", "novel-plugin", "skills");

const dryRun = process.argv.includes("--dry-run");

function main() {
  const slugs = readdirSync(TARGET).filter((d) => {
    const p = join(TARGET, d);
    return d.startsWith("nf-lornshrimp--") && statSync(p).isDirectory();
  });

  let removed = 0;
  const removedList: string[] = [];

  for (const slug of slugs) {
    const targetDir = join(TARGET, slug);
    const skillFile = join(targetDir, "SKILL.md");
    if (!existsSync(skillFile)) continue;

    const content = readFileSync(skillFile, "utf8");
    const lines = content.split(/\r?\n/);
    const newLines: string[] = [];

    for (const line of lines) {
      // 匹配列表项形式的 references 引用：`- \`references/xxx.md\``
      const m = line.match(/^(\s*[-*]\s*)`references\/([A-Za-z0-9_.\-\u4e00-\u9fa5]+\.md)`/);
      if (m) {
        const ref = m[2];
        const refPath = join(targetDir, "references", ref);
        if (!existsSync(refPath)) {
          // 破损引用，删除整行
          removed++;
          if (removedList.length < 40) {
            removedList.push(`${slug} → ${ref}`);
          }
          continue; // 跳过该行
        }
      }
      newLines.push(line);
    }

    if (newLines.length !== lines.length) {
      if (!dryRun) {
        writeFileSync(skillFile, newLines.join("\n"), "utf8");
      }
    }
  }

  console.log(`=== 删除破损 references 列表项 ===`);
  console.log(`删除行数: ${removed} 个`);
  if (removedList.length > 0) {
    console.log(`删除清单:`);
    for (const ex of removedList) console.log(`  - ${ex}`);
  }
}

main();
