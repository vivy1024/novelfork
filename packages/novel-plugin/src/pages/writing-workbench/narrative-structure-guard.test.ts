/**
 * 叙事结构网络请求收敛守卫测试（Task 4 Guardrail）。
 *
 * 铁律：
 * 严禁在 writing-workbench 面板中新增对 `jingwei/entries` 或 `narrative-memory/graph`
 * 的零散碎片化 fetch！
 * 所有全书结构、卷大纲、章节、场景、剧情线与伏笔需求统一走：
 * `GET /api/books/:bookId/narrative-structure` 或 useNarrativeStructure。
 * 历史遗留文件记录在白名单中受控收敛，名单只能减少、不得增加。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workbenchDir = resolve(__dirname, ".");

function scanTsxFiles(dir: string): string[] {
  const results: string[] = [];
  for (const item of readdirSync(dir)) {
    if (item.startsWith(".") || item === "node_modules" || item.endsWith(".test.tsx") || item.endsWith(".test.ts")) {
      continue;
    }
    const full = join(dir, item);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...scanTsxFiles(full));
    } else if (item.endsWith(".tsx")) {
      results.push(full);
    }
  }
  return results;
}

/** 历史遗留直接拉取原始路由的已知债务白名单（只减不增）。 */
const KNOWN_LEGACY_FETCH_WHITELIST = new Set([
  "ChapterContextRail.tsx",
  "CreativeCompassPanel.tsx",
  "GovernanceCockpitPanel.tsx",
  "IdeWorkbench.tsx",
  "JingweiCanonPanel.tsx",
  "JingweiEntryEditor.tsx",
  "StoryProgressBoard.tsx",
  "TensionCurvePanel.tsx",
  "WorldCardPage.tsx",
  "CharactersAndLoreSidebarPanel.tsx",
  "StorylineAndPlanningSidebarPanel.tsx",
  "CanonicalTreesPanel.tsx",
]);

describe("writing-workbench 叙事结构取数守卫", () => {
  it("不得出现未登记在白名单中的碎片化直接网络抓取", () => {
    const files = scanTsxFiles(workbenchDir);
    const violations: string[] = [];

    for (const file of files) {
      const fileName = file.split(/[\\/]/).pop()!;
      const content = readFileSync(file, "utf8");

      // 只拦「拉全书条目列表」；单个条目的子资源（如 /jingwei/entries/:id/voice）是定点读写，不属于碎片化取数。
      const hasDirectJingweiEntries = /jingwei\/entries(?!\/)/.test(content) && !content.includes("narrative-structure");
      const hasDirectGraph = content.includes("narrative-memory/graph") && !content.includes("narrative-structure");

      if (hasDirectJingweiEntries || hasDirectGraph) {
        if (!KNOWN_LEGACY_FETCH_WHITELIST.has(fileName)) {
          violations.push(
            `[守卫拦截] ${fileName} 出现了未经批准的碎片化取数！请使用 useNarrativeStructure 或 /narrative-structure 接口。`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("已改造面板成功接入单次叙事结构快照", () => {
    const progressBoardSource = readFileSync(join(workbenchDir, "StoryProgressBoard.tsx"), "utf8");
    expect(progressBoardSource).toContain("narrative-structure");

    const canonicalTreesSource = readFileSync(join(workbenchDir, "CanonicalTreesPanel.tsx"), "utf8");
    expect(canonicalTreesSource).toContain("narrative-structure");
  });
});
