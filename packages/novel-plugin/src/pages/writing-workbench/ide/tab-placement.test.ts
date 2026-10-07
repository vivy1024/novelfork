/**
 * toTabKind / toTabView 映射表全量核对。
 *
 * 侧栏所有可点击的 entry kind 都必须命中一个确定归属：
 * - toTabView 决定 tab 落在哪个 ActivityBar 工作区（handleOpen 据此切换侧栏视图）；
 * - toTabKind 决定 tab 图标分类。
 * 这里 pins 住整张表，防止新增资源类型时静默落进 default 分支而放错工作区。
 */
import { describe, expect, it } from "vitest";

import type { WorkbenchResourceNode } from "../useWorkbenchResources";
import { toTabKind, toTabView } from "./IdeWorkbench";

const capabilities = { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false };

function node(kind: WorkbenchResourceNode["kind"], metadata?: Record<string, unknown>): WorkbenchResourceNode {
  return { id: `test:${kind}`, kind, title: kind, capabilities, metadata };
}

describe("toTabView：侧栏每种入口节点的 tab 归属工作区", () => {
  it.each([
    ["角色卡/世界录条目", node("jingwei-entry"), "characters-lore"],
    ["经纬分区", node("jingwei-section"), "characters-lore"],
    ["经纬入口", node("jingwei"), "characters-lore"],
    ["故事画布（story-progression）", node("story-progression"), "storyline"],
    // 工作流（按工序写这一章）从写作侧栏打开，标签留在写作视图；不再挂在故事画布的「执行」页。
    ["工作流", node("file", { isWorkflowRun: true }), "write"],
    ["全景图谱（叙事记忆）", node("file", { isNarrativeMemoryEntry: true }), "storyline"],
    ["章后事实", node("file", { isNarrativeMemoryEntry: true, predicate: "位置" }), "storyline"],
    // 从故事推进侧栏「在中央打开章后事实」，侧栏要留在故事推进。
    ["章后事实中心", node("file", { isMemoryCenter: true }), "storyline"],
    // 分析工具与文件树同属「资源」视图（原「资源管理器」「分析工具」已合并）。
    ["分析工具节点", node("tool"), "resources"],
    ["分析工具分组", node("tool-group"), "resources"],
    // 从作品基础侧栏打开，必须留在作品基础，不能把活动栏拽去资源。
    ["设定图谱", node("group", { isLoreTrees: true }), "characters-lore"],
    ["章节", node("chapter"), "resources"],
    ["大纲文档", node("story"), "resources"],
    ["叙事线快照", node("narrative-line"), "resources"],
    ["文件", node("file", { isFile: true }), "resources"],
  ] as const)("%s → %s", (_label, n, view) => {
    expect(toTabView(n)).toBe(view);
  });
});

describe("toTabKind：每种入口节点的 tab 图标分类", () => {
  it.each([
    ["角色卡/世界录条目", node("jingwei-entry"), "jingwei-entry"],
    ["经纬分区", node("jingwei-section"), "jingwei-entry"],
    ["经纬入口", node("jingwei"), "jingwei-entry"],
    ["故事画布（story-progression）", node("story-progression"), "story-map"],
    ["工作流", node("file", { isWorkflowRun: true }), "tool"],
    ["章后事实", node("file", { isNarrativeMemoryEntry: true }), "memory-entry"],
    ["分析工具节点", node("tool"), "tool"],
    ["章节", node("chapter"), "chapter"],
    ["大纲文档", node("story"), "file"],
    ["叙事线快照", node("narrative-line"), "story-map"],
    ["文件", node("file", { isFile: true }), "file"],
  ] as const)("%s → %s", (_label, n, kind) => {
    expect(toTabKind(n)).toBe(kind);
  });

  it("章后事实优先识别为 memory-entry 而不是 file（metadata 先于 kind）", () => {
    expect(toTabKind(node("file", { isFile: true, isNarrativeMemoryEntry: true }))).toBe("memory-entry");
  });
});
