import { describe, expect, it } from "vitest";

import { buildCausalGraph, UNMOUNTED_LANE_ID } from "../../../engine/narrative-taxonomy/causal-graph";
import {
  CHAPTER_LABEL_SPACE,
  LANE_COLORS,
  LANE_HEIGHT,
  LANE_LABEL_SPACE,
  laneAtY,
  initialViewport,
  laneColor,
  layoutCausalGraph,
  RAIL_SCREEN_WIDTH,
  SCENE_HEIGHT,
  SCENE_WIDTH,
  toCausalFlow,
  UNMOUNTED_COLOR,
} from "./causal-canvas-layout";

const graph = buildCausalGraph({
  storylines: [
    { id: "main", name: "主线", kind: "main" },
    { id: "romance", name: "感情线", kind: "romance" },
  ],
  scenes: [
    { id: "a", chapterNumber: 1, ordinal: 1, title: "初遇" },
    { id: "b", chapterNumber: 1, ordinal: 2, title: "拜师" },
    { id: "c", chapterNumber: 4, ordinal: 1, title: "月下", hooksPlanted: ["玉佩"] },
    { id: "d", chapterNumber: 9, ordinal: 1, title: "摊牌", hooksUsed: ["玉佩"] },
    { id: "loose", chapterNumber: 9, ordinal: 2 },
  ],
  mounts: [
    { sceneId: "a", storylineId: "main" },
    { sceneId: "b", storylineId: "main" },
    { sceneId: "c", storylineId: "romance" },
    { sceneId: "c", storylineId: "main", role: "supporting" },
    { sceneId: "d", storylineId: "main" },
  ],
});

describe("因果画布排版", () => {
  const layout = layoutCausalGraph(graph);

  it("横轴按章：只给有场景的章开列，列宽按该章在任一泳道里最多并排的场景数", () => {
    expect(layout.columns.map((column) => column.chapterNumber)).toEqual([1, 4, 9]);
    const [first, second] = layout.columns;
    expect(first!.x).toBe(LANE_LABEL_SPACE);
    // 第 1 章主线上并排两场，列比单场宽
    expect(first!.width).toBeGreaterThan(SCENE_WIDTH);
    expect(second!.x).toBeGreaterThan(first!.x + first!.width);
    expect(layout.scenePositions.get("b")!.x).toBeGreaterThan(layout.scenePositions.get("a")!.x);
  });

  it("纵轴按泳道：场景在自己泳道里垂直居中，未挂线在最下面", () => {
    const mainTop = layout.laneTops.get("main")!;
    expect(mainTop).toBe(CHAPTER_LABEL_SPACE);
    expect(layout.laneTops.get(UNMOUNTED_LANE_ID)).toBe(CHAPTER_LABEL_SPACE + 2 * LANE_HEIGHT);
    expect(layout.scenePositions.get("a")!.y).toBe(mainTop + (LANE_HEIGHT - SCENE_HEIGHT) / 2);
    // c 主挂在感情线、辅挂主线：住感情线
    expect(layout.scenePositions.get("c")!.y).toBe(layout.laneTops.get("romance")! + (LANE_HEIGHT - SCENE_HEIGHT) / 2);
    expect(layout.height).toBe(CHAPTER_LABEL_SPACE + 3 * LANE_HEIGHT);
  });

  it("拖动落点：按卡片中心判断泳道，超出上下边界取最近的", () => {
    const yIn = (laneId: string) => layout.laneTops.get(laneId)! + 10;
    expect(laneAtY(graph, yIn("romance")).id).toBe("romance");
    expect(laneAtY(graph, -500).id).toBe("main");
    expect(laneAtY(graph, 99999).id).toBe(UNMOUNTED_LANE_ID);
  });

  it("剧情线按泳道顺序取色，未挂线用灰色", () => {
    expect(laneColor(graph, "main")).toBe(LANE_COLORS[0]);
    expect(laneColor(graph, "romance")).toBe(LANE_COLORS[1]);
    expect(laneColor(graph, UNMOUNTED_LANE_ID)).toBe(UNMOUNTED_COLOR);
  });

  it("生成节点与连线：泳道底纹不可选不可拖，场景带挂载圆点；伏笔线可关", () => {
    const flow = toCausalFlow(graph, layout, { showHooks: true });
    const lanes = flow.nodes.filter((node) => node.type === "lane");
    expect(lanes).toHaveLength(3);
    expect(lanes.every((node) => node.selectable === false && node.draggable === false)).toBe(true);
    const c = flow.nodes.find((node) => node.id === "c")!;
    expect(c.type === "scene" && c.data.mountDots).toEqual([
      { color: LANE_COLORS[1], name: "感情线", primary: true },
      { color: LANE_COLORS[0], name: "主线", primary: false },
    ]);
    expect(flow.edges.filter((edge) => edge.type === "hook")).toHaveLength(1);
    expect(toCausalFlow(graph, layout, { showHooks: false }).edges.some((edge) => edge.type === "hook")).toBe(false);
  });

  it("聚焦一条线：不在这条线上的场景与别的线路变淡；搜索命中的场景标出", () => {
    const flow = toCausalFlow(graph, layout, { showHooks: false, focusLaneId: "romance", query: "摊" });
    const scene = (id: string) => flow.nodes.find((node) => node.id === id)!;
    const data = (id: string) => (scene(id).type === "scene" ? scene(id).data as { dimmed: boolean; matched: boolean } : null)!;
    expect(data("c").dimmed).toBe(false);
    expect(data("a").dimmed).toBe(true);
    expect(data("d").matched).toBe(true);
    expect(flow.edges.filter((edge) => !edge.data!.dimmed).every((edge) => edge.id.startsWith("line:romance"))).toBe(true);
  });

  it("初始视口：放得下时从第一章左对齐、不被左侧线名栏遮住；放不下时靠右先看最近几章", () => {
    const wide = initialViewport(layout, { width: 4000, height: 800 });
    expect(wide.zoom).toBe(1);
    // 第一列的屏幕位置在冻结栏右边
    expect(wide.x + layout.columns[0]!.x * wide.zoom).toBeGreaterThanOrEqual(RAIL_SCREEN_WIDTH);

    const narrow = initialViewport(layout, { width: 600, height: 800 });
    const lastColumn = layout.columns.at(-1)!;
    expect(narrow.x + (lastColumn.x + lastColumn.width) * narrow.zoom).toBeLessThanOrEqual(600);
    expect(narrow.x + layout.columns[0]!.x * narrow.zoom).toBeLessThan(RAIL_SCREEN_WIDTH);

    // 泳道太多时缩放有下限，宁可平移也不缩到看不清
    expect(initialViewport({ width: 800, height: 5000, columns: [] }, { width: 600, height: 400 }).zoom).toBe(0.55);
  });
});
