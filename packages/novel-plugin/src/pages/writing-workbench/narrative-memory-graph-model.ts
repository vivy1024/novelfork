export type NarrativeMemoryView = "relationship" | "timeline" | "character_arc" | "conflict" | "event_chain" | "wave";

export interface NarrativeFact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  category: string;
  layer: string;
  confidence: number;
  sourceChapter?: number;
  evidenceText?: string;
}

export interface NarrativeEvent {
  id: string;
  chapterNumber: number;
  eventType: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  status: string;
  riskLevel: string;
  evidenceText: string;
}

export type GraphNodeKind = "entity" | "fact" | "event";
export type GraphEdgeKind = "fact" | "event" | "sequence";

export interface GraphPosition {
  x: number;
  y: number;
}

export interface GraphNodeModel {
  id: string;
  kind: GraphNodeKind;
  title: string;
  displayTitle: string;
  subtitle?: string;
  description?: string;
  entityName?: string;
  category?: string;
  layer?: string;
  chapterNumber?: number;
  confidence?: number;
  status?: string;
  riskLevel?: string;
  evidenceText?: string;
  lane?: string;
  depth?: number;
  position: GraphPosition;
  width: number;
  height: number;
}

export interface GraphEdgeModel {
  id: string;
  source: string;
  target: string;
  label: string;
  displayLabel: string;
  kind: GraphEdgeKind;
  category?: string;
  riskLevel?: string;
  animated?: boolean;
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  factCount: number;
  eventCount: number;
  chapterCount: number;
  entityCount: number;
}

export interface NarrativeGraphModel {
  nodes: GraphNodeModel[];
  edges: GraphEdgeModel[];
  stats: GraphStats;
  focusNodeId?: string;
  focusLabel?: string;
}

export interface BuildGraphModelInput {
  facts: readonly NarrativeFact[];
  events: readonly NarrativeEvent[];
  view: NarrativeMemoryView;
  focusEntity?: string;
}

const ENTITY_WIDTH = 196;
const ENTITY_HEIGHT = 84;
const FACT_WIDTH = 224;
const FACT_HEIGHT = 100;
const EVENT_WIDTH = 244;
const EVENT_HEIGHT = 112;
const PLACEHOLDER_ENTITY = "未命名实体";

const CATEGORY_LABELS: Record<string, string> = {
  relationship: "关系",
  hook: "伏笔",
  timeline: "时间线",
  conflict: "矛盾",
  world_fact: "世界事实",
  character_state: "角色状态",
  location: "地点",
};

function clean(value: unknown, fallback: string): string {
  const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return normalized || fallback;
}

export function displayLabel(value: string, maxLength = 24): string {
  const normalized = clean(value, PLACEHOLDER_ENTITY);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 1))}…`;
}

export function displayPredicate(value: string, maxLength = 18): string {
  return displayLabel(value, maxLength);
}

function stableId(prefix: string, value: string): string {
  return `${prefix}:${encodeURIComponent(value)}`;
}

function nodePosition(x: number, y: number, width: number, height: number): GraphPosition {
  return { x: Math.round(x - width / 2), y: Math.round(y - height / 2) };
}

function entityName(value: unknown): string {
  return clean(value, PLACEHOLDER_ENTITY);
}

function factKey(fact: NarrativeFact): string {
  return [fact.subject, fact.predicate, fact.object, fact.sourceChapter ?? ""].join("\u0000");
}

function eventKey(event: NarrativeEvent): string {
  return [event.id, event.chapterNumber, event.subject, event.predicate, event.object].join("\u0000");
}

function uniqueFacts(facts: readonly NarrativeFact[]): NarrativeFact[] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = fact.id || factKey(fact);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueEvents(events: readonly NarrativeEvent[]): NarrativeEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = event.id || eventKey(event);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function categoryLabel(category: string | undefined): string | undefined {
  if (!category) return undefined;
  return CATEGORY_LABELS[category] ?? category;
}

function createEntityNode(name: string, category?: string): GraphNodeModel {
  const normalized = entityName(name);
  return {
    id: stableId("entity", normalized),
    kind: "entity",
    title: normalized,
    displayTitle: displayLabel(normalized, 20),
    subtitle: categoryLabel(category) ?? "动态实体",
    entityName: normalized,
    category,
    position: { x: 0, y: 0 },
    width: ENTITY_WIDTH,
    height: ENTITY_HEIGHT,
  };
}

function createFactNode(fact: NarrativeFact): GraphNodeModel {
  const subject = entityName(fact.subject);
  const object = entityName(fact.object);
  return {
    id: stableId("fact", fact.id || factKey(fact)),
    kind: "fact",
    title: `${subject} · ${clean(fact.predicate, "状态")} · ${object}`,
    displayTitle: displayLabel(`${subject} · ${clean(fact.predicate, "状态")} · ${object}`, 32),
    subtitle: categoryLabel(fact.category),
    description: object,
    entityName: subject,
    category: fact.category,
    layer: fact.layer,
    chapterNumber: fact.sourceChapter,
    confidence: fact.confidence,
    evidenceText: fact.evidenceText,
    position: { x: 0, y: 0 },
    width: FACT_WIDTH,
    height: FACT_HEIGHT,
  };
}

function createEventNode(event: NarrativeEvent): GraphNodeModel {
  const subject = entityName(event.subject);
  const predicate = clean(event.predicate, event.eventType || "事件");
  const object = entityName(event.object);
  return {
    id: stableId("event", event.id || eventKey(event)),
    kind: "event",
    title: `${subject} · ${predicate} · ${object}`,
    displayTitle: displayLabel(`${subject} · ${predicate} · ${object}`, 34),
    subtitle: event.eventType || "事件",
    description: object,
    entityName: subject,
    chapterNumber: Number.isFinite(event.chapterNumber) ? event.chapterNumber : undefined,
    confidence: event.confidence,
    status: event.status,
    riskLevel: event.riskLevel,
    evidenceText: event.evidenceText,
    position: { x: 0, y: 0 },
    width: EVENT_WIDTH,
    height: EVENT_HEIGHT,
  };
}

function createFactEdges(facts: readonly NarrativeFact[]): GraphEdgeModel[] {
  const seen = new Set<string>();
  const edges: GraphEdgeModel[] = [];
  for (const fact of facts) {
    const sourceName = entityName(fact.subject);
    const targetName = entityName(fact.object);
    if (sourceName === targetName) continue;
    const source = stableId("entity", sourceName);
    const target = stableId("entity", targetName);
    const key = `${source}|${target}|${fact.predicate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = clean(fact.predicate, "关联");
    edges.push({
      id: stableId("fact-edge", fact.id || factKey(fact)),
      source,
      target,
      label,
      displayLabel: displayPredicate(label),
      kind: "fact",
      category: fact.category,
    });
  }
  return edges;
}

function createEntityNodes(facts: readonly NarrativeFact[], events: readonly NarrativeEvent[] = []): GraphNodeModel[] {
  const nodes = new Map<string, GraphNodeModel>();
  for (const fact of facts) {
    for (const name of [fact.subject, fact.object]) {
      const normalized = entityName(name);
      const id = stableId("entity", normalized);
      if (!nodes.has(id)) nodes.set(id, createEntityNode(normalized, fact.category));
    }
  }
  for (const event of events) {
    const normalized = entityName(event.subject);
    const id = stableId("entity", normalized);
    if (!nodes.has(id)) nodes.set(id, createEntityNode(normalized, "character_state"));
    const object = entityName(event.object);
    const objectId = stableId("entity", object);
    if (!nodes.has(objectId)) nodes.set(objectId, createEntityNode(object, "timeline"));
  }
  return [...nodes.values()];
}

function adjacency(nodes: readonly GraphNodeModel[], edges: readonly GraphEdgeModel[]): Map<string, Set<string>> {
  const result = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of edges) {
    if (!result.has(edge.source)) result.set(edge.source, new Set());
    if (!result.has(edge.target)) result.set(edge.target, new Set());
    result.get(edge.source)!.add(edge.target);
    result.get(edge.target)!.add(edge.source);
  }
  return result;
}

function layoutEntityNodes(nodes: GraphNodeModel[], edges: GraphEdgeModel[], focusEntity?: string): string | undefined {
  if (nodes.length === 0) return undefined;
  const graph = adjacency(nodes, edges);
  const focusNode = focusEntity
    ? nodes.find((node) => node.entityName === focusEntity || node.title === focusEntity)
    : undefined;
  const center = focusNode ?? [...nodes].sort((a, b) => (graph.get(b.id)?.size ?? 0) - (graph.get(a.id)?.size ?? 0) || a.title.localeCompare(b.title))[0]!;
  const depths = new Map<string, number>([[center.id, 0]]);
  const queue = [center.id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDepth = depths.get(current)!;
    for (const next of graph.get(current) ?? []) {
      if (depths.has(next)) continue;
      depths.set(next, currentDepth + 1);
      queue.push(next);
    }
  }

  const levels = new Map<number, GraphNodeModel[]>();
  for (const node of nodes) {
    const depth = depths.get(node.id);
    if (depth === undefined) continue;
    node.depth = depth;
    const level = levels.get(depth) ?? [];
    level.push(node);
    levels.set(depth, level);
  }
  const centerX = 520;
  const centerY = 360;
  center.position = nodePosition(centerX, centerY, center.width, center.height);
  for (const [depth, level] of levels) {
    if (depth === 0) continue;
    const radius = Math.max(250 + depth * 190, level.length * 125);
    const angleStep = (Math.PI * 2) / Math.max(level.length, 1);
    level.sort((a, b) => a.title.localeCompare(b.title)).forEach((node, index) => {
      const angle = -Math.PI / 2 + index * angleStep;
      node.position = nodePosition(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius, node.width, node.height);
    });
  }

  const disconnected = nodes.filter((node) => !depths.has(node.id)).sort((a, b) => a.title.localeCompare(b.title));
  disconnected.forEach((node, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    node.depth = undefined;
    node.position = nodePosition(980 + column * 260, 160 + row * 150, node.width, node.height);
  });
  return center.id;
}

function layoutConflictNodes(nodes: GraphNodeModel[], facts: readonly NarrativeFact[]): void {
  const subjects = new Set(facts.map((fact) => stableId("entity", entityName(fact.subject))));
  const objects = new Set(facts.map((fact) => stableId("entity", entityName(fact.object))));
  const left = nodes.filter((node) => subjects.has(node.id) && !objects.has(node.id)).sort((a, b) => a.title.localeCompare(b.title));
  const right = nodes.filter((node) => objects.has(node.id) && !subjects.has(node.id)).sort((a, b) => a.title.localeCompare(b.title));
  const shared = nodes.filter((node) => !left.includes(node) && !right.includes(node)).sort((a, b) => a.title.localeCompare(b.title));
  left.forEach((node, index) => { node.position = nodePosition(220, 160 + index * 150, node.width, node.height); });
  shared.forEach((node, index) => { node.position = nodePosition(600, 160 + index * 150, node.width, node.height); });
  right.forEach((node, index) => { node.position = nodePosition(980, 160 + index * 150, node.width, node.height); });
}

function layoutRadialRings(
  nodes: readonly GraphNodeModel[],
  centerX: number,
  centerY: number,
  initialRadius: number,
  ringGap: number,
  minimumArc: number,
  phaseOffset = 0,
): number {
  let index = 0;
  let ring = 0;
  let radius = initialRadius;
  while (index < nodes.length) {
    const capacity = Math.max(6, Math.floor((Math.PI * 2 * radius) / minimumArc));
    const count = Math.min(capacity, nodes.length - index);
    const phase = -Math.PI / 2 + phaseOffset + (ring % 2 === 1 ? Math.PI / Math.max(count, 1) : 0);
    for (let slot = 0; slot < count; slot += 1) {
      const node = nodes[index + slot]!;
      const angle = phase + slot * (Math.PI * 2 / Math.max(count, 1));
      node.position = nodePosition(
        centerX + Math.cos(angle) * radius,
        centerY + Math.sin(angle) * radius,
        node.width,
        node.height,
      );
    }
    index += count;
    ring += 1;
    if (index < nodes.length) radius += ringGap;
  }
  return nodes.length > 0 ? radius : 0;
}

function layoutWaveNodes(entityNodes: GraphNodeModel[], eventNodes: GraphNodeModel[], focusNodeId?: string): void {
  if (entityNodes.length === 0) return;
  const centerX = 620;
  const centerY = 440;
  const center = entityNodes.find((node) => node.id === focusNodeId) ?? entityNodes[0]!;
  center.position = nodePosition(centerX, centerY, center.width, center.height);

  const radialEntities = entityNodes
    .filter((node) => node.id !== center.id)
    .sort((a, b) => (a.depth ?? Number.MAX_SAFE_INTEGER) - (b.depth ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title));
  const entityOuterRadius = layoutRadialRings(radialEntities, centerX, centerY, 320, 250, 250);

  const orderedEvents = [...eventNodes].sort((a, b) =>
    (a.chapterNumber ?? Number.MAX_SAFE_INTEGER) - (b.chapterNumber ?? Number.MAX_SAFE_INTEGER)
    || a.title.localeCompare(b.title));
  orderedEvents.forEach((node) => { node.depth = 1; });
  layoutRadialRings(
    orderedEvents,
    centerX,
    centerY,
    Math.max(720, entityOuterRadius + 300),
    300,
    300,
    Math.PI / 12,
  );
}

function layoutSequenceNodes(nodes: GraphNodeModel[], laneByNodeId?: Map<string, string>): void {
  const chapters = [...new Set(nodes.map((node) => node.chapterNumber).filter((chapter): chapter is number => chapter !== undefined))].sort((a, b) => a - b);
  const chapterIndex = new Map(chapters.map((chapter, index) => [chapter, index]));
  const lanes = [...new Set(nodes.map((node) => laneByNodeId?.get(node.id) ?? node.entityName ?? "事件"))].sort((a, b) => a.localeCompare(b));
  const laneIndex = new Map(lanes.map((lane, index) => [lane, index]));
  const chapterBuckets = new Map<string, number>();
  const sorted = [...nodes].sort((a, b) => (a.chapterNumber ?? Number.MAX_SAFE_INTEGER) - (b.chapterNumber ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title));
  for (const node of sorted) {
    const lane = laneByNodeId?.get(node.id) ?? node.entityName ?? "事件";
    const chapter = node.chapterNumber ?? chapters[chapters.length - 1] ?? 0;
    const chapterKey = `${lane}|${chapter}`;
    const offset = chapterBuckets.get(chapterKey) ?? 0;
    chapterBuckets.set(chapterKey, offset + 1);
    const x = 220 + (chapterIndex.get(chapter) ?? 0) * 280;
    const y = 150 + (laneIndex.get(lane) ?? 0) * 170 + offset * 28;
    node.lane = lane;
    node.position = nodePosition(x, y, node.width, node.height);
  }
}

function buildEntityGraph(facts: readonly NarrativeFact[], events: readonly NarrativeEvent[], view: NarrativeMemoryView, focusEntity?: string): NarrativeGraphModel {
  const entityNodes = createEntityNodes(facts, view === "wave" ? events : []);
  const edges = createFactEdges(facts);
  const eventNodes = view === "wave" ? uniqueEvents(events).map(createEventNode) : [];
  const allNodes = [...entityNodes, ...eventNodes];
  if (view === "wave") {
    for (const event of eventNodes) {
      const source = stableId("entity", event.entityName ?? PLACEHOLDER_ENTITY);
      edges.push({
        id: `${event.id}:event`,
        source,
        target: event.id,
        label: event.subtitle ?? "事件",
        displayLabel: displayPredicate(event.subtitle ?? "事件"),
        kind: "event",
        riskLevel: event.riskLevel,
      });
    }
  }
  const focusNodeId = layoutEntityNodes(entityNodes, edges.filter((edge) => edge.target.startsWith("entity:") && edge.source.startsWith("entity:")), focusEntity);
  if (view === "conflict") layoutConflictNodes(entityNodes, facts);
  if (view === "wave") layoutWaveNodes(entityNodes, eventNodes, focusNodeId);
  return createModel(allNodes, edges, facts, events, focusNodeId, focusEntity);
}

function buildSequenceGraph(facts: readonly NarrativeFact[], events: readonly NarrativeEvent[], view: NarrativeMemoryView): NarrativeGraphModel {
  const sourceEvents = uniqueEvents(events);
  const eventNodes = sourceEvents.length > 0 ? sourceEvents.map(createEventNode) : uniqueFacts(facts).map(createFactNode);
  const edges: GraphEdgeModel[] = [];
  const laneByNodeId = new Map<string, string>();
  for (const node of eventNodes) laneByNodeId.set(node.id, node.entityName ?? "事件");
  if (view === "character_arc") {
    const grouped = new Map<string, GraphNodeModel[]>();
    for (const node of eventNodes) {
      const lane = node.entityName ?? "事件";
      const group = grouped.get(lane) ?? [];
      group.push(node);
      grouped.set(lane, group);
    }
    for (const group of grouped.values()) {
      group.sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0) || a.title.localeCompare(b.title));
      for (let index = 1; index < group.length; index += 1) {
        const source = group[index - 1]!;
        const target = group[index]!;
        edges.push({ id: `${source.id}->${target.id}`, source: source.id, target: target.id, label: "状态推进", displayLabel: "状态推进", kind: "sequence", animated: true });
      }
    }
  } else {
    const sorted = [...eventNodes].sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0) || a.title.localeCompare(b.title));
    for (let index = 1; index < sorted.length; index += 1) {
      const source = sorted[index - 1]!;
      const target = sorted[index]!;
      edges.push({ id: `${source.id}->${target.id}`, source: source.id, target: target.id, label: "下一事件", displayLabel: "下一事件", kind: "sequence", animated: true });
    }
  }
  layoutSequenceNodes(eventNodes, view === "character_arc" ? laneByNodeId : undefined);
  return createModel(eventNodes, edges, facts, events);
}

function createModel(nodes: GraphNodeModel[], edges: GraphEdgeModel[], facts: readonly NarrativeFact[], events: readonly NarrativeEvent[], focusNodeId?: string, focusLabel?: string): NarrativeGraphModel {
  const entityCount = nodes.filter((node) => node.kind === "entity").length;
  const chapters = new Set([...facts.map((fact) => fact.sourceChapter), ...events.map((event) => event.chapterNumber)].filter((chapter): chapter is number => chapter !== undefined));
  return {
    nodes,
    edges,
    focusNodeId,
    focusLabel,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      factCount: facts.length,
      eventCount: events.length,
      chapterCount: chapters.size,
      entityCount,
    },
  };
}

export function buildNarrativeGraphModel(input: BuildGraphModelInput): NarrativeGraphModel {
  const facts = uniqueFacts(input.facts);
  const events = uniqueEvents(input.events);
  if (input.view === "relationship" || input.view === "conflict" || input.view === "wave") {
    return buildEntityGraph(facts, events, input.view, input.focusEntity);
  }
  return buildSequenceGraph(facts, events, input.view);
}

export function isNarrativeMemoryView(value: unknown): value is NarrativeMemoryView {
  return value === "relationship" || value === "timeline" || value === "character_arc" || value === "conflict" || value === "event_chain" || value === "wave";
}

export function viewLabel(view: NarrativeMemoryView): string {
  switch (view) {
    case "relationship": return "关系图";
    case "timeline": return "时间线";
    case "character_arc": return "角色弧线";
    case "conflict": return "矛盾地图";
    case "event_chain": return "事件链";
    case "wave": return "浪潮视图";
  }
}

export function viewFromLabel(label: unknown): NarrativeMemoryView | undefined {
  switch (label) {
    case "关系图": return "relationship";
    case "时间线": return "timeline";
    case "角色弧线": return "character_arc";
    case "矛盾地图": return "conflict";
    case "事件链": return "event_chain";
    case "浪潮视图": return "wave";
    default: return undefined;
  }
}
