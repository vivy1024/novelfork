export type NarrativeMemoryView = "relationship" | "timeline" | "character_arc" | "conflict" | "event_chain" | "wave" | "anchor";

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
  /** 实体身份链：命中经纬实体字典时回填的条目 id（API 已透传）。 */
  subjectEntryId?: string;
  objectEntryId?: string;
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
  /** 实体身份链：命中经纬实体字典时回填的条目 id（API 已透传）。 */
  subjectEntryId?: string;
  objectEntryId?: string;
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
  /** 实体身份链：subject/object 命中经纬实体字典时回填的 story_jingwei_entry.id（仅 entity 节点）。 */
  entryId?: string;
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

export interface SequenceLaneHeader {
  /** 实体泳道名（通常是角色/主体名）。 */
  name: string;
  /** 该泳道第一条子泳道的中心 Y（与 nodePosition 入参同口径）。 */
  y: number;
  /** 泳道内事件数，用于行头频次展示。 */
  eventCount: number;
  /** 行头色点（由实体名稳定哈希）。 */
  color: string;
}

export interface SequenceLayoutMeta {
  chapters: readonly number[];
  lanes: readonly SequenceLaneHeader[];
  chapterStep: number;
  originX: number;
  originY: number;
}

export interface NarrativeGraphModel {
  nodes: GraphNodeModel[];
  edges: GraphEdgeModel[];
  stats: GraphStats;
  focusNodeId?: string;
  focusLabel?: string;
  /** 仅 sequence 视图（时间线 / 角色弧 / 事件链）携带，供行头与缩放使用。 */
  sequence?: SequenceLayoutMeta;
}

export interface BuildGraphModelInput {
  facts: readonly NarrativeFact[];
  events: readonly NarrativeEvent[];
  view: NarrativeMemoryView;
  focusEntity?: string;
  /** 时间线 X 步长（px/章）。缺省 280；滚轮缩放时由画布传入。 */
  chapterStep?: number;
  /** 前端隐藏的角色泳道；布局时不占高度。 */
  hiddenLanes?: ReadonlySet<string>;
}

const ENTITY_WIDTH = 196;
const ENTITY_HEIGHT = 84;
const FACT_WIDTH = 224;
const FACT_HEIGHT = 100;
const EVENT_WIDTH = 244;
const EVENT_HEIGHT = 112;
const PLACEHOLDER_ENTITY = "未命名实体";

/** 时间线 X 步长（px/章）：默认 280，滚轮在 [140, 560] 间缩放。 */
export const SEQUENCE_CHAPTER_STEP_DEFAULT = 280;
export const SEQUENCE_CHAPTER_STEP_MIN = 140;
export const SEQUENCE_CHAPTER_STEP_MAX = 560;
export const SEQUENCE_ORIGIN_X = 220;
export const SEQUENCE_ORIGIN_Y = 150;
/** 同章子泳道纵向步长：必须 ≥ 事件高度，避免 offset*28 把卡片叠在一起。 */
const SEQUENCE_SUB_LANE_STRIDE = EVENT_HEIGHT + 16;
const SEQUENCE_ENTITY_LANE_GAP = 40;

const LANE_COLORS = [
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#dc2626",
  "#d97706",
  "#059669",
  "#0891b2",
  "#65a30d",
] as const;

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

/**
 * 实体身份链：从 facts/events 的 subjectEntryId/objectEntryId 提取
 * 「canonical 实体名 → 经纬条目 id」映射，供图谱节点直跳角色卡。
 * 同名实体取最新一条命中的 entryId（事件按章号降序遍历）。
 */
export function buildEntityEntryIdIndex(
  facts: readonly NarrativeFact[],
  events: readonly NarrativeEvent[],
): Map<string, string> {
  const index = new Map<string, string>();
  const record = (name: string, entryId?: string) => {
    if (!name.trim() || !entryId?.trim()) return;
    index.set(entityName(name), entryId);
  };
  for (const fact of facts) {
    record(fact.subject, fact.subjectEntryId);
    record(fact.object, fact.objectEntryId);
  }
  for (const event of [...events].sort((a, b) => b.chapterNumber - a.chapterNumber)) {
    record(event.subject, event.subjectEntryId);
    record(event.object, event.objectEntryId);
  }
  return index;
}

function createEntityNodes(
  facts: readonly NarrativeFact[],
  events: readonly NarrativeEvent[] = [],
  entryIds: ReadonlyMap<string, string> = new Map(),
): GraphNodeModel[] {
  const nodes = new Map<string, GraphNodeModel>();
  for (const fact of facts) {
    for (const name of [fact.subject, fact.object]) {
      const normalized = entityName(name);
      const id = stableId("entity", normalized);
      if (!nodes.has(id)) nodes.set(id, { ...createEntityNode(normalized, fact.category), entryId: entryIds.get(normalized) });
    }
  }
  for (const event of events) {
    const normalized = entityName(event.subject);
    const id = stableId("entity", normalized);
    if (!nodes.has(id)) nodes.set(id, { ...createEntityNode(normalized, "character_state"), entryId: entryIds.get(normalized) });
    const object = entityName(event.object);
    const objectId = stableId("entity", object);
    if (!nodes.has(objectId)) nodes.set(objectId, { ...createEntityNode(object, "timeline"), entryId: entryIds.get(object) });
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

export function clampChapterStep(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) return SEQUENCE_CHAPTER_STEP_DEFAULT;
  return Math.min(SEQUENCE_CHAPTER_STEP_MAX, Math.max(SEQUENCE_CHAPTER_STEP_MIN, Math.round(value)));
}

export function laneColor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) | 0;
  }
  return LANE_COLORS[Math.abs(hash) % LANE_COLORS.length]!;
}

/**
 * 实体泳道排序：出场频次降序（主角置顶），同频次按名 localeCompare 保稳定。
 */
export function sortLanesByFrequency(lanes: readonly string[], counts: ReadonlyMap<string, number>): string[] {
  return [...lanes].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b));
}

/**
 * foliantica 式贪心子泳道：同一实体泳道内，同章多事件各占一条子泳道，
 * 跨章可复用已空闲的子泳道（按章号升序分配，同章按标题稳定）。
 *
 * 泳道选择用最小堆（按 untilChapter 升序）：取堆顶即「结束最早」的泳道，
 * 复杂度从 findIndex 全扫描 O(k) 降到 O(log k)。同章复用判据为
 * `untilChapter < chapter`（严格不等）：同章事件必须占不同子泳道，
 * 否则 x 坐标相同会在视觉上重叠。
 *
 * fallbackChapter：无 chapterNumber 的游离节点（如跨章钩子）的落位章号，
 * 必须与 layoutSequenceNodes 的 x 轴回退（全书最大章）一致——不一致时
 * 这种节点排序在无穷远却能复用 slot 0，而 x 被画到最后一章，
 * 正好压在该章 slot-0 已有节点的位置上造成重叠。
 *
 * 返回 nodeId → 子泳道下标。
 */
export function assignSubLanes(
  nodes: readonly GraphNodeModel[],
  laneByNodeId?: Map<string, string>,
  fallbackChapter?: number,
): Map<string, number> {
  const grouped = new Map<string, GraphNodeModel[]>();
  for (const node of nodes) {
    const lane = laneByNodeId?.get(node.id) ?? node.entityName ?? "事件";
    const group = grouped.get(lane) ?? [];
    group.push(node);
    grouped.set(lane, group);
  }
  const resolveChapter = (node: GraphNodeModel): number =>
    node.chapterNumber ?? fallbackChapter ?? Number.MAX_SAFE_INTEGER;
  const assigned = new Map<string, number>();
  for (const group of grouped.values()) {
    const sorted = [...group].sort(
      (a, b) => resolveChapter(a) - resolveChapter(b) || a.title.localeCompare(b.title),
    );
    // 最小堆：按 untilChapter 取「结束最早」的泳道。堆顶不可复用则没有泳道可复用。
    const heap: Array<{ untilChapter: number; slot: number }> = [];
    let laneCount = 0;
    for (const node of sorted) {
      const chapter = resolveChapter(node);
      const head = heap[0];
      let slot: number;
      if (head && head.untilChapter < chapter) {
        // 复用堆顶泳道（O(log k)）：弹出、更新占用章、重新入堆。
        slot = head.slot;
        heap[0] = { untilChapter: chapter, slot };
        heapSinkDown(heap, 0);
      } else {
        slot = laneCount;
        laneCount += 1;
        heapPush(heap, { untilChapter: chapter, slot });
      }
      assigned.set(node.id, slot);
    }
  }
  return assigned;
}

/** 堆上浮：新元素按 untilChapter 升序归位。 */
function heapPush(heap: Array<{ untilChapter: number; slot: number }>, item: { untilChapter: number; slot: number }): void {
  heap.push(item);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = (index - 1) >> 1;
    if (heap[parent]!.untilChapter <= item.untilChapter) break;
    heap[index] = heap[parent]!;
    index = parent;
  }
  heap[index] = item;
}

/** 堆下沉：堆顶被替换后按 untilChapter 下沉归位。 */
function heapSinkDown(heap: Array<{ untilChapter: number; slot: number }>, index: number): void {
  const item = heap[index]!;
  const half = heap.length >> 1;
  while (index < half) {
    const left = index * 2 + 1;
    const right = left + 1;
    const smaller = right < heap.length && heap[right]!.untilChapter < heap[left]!.untilChapter ? right : left;
    if (item.untilChapter <= heap[smaller]!.untilChapter) break;
    heap[index] = heap[smaller]!;
    index = smaller;
  }
  heap[index] = item;
}

export function nodeLaneName(node: GraphNodeModel, laneByNodeId?: Map<string, string>): string {
  return laneByNodeId?.get(node.id) ?? node.entityName ?? node.lane ?? "事件";
}

function layoutSequenceNodes(
  nodes: GraphNodeModel[],
  laneByNodeId: Map<string, string> | undefined,
  chapterStep: number,
  hiddenLanes?: ReadonlySet<string>,
): SequenceLayoutMeta {
  const chapters = [...new Set(nodes.map((node) => node.chapterNumber).filter((chapter): chapter is number => chapter !== undefined))].sort((a, b) => a - b);
  const chapterIndex = new Map(chapters.map((chapter, index) => [chapter, index]));
  const visibleNodes = hiddenLanes && hiddenLanes.size > 0
    ? nodes.filter((node) => !hiddenLanes.has(nodeLaneName(node, laneByNodeId)))
    : nodes;
  const counts = new Map<string, number>();
  for (const node of visibleNodes) {
    const lane = nodeLaneName(node, laneByNodeId);
    counts.set(lane, (counts.get(lane) ?? 0) + 1);
  }
  const lanes = sortLanesByFrequency(
    [...new Set(visibleNodes.map((node) => nodeLaneName(node, laneByNodeId)))],
    counts,
  );
  // 游离节点（无 chapterNumber）的落位必须与下方 x 轴回退一致：
  // 都用「全书最大章」，否则子泳道分配把它排在无穷远、渲染却画在最后一章。
  const fallbackChapter = chapters[chapters.length - 1] ?? 0;
  const subLanes = assignSubLanes(visibleNodes, laneByNodeId, fallbackChapter);
  const maxSubByLane = new Map<string, number>();
  for (const node of visibleNodes) {
    const lane = nodeLaneName(node, laneByNodeId);
    maxSubByLane.set(lane, Math.max(maxSubByLane.get(lane) ?? 0, subLanes.get(node.id) ?? 0));
  }
  const laneBaseY = new Map<string, number>();
  let cursorY = SEQUENCE_ORIGIN_Y;
  for (const lane of lanes) {
    laneBaseY.set(lane, cursorY);
    const subCount = (maxSubByLane.get(lane) ?? 0) + 1;
    cursorY += subCount * SEQUENCE_SUB_LANE_STRIDE + SEQUENCE_ENTITY_LANE_GAP;
  }
  const sorted = [...visibleNodes].sort(
    (a, b) => (a.chapterNumber ?? Number.MAX_SAFE_INTEGER) - (b.chapterNumber ?? Number.MAX_SAFE_INTEGER)
      || a.title.localeCompare(b.title),
  );
  for (const node of sorted) {
    const lane = nodeLaneName(node, laneByNodeId);
    const chapter = node.chapterNumber ?? fallbackChapter;
    const sub = subLanes.get(node.id) ?? 0;
    const x = SEQUENCE_ORIGIN_X + (chapterIndex.get(chapter) ?? 0) * chapterStep;
    const y = (laneBaseY.get(lane) ?? SEQUENCE_ORIGIN_Y) + sub * SEQUENCE_SUB_LANE_STRIDE;
    node.lane = lane;
    node.position = nodePosition(x, y, node.width, node.height);
  }
  return {
    chapters,
    chapterStep,
    originX: SEQUENCE_ORIGIN_X,
    originY: SEQUENCE_ORIGIN_Y,
    lanes: lanes.map((name) => ({
      name,
      y: laneBaseY.get(name) ?? SEQUENCE_ORIGIN_Y,
      eventCount: counts.get(name) ?? 0,
      color: laneColor(name),
    })),
  };
}

function buildEntityGraph(facts: readonly NarrativeFact[], events: readonly NarrativeEvent[], view: NarrativeMemoryView, focusEntity?: string): NarrativeGraphModel {
  // 身份链索引从全部 facts+events 提取（不随视图裁剪），保证任何视图下实体节点都带得上 entryId。
  const entryIds = buildEntityEntryIdIndex(facts, events);
  const entityNodes = createEntityNodes(facts, view === "wave" ? events : [], entryIds);
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

function buildSequenceGraph(
  facts: readonly NarrativeFact[],
  events: readonly NarrativeEvent[],
  view: NarrativeMemoryView,
  chapterStep: number,
  hiddenLanes?: ReadonlySet<string>,
): NarrativeGraphModel {
  // 全量铺开（不再截断最近 8 章）：可读性由 GraphCanvas 的「打开定位当前章 +
  // HEAD 竖线」承担，作者平移/缩放即可回看全书；截断会让历史不可达。
  const sourceEvents = uniqueEvents(events);
  const eventNodes = sourceEvents.length > 0 ? sourceEvents.map(createEventNode) : uniqueFacts(facts).map(createFactNode);
  const edges: GraphEdgeModel[] = [];
  const laneByNodeId = new Map<string, string>();
  for (const node of eventNodes) laneByNodeId.set(node.id, node.entityName ?? "事件");
  if (view === "character_arc" || view === "timeline" || view === "event_chain") {
    // 按实体泳道分组、组内按章节串联——形成多条并行链（树状网络），而不是
    // 全部实体串成一条几十节点的长链（视觉堆叠的根源）。跨泳道不连线。
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
  const sequence = layoutSequenceNodes(eventNodes, view !== "conflict" ? laneByNodeId : undefined, chapterStep, hiddenLanes);
  // 隐藏泳道必须按名字过滤，不能用 sequence.lanes.length 回退：
  // 把最后一条泳道关掉后 lanes 为空，旧逻辑会把全部节点又画回来。
  const visibleNodes = hiddenLanes && hiddenLanes.size > 0
    ? eventNodes.filter((node) => !hiddenLanes.has(nodeLaneName(node, laneByNodeId)))
    : eventNodes;
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = visibleNodes.length === eventNodes.length
    ? edges
    : edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  return createModel(visibleNodes, visibleEdges, facts, events, undefined, undefined, sequence);
}

function createModel(
  nodes: GraphNodeModel[],
  edges: GraphEdgeModel[],
  facts: readonly NarrativeFact[],
  events: readonly NarrativeEvent[],
  focusNodeId?: string,
  focusLabel?: string,
  sequence?: SequenceLayoutMeta,
): NarrativeGraphModel {
  const entityCount = nodes.filter((node) => node.kind === "entity").length;
  const chapters = new Set([...facts.map((fact) => fact.sourceChapter), ...events.map((event) => event.chapterNumber)].filter((chapter): chapter is number => chapter !== undefined));
  return {
    nodes,
    edges,
    focusNodeId,
    focusLabel,
    ...(sequence ? { sequence } : {}),
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
  // anchor 是发展历程的章节锚定时间线：它复用 timeline 的布局和现有数据接口。
  const resolvedView = input.view === "anchor" ? "timeline" : input.view;
  if (resolvedView === "relationship" || resolvedView === "conflict" || resolvedView === "wave") {
    return buildEntityGraph(facts, events, resolvedView, input.focusEntity);
  }
  return buildSequenceGraph(facts, events, resolvedView, clampChapterStep(input.chapterStep), input.hiddenLanes);
}

export function isNarrativeMemoryView(value: unknown): value is NarrativeMemoryView {
  return value === "relationship" || value === "timeline" || value === "character_arc" || value === "conflict" || value === "event_chain" || value === "wave" || value === "anchor";
}

export function viewLabel(view: NarrativeMemoryView): string {
  switch (view) {
    case "relationship": return "关系图";
    case "timeline": return "时间线";
    case "character_arc": return "角色弧线";
    case "conflict": return "矛盾地图";
    case "event_chain": return "事件链";
    case "wave": return "浪潮视图";
    case "anchor": return "锚点时间线";
  }
}

export function viewFromLabel(label: unknown): NarrativeMemoryView | undefined {
  switch (label) {
    case "关系图": return "relationship";
    case "时间线": return "timeline";
    case "锚点时间线": return "anchor";
    case "角色弧线": return "character_arc";
    case "矛盾地图": return "conflict";
    case "事件链": return "event_chain";
    case "浪潮视图": return "wave";
    default: return undefined;
  }
}
