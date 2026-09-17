/**
 * 两棵正交叙事树的行为契约。
 *
 * 除了「树长对了」，这里更在意两件产品层面的事：
 *   · 正交性：同一个场景同时出现在两棵树上，且在因果树里可以出现在多条线下；
 *   · 不静默丢数据：归不进卷的章、挂不上线的场景都要看得见，并写明原因。
 * 第二条尤其重要——作者看不见的缺口最伤信任，而「树上没有」和
 * 「本来就没有」在界面上长得一模一样。
 */
import { describe, expect, it } from "vitest";

import { buildCarrierTree, buildCausalTree, type SceneTreeInput } from "./scene-trees";

function scene(id: string, chapterNumber: number, ordinal: number, extra: Partial<SceneTreeInput> = {}): SceneTreeInput {
  return { id, chapterNumber, ordinal, ...extra };
}

function childLabels(node: { children: readonly { label: string }[] }): string[] {
  return node.children.map((child) => child.label);
}

describe("承载树 卷 → 章 → 场景", () => {
  it("章按卷的区间归位，场景按章内次序挂在章下", () => {
    const forest = buildCarrierTree({
      volumes: [{ id: "v1", title: "第一卷 七玄门", chapterRange: { from: 1, to: 2 } }],
      chapters: [{ number: 1, title: "入门" }, { number: 2 }],
      scenes: [
        scene("s2", 1, 2, { title: "夜谈" }),
        scene("s1", 1, 1, { title: "拜师" }),
        scene("s3", 2, 1, { title: "试炼" }),
      ],
    });

    const volume = forest.root.children[0]!;
    expect(volume.label).toBe("第一卷 七玄门");
    expect(volume.subtitle).toBe("2 章 · 3 场");
    expect(childLabels(volume)).toEqual(["第 1 章 入门", "第 2 章"]);
    // 章内按 ordinal 排，不按插入顺序
    expect(childLabels(volume.children[0]!)).toEqual(["拜师", "夜谈"]);
  });

  it("不在任何卷区间内的章进「未归卷」，不从树上消失", () => {
    const forest = buildCarrierTree({
      volumes: [{ id: "v1", title: "第一卷", chapterRange: { from: 1, to: 2 } }],
      chapters: [{ number: 1 }, { number: 2 }, { number: 9 }],
      scenes: [scene("s1", 9, 1, { title: "孤章场景" })],
    });

    const orphanGroup = forest.root.children.find((child) => child.id === "volume:unassigned");
    expect(orphanGroup?.label).toBe("未归卷");
    expect(orphanGroup?.subtitle).toContain("不在任何卷的章节区间内");
    expect(childLabels(orphanGroup!)).toEqual(["第 9 章"]);
  });

  it("没有卷纲时全部章节铺在一组里，并说明还没有卷纲", () => {
    const forest = buildCarrierTree({ chapters: [{ number: 1 }, { number: 2 }] });
    const group = forest.root.children[0]!;
    expect(group.label).toBe("全部章节");
    expect(group.subtitle).toContain("还没有卷纲");
    expect(group.defaultExpanded).toBe(true);
  });

  it("区间重叠时章只归第一个匹配的卷，不被重复计数", () => {
    const forest = buildCarrierTree({
      volumes: [
        { id: "v1", title: "A", chapterRange: { from: 1, to: 5 } },
        { id: "v2", title: "B", chapterRange: { from: 3, to: 8 } },
      ],
      chapters: [{ number: 3 }],
    });

    expect(childLabels(forest.root.children[0]!)).toEqual(["第 3 章"]);
    expect(forest.root.children[1]!.children).toEqual([]);
  });

  it("场景落在还没有章节行的章号上时，该章仍然出现在树上", () => {
    const forest = buildCarrierTree({
      chapters: [{ number: 1 }],
      scenes: [scene("s1", 7, 1, { title: "先规划后写" })],
    });
    expect(childLabels(forest.root.children[0]!)).toEqual(["第 1 章", "第 7 章"]);
  });

  it("没拆场景的章标注出来，而不是显示成空节点让人以为加载失败", () => {
    const forest = buildCarrierTree({ chapters: [{ number: 1 }] });
    expect(forest.root.children[0]!.children[0]!.subtitle).toBe("尚未拆场景");
  });

  it("完全没有章节和场景时给出可读的空原因", () => {
    const forest = buildCarrierTree({});
    expect(forest.root.children).toEqual([]);
    expect(forest.emptyReason).toContain("还没有章节");
  });
});

describe("因果树 剧情线 → 场景", () => {
  const scenes = [
    scene("s-early", 8, 1, { title: "初遇" }),
    scene("s-late", 30, 1, { title: "决裂" }),
  ];

  it("场景按章号排，副标题直接回答「这条线上次推进是哪章」", () => {
    const forest = buildCausalTree({
      storylines: [{ id: "main", name: "夺回师门", kind: "main" }],
      scenes,
      mounts: [
        { sceneId: "s-late", storylineId: "main" },
        { sceneId: "s-early", storylineId: "main" },
      ],
    });

    const line = forest.root.children[0]!;
    expect(childLabels(line)).toEqual(["初遇", "决裂"]);
    expect(line.subtitle).toBe("主线 · 2 场 · 最近推进第 30 章");
    expect(line.defaultExpanded).toBe(true);
  });

  it("同一场景可挂在多条线下 —— 这是正交性，不是重复", () => {
    const forest = buildCausalTree({
      storylines: [
        { id: "main", name: "主线", kind: "main" },
        { id: "romance", name: "感情线", kind: "romance" },
      ],
      scenes: [scenes[0]!],
      mounts: [
        { sceneId: "s-early", storylineId: "main", role: "primary" },
        { sceneId: "s-early", storylineId: "romance", role: "supporting" },
      ],
    });

    expect(childLabels(forest.root.children[0]!)).toEqual(["初遇"]);
    expect(childLabels(forest.root.children[1]!)).toEqual(["初遇"]);
  });

  it("primaryOnly 时只看主挂载", () => {
    const forest = buildCausalTree({
      storylines: [{ id: "romance", name: "感情线", kind: "romance" }],
      scenes: [scenes[0]!],
      mounts: [{ sceneId: "s-early", storylineId: "romance", role: "supporting" }],
      primaryOnly: true,
    });
    expect(forest.root.children[0]!.children).toEqual([]);
    expect(forest.root.children[0]!.subtitle).toContain("还没有场景挂上来");
  });

  it("没挂任何线的场景进「未挂线」组，不被丢掉", () => {
    const forest = buildCausalTree({
      storylines: [{ id: "main", name: "主线", kind: "main" }],
      scenes,
      mounts: [{ sceneId: "s-early", storylineId: "main" }],
    });

    const unmounted = forest.root.children.find((child) => child.id === "storyline:unmounted");
    expect(unmounted?.count).toBe(1);
    expect(childLabels(unmounted!)).toEqual(["决裂"]);
    expect(unmounted?.subtitle).toContain("还没有归到任何剧情线");
  });

  it("有场景却没有剧情线时，空原因说清下一步该做什么", () => {
    const forest = buildCausalTree({ scenes });
    expect(forest.emptyReason).toContain("还没有剧情线");
    expect(forest.emptyReason).toContain("哪条线在推进");
  });

  it("挂载指向不存在的场景时安静跳过，不产出悬空节点", () => {
    const forest = buildCausalTree({
      storylines: [{ id: "main", name: "主线", kind: "main" }],
      scenes: [scenes[0]!],
      mounts: [
        { sceneId: "s-early", storylineId: "main" },
        { sceneId: "s-已删除", storylineId: "main" },
      ],
    });
    expect(forest.root.children[0]!.count).toBe(1);
  });
});

describe("两棵树的正交性", () => {
  it("同一个场景同时出现在承载树与因果树上", () => {
    const shared = scene("s1", 12, 1, { title: "药园夜谈" });

    const carrier = buildCarrierTree({ chapters: [{ number: 12 }], scenes: [shared] });
    const causal = buildCausalTree({
      storylines: [{ id: "main", name: "主线", kind: "main" }],
      scenes: [shared],
      mounts: [{ sceneId: "s1", storylineId: "main" }],
    });

    const inCarrier = carrier.root.children[0]!.children[0]!.children[0]!;
    const inCausal = causal.root.children[0]!.children[0]!;
    // 同一个身份，挂在两棵不同的树下
    expect(inCarrier.id).toBe(inCausal.id);
    expect(inCarrier.id).toBe("scene:s1");
  });

  it("待审状态在两棵树上都带出来，作者能分清哪些是机器猜的", () => {
    const pending = scene("s1", 1, 1, { title: "机器拆的", status: "needs-review" });
    const carrier = buildCarrierTree({ chapters: [{ number: 1 }], scenes: [pending] });
    const causal = buildCausalTree({
      storylines: [{ id: "main", name: "主线" }],
      scenes: [pending],
      mounts: [{ sceneId: "s1", storylineId: "main" }],
    });

    expect(carrier.root.children[0]!.children[0]!.children[0]!.status).toBe("needs-review");
    expect(causal.root.children[0]!.children[0]!.status).toBe("needs-review");
  });
});
