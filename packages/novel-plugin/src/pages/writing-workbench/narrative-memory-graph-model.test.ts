import { describe, expect, it } from "vitest";

import {
  assignSubLanes,
  buildNarrativeGraphModel,
  clampChapterStep,
  displayLabel,
  isNarrativeMemoryView,
  SEQUENCE_CHAPTER_STEP_DEFAULT,
  SEQUENCE_CHAPTER_STEP_MAX,
  SEQUENCE_CHAPTER_STEP_MIN,
  sortLanesByFrequency,
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
    // 泳道重构后（88c081ee）：夹具 3 事件分属「薛行之」「周工离职」两条泳道，
    // 泳道内串联产生 1 条边，跨泳道不连线——不再是全局线性链的 n-1 条。
    ["timeline", "event", 1],
    ["character_arc", "event", 1],
    ["event_chain", "event", 1],
    ["conflict", "entity", 4],
  ])("为 %s 生成专属节点与连线", (view, kind, minimumEdges) => {
    const model = buildNarrativeGraphModel({ facts, events, view });
    expect(model.nodes.some((node) => node.kind === kind)).toBe(true);
    expect(model.edges.length).toBeGreaterThanOrEqual(minimumEdges);
    expectFiniteUniqueLayout(model.nodes);
  });

  it("泳道分组：同一实体的事件按章节串联，跨泳道不连线", () => {
    for (const view of ["timeline", "character_arc", "event_chain"] as const) {
      const model = buildNarrativeGraphModel({ facts, events, view });
      const sequenceEdges = model.edges.filter((edge) => edge.kind === "sequence");
      expect(sequenceEdges, `${view} 应只有薛之行泳道内的 1 条串联边`).toHaveLength(1);
      const laneOf = new Map(model.nodes.map((node) => [node.id, node.entityName ?? node.title]));
      for (const edge of sequenceEdges) {
        expect(laneOf.get(edge.source)).toBe(laneOf.get(edge.target));
      }
    }
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
    expect(isNarrativeMemoryView("anchor")).toBe(true);
    expect(isNarrativeMemoryView("浪潮视图")).toBe(false);
    expect(viewFromLabel("矛盾地图")).toBe("conflict");
    expect(viewFromLabel("锚点时间线")).toBe("anchor");
    expect(viewFromLabel("不存在")).toBeUndefined();
  });

  it("anchor 视图复用时间线数据并保持事件布局", () => {
    const anchor = buildNarrativeGraphModel({ facts, events, view: "anchor" });
    const timeline = buildNarrativeGraphModel({ facts, events, view: "timeline" });
    expect(anchor.nodes.map((node) => node.id)).toEqual(timeline.nodes.map((node) => node.id));
    expect(anchor.edges.map((edge) => edge.id)).toEqual(timeline.edges.map((edge) => edge.id));
  });

  it("时间线铺开全书事件：远章不被 8 章窗口截断", () => {
    const longEvents = Array.from({ length: 12 }, (_, index): NarrativeEvent => ({
      ...events[0]!,
      id: `long-${index + 1}`,
      chapterNumber: index + 1,
      subject: "薛行之",
      predicate: `推进-${index + 1}`,
      object: `节点-${index + 1}`,
    }));
    const model = buildNarrativeGraphModel({ facts: [], events: longEvents, view: "timeline" });
    expect(model.nodes).toHaveLength(12);
    expect(model.sequence?.chapters).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const first = model.nodes.find((node) => node.chapterNumber === 1);
    const last = model.nodes.find((node) => node.chapterNumber === 12);
    expect(first && last ? last.position.x - first.position.x : 0).toBe(SEQUENCE_CHAPTER_STEP_DEFAULT * 11);
  });

  it("泳道按出场频次降序，主角置顶", () => {
    const mixed: NarrativeEvent[] = [
      { ...events[0]!, id: "a1", chapterNumber: 1, subject: "配角甲" },
      { ...events[0]!, id: "b1", chapterNumber: 1, subject: "薛行之" },
      { ...events[0]!, id: "b2", chapterNumber: 2, subject: "薛行之" },
      { ...events[0]!, id: "b3", chapterNumber: 3, subject: "薛行之" },
      { ...events[0]!, id: "c1", chapterNumber: 2, subject: "周工离职" },
      { ...events[0]!, id: "c2", chapterNumber: 4, subject: "周工离职" },
    ];
    const model = buildNarrativeGraphModel({ facts: [], events: mixed, view: "timeline" });
    expect(model.sequence?.lanes.map((lane) => lane.name)).toEqual(["薛行之", "周工离职", "配角甲"]);
    const protagonistY = model.sequence?.lanes[0]?.y ?? 0;
    const extraY = model.sequence?.lanes[2]?.y ?? 0;
    expect(protagonistY).toBeLessThan(extraY);
    expect(model.sequence?.lanes[0]?.eventCount).toBe(3);
    expect(model.sequence?.lanes[0]?.color).toMatch(/^#/);
  });

  it("隐藏泳道后节点与行高都收回", () => {
    const mixed: NarrativeEvent[] = [
      { ...events[0]!, id: "a1", chapterNumber: 1, subject: "配角甲" },
      { ...events[0]!, id: "b1", chapterNumber: 1, subject: "薛行之" },
      { ...events[0]!, id: "b2", chapterNumber: 2, subject: "薛行之" },
    ];
    const full = buildNarrativeGraphModel({ facts: [], events: mixed, view: "timeline" });
    const hidden = buildNarrativeGraphModel({ facts: [], events: mixed, view: "timeline", hiddenLanes: new Set(["配角甲"]) });
    expect(full.sequence?.lanes.map((lane) => lane.name)).toEqual(["薛行之", "配角甲"]);
    expect(hidden.nodes.every((node) => node.entityName !== "配角甲")).toBe(true);
    expect(hidden.sequence?.lanes.map((lane) => lane.name)).toEqual(["薛行之"]);
    expect(hidden.nodes.length).toBeLessThan(full.nodes.length);
  });

  it("隐藏全部泳道后节点为空，而不是回退成全量", () => {
    const mixed: NarrativeEvent[] = [
      { ...events[0]!, id: "b1", chapterNumber: 1, subject: "薛行之" },
    ];
    const hidden = buildNarrativeGraphModel({
      facts: [],
      events: mixed,
      view: "timeline",
      hiddenLanes: new Set(["薛行之"]),
    });
    expect(hidden.nodes).toHaveLength(0);
    expect(hidden.sequence?.lanes).toEqual([]);
  });

  it("X 步长缩放改变章间距，并被 clamp 到 [140, 560]", () => {
    expect(clampChapterStep(undefined)).toBe(SEQUENCE_CHAPTER_STEP_DEFAULT);
    expect(clampChapterStep(80)).toBe(SEQUENCE_CHAPTER_STEP_MIN);
    expect(clampChapterStep(900)).toBe(SEQUENCE_CHAPTER_STEP_MAX);
    const compact = buildNarrativeGraphModel({ facts: [], events, view: "timeline", chapterStep: 140 });
    const wide = buildNarrativeGraphModel({ facts: [], events, view: "timeline", chapterStep: 560 });
    const compactSpan = (compact.nodes.find((node) => node.chapterNumber === 2)!.position.x)
      - (compact.nodes.find((node) => node.chapterNumber === 1)!.position.x);
    const wideSpan = (wide.nodes.find((node) => node.chapterNumber === 2)!.position.x)
      - (wide.nodes.find((node) => node.chapterNumber === 1)!.position.x);
    expect(compactSpan).toBe(140);
    expect(wideSpan).toBe(560);
  });

  it("同章多事件走贪心子泳道，不再用 offset*28 纵向叠卡片", () => {
    const sameChapter: NarrativeEvent[] = [
      { ...events[0]!, id: "s1", chapterNumber: 5, subject: "薛行之", predicate: "事件甲", object: "甲" },
      { ...events[0]!, id: "s2", chapterNumber: 5, subject: "薛行之", predicate: "事件乙", object: "乙" },
      { ...events[0]!, id: "s3", chapterNumber: 6, subject: "薛行之", predicate: "事件丙", object: "丙" },
    ];
    const model = buildNarrativeGraphModel({ facts: [], events: sameChapter, view: "timeline" });
    const ch5 = model.nodes.filter((node) => node.chapterNumber === 5).sort((a, b) => a.position.y - b.position.y);
    expect(ch5).toHaveLength(2);
    expect(ch5[1]!.position.y - ch5[0]!.position.y).toBeGreaterThanOrEqual(ch5[0]!.height);
    expect(overlaps(ch5[0]!, ch5[1]!)).toBe(false);
    const ch6 = model.nodes.find((node) => node.chapterNumber === 6)!;
    // 第 6 章只有一条，复用子泳道 0，与第 5 章第一条同 Y。
    expect(ch6.position.y).toBe(ch5[0]!.position.y);
  });

  it("assignSubLanes 跨章复用空闲子泳道，同章才新开", () => {
    const nodes: GraphNodeModel[] = [
      { id: "n1", kind: "event", title: "a", displayTitle: "a", chapterNumber: 1, entityName: "主角", position: { x: 0, y: 0 }, width: 244, height: 112 },
      { id: "n2", kind: "event", title: "b", displayTitle: "b", chapterNumber: 1, entityName: "主角", position: { x: 0, y: 0 }, width: 244, height: 112 },
      { id: "n3", kind: "event", title: "c", displayTitle: "c", chapterNumber: 2, entityName: "主角", position: { x: 0, y: 0 }, width: 244, height: 112 },
    ];
    const assigned = assignSubLanes(nodes);
    expect(assigned.get("n1")).toBe(0);
    expect(assigned.get("n2")).toBe(1);
    expect(assigned.get("n3")).toBe(0);
    expect(sortLanesByFrequency(["乙", "甲"], new Map([["甲", 3], ["乙", 1]]))).toEqual(["甲", "乙"]);
  });

  it("assignSubLanes 同章第三个即新开泳道，且同章三事件 y 坐标不重叠", () => {
    // 漏洞场景：同章 3 事件必须占 0/1/2 三条子泳道（严格 < 保证同章不复用）。
    const nodes: GraphNodeModel[] = [0, 1, 2].map((index) => ({
      id: `n${index}`, kind: "event", title: `e${index}`, displayTitle: `e${index}`,
      chapterNumber: 5, entityName: "主角", position: { x: 0, y: 0 }, width: 244, height: 112,
    }));
    const assigned = assignSubLanes(nodes);
    expect(new Set([assigned.get("n0"), assigned.get("n1"), assigned.get("n2")])).toEqual(new Set([0, 1, 2]));
  });

  it("assignSubLanes 游离节点（无 chapterNumber）用 fallbackChapter 落位，不与该章已有节点碰撞", () => {
    // 漏洞场景：游离节点不传 fallback 时排在无穷远，却通过 `< MAX` 复用 slot 0——
    // 而 layoutSequenceNodes 把它画在最后一章 x，正好压住该章 slot-0 的现有节点。
    const nodes: GraphNodeModel[] = [
      { id: "real", kind: "event", title: "real", displayTitle: "real", chapterNumber: 3, entityName: "主角", position: { x: 0, y: 0 }, width: 244, height: 112 },
      { id: "free", kind: "event", title: "free", displayTitle: "free", chapterNumber: undefined, entityName: "主角", position: { x: 0, y: 0 }, width: 244, height: 112 },
    ];
    // fallback=3（仿真 layout 的「全书最大章」回退）：游离节点落在第 3 章，
    // 与 real 同章 → 必须拿不同子泳道，不能复用 real 的 slot 0。
    const assigned = assignSubLanes(nodes, undefined, 3);
    // 同章必须不同子泳道（顺序由 localeCompare 稳定，不归断言谁拿哪条）。
    expect(assigned.get("real")).not.toBe(assigned.get("free"));
    // 不改写传统兜底：无 fallback 时仍走 MAX_SAFE_INTEGER，排在最后、不挤占现有泳道。
    const plain = assignSubLanes(nodes);
    expect(plain.get("real")).toBe(0);
  });

  it("实体身份链：实体节点从 facts/events 提取 entryId，供图谱直跳条目卡", () => {
    const withIds: NarrativeFact[] = [
      { ...facts[0]!, subjectEntryId: "entry-xuejianguo" },
      { ...facts[1]!, subjectEntryId: "entry-xuezhihang" },
      { ...facts[3]!, objectEntryId: "entry-archive" },
    ];
    const model = buildNarrativeGraphModel({ facts: withIds, events, view: "relationship" });
    const byName = (name: string) => model.nodes.find((node) => node.kind === "entity" && node.entityName === name);
    expect(byName("薛建国")?.entryId).toBe("entry-xuejianguo");
    expect(byName("薛行之")?.entryId).toBe("entry-xuezhihang");
    expect(byName("只可作为未解异常现象归档")?.entryId).toBe("entry-archive");
    // 未命中身份链的实体不携带 entryId（点击回落实体详情抽屉）。
    expect(byName("鼻血")?.entryId).toBeUndefined();
  });
});
