import { describe, expect, it } from "vitest";

import {
  commonRelations,
  defaultFocusEntity,
  egoNetwork,
  entityRelationSummary,
  isRelationActiveAt,
  relationHistory,
  relationPath,
  relationsAtChapter,
  relationTrend,
  scoreRelationPolarity,
  sharedEventCount,
  type GraphEntity,
  type GraphRelation,
  type RelationGraphData,
  type RelationHistoryItem,
} from "./relation-graph.js";

function entity(id: string, name: string): GraphEntity {
  return { id, entryId: `entry-${id}`, name, type: "character", firstChapter: null, lastChapter: null };
}

function rel(id: string, subjectId: string, objectId: string, predicate: string, validFrom: number | null, validTo: number | null = null): GraphRelation {
  return { id, subjectId, objectId, predicate, relationKind: "relationship", sentiment: null, validFrom, validTo, sourceEventId: null, evidence: `证据-${id}`, confidence: 0.9 };
}

const entities = [entity("xue", "薛行之"), entity("fang", "方工"), entity("lin", "林薇"), entity("shen", "沈遥"), entity("song", "宋崇礼"), entity("lone", "路人")];

const data: RelationGraphData = {
  bookId: "book-1",
  schemaMissing: false,
  entities,
  relations: [
    rel("r1", "xue", "fang", "事故复核协作关系", 12),
    rel("r2", "fang", "xue", "作保与连带同盟关系", 15),
    rel("r3", "xue", "lin", "OpenQi事故处理协作关系", 10, 14),
    rel("r4", "lin", "shen", "安全判断共识", 13),
    rel("r5", "shen", "song", "初识获赏识", 17),
    rel("r6", "fang", "lin", "旧识", 3),
  ],
  participations: [
    { eventId: "e1", entityId: "xue", chapter: 12 },
    { eventId: "e1", entityId: "fang", chapter: 12 },
    { eventId: "e2", entityId: "xue", chapter: 15 },
    { eventId: "e2", entityId: "fang", chapter: 15 },
    { eventId: "e3", entityId: "xue", chapter: 20 },
    { eventId: "e3", entityId: "fang", chapter: 20 },
    { eventId: "e4", entityId: "xue", chapter: 10 },
    { eventId: "e4", entityId: "lin", chapter: 10 },
  ],
};

describe("时间切片：第 N 章时的关系", () => {
  it("valid_from ≤ N 且 valid_to 为空或 > N；不给 N 取至今（valid_to 为空）", () => {
    expect(isRelationActiveAt(rel("x", "a", "b", "p", 5, 8), 4)).toBe(false);
    expect(isRelationActiveAt(rel("x", "a", "b", "p", 5, 8), 5)).toBe(true);
    expect(isRelationActiveAt(rel("x", "a", "b", "p", 5, 8), 7)).toBe(true);
    expect(isRelationActiveAt(rel("x", "a", "b", "p", 5, 8), 8)).toBe(false);
    expect(isRelationActiveAt(rel("x", "a", "b", "p", null), 1)).toBe(true);
    expect(relationsAtChapter(data, 12).map((r) => r.id)).toEqual(["r6", "r3", "r1"]);
    expect(relationsAtChapter(data, 14).map((r) => r.id)).toEqual(["r6", "r1", "r4"]);
    expect(relationsAtChapter(data).map((r) => r.id)).toEqual(["r6", "r1", "r4", "r2", "r5"]);
    expect(relationsAtChapter(data, 12, "lin").map((r) => r.id)).toEqual(["r6", "r3"]);
  });

  it("关系史两个方向都算、按章排序，给了章号不剧透之后的关系", () => {
    expect(relationHistory(data, "xue", "fang").map((item) => [item.relationId, item.validFrom])).toEqual([["r1", 12], ["r2", 15]]);
    expect(relationHistory(data, "fang", "xue", 13).map((item) => item.relationId)).toEqual(["r1"]);
    const lin = relationHistory(data, "xue", "lin", 20);
    expect(lin).toHaveLength(1);
    expect(lin[0]).toMatchObject({ active: false, validTo: 14, evidence: "证据-r3" });
  });

  it("共同事件数只算截至第 N 章的事件", () => {
    expect(sharedEventCount(data, "xue", "fang")).toBe(3);
    expect(sharedEventCount(data, "xue", "fang", 15)).toBe(2);
    expect(sharedEventCount(data, "xue", "lin", 9)).toBe(0);
  });
});

describe("焦点人物网络", () => {
  it("1 跳只含直接关系人；边带当前有效谓词与共同事件数", () => {
    const network = egoNetwork(data, "xue", { hops: 1 })!;
    expect(network.nodes.map((node) => [node.id, node.hop])).toEqual([["xue", 0], ["fang", 1]]);
    expect(network.edges).toHaveLength(1);
    expect(network.edges[0]).toMatchObject({ source: "xue", target: "fang", relationCount: 2, sharedEvents: 3, latestPredicate: "作保与连带同盟关系", trend: "warming" });
    expect(network.edges[0]!.predicates).toEqual(["事故复核协作关系", "作保与连带同盟关系"]);
  });

  it("2 跳经由一跳节点展开，并连上被纳入节点之间的边；截止章改变网络", () => {
    const now = egoNetwork(data, "xue", { hops: 2 })!;
    expect(now.nodes.map((node) => [node.id, node.hop, node.via])).toEqual([["xue", 0, null], ["fang", 1, null], ["lin", 2, "fang"]]);
    expect(now.edges.map((edge) => `${edge.source}-${edge.target}`)).toEqual(["fang-lin", "xue-fang"]);

    const at12 = egoNetwork(data, "xue", { hops: 2, chapter: 12 })!;
    // 第 12 章时薛行之与林薇的协作还成立，林薇是一跳；方工与林薇的旧识把两位一跳连起来。
    expect(at12.nodes.map((node) => [node.id, node.hop])).toEqual([["xue", 0], ["fang", 1], ["lin", 1]]);
    expect(at12.edges.map((edge) => `${edge.source}-${edge.target}`).sort()).toEqual(["fang-lin", "xue-fang", "xue-lin"]);
    // 沈遥第 13 章才出现，不在第 12 章的网里
    expect(at12.nodes.some((node) => node.id === "shen")).toBe(false);
  });

  it("结果稳定、可截断；焦点不存在返回 null", () => {
    expect(egoNetwork(data, "xue", { hops: 2 })).toEqual(egoNetwork(data, "xue", { hops: 2 }));
    const capped = egoNetwork(data, "lin", { hops: 2, maxFirstHop: 1, chapter: 13 })!;
    expect(capped.nodes.filter((node) => node.hop === 1)).toHaveLength(1);
    expect(capped.omitted).toBeGreaterThan(0);
    expect(egoNetwork(data, "nobody")).toBeNull();
  });

  it("边的颜色看最近一条有倾向的关系，中性描述不盖掉之前的同盟", () => {
    const withNeutral: RelationGraphData = { ...data, relations: [...data.relations, rel("r7", "fang", "xue", "追加人情债关系", 25)] };
    const edge = egoNetwork(withNeutral, "xue")!.edges.find((item) => item.target === "fang")!;
    expect(edge.latestPredicate).toBe("追加人情债关系");
    expect(edge.latestPolarity).toMatchObject({ score: 2, label: "紧密" });
  });

  it("默认焦点取有效关系最多的实体；没有关系时为 null", () => {
    expect(defaultFocusEntity(data)).toBe("fang");
    expect(defaultFocusEntity({ ...data, relations: [] })).toBeNull();
  });
});

describe("共同关系人与路径", () => {
  it("共同关系人按当前有效关系算", () => {
    expect(commonRelations(data, "xue", "shen", 13).map((item) => item.entity.id)).toEqual(["lin"]);
    expect(commonRelations(data, "xue", "shen")).toEqual([]);
    const common = commonRelations(data, "fang", "shen", 13);
    expect(common[0]).toMatchObject({ entity: { id: "lin" }, withA: ["旧识"], withB: ["安全判断共识"] });
  });

  it("最短路径按章切片；不连通返回 null", () => {
    expect(relationPath(data, "xue", "song")?.map((step) => `${step.from}>${step.to}`)).toEqual(["xue>fang", "fang>lin", "lin>shen", "shen>song"]);
    expect(relationPath(data, "xue", "lone")).toBeNull();
    expect(relationPath(data, "xue", "song", { chapter: 13 })).toBeNull();
  });
});

describe("关系倾向与趋势规则", () => {
  it("谓词关键词分档，负向优先，否定词让正向转冷", () => {
    expect(scoreRelationPolarity("作保与连带同盟关系")).toMatchObject({ score: 2, label: "紧密", keyword: "同盟" });
    expect(scoreRelationPolarity("事故复核协作关系")).toMatchObject({ score: 1, keyword: "协作" });
    expect(scoreRelationPolarity("背叛盟友")).toMatchObject({ score: -2, keyword: "背叛" });
    expect(scoreRelationPolarity("不再信任")).toMatchObject({ score: -1, label: "紧张" });
    expect(scoreRelationPolarity("追加人情债关系")).toMatchObject({ score: null, keyword: null });
    expect(scoreRelationPolarity("随便什么", "hostile")).toMatchObject({ score: -2 });
  });

  const item = (chapter: number, predicate: string): RelationHistoryItem => ({
    relationId: `r${chapter}`, subjectId: "a", objectId: "b", predicate, validFrom: chapter, validTo: null, active: true,
    evidence: null, confidence: 1, polarity: scoreRelationPolarity(predicate),
  });

  it("升温 / 恶化 / 起伏 / 平稳 / 数据不足", () => {
    expect(relationTrend([item(1, "协作"), item(3, "人情债"), item(5, "结盟")]).kind).toBe("warming");
    expect(relationTrend([item(1, "结盟"), item(4, "猜忌"), item(6, "决裂")]).kind).toBe("worsening");
    const up_down = relationTrend([item(1, "协作"), item(2, "同盟"), item(3, "背叛")]);
    expect(up_down.kind).toBe("fluctuating");
    expect(up_down.explanation).toContain("转折 1 次");
    expect(up_down.explanation).toContain("第 3 章「背叛」(敌对)");
    expect(relationTrend([item(1, "协作"), item(9, "合作")]).kind).toBe("stable");
    const thin = relationTrend([item(1, "协作"), item(2, "人情债")]);
    expect(thin.kind).toBe("insufficient");
    expect(thin.label).toBe("数据不足");
    expect(thin.explanation).toContain("只有 1 条");
    expect(relationTrend([]).explanation).toContain("还没有关系记录");
  });
});

describe("实体关系汇总", () => {
  it("按实体 id 汇总当前关系与关系史；不存在的实体返回 null", () => {
    const summary = entityRelationSummary(data, "xue", 15)!;
    expect(summary.counterparts.map((item) => [item.entity.id, item.current.length, item.history.length])).toEqual([
      ["fang", 2, 2],
      ["lin", 0, 1],
    ]);
    expect(summary.counterparts[0]!.trend.kind).toBe("warming");
    expect(entityRelationSummary(data, "nobody")).toBeNull();
  });
});
