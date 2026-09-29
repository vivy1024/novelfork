import { describe, expect, it } from "vitest";

import {
  buildCanonicalTrees,
  buildChapterForkTree,
  buildChronicleTree,
  buildTimelineTree,
  buildWorldviewTree,
  collectDefaultExpanded,
  pruneCanonicalTree,
  relationsFromCooccurrence,
  toLayoutInput,
  type CanonicalTreeNode,
  type CooccurrenceEdgeInput,
  type TimelineEventInput,
  type VolumeTreeInput,
} from "./canonical-trees";
import { layoutTidyTree } from "./tidy-tree-layout";
import type { TreeEntryInput } from "./story-tree";

function entry(id: string, category: string, title: string, extra: Partial<TreeEntryInput> = {}): TreeEntryInput {
  return { id, category, title, ...extra };
}

const settingEntries: TreeEntryInput[] = [
  entry("c1", "characters", "薛行之", { fields: { name: "薛行之", roleType: "主角" } }),
  entry("c2", "characters", "方工", { fields: { name: "方工", roleType: "对手" } }),
  entry("l1", "locations", "灵科院西京分院", { fields: { name: "灵科院西京分院" } }),
  entry("f1", "foreshadowing", "B-17异常波形", { fields: { status: "planted", plantedChapter: 1 } }),
  entry("s1", "chapter-summaries", "第 1 章 归档", { fields: { chapterNumber: 1, summary: "接手异常" } }),
  entry("s2", "chapter-summaries", "第 2 章 追查", { fields: { chapterNumber: 2 } }),
];

const cooccurrence: CooccurrenceEdgeInput[] = [
  { source: "薛行之", target: "方工", weight: 0.9, coCount: 4 },
  { source: "薛行之", target: "灵科院西京分院", weight: 0.6, coCount: 2 },
  { source: "自费转诊", target: "薛行之", weight: 0.8, coCount: 3 },
];

const volumes: VolumeTreeInput[] = [
  {
    id: "vol-1",
    title: "西京篇",
    chapterRange: { from: 1, to: 3 },
    status: "active",
    goal: "把异常从个案做成制度问题",
    mainlineBeats: [{ id: "b1", title: "接手 B-17", status: "done" }],
  },
];

describe("buildWorldviewTree 世界观", () => {
  it("复用 NarraBench 层级，伏笔进话语维度", () => {
    const forest = buildWorldviewTree({ entries: settingEntries });
    const ids = forest.root.children.map((node) => node.id);
    expect(ids).toContain("dimension:story");
    expect(ids).toContain("dimension:discourse");
  });

  it("共现边计入度数，枢纽排前面", () => {
    const forest = buildWorldviewTree({
      entries: settingEntries,
      relations: relationsFromCooccurrence(cooccurrence),
    });
    const characters = forest.root.children
      .find((node) => node.id === "dimension:story")!.children
      .find((node) => node.id === "feature:agent")!.children
      .find((node) => node.id === "category:characters")!;
    expect(characters.children[0]!.label).toBe("薛行之");
    expect(characters.children[0]!.degree).toBeGreaterThan(0);
  });
});

describe("buildChapterForkTree 章节分叉", () => {
  it("卷纲 → 章，占位章不假装已写", () => {
    const forest = buildChapterForkTree({ entries: settingEntries, volumes });
    const volume = forest.root.children[0]!;
    expect(volume.label).toBe("西京篇");
    expect(volume.children.some((node) => node.kind === "beat" && node.label === "接手 B-17")).toBe(true);
    const chapter3 = volume.children.find((node) => node.chapterNumber === 3);
    expect(chapter3?.subtitle).toBe("尚无摘要");
    expect(volume.children.filter((node) => node.kind === "chapter").map((node) => node.chapterNumber))
      .toEqual([1, 2, 3]);
  });

  it("没有卷纲时按章摘要平铺，不编造分叉", () => {
    const forest = buildChapterForkTree({ entries: settingEntries });
    expect(forest.root.subtitle).toContain("还没有卷纲");
    expect(forest.root.children.every((node) => node.kind === "chapter")).toBe(true);
    expect(forest.root.children.map((node) => node.chapterNumber)).toEqual([1, 2]);
  });

  it("outline 条目 fields.volumes 也能当卷纲", () => {
    const forest = buildChapterForkTree({
      entries: [
        ...settingEntries,
        entry("o1", "outline", "卷纲", { fields: { volumes } }),
      ],
    });
    expect(forest.root.children[0]!.label).toBe("西京篇");
  });
});

const events: TimelineEventInput[] = [
  { id: "e1", chapterNumber: 1, subject: "薛行之", predicate: "接手", object: "异常", eventType: "character_state_changed", evidenceText: "归档当晚接手当班" },
  { id: "e2", chapterNumber: 1, subject: "薛行之", predicate: "对峙", object: "方工", eventType: "relationship_changed", causedBy: ["e1"] },
  { id: "e3", chapterNumber: 2, subject: "方工", predicate: "追查", object: "波形", eventType: "world_fact_introduced", riskLevel: "high" },
];

describe("buildTimelineTree 发展历程", () => {
  it("按章挂事件，同章因果才往下挂", () => {
    const forest = buildTimelineTree({ entries: settingEntries, events });
    const chapter1 = forest.root.children.find((node) => node.chapterNumber === 1)!;
    expect(chapter1.children.map((node) => node.id)).toEqual(["event:e1"]);
    expect(chapter1.children[0]!.children.map((node) => node.id)).toEqual(["event:e2"]);
    const chapter2 = forest.root.children.find((node) => node.chapterNumber === 2)!;
    expect(chapter2.children.map((node) => node.id)).toEqual(["event:e3"]);
  });

  it("没有事件时给可执行空态", () => {
    const forest = buildTimelineTree({});
    expect(forest.root.children).toEqual([]);
    expect(forest.emptyReason).toContain("叙事事件");
  });
});

describe("buildChronicleTree 章节脉络", () => {
  it("表世界挂摘要，里世界按角色分枝，不画对照条", () => {
    const forest = buildChronicleTree({ entries: settingEntries, events });
    expect(forest.root.children.map((node) => node.id)).toEqual([
      "chronicle:surface",
      "chronicle:inner",
      "chronicle:turning",
    ]);
    const inner = forest.root.children.find((node) => node.id === "chronicle:inner")!;
    expect(inner.children.map((node) => node.label).sort()).toEqual(["方工", "薛行之"]);
    expect(forest.root.subtitle).toContain("不画对照条");
  });
});

describe("buildCanonicalTrees 正图", () => {
  it("总图挂世界观与章节两棵浅层，不把全量叶子一次铺开；关系网不再建成共现树", () => {
    const trees = buildCanonicalTrees({
      entries: settingEntries,
      cooccurrence,
      volumes,
      events,
    });
    expect(trees.overview.root.children.map((node) => node.label)).toEqual(["世界观", "章节"]);
    expect("relations" in trees).toBe(false);
    const worldviewBranch = trees.overview.root.children.find((node) => node.label === "世界观")!;
    const hasEntryLeaf = worldviewBranch.children.some((node) =>
      node.children.some((child) => child.children.some((leaf) => leaf.kind === "entry")),
    );
    expect(hasEntryLeaf).toBe(false);
  });

  it("tidy-tree 能吃展开后的章节树，同深度对齐", () => {
    const trees = buildCanonicalTrees({ entries: settingEntries, cooccurrence, volumes });
    const expanded = collectDefaultExpanded(trees.chapters.root);
    const layout = layoutTidyTree(toLayoutInput(trees.chapters.root, expanded));
    const volume = trees.chapters.root.children[0]!;
    const hub = layout.points.get(volume.id)!;
    const childIds = volume.children.map((node) => node.id);
    expect(childIds.length).toBeGreaterThan(0);
    for (const id of childIds) {
      expect(layout.points.get(id)!.depthCoord).toBeGreaterThan(hub.depthCoord);
      expect(layout.points.get(id)!.depth).toBe(hub.depth + 1);
    }
  });
});

describe("pruneCanonicalTree / toLayoutInput", () => {
  it("深度裁剪后只留浅层", () => {
    const node: CanonicalTreeNode = {
      id: "r",
      kind: "root",
      label: "r",
      count: 2,
      defaultExpanded: true,
      children: [{
        id: "a",
        kind: "group",
        label: "a",
        count: 1,
        defaultExpanded: true,
        children: [{
          id: "a1",
          kind: "entry",
          label: "a1",
          count: 1,
          defaultExpanded: false,
          children: [],
        }],
      }],
    };
    const pruned = pruneCanonicalTree(node, 1, 8);
    expect(pruned.children[0]!.children).toEqual([]);
  });

  it("折叠节点不进布局输入", () => {
    const trees = buildCanonicalTrees({ entries: settingEntries, volumes });
    const expanded = new Set(["chapters"]);
    const input = toLayoutInput(trees.chapters.root, expanded);
    expect(input.children.length).toBeGreaterThan(0);
    expect(input.children[0]!.children).toEqual([]);
  });
});
