import { describe, expect, it } from "vitest";

import {
  buildNarrativeGraphModel,
  displayLabel,
  isNarrativeMemoryView,
  viewFromLabel,
  type GraphNodeModel,
  type NarrativeEvent,
  type NarrativeFact,
  type NarrativeMemoryView,
} from "./narrative-memory-graph-model";

const facts: NarrativeFact[] = [
  {
    id: "fact-1",
    subject: "薛建国",
    predicate: "职业暴露病情需要",
    object: "自费转诊",
    category: "relationship",
    layer: "dynamic",
    confidence: 0.99,
    sourceChapter: 1,
    evidenceText: "小腿肿了，要转市二院职业病科。",
  },
  {
    id: "fact-2",
    subject: "薛行之",
    predicate: "触碰异常波形时出现",
    object: "指尖电流与异常感知",
    category: "character_state",
    layer: "dynamic",
    confidence: 0.98,
    sourceChapter: 1,
  },
  {
    id: "fact-3",
    subject: "薛行之",
    predicate: "异常感知伴随",
    object: "鼻血",
    category: "conflict",
    layer: "dynamic",
    confidence: 0.98,
    sourceChapter: 2,
  },
  {
    id: "fact-4",
    subject: "鼻血",
    predicate: "留下疑点",
    object: "只可作为未解异常现象归档",
    category: "world_fact",
    layer: "dynamic",
    confidence: 0.88,
    sourceChapter: 3,
  },
];

const events: NarrativeEvent[] = [
  {
    id: "event-1",
    chapterNumber: 1,
    eventType: "character_state_changed",
    subject: "薛行之",
    predicate: "触碰异常波形时出现",
    object: "指尖电流与异常感知",
    confidence: 0.98,
    status: "applied",
    riskLevel: "medium",
    evidenceText: "薛行之触碰到那条波形，电流就窜了上来。",
  },
  {
    id: "event-2",
    chapterNumber: 2,
    eventType: "character_state_changed",
    subject: "薛行之",
    predicate: "异常感知伴随",
    object: "鼻血",
    confidence: 0.98,
    status: "applied",
    riskLevel: "medium",
    evidenceText: "薛行之回过神，鼻血滴在键盘上。",
  },
  {
    id: "event-3",
    chapterNumber: 3,
    eventType: "world_fact_introduced",
    subject: "周工离职",
    predicate: "留下疑点",
    object: "提交疑似标注后离开",
    confidence: 0.9,
    status: "applied",
    riskLevel: "high",
    evidenceText: "周工提交标注后离职。",
  },
];

function overlaps(a: GraphNodeModel, b: GraphNodeModel): boolean {
  return !(
    a.position.x + a.width <= b.position.x
    || b.position.x + b.width <= a.position.x
    || a.position.y + a.height <= b.position.y
    || b.position.y + b.height <= a.position.y
  );
}

function expectFiniteUniqueLayout(nodes: readonly GraphNodeModel[]): void {
  const positions = new Set<string>();
  for (const node of nodes) {
    expect(Number.isFinite(node.position.x)).toBe(true);
    expect(Number.isFinite(node.position.y)).toBe(true);
    const key = `${node.position.x}:${node.position.y}`;
    expect(positions.has(key)).toBe(false);
    positions.add(key);
  }
}

function nodeCenter(node: GraphNodeModel): { x: number; y: number } {
  return { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
}

function distanceFrom(node: GraphNodeModel, center: GraphNodeModel): number {
  const point = nodeCenter(node);
  const origin = nodeCenter(center);
  return Math.hypot(point.x - origin.x, point.y - origin.y);
}

function layoutSize(nodes: readonly GraphNodeModel[]): { width: number; height: number } {
  const minX = Math.min(...nodes.map((node) => node.position.x));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  const maxX = Math.max(...nodes.map((node) => node.position.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.position.y + node.height));
  return { width: maxX - minX, height: maxY - minY };
}

describe("narrative-memory-graph-model", () => {
  it("截断画布标签但保留原始实体标题", () => {
    const long = "这是一个非常长的真实小说实体或状态描述用于验证截断";
    expect(displayLabel(long, 12)).toBe("这是一个非常长的真实小…");
    const model = buildNarrativeGraphModel({ facts: [{ ...facts[0]!, id: "long", subject: long }], events: [], view: "relationship" });
    const node = model.nodes.find((item) => item.entityName === long);
    expect(node?.title).toBe(long);
    expect(node?.displayTitle.length).toBeLessThan(node?.title.length ?? 0);
  });

  it("关系图去重实体与边并产生稳定无重叠布局", () => {
    const model = buildNarrativeGraphModel({ facts: [...facts, { ...facts[0]!, id: "fact-1" }], events: [], view: "relationship", focusEntity: "薛行之" });
    expect(model.nodes.filter((node) => node.kind === "entity")).toHaveLength(6);
    expect(model.edges).toHaveLength(4);
    expect(model.nodes.find((node) => node.entityName === "薛行之")?.depth).toBe(0);
    expectFiniteUniqueLayout(model.nodes);
    for (let left = 0; left < model.nodes.length; left += 1) {
      for (let right = left + 1; right < model.nodes.length; right += 1) {
        expect(overlaps(model.nodes[left]!, model.nodes[right]!)).toBe(false);
      }
    }
  });

  it.each<[NarrativeMemoryView, "entity" | "event", number]>([
    ["timeline", "event", 2],
    ["character_arc", "event", 1],
    ["event_chain", "event", 2],
    ["conflict", "entity", 4],
  ])("为 %s 生成专属节点与连线", (view, kind, minimumEdges) => {
    const model = buildNarrativeGraphModel({ facts, events, view });
    expect(model.nodes.some((node) => node.kind === kind)).toBe(true);
    expect(model.edges.length).toBeGreaterThanOrEqual(minimumEdges);
    expectFiniteUniqueLayout(model.nodes);
  });

  it("角色弧按角色分 lane 并按章节向右推进", () => {
    const model = buildNarrativeGraphModel({ facts, events, view: "character_arc" });
    const arc = model.nodes.filter((node) => node.entityName === "薛行之").sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0));
    expect(arc).toHaveLength(2);
    expect(arc[0]?.lane).toBe("薛行之");
    expect(arc[1]!.position.x).toBeGreaterThan(arc[0]!.position.x);
  });

  it("浪潮视图以聚焦实体为中心并把事件放到外圈", () => {
    const model = buildNarrativeGraphModel({ facts, events, view: "wave", focusEntity: "薛行之" });
    const center = model.nodes.find((node) => node.entityName === "薛行之" && node.kind === "entity");
    const direct = model.nodes.find((node) => node.entityName === "鼻血" && node.kind === "entity");
    const eventNode = model.nodes.find((node) => node.kind === "event");
    expect(center?.id).toBe(model.focusNodeId);
    expect(center?.depth).toBe(0);
    expect(direct?.depth).toBe(1);
    expect(eventNode).toBeDefined();
    expect(eventNode && center ? distanceFrom(eventNode, center) : 0).toBeGreaterThan(direct && center ? distanceFrom(direct, center) : 0);
    expectFiniteUniqueLayout(model.nodes);
  });

  it("高密度浪潮视图使用紧凑同心环并保持确定性无重叠", () => {
    const denseFacts = Array.from({ length: 18 }, (_, index): NarrativeFact => ({
      ...facts[0]!,
      id: `dense-fact-${index}`,
      subject: index === 0 ? "中心角色" : `角色-${index}`,
      predicate: `传播关系-${index}`,
      object: `目标-${index}`,
      sourceChapter: index + 1,
    }));
    const denseEvents = Array.from({ length: 16 }, (_, index): NarrativeEvent => ({
      ...events[0]!,
      id: `dense-event-${index}`,
      chapterNumber: index + 1,
      subject: denseFacts[index % denseFacts.length]!.subject,
      predicate: `触发余波-${index}`,
      object: denseFacts[(index + 1) % denseFacts.length]!.object,
    }));

    const model = buildNarrativeGraphModel({ facts: denseFacts, events: denseEvents, view: "wave", focusEntity: "中心角色" });
    const repeated = buildNarrativeGraphModel({ facts: denseFacts, events: denseEvents, view: "wave", focusEntity: "中心角色" });
    const center = model.nodes.find((node) => node.id === model.focusNodeId)!;
    const entityNodes = model.nodes.filter((node) => node.kind === "entity" && node.id !== center.id);
    const eventNodes = model.nodes.filter((node) => node.kind === "event");
    const outerEntityRadius = Math.max(...entityNodes.map((node) => distanceFrom(node, center)));
    const innerEventRadius = Math.min(...eventNodes.map((node) => distanceFrom(node, center)));
    const size = layoutSize(model.nodes);

    expect(innerEventRadius).toBeGreaterThan(outerEntityRadius + 200);
    expect(size.width).toBeLessThan(2_700);
    expect(size.height).toBeLessThan(2_700);
    expect(model.nodes.map((node) => node.position)).toEqual(repeated.nodes.map((node) => node.position));
    expectFiniteUniqueLayout(model.nodes);
    for (let left = 0; left < model.nodes.length; left += 1) {
      for (let right = left + 1; right < model.nodes.length; right += 1) {
        expect(overlaps(model.nodes[left]!, model.nodes[right]!)).toBe(false);
      }
    }
  });

  it("视图值和中文入口映射明确", () => {
    expect(isNarrativeMemoryView("wave")).toBe(true);
    expect(isNarrativeMemoryView("浪潮视图")).toBe(false);
    expect(viewFromLabel("矛盾地图")).toBe("conflict");
    expect(viewFromLabel("不存在")).toBeUndefined();
  });
});
