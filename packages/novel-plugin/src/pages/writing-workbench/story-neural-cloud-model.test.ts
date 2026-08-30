import { describe, expect, it } from "vitest";

import type { NarrativeEvent, NarrativeFact } from "./narrative-memory-graph-model";
import {
  activateNeuralCloud,
  buildNeuralCloudModel,
  NEURAL_CLOUD_MAX_EDGES,
  NEURAL_CLOUD_MAX_NODES,
  type JingweiCloudEntry,
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
