import { describe, expect, it } from "vitest";

import { CATEGORY_META } from "../../engine/jingwei/unified-categories";
import {
  LOW_CONFIDENCE_THRESHOLD,
  MEMORY_FACT_CATEGORY_OPTIONS,
  categoriesForWorkspace,
  factCategoryLabel,
  factSourceLabel,
  groupEntriesByCategory,
  isLowConfidence,
  isSettingsCategory,
  jingweiCategoryLabel,
  jingweiLayerLabel,
  memoryFactLabel,
  workspaceForCategory,
  workspaceForEntry,
} from "./lore-workspace-split";

describe("workspaceForCategory", () => {
  it("把随剧情推进的分类归到进度侧", () => {
    for (const category of ["relationships", "conflicts", "foreshadowing", "timeline", "chapter-summaries", "outline"]) {
      expect(workspaceForCategory(category), category).toBe("progress");
    }
  });

  it("把可作为 canon 基线的分类归到设定侧", () => {
    for (const category of ["premise", "world-model", "characters", "factions", "locations", "props", "power-system", "rules"]) {
      expect(workspaceForCategory(category), category).toBe("settings");
    }
  });

  it("完全由 CATEGORY_META.defaultLayer 推导，不另存名单", () => {
    for (const meta of CATEGORY_META) {
      const expected = meta.defaultLayer === "dynamic" ? "progress" : "settings";
      expect(workspaceForCategory(meta.id), meta.id).toBe(expected);
    }
  });

  it("归一化脏分类值后再判断", () => {
    expect(workspaceForCategory("character")).toBe(workspaceForCategory("characters"));
    expect(workspaceForCategory("完全不存在的分类")).toBe("settings");
  });

  it("每个分类恰好属于一个工作区", () => {
    const settings = categoriesForWorkspace("settings");
    const progress = categoriesForWorkspace("progress");
    expect(settings.length + progress.length).toBe(CATEGORY_META.length);
    expect(settings.filter((id) => progress.includes(id))).toEqual([]);
  });

  it("categoriesForWorkspace 保留 CATEGORY_META 顺序", () => {
    const order = CATEGORY_META.map((meta) => meta.id);
    const settings = categoriesForWorkspace("settings");
    const positions = settings.map((id) => order.indexOf(id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("isSettingsCategory 与 workspaceForCategory 一致", () => {
    for (const meta of CATEGORY_META) {
      expect(isSettingsCategory(meta.id)).toBe(workspaceForCategory(meta.id) === "settings");
    }
  });
});

describe("workspaceForEntry", () => {
  it("不再按标题猜层级：叫「时间线」的角色条目仍归设定侧", () => {
    expect(workspaceForEntry({ category: "characters", title: "时间线" })).toBe("settings");
    expect(workspaceForEntry({ category: "characters", title: "人物关系" })).toBe("settings");
  });

  it("动态分类不因标题普通就被当成设定", () => {
    expect(workspaceForEntry({ category: "foreshadowing", title: "青铜镜的来历" })).toBe("progress");
  });

  it("缺失分类按未分类处理", () => {
    expect(workspaceForEntry({ title: "无分类条目" })).toBe("settings");
  });
});

describe("groupEntriesByCategory", () => {
  const entries = [
    { id: "a", category: "characters", title: "林舟" },
    { id: "b", category: "character", title: "苏晚" },
    { id: "c", category: "foreshadowing", title: "旧伤" },
    { id: "d", category: "premise", title: "核心卖点" },
    { id: "e", category: "chapter-summaries", title: "第 1 章" },
  ];

  it("只返回目标工作区且非空的分类", () => {
    const groups = groupEntriesByCategory(entries, "settings");
    expect(groups.map((g) => g.category)).toEqual(["premise", "characters"]);
    expect(groups.find((g) => g.category === "characters")?.entries).toHaveLength(2);
  });

  it("进度侧只收动态分类", () => {
    const groups = groupEntriesByCategory(entries, "progress");
    expect(groups.map((g) => g.category)).toEqual(["foreshadowing", "chapter-summaries"]);
  });

  it("两个工作区加起来不丢条目、不重复计数", () => {
    const total = [...groupEntriesByCategory(entries, "settings"), ...groupEntriesByCategory(entries, "progress")]
      .reduce((sum, group) => sum + group.entries.length, 0);
    expect(total).toBe(entries.length);
  });

  it("空输入返回空数组", () => {
    expect(groupEntriesByCategory([], "settings")).toEqual([]);
  });
});

describe("memoryFactLabel", () => {
  it("翻译已知记忆通道", () => {
    expect(memoryFactLabel("hook")).toBe("伏笔");
    expect(memoryFactLabel("world_fact")).toBe("世界事实");
  });

  it("未知通道原样返回而不是报错", () => {
    expect(memoryFactLabel("brand_new_channel")).toBe("brand_new_channel");
  });
});

describe("资料卡的作者说法", () => {
  it("经纬分类显示 CATEGORY_META 中文名，旧分类名也认得", () => {
    expect(jingweiCategoryLabel("characters")).toBe("角色");
    expect(jingweiCategoryLabel("character")).toBe("角色");
    expect(jingweiCategoryLabel("world-model")).toBe("世界模型");
    expect(jingweiCategoryLabel("unclassified")).toBe("未分类");
    // 认不出的不硬归「未分类」，原样显示（多半是作者自己写的中文）
    expect(jingweiCategoryLabel("门派秘闻")).toBe("门派秘闻");
  });

  it("层级按 CATEGORY_META 的含义说人话", () => {
    expect(jingweiLayerLabel("canon")).toBe("固定设定");
    expect(jingweiLayerLabel("dynamic")).toBe("随剧情变化");
    expect(jingweiLayerLabel("reference")).toBe("按需查阅");
  });

  it("记忆事实分类：记忆通道名与经纬分类名都翻成中文", () => {
    expect(factCategoryLabel("state")).toBe("状态");
    expect(factCategoryLabel("character_state")).toBe("角色状态");
    expect(factCategoryLabel("inventory")).toBe("持有物品");
    expect(factCategoryLabel("characters")).toBe("角色");
    expect(factCategoryLabel("自定义")).toBe("自定义");
    expect(MEMORY_FACT_CATEGORY_OPTIONS.every((option) => !/^[a-z_]+$/u.test(option.label))).toBe(true);
  });

  it("来源说成作者手填 / 章后结算 / 导入，未知来源不露代号", () => {
    expect(factSourceLabel("manual")).toBe("作者手填");
    expect(factSourceLabel("event")).toBe("章后结算");
    expect(factSourceLabel("import")).toBe("导入");
    expect(factSourceLabel("jingwei")).toBe("作品设定");
    expect(factSourceLabel("runtime-state")).toBe("章节状态推算");
    expect(factSourceLabel("weird")).toBe("其他来源");
  });

  it("只有低于阈值的置信度才算「不太确定」", () => {
    expect(LOW_CONFIDENCE_THRESHOLD).toBe(0.6);
    expect(isLowConfidence(0.59)).toBe(true);
    expect(isLowConfidence(0.6)).toBe(false);
    expect(isLowConfidence(1)).toBe(false);
    expect(isLowConfidence(undefined)).toBe(false);
  });
});
