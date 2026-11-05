/**
 * 绘图组件防回归：SVG、Canvas、React Flow、图表的颜色必须读主题令牌（var(--…)），
 * 不得写死十六进制、rgb()/hsl()/oklch() 或 Tailwind 原生色系——写死的颜色切换书房主题与明暗时不跟随，
 * 深色下可能看不清。分类色用 @/styles/chart-palette（DESIGN.md 的 chart-1 … chart-8）。
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const workspaceRoot = path.resolve(__dirname, "../../..");
const SCAN_ROOTS = ["packages/studio/src", "packages/novel-plugin/src/pages/writing-workbench"];

/**
 * 明确登记的绘图文件：其中有的只产出颜色数据、自己不含 <svg> 或画布库导入（如 story-progress-board.ts），
 * 自动识别抓不到，所以写死在这里。文件被删或改名时测试会报出来，提醒同步。
 */
const DRAWING_FILES = [
  "packages/studio/src/app-next/chapter-graph/ChapterGraph.tsx",
  "packages/studio/src/app-next/chapter-graph/ChapterNode.tsx",
  "packages/studio/src/components/ui/chart.tsx",
  "packages/studio/src/extensions/ghost-text.ts",
  "packages/studio/src/styles/chart-palette.ts",
  "packages/studio/src/styles/canvas-theme.css",
  "packages/novel-plugin/src/pages/writing-workbench/story-progress-board.ts",
  "packages/novel-plugin/src/pages/writing-workbench/StoryProgressBoard.tsx",
  "packages/novel-plugin/src/pages/writing-workbench/TensionCurveStrip.tsx",
  "packages/novel-plugin/src/pages/writing-workbench/TidyTreeCanvas.tsx",
  "packages/novel-plugin/src/pages/writing-workbench/causal-canvas/causal-canvas-layout.ts",
  "packages/novel-plugin/src/pages/writing-workbench/causal-canvas/CausalCanvas.tsx",
  "packages/novel-plugin/src/pages/writing-workbench/causal-canvas/CausalCanvasNodes.tsx",
  "packages/novel-plugin/src/pages/writing-workbench/workflow-canvas/WorkflowCanvas.tsx",
  "packages/novel-plugin/src/pages/writing-workbench/workflow-canvas/WorkflowCanvasNodes.tsx",
  "packages/novel-plugin/src/pages/writing-workbench/workflow-canvas/workflow-canvas-model.ts",
  "packages/novel-plugin/src/pages/writing-workbench/relation-network/RelationNetworkPanel.tsx",
  "packages/novel-plugin/src/pages/writing-workbench/relation-network/RelationNetworkNodes.tsx",
  "packages/novel-plugin/src/pages/writing-workbench/relation-network/relation-network-layout.ts",
  "packages/novel-plugin/src/pages/writing-workbench/resource-viewers/EditorMinimap.tsx",
  "packages/novel-plugin/src/pages/writing-workbench/panels/QualityPanel.tsx",
  "packages/novel-plugin/src/pages/writing-workbench/ChapterContextRail.tsx",
];

/** 含这些特征的源码视为绘图组件，新增的画布 / 图表自动纳入扫描。 */
const DRAWING_MARKERS = [/<svg[\s>]/, /\.getContext\(/, /from "@xyflow\/react"/, /from "recharts"/, /<canvas[\s>]/];

const FORBIDDEN: ReadonlyArray<{ readonly name: string; readonly pattern: RegExp }> = [
  { name: "十六进制色值", pattern: /#[0-9a-fA-F]{3,8}\b/g },
  { name: "rgb()/hsl()/oklch() 色值", pattern: /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(\s*[0-9.]/g },
  {
    name: "Tailwind 原生色系（不随主题）",
    pattern: /\b(?:bg|text|border|stroke|fill|ring|outline|from|via|to|decoration|shadow|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}\b/g,
  },
  {
    name: "写死的颜色名",
    pattern: /\b(?:fill|stroke|stopColor|color|nodeColor|nodeStrokeColor|maskColor|fillStyle|strokeStyle|background|backgroundColor|borderColor)\s*[=:]\s*\{?\s*["'](?:white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|silver)["']/g,
  },
];

/**
 * 允许名单：每条都写明理由。transparent / currentColor / none / CanvasText 这类不是具体色值，本来就不会被上面的规则命中。
 */
const ALLOWED: ReadonlyArray<{ readonly file: string; readonly match: string; readonly reason: string }> = [
  {
    file: "packages/studio/src/components/ui/chart.tsx",
    match: "#ccc",
    reason: "属性选择器 [stroke='#ccc']：匹配 recharts 写死的默认网格色，再把它覆盖成 stroke-border，本身不是我们用的颜色",
  },
  {
    file: "packages/studio/src/components/ui/chart.tsx",
    match: "#fff",
    reason: "属性选择器 [stroke='#fff']：匹配 recharts 默认的白描边并改成透明，同上",
  },
];

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(?:tsx?|css)$/.test(entry.name) && !/\.(?:test|spec)\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** 去掉注释（保留换行以对齐行号）：注释里讲旧色值、讲规则都不算违规。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/.*$/gm, (_, lead: string) => lead);
}

function drawingFiles(): string[] {
  const files = new Set(DRAWING_FILES.map((file) => path.join(workspaceRoot, file)));
  for (const root of SCAN_ROOTS) {
    for (const file of walk(path.join(workspaceRoot, root))) {
      if (!file.endsWith(".tsx") && !file.endsWith(".ts")) continue;
      const source = fs.readFileSync(file, "utf8");
      if (DRAWING_MARKERS.some((marker) => marker.test(source))) files.add(file);
    }
  }
  return [...files].sort();
}

describe("绘图组件颜色防回归（drawing-color-guard）", () => {
  it("登记的绘图文件都还在（改名或删除时同步这份清单）", () => {
    const missing = DRAWING_FILES.filter((file) => !fs.existsSync(path.join(workspaceRoot, file)));
    expect(missing).toEqual([]);
  });

  it("SVG / Canvas / React Flow / 图表源码不写死颜色，只读主题令牌", () => {
    const violations: string[] = [];
    const usedAllowances = new Set<number>();
    for (const file of drawingFiles()) {
      const relative = path.relative(workspaceRoot, file).replaceAll("\\", "/");
      const lines = stripComments(fs.readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, index) => {
        for (const { name, pattern } of FORBIDDEN) {
          for (const match of line.matchAll(pattern)) {
            const allowance = ALLOWED.findIndex((entry) => entry.file === relative && entry.match === match[0]);
            if (allowance >= 0) {
              usedAllowances.add(allowance);
              continue;
            }
            violations.push(`  ${relative}:${index + 1} ${name} -> ${match[0]}`);
          }
        }
      });
    }
    expect(
      violations,
      `发现 ${violations.length} 处写死的颜色。改用 var(--primary) / var(--muted-foreground) / var(--warning) 等令牌，` +
        `分类色用 @/styles/chart-palette 的 chartColor(n)：\n${violations.join("\n")}`,
    ).toEqual([]);
    // 允许名单里不再命中的条目要删掉，避免名单只增不减
    const stale = ALLOWED.filter((_, index) => !usedAllowances.has(index)).map((entry) => `${entry.file} ${entry.match}`);
    expect(stale, "允许名单里有已不再出现的条目").toEqual([]);
  });

  it("规则能命中典型写法（防止正则失效后测试空转），也不误伤令牌与注释", () => {
    const hits = (source: string) =>
      stripComments(source).split("\n").flatMap((line) => FORBIDDEN.flatMap(({ pattern }) => [...line.matchAll(pattern)].map((m) => m[0])));
    expect(hits('<circle fill="#10b981" />')).toEqual(["#10b981"]);
    expect(hits('stroke="rgba(148,163,184,0.35)"')).toHaveLength(1);
    expect(hits("ctx.fillStyle = oklch(0.6 0.1 200);")).toHaveLength(1);
    expect(hits('className="border-rose-500/50 text-cyan-600"')).toHaveLength(2);
    expect(hits('<path stroke="white" />')).toHaveLength(1);
    expect(hits('ctx.strokeStyle = "red";')).toHaveLength(1);
    expect(hits('<path fill="none" stroke="currentColor" style={{ stroke: "var(--chart-2)", background: "transparent" }} />')).toEqual([]);
    expect(hits("// 以前写死 #f7768e\n/* rgb(1, 2, 3) */")).toEqual([]);
  });

  it("自动识别能抓到画布与图表文件（防止识别规则失效后测试空转）", () => {
    const files = drawingFiles().map((file) => path.relative(workspaceRoot, file).replaceAll("\\", "/"));
    expect(files).toContain("packages/novel-plugin/src/pages/writing-workbench/TidyTreeCanvas.tsx");
    expect(files).toContain("packages/studio/src/app-next/chapter-graph/ChapterGraph.tsx");
    expect(files.length).toBeGreaterThanOrEqual(DRAWING_FILES.length);
  });
});
