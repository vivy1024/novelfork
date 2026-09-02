import { lazy, Suspense } from "react";
import { FolderTree, Loader2 } from "lucide-react";

import { ToolResultSurface } from "./ToolResultSurface";
import { asRecord, getNumber, getString, getToolResultData, type ToolResultRenderer, type ToolResultRendererContext } from "./types";

/**
 * lore.read / memory.graph 的树形结果卡。
 *
 * 改造前：
 *   · `lore.read` 在渲染器注册表里**没有条目**，落到 GenericToolResultCard，
 *     在对话里吐原始结构，作者看到的是一坨 JSON。
 *   · `memory.graph` 有专属卡，但把图数据渲染成「主语 · 谓语 · 宾语」文本行列表
 *     塞在折叠块里——本来是图，却画成了文字。
 *
 * 改造后：两者共用工作台那棵 `StoryTreeView`（同一份实现、同一套层级），
 * 用 compact 模式适配对话气泡。层级来自 NarraBench 分类学，不依赖 parent_id。
 *
 * 树组件体量较大（含搜索/详情/折叠），懒加载避免拖慢对话流首帧。
 */
const StoryTreeView = lazy(() =>
  import("@vivy1024/novelfork-novel-plugin/pages/writing-workbench").then((m) => ({ default: m.StoryTreeView })),
);

interface TreeEntry {
  readonly id: string;
  readonly title?: string;
  readonly category?: string;
  readonly summaryMd?: string | null;
  readonly contentMd?: string;
  readonly fields?: Record<string, unknown>;
  readonly lifecycle?: string;
  readonly status?: string;
}

interface TreeRelation {
  readonly sourceName?: string;
  readonly targetName?: string;
  readonly predicate?: string;
}

/**
 * 从工具返回里捞**经纬条目**数组：兼容 entries / items / results / lore 几种历史键名。
 *
 * 注意不能把 `facts` 当条目：memory.graph 的 facts 是 (subject, predicate, object)
 * 动态事实三元组，没有 category，硬当条目会全部落进「其他」维度，
 * 让树看起来有内容、实际是一堆无归属节点。事实只用来派生关系边（readRelations）。
 */
function readEntries(data: Record<string, unknown>): TreeEntry[] {
  const candidates = [data.entries, data.items, data.results, data.lore];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const rows = candidate.flatMap((item) => {
      const record = asRecord(item);
      if (!record) return [];
      const id = getString(record.id) || getString(record.entryId);
      if (!id) return [];
      return [{
        id,
        title: getString(record.title) || getString(record.name) || getString(record.subject),
        category: getString(record.category),
        summaryMd: getString(record.summaryMd) || null,
        contentMd: getString(record.contentMd) || getString(record.preview) || getString(record.evidenceText),
        fields: asRecord(record.fields) ?? undefined,
        lifecycle: getString(record.lifecycle),
        status: getString(record.status),
      } satisfies TreeEntry];
    });
    if (rows.length > 0) return rows;
  }
  return [];
}

/**
 * 关系边：memory.graph 的 facts 里 category=relationship 的三元组，
 * 以及经纬 relationships 条目的 fields.source/target。
 */
function readRelations(data: Record<string, unknown>): TreeRelation[] {
  const relations: TreeRelation[] = [];
  const facts = Array.isArray(data.facts) ? data.facts : [];
  for (const item of facts) {
    const record = asRecord(item);
    if (!record) continue;
    if (getString(record.category) !== "relationship") continue;
    const subject = getString(record.subject);
    const object = getString(record.object);
    if (!subject || !object) continue;
    relations.push({ sourceName: subject, targetName: object, predicate: getString(record.predicate) });
  }
  const entries = Array.isArray(data.entries) ? data.entries : [];
  for (const item of entries) {
    const record = asRecord(item);
    const fields = asRecord(record?.fields);
    if (!fields) continue;
    const source = getString(fields.source) || getString(fields.sourceName);
    const target = getString(fields.target) || getString(fields.targetName);
    if (!source || !target) continue;
    relations.push({ sourceName: source, targetName: target, predicate: getString(fields.relationType) });
  }
  const cooccurrence = asRecord(data.cooccurrence);
  const edges = Array.isArray(cooccurrence?.edges) ? cooccurrence.edges : [];
  for (const item of edges) {
    const record = asRecord(item);
    if (!record) continue;
    const source = getString(record.source);
    const target = getString(record.target);
    if (!source || !target) continue;
    relations.push({ sourceName: source, targetName: target, predicate: "共现" });
  }
  return relations;
}

/** 事件行：memory.graph 的 events 不属于经纬分类树，单独列出，不硬塞进树里。 */
function readEventSummary(data: Record<string, unknown>): { count: number; chapters: number[] } {
  const events = Array.isArray(data.events) ? data.events : [];
  const chapters = new Set<number>();
  for (const item of events) {
    const record = asRecord(item);
    if (!record) continue;
    const chapter = getNumber(record.chapterNumber);
    if (chapter !== null) chapters.add(chapter);
  }
  return { count: events.length, chapters: [...chapters].sort((left, right) => left - right) };
}

function readGraphLayerCounts(data: Record<string, unknown>): {
  cooccurrence: number;
  causal: number;
  foreshadows: number;
} {
  const cooccurrence = asRecord(data.cooccurrence);
  const edges = Array.isArray(cooccurrence?.edges) ? cooccurrence.edges.length : 0;
  const causal = Array.isArray(data.causal) ? data.causal.length : 0;
  const foreshadows = Array.isArray(data.foreshadows) ? data.foreshadows.length : 0;
  return { cooccurrence: edges, causal, foreshadows };
}

export const LoreTreeCard: ToolResultRenderer = (context: ToolResultRendererContext) => {
  const data = asRecord(getToolResultData(context.result));
  if (!data) return null;

  const entries = readEntries(data);
  const relations = readRelations(data);
  const events = readEventSummary(data);
  const layers = readGraphLayerCounts(data);
  const scope = getString(data.scope) || getString(data.view);
  const focusEntity = getString(data.focusEntity) || getString(data.entity);

  // 没有条目就不强行画空树；让通用信息（事件数/视图）如实呈现
  const hasTree = entries.length > 0;

  return (
    <ToolResultSurface
      testId="tool-result-lore-tree"
      title={hasTree ? "故事树" : "叙事读取"}
      icon={<FolderTree className="size-4 text-primary" />}
      meta={[
        hasTree ? `${entries.length} 条条目` : null,
        relations.length > 0 ? `${relations.length} 条关系` : null,
        events.count > 0 ? `${events.count} 个事件` : null,
        layers.cooccurrence > 0 ? `共现 ${layers.cooccurrence}` : null,
        layers.causal > 0 ? `因果 ${layers.causal}` : null,
        layers.foreshadows > 0 ? `伏笔 ${layers.foreshadows}` : null,
      ].filter(Boolean).join(" · ") || undefined}
    >
      {scope ? <p className="text-[10px] text-muted-foreground">范围：{scope}</p> : null}
      {focusEntity ? <p className="text-[10px] text-muted-foreground">聚焦：{focusEntity}</p> : null}

      {hasTree ? (
        <Suspense
          fallback={
            <div className="flex items-center gap-1.5 py-3 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> 正在铺开故事树…
            </div>
          }
        >
          <StoryTreeView mode="compact" entries={entries} relations={relations} maxEntriesPerCategory={20} />
        </Suspense>
      ) : (
        <p className="text-[11px] text-muted-foreground" data-testid="tool-result-lore-tree-no-entries">
          这次读取没有返回经纬条目
          {events.count > 0
            ? `，但带回了 ${events.count} 个事件（第 ${events.chapters[0] ?? "?"}–${events.chapters[events.chapters.length - 1] ?? "?"} 章）。`
            : "。"}
          {layers.cooccurrence || layers.causal || layers.foreshadows
            ? ` 图谱层：共现 ${layers.cooccurrence}、因果 ${layers.causal}、伏笔 ${layers.foreshadows}。`
            : ""}
        </p>
      )}

      {/* 事件是时序数据，不属于分类树；单独一行交代，避免混进层级 */}
      {hasTree && events.count > 0 ? (
        <p className="text-[10px] text-muted-foreground" data-testid="tool-result-lore-tree-events">
          另有 {events.count} 个叙事事件（第 {events.chapters[0]}–{events.chapters[events.chapters.length - 1]} 章），
          属于时序数据，在「故事推进 › 时间线」里看。
        </p>
      ) : null}
    </ToolResultSurface>
  );
};

export default LoreTreeCard;
