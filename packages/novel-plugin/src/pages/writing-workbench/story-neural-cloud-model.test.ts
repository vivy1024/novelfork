import { describe, expect, it } from "vitest";

import type { NarrativeEvent, NarrativeFact } from "./narrative-memory-graph-model";
import {
  activateNeuralCloud,
  buildNeuralCloudModel,
  neighborIds,
  NEURAL_CLOUD_MAX_EDGES,
  NEURAL_CLOUD_MAX_NODES,
  nodeRadius,
  pickLabeledNodeIds,
  type JingweiCloudEntry,
  type NeuralCloudEdge,
  type NeuralCloudLayoutNode,
} from "./story-neural-cloud-model";

const entries: JingweiCloudEntry[] = [
  { id: "entry-linzhou", category: "characters", title: "林舟", fields: { name: "林舟", roleType: "主角", secret: "内息来历不明", currentState: "刚入青石镇", firstChapter: 1 } },
  { id: "entry-zhouheng", category: "characters", title: "周衡", fields: { name: "周衡", roleType: "对手", firstChapter: 1 } },
  { id: "entry-town", category: "locations", title: "青石镇", fields: { name: "青石镇", locationType: "小镇", firstChapter: 2 } },
  { id: "entry-guild", category: "factions", title: "北境商会", fields: { name: "北境商会", type: "商会", firstChapter: 8 } },
  {
    id: "rel-1",
    category: "relationships",
    title: "林舟-周衡",
    fields: { sourceName: "林舟", targetName: "周衡", relationType: "冲突", sentiment: "负面", status: "对峙中", since: 1 },
  },
  {
    id: "rel-2",
    category: "relationships",
    title: "林舟-青石镇",
    fields: { sourceName: "林舟", targetName: "青石镇", relationType: "联盟", sentiment: "中性", status: "藏身", since: 2 },
  },
];

const facts: NarrativeFact[] = [
  {
    id: "f1",
    subject: "林舟",
    predicate: "抵达",
    object: "青石镇",
    category: "location",
    layer: "dynamic",
    confidence: 0.9,
    sourceChapter: 2,
    evidenceText: "青石镇的夜比城中安静。",
    subjectEntryId: "entry-linzhou",
  },
];

const events: NarrativeEvent[] = [
  {
    id: "e1",
    chapterNumber: 2,
    eventType: "location_changed",
    subject: "林舟",
    predicate: "抵达",
    object: "青石镇",
    confidence: 0.85,
    status: "applied",
    riskLevel: "low",
    evidenceText: "青石镇的夜比城中安静。",
  },
];

describe("story-neural-cloud-model", () => {
  it("点来自经纬实体，边来自关系表，不把结算流水画成点", () => {
    const model = buildNeuralCloudModel({ entries, facts, events, currentChapter: 2 });
    expect(model.nodes.find((node) => node.label === "林舟")?.entryId).toBe("entry-linzhou");
    expect(model.nodes.find((node) => node.label === "林舟")?.secret).toBe("内息来历不明");
    expect(model.nodes.find((node) => node.label === "林舟")?.currentState).toContain("抵达");
    expect(model.edges.some((edge) => edge.label === "冲突" && edge.sentiment === "负面")).toBe(true);
    expect(model.nodes.some((node) => node.label === "内息")).toBe(false);
    const spine = model.nodes.filter((node) => node.kind === "chapter").sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0));
    expect(spine[1]!.x).toBeGreaterThan(spine[0]!.x);
  });

  it("点击种子后只点亮关系邻域，不点亮无关势力", () => {
    const model = buildNeuralCloudModel({ entries, facts, events, currentChapter: 2 });
    const seed = model.nodes.find((node) => node.label === "林舟")!;
    const activation = activateNeuralCloud(model, seed.id);
    expect(activation.energyById.get(seed.id)?.energy).toBe(1);
    expect(activation.energyById.size).toBeGreaterThan(1);
    expect(activation.energyById.has(model.nodes.find((node) => node.label === "北境商会")!.id)).toBe(false);
    expect(activation.litEdgeIds.length).toBeGreaterThan(0);
  });

  it("没有经纬设定时，结算流水不会单独铺出点云", () => {
    const model = buildNeuralCloudModel({ facts, events, currentChapter: 2 });
    expect(model.nodes.filter((node) => node.kind !== "chapter")).toHaveLength(0);
  });

  it("关系边超过上限会被剪", () => {
    const dense: JingweiCloudEntry[] = Array.from({ length: 80 }, (_, index) => ({
      id: `c${index}`,
      category: "characters",
      title: `角色${index}`,
      fields: { name: `角色${index}`, firstChapter: (index % 12) + 1 },
    }));
    const rels: JingweiCloudEntry[] = Array.from({ length: 80 }, (_, index) => ({
      id: `r${index}`,
      category: "relationships",
      title: `r${index}`,
      fields: { sourceName: `角色${index}`, targetName: `角色${(index + 1) % 80}`, relationType: "联盟" },
    }));
    const model = buildNeuralCloudModel({ entries: [...dense, ...rels] });
    expect(model.nodes.length).toBeLessThanOrEqual(NEURAL_CLOUD_MAX_NODES);
    expect(model.edges.length).toBeLessThanOrEqual(NEURAL_CLOUD_MAX_EDGES);
  });
});

describe("视觉基元（避免叠墙/糊字）", () => {
  it("nodeRadius 按 sqrt(degree) 增长且有上界，超级节点不会压住周围", () => {
    expect(nodeRadius(0)).toBeCloseTo(3.2, 5);
    const d4 = nodeRadius(4);
    const d16 = nodeRadius(16);
    // sqrt: 度数翻 4 倍，增量只翻 2 倍（线性会翻 4 倍）
    expect(d16 - 3.2).toBeCloseTo((d4 - 3.2) * 2, 5);
    expect(nodeRadius(10_000)).toBeLessThanOrEqual(9);
  });

  it("nodeRadius 对非法度数退化为基准值，不产生 NaN 半径", () => {
    expect(nodeRadius(Number.NaN)).toBeCloseTo(3.2, 5);
    expect(nodeRadius(-5)).toBeCloseTo(3.2, 5);
  });

  it("pickLabeledNodeIds 按缩放分级限制标签数量", () => {
    const nodes: NeuralCloudLayoutNode[] = Array.from({ length: 60 }, (_, index) => ({
      id: `n${index}`,
      kind: "character",
      label: `节点${index}`,
      x: index,
      y: 0,
      radius: 3,
    }));
    const edges: NeuralCloudEdge[] = nodes.slice(1).map((node, index) => ({
      id: `e${index}`,
      source: "n0",
      target: node.id,
      weight: 0.5,
      kind: "relation",
    }));

    expect(pickLabeledNodeIds(nodes, edges, 0.5).size).toBe(12);
    expect(pickLabeledNodeIds(nodes, edges, 0.8).size).toBe(22);
    expect(pickLabeledNodeIds(nodes, edges, 1.0).size).toBe(40);
    // 放大到看细节时全显
    expect(pickLabeledNodeIds(nodes, edges, 1.4).size).toBe(nodes.length);
    // 度数最高的中心节点一定入选
    expect(pickLabeledNodeIds(nodes, edges, 0.5).has("n0")).toBe(true);
  });

  it("neighborIds 返回自身与一跳邻居，供 hover focus 使用", () => {
    const edges: NeuralCloudEdge[] = [
      { id: "e1", source: "a", target: "b", weight: 1, kind: "relation" },
      { id: "e2", source: "c", target: "a", weight: 1, kind: "relation" },
      { id: "e3", source: "d", target: "e", weight: 1, kind: "relation" },
    ];
    const focus = neighborIds(edges, "a");
    expect([...focus].sort()).toEqual(["a", "b", "c"]);
    // 无关节点不进焦点集（渲染层据此淡化）
    expect(focus.has("d")).toBe(false);
  });
});
