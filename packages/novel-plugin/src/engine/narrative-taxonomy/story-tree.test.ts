import { describe, expect, it } from "vitest";

import {
  CATEGORY_MAPPINGS,
  countAspects,
  dimensionForCategory,
  featuresOfDimension,
  mappingForCategory,
  NARRA_DIMENSIONS,
  NARRA_FEATURES,
  UNCOVERED_FEATURES,
} from "./narrabench";
import {
  buildDegreeIndex,
  buildStoryTree,
  flattenVisible,
  idsMatchingQuery,
  initialExpandedIds,
  trimLabel,
  type TreeEntryInput,
} from "./story-tree";

function entry(id: string, category: string, title: string, extra: Partial<TreeEntryInput> = {}): TreeEntryInput {
  return { id, category, title, ...extra };
}

describe("NarraBench 分类骨架", () => {
  it("Big-4 维度与 12 个一级特征齐全", () => {
    expect(NARRA_DIMENSIONS.map((dimension) => dimension.id)).toEqual([
      "story", "narration", "discourse", "situatedness",
    ]);
    expect(NARRA_FEATURES).toHaveLength(12);
  });

  it("aspect 名共 40 个（论文的 50 条是含 SMV 评估变体的计数，此处只登记唯一 aspect 名）", () => {
    // NarraBench Table 1 里同一 aspect 可能有多行（如 name 既有 L·D·D 也有 G·H·C 口径），
    // 论文按评估条目数说 50；我们只需要唯一 aspect 名做层级，故为 40。
    expect(countAspects()).toBe(40);
  });

  it("每个特征都归属某个已声明维度", () => {
    const dimensionIds = new Set(NARRA_DIMENSIONS.map((dimension) => dimension.id));
    for (const feature of NARRA_FEATURES) {
      expect(dimensionIds.has(feature.dimension)).toBe(true);
    }
  });

  it("伏笔挂在 discourse › revelation，而不是当成一种设定条目", () => {
    const mapping = mappingForCategory("foreshadowing");
    expect(mapping?.feature).toBe("revelation");
    expect(dimensionForCategory("foreshadowing")).toBe("discourse");
  });

  it("网文特有类目被标记，不硬塞进学术分类", () => {
    for (const category of ["power-system", "rules", "props"]) {
      expect(mappingForCategory(category)?.webNovelSpecific).toBe(true);
    }
    // 角色/关系是学术分类覆盖的，不该标记
    expect(mappingForCategory("characters")?.webNovelSpecific).toBeUndefined();
  });

  it("真实缺口如实记录：视角与文风整层没有条目", () => {
    expect(UNCOVERED_FEATURES).toContain("perspective");
    expect(UNCOVERED_FEATURES).toContain("style");
    // 这两个特征确实没有任何分类挂载
    for (const feature of UNCOVERED_FEATURES) {
      expect(CATEGORY_MAPPINGS.some((mapping) => mapping.feature === feature)).toBe(false);
    }
  });

  it("未登记分类回落到 story，不抛错", () => {
    expect(dimensionForCategory("某个自定义类目")).toBe("story");
    expect(mappingForCategory("某个自定义类目")).toBeUndefined();
  });

  it("story 维度含六个一级特征", () => {
    expect(featuresOfDimension("story").map((feature) => feature.id)).toEqual([
      "agent", "social_net", "event", "plot", "structure", "setting",
    ]);
  });
});

describe("buildStoryTree 层级构建", () => {
  const entries: TreeEntryInput[] = [
    entry("c1", "characters", "薛行之", { fields: { name: "薛行之", roleType: "主角" } }),
    entry("c2", "characters", "方工", { fields: { name: "方工", roleType: "对手" } }),
    entry("l1", "locations", "灵科院西京分院"),
    entry("f1", "foreshadowing", "B-17异常波形", { fields: { status: "planted", plantedChapter: 1 } }),
    entry("p1", "power-system", "功法体系"),
    entry("s1", "chapter-summaries", "第 1 章 归档", { fields: { chapterNumber: 1 } }),
  ];

  it("层级是 root → 维度 → 特征 → 分类 → 条目，不依赖 parentId", () => {
    const tree = buildStoryTree({ entries });
    expect(tree.root.kind).toBe("root");

    const story = tree.root.children.find((node) => node.id === "dimension:story");
    expect(story).toBeDefined();
    const agent = story!.children.find((node) => node.id === "feature:agent");
    expect(agent).toBeDefined();
    const characters = agent!.children.find((node) => node.id === "category:characters");
    expect(characters).toBeDefined();
    // 无关系边时按名字排序（度数相同），这里只验证条目齐全与深度
    expect(characters!.children.map((node) => node.entryId).sort()).toEqual(["c1", "c2"]);
    expect(characters!.children[0]!.depth).toBe(4);
  });

  it("计数沿层级累加", () => {
    const tree = buildStoryTree({ entries });
    expect(tree.totalEntries).toBe(entries.length);
    const story = tree.root.children.find((node) => node.id === "dimension:story")!;
    const agent = story.children.find((node) => node.id === "feature:agent")!;
    expect(agent.count).toBe(2);
  });

  it("伏笔进 discourse 维度，不进 story", () => {
    const tree = buildStoryTree({ entries });
    const discourse = tree.root.children.find((node) => node.id === "dimension:discourse");
    expect(discourse).toBeDefined();
    const revelation = discourse!.children.find((node) => node.id === "feature:revelation");
    expect(revelation!.children[0]!.id).toBe("category:foreshadowing");
  });

  it("报告空特征（真实缺口），不假装齐全", () => {
    const tree = buildStoryTree({ entries });
    const emptyIds = tree.emptyFeatures.map((item) => item.feature);
    expect(emptyIds).toContain("perspective");
    expect(emptyIds).toContain("style");
  });

  it("未登记分类归入「其他」，不静默丢弃", () => {
    const tree = buildStoryTree({
      entries: [...entries, entry("x1", "我的自定义类目", "神秘条目")],
    });
    const other = tree.root.children.find((node) => node.id === "dimension:other");
    expect(other).toBeDefined();
    expect(other!.count).toBe(1);
    expect(tree.uncategorized).toBe(1);
  });

  it("按度数排序：关系枢纽排前面", () => {
    const tree = buildStoryTree({
      entries,
      relations: [
        { sourceName: "方工", targetName: "沈遥" },
        { sourceName: "方工", targetName: "李文彬" },
        { sourceName: "薛行之", targetName: "沈遥" },
      ],
    });
    const characters = tree.root.children
      .find((node) => node.id === "dimension:story")!.children
      .find((node) => node.id === "feature:agent")!.children
      .find((node) => node.id === "category:characters")!;
    // 方工度数 2 > 薛行之度数 1
    expect(characters.children.map((node) => node.label)).toEqual(["方工", "薛行之"]);
    expect(characters.children[0]!.degree).toBe(2);
  });

  it("超出上限的条目折叠计数，不一次全画", () => {
    const many = Array.from({ length: 50 }, (_, index) =>
      entry(`m${index}`, "characters", `角色${index}`, { fields: { name: `角色${index}` } }));
    const tree = buildStoryTree({ entries: many, maxEntriesPerCategory: 10 });
    const characters = tree.root.children
      .find((node) => node.id === "dimension:story")!.children
      .find((node) => node.id === "feature:agent")!.children
      .find((node) => node.id === "category:characters")!;
    expect(characters.children).toHaveLength(10);
    expect(characters.count).toBe(50);
    expect(characters.subtitle).toContain("另有 40 条未展开");
  });

  it("可按维度裁剪（工具卡里只显示相关维度）", () => {
    const tree = buildStoryTree({ entries, dimensions: ["discourse"] });
    expect(tree.root.children.map((node) => node.id)).toEqual(["dimension:discourse"]);
  });

  it("空输入不报错", () => {
    const tree = buildStoryTree({});
    expect(tree.totalEntries).toBe(0);
    expect(tree.root.children).toEqual([]);
  });

  it("整段正文当标题的条目被截断（实测存在这种脏数据）", () => {
    const long = "两年前，他背负着十五万债务，在昏暗的工位上一条八分钱敲击着别人的死亡";
    const tree = buildStoryTree({ entries: [entry("d1", "foreshadowing", long)] });
    const node = tree.root.children[0]!.children[0]!.children[0]!.children[0]!;
    expect(node.label.length).toBeLessThanOrEqual(24);
    expect(node.label.endsWith("…")).toBe(true);
    // 全文保留在 detail 里，不丢信息
    expect(node.label).not.toBe(long);
  });
});

describe("遍历与交互辅助", () => {
  const tree = buildStoryTree({
    entries: [
      entry("c1", "characters", "薛行之", { fields: { name: "薛行之" } }),
      entry("l1", "locations", "灵科院"),
    ],
  });

  it("initialExpandedIds 只展开默认展开的层（维度与特征）", () => {
    const expanded = initialExpandedIds(tree.root);
    expect(expanded.has("root")).toBe(true);
    expect(expanded.has("dimension:story")).toBe(true);
    expect(expanded.has("feature:agent")).toBe(true);
    // 分类层默认折叠，避免一次画出所有条目
    expect(expanded.has("category:characters")).toBe(false);
  });

  it("flattenVisible 只输出展开路径上的节点", () => {
    const collapsed = flattenVisible(tree.root, new Set(["root"]));
    expect(collapsed.map((node) => node.id)).toContain("dimension:story");
    expect(collapsed.map((node) => node.id)).not.toContain("feature:agent");

    const expanded = flattenVisible(tree.root, initialExpandedIds(tree.root));
    expect(expanded.map((node) => node.id)).toContain("feature:agent");
  });

  it("搜索返回命中节点及祖先链，供自动展开路径", () => {
    const hits = idsMatchingQuery(tree.root, "薛行之");
    expect(hits.has("entry:c1")).toBe(true);
    expect(hits.has("category:characters")).toBe(true);
    expect(hits.has("feature:agent")).toBe(true);
    expect(hits.has("dimension:story")).toBe(true);
  });

  it("空查询不返回任何命中", () => {
    expect(idsMatchingQuery(tree.root, "   ").size).toBe(0);
  });
});

describe("buildDegreeIndex", () => {
  it("统计每个实体名的关系度数", () => {
    const degree = buildDegreeIndex([
      { sourceName: "甲", targetName: "乙" },
      { sourceName: "甲", targetName: "丙" },
    ]);
    expect(degree.get("甲")).toBe(2);
    expect(degree.get("乙")).toBe(1);
  });

  it("忽略空名字，不产生空键", () => {
    const degree = buildDegreeIndex([{ sourceName: "", targetName: "乙" }]);
    expect(degree.has("")).toBe(false);
    expect(degree.get("乙")).toBe(1);
  });
});

describe("trimLabel", () => {
  it("空值给占位而不是空串", () => {
    expect(trimLabel(undefined)).toBe("未命名");
    expect(trimLabel("   ")).toBe("未命名");
  });

  it("短标题原样保留", () => {
    expect(trimLabel("薛行之")).toBe("薛行之");
  });
});
