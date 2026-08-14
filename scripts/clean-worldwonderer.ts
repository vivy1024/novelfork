/**
 * 清理 worldwonderer 7 个技能里的 .claude/.opencode/.codex 外部 agent 目录死路径。
 *
 * 这些引用是 worldwonderer 原作者设计的「多运行时 agent 兼容层」：
 * 检查 .claude/agents/ → .opencode/agents/ → .codex/agents/ 目录，找到就 spawn 外部 agent。
 * 在 NovelFork（NarraFork Runtime）里这些外部 agent 目录不存在，最终都降级为主会话执行。
 *
 * 清理策略：把这些「外部 agent 目录检查」措辞统一简化为「由 NarraFork Runtime
 * 主会话直接执行，必要时可用子代理辅助」，保留方法论主体不变。
 *
 * 用法：bun scripts/clean-worldwonderer.ts [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(".");
const TARGET = join(ROOT, "packages", "novel-plugin", "skills");

const dryRun = process.argv.includes("--dry-run");

const SKILLS = [
  "nf-worldwonderer--story",
  "nf-worldwonderer--story-deslop",
  "nf-worldwonderer--story-import",
  "nf-worldwonderer--story-long-analyze",
  "nf-worldwonderer--story-long-write",
  "nf-worldwonderer--story-review",
  "nf-worldwonderer--story-short-write",
];

// 精确替换规则：把外部 agent 目录检查措辞 → NovelFork 措辞
const REPLACEMENTS: Array<[RegExp, string]> = [
  // 1. 通用「检查顺序」表述
  [/按\s*`\.claude\/agents\/\{agent\}\.md`\s*→\s*`\.opencode\/agents\/\{agent\}\.md`\s*→\s*`\.codex\/agents\/\{agent\}\.toml`\s*查找[^；。]*[；。]/g,
   "按 NarraFork Runtime 的子代理能力查找；"],
  [/检查顺序：`\.claude\/agents\/[^`]+`\s*→\s*`\.opencode\/agents\/`\s*→\s*`\.codex\/agents\/`[^\n]*/g,
   "检查顺序：优先用 NarraFork Runtime 子代理，其次主会话直接执行。"],
  // 2. 「优先检查 .claude/agents/ 下的 xxx 是否存在；不存在时再检查 .opencode/，再不存在时检查 .codex/」模式
  [/优先检查\s*`\.claude\/agents\/`\s*下的\s*`([^`]+)`\s*是否存在[^）)）]*[）)]/g,
   "优先判断 NarraFork Runtime 是否可用子代理执行「$1」"],
  [/优先检查\s*`\.claude\/agents\/`\s*下的\s*`([^`]+)`\s*和\s*`([^`]+)`\s*是否存在[^）)）]*[）)]/g,
   "优先判断 NarraFork Runtime 是否可用子代理执行「$1」「$2」"],
  // 3. 「（检查 .claude/agents/xxx 是否存在）」内联模式
  [/（检查\s*`\.claude\/agents\/[^`]+`\s*是否存在）/g, "（判断是否可用子代理）"],
  [/（优先检查\s*`\.claude\/agents\/[^`]+`\s*是否存在[^）]*）/g, "（优先判断是否可用子代理）"],
  // 4. 「.claude/agents/xxx」→ 「子代理 xxx」
  [/`\.claude\/agents\/([^`]+)\.md`/g, "「$1」子代理"],
  [/`\.claude\/agents\//g, "「"],
  [/\.claude\/agents\//g, "「"],
  [/`\.opencode\/agents\//g, "「"],
  [/\.opencode\/agents\//g, "「"],
  [/`\.codex\/agents\//g, "「"],
  [/\.codex\/agents\//g, "「"],
  // 5. 「.claude/skills/」路径
  [/`\.claude\/skills\/\{规范路径\}`[^）]*/g, "NarraFork Runtime 技能目录"],
  [/\.claude\/skills\/[^\s`）]*/g, "NarraFork Runtime 技能"],
  // 6. 「~/.claude/skills/」个人路径
  [/~\/\.claude\/skills\/[^\s`）]*/g, "NarraFork Runtime 技能"],
];

function clean(content: string): { count: number; result: string } {
  let count = 0;
  let result = content;
  for (const [pattern, replacement] of REPLACEMENTS) {
    const matches = result.match(pattern);
    if (matches) count += matches.length;
    result = result.replace(pattern, replacement);
  }
  return { count, result };
}

function main() {
  let total = 0;
  for (const slug of SKILLS) {
    const skillFile = join(TARGET, slug, "SKILL.md");
    if (!existsSync(skillFile)) {
      console.log(`跳过（不存在）: ${slug}`);
      continue;
    }
    const content = readFileSync(skillFile, "utf8");
    const { count, result } = clean(content);
    if (count > 0) {
      total += count;
      if (!dryRun) writeFileSync(skillFile, result, "utf8");
    }
    console.log(`${slug}: 清理 ${count} 处`);
  }
  console.log(`\n共清理 ${total} 处${dryRun ? "（dry-run）" : ""}`);
}

main();
