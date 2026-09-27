import { describe, expect, it } from "vitest";

import { buildCausalGraph, UNMOUNTED_LANE_ID, type CausalSceneInput } from "./causal-graph";

function scene(id: string, chapterNumber: number, ordinal: number, patch: Partial<CausalSceneInput> = {}): CausalSceneInput {
  return { id, chapterNumber, ordinal, ...patch };
}

const main = { id: "main", name: "夺回师门", kind: "main" };
const romance = { id: "romance", name: "感情线", kind: "romance" };

describe("因果图：剧情线 × 场景", () => {
  it("同一场景服务两条线时只出现一次：住在主挂载的泳道，另一条线跨泳道经过它", () => {
    const graph = buildCausalGraph({
      storylines: [main, romance],
      scenes: [scene("a", 1, 1), scene("shared", 2, 1), scene("c", 3, 1)],
      mounts: [
        { sceneId: "a", storylineId: "main" },
        { sceneId: "shared", storylineId: "romance", role: "supporting" },
        { sceneId: "shared", storylineId: "main", role: "primary" },
        { sceneId: "c", storylineId: "romance" },
      ],
    });
    expect(graph.scenes.filter((node) => node.scene.id === "shared")).toHaveLength(1);
    const shared = graph.scenes.find((node) => node.scene.id === "shared")!;
    expect(shared.laneId).toBe("main");
    expect(shared.mounts).toEqual([
      { storylineId: "main", role: "primary" },
      { storylineId: "romance", role: "supporting" },
    ]);
    // 感情线：shared → c，跨泳道
    expect(graph.lineLinks.filter((link) => link.storylineId === "romance").map((link) => [link.source, link.target])).toEqual([["shared", "c"]]);
    expect(graph.lineLinks.filter((link) => link.storylineId === "main").map((link) => [link.source, link.target])).toEqual([["a", "shared"]]);
  });

  it("只有辅助挂载的场景住在第一条辅助挂载的线上", () => {
    const graph = buildCausalGraph({
      storylines: [main, romance],
      scenes: [scene("s", 1, 1)],
      mounts: [{ sceneId: "s", storylineId: "romance", role: "supporting" }],
    });
    expect(graph.scenes[0]!.laneId).toBe("romance");
  });

  it("线上的场景按章号与章内次序串起来，泳道说明最近推进到哪章", () => {
    const graph = buildCausalGraph({
      storylines: [main],
      scenes: [scene("late", 30, 1, { title: "决裂" }), scene("early", 8, 2, { title: "初遇" }), scene("earliest", 8, 1)],
      mounts: [
        { sceneId: "late", storylineId: "main" },
        { sceneId: "early", storylineId: "main" },
        { sceneId: "earliest", storylineId: "main" },
      ],
    });
    expect(graph.lineLinks.map((link) => `${link.source}>${link.target}`)).toEqual(["earliest>early", "early>late"]);
    expect(graph.lanes[0]).toMatchObject({ label: "夺回师门", kindLabel: "主线", sceneCount: 3, lastChapter: 30 });
    expect(graph.chapters).toEqual([8, 30]);
  });

  it("没挂任何线的场景住进「未挂线」泳道，不被丢掉；这条泳道始终在，作为摘下挂载的落点", () => {
    const graph = buildCausalGraph({ storylines: [main], scenes: [scene("s", 1, 1)], mounts: [] });
    expect(graph.scenes[0]!.laneId).toBe(UNMOUNTED_LANE_ID);
    expect(graph.lanes.map((lane) => lane.id)).toEqual(["main", UNMOUNTED_LANE_ID]);
    expect(graph.lanes[1]).toMatchObject({ label: "未挂线", sceneCount: 1 });

    const empty = buildCausalGraph({});
    expect(empty.lanes.map((lane) => lane.id)).toEqual([UNMOUNTED_LANE_ID]);
    expect(empty.scenes).toEqual([]);
  });

  it("挂载指向已删除的场景或剧情线时安静跳过，不产出悬空连线", () => {
    const graph = buildCausalGraph({
      storylines: [main],
      scenes: [scene("s", 1, 1)],
      mounts: [
        { sceneId: "s", storylineId: "main" },
        { sceneId: "已删除", storylineId: "main" },
        { sceneId: "s", storylineId: "已删除的线" },
      ],
    });
    expect(graph.scenes[0]!.mounts).toEqual([{ storylineId: "main", role: "primary" }]);
    expect(graph.lineLinks).toEqual([]);
    expect(graph.lanes[0]!.sceneCount).toBe(1);
  });

  it("进行中的线超过阈值没推进标为停滞；已收束的线不算", () => {
    const graph = buildCausalGraph({
      storylines: [main, { id: "done", name: "旧案", kind: "mystery", lifecycle: "resolved" }, romance],
      scenes: [scene("a", 2, 1), scene("b", 3, 1), scene("c", 9, 1)],
      mounts: [
        { sceneId: "a", storylineId: "main" },
        { sceneId: "b", storylineId: "done" },
        { sceneId: "c", storylineId: "romance" },
      ],
      currentChapter: 10,
      stalledGap: 3,
    });
    const lane = (id: string) => graph.lanes.find((candidate) => candidate.id === id)!;
    expect(lane("main").stalledChapters).toBe(8);
    expect(lane("done").stalledChapters).toBeUndefined();
    expect(lane("romance").stalledChapters).toBeUndefined();
  });

  it("伏笔：回收连到之前最近一次埋下它的场景，标签换成经纬伏笔标题；没人回收的钩子记为悬置", () => {
    const graph = buildCausalGraph({
      storylines: [main],
      scenes: [
        scene("plant-1", 1, 1, { hooksPlanted: ["玉佩"] }),
        scene("plant-2", 3, 1, { hooksPlanted: ["玉佩", " 血书 "] }),
        scene("use", 5, 1, { hooksUsed: ["玉佩"] }),
        scene("paid", 6, 1, { hooksPlanted: ["旧誓"] }),
      ],
      mounts: [],
      foreshadows: [
        { id: "f-1", entryId: "entry-yupei", title: "母亲留下的玉佩", status: "planted" },
        { id: "旧誓", title: "旧誓", status: "paid_off" },
      ],
    });
    expect(graph.hookLinks).toEqual([
      expect.objectContaining({ source: "plant-2", target: "use", hook: "玉佩", label: "玉佩" }),
    ]);
    const node = (id: string) => graph.scenes.find((candidate) => candidate.scene.id === id)!;
    expect(node("plant-2").openHooks).toEqual(["血书"]);
    // 更早那次埋设之后被再次埋下并回收——它自己没人回收，照实记为悬置
    expect(node("plant-1").openHooks).toEqual(["玉佩"]);
    // 经纬里已标回收的不算悬置
    expect(node("paid").openHooks).toEqual([]);

    const labelled = buildCausalGraph({
      scenes: [scene("p", 1, 1, { hooksPlanted: ["entry-yupei"] }), scene("u", 2, 1, { hooksUsed: ["entry-yupei"] })],
      foreshadows: [{ id: "f-1", entryId: "entry-yupei", title: "母亲留下的玉佩" }],
    });
    expect(labelled.hookLinks[0]!.label).toBe("母亲留下的玉佩");
  });

  it("同一章里先埋后收也连得上；只在后面的场景回收才算", () => {
    const graph = buildCausalGraph({
      scenes: [scene("later", 4, 2, { hooksUsed: ["暗号"] }), scene("earlier", 4, 1, { hooksPlanted: ["暗号"] }), scene("before", 3, 1, { hooksUsed: ["暗号"] })],
    });
    expect(graph.hookLinks.map((link) => `${link.source}>${link.target}`)).toEqual(["earlier>later"]);
  });
});
