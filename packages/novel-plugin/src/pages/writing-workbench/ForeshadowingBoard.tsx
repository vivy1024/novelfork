import { useState, useCallback, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { AlertTriangle, Loader2, Eye, EyeOff, Trash2, BookOpen, GripVertical, Info } from "lucide-react";
import { useApi, fetchJson } from "@/hooks/use-api";
import {
  computeForeshadowingDebt,
  FORESHADOWING_DEBT_THRESHOLD,
  type ForeshadowingDebt,
} from "../../engine/jingwei/foreshadowing-debt";
import { fetchFactsByEntity, type EntityFact } from "./narrative-fact-edits";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ForeshadowingStatus = "已埋设" | "部分揭示" | "已回收" | "已废弃";

interface ForeshadowingEntry {
  readonly id: string;
  readonly title: string;
  readonly contentMd?: string;
  readonly customFields?: Record<string, unknown>;
  readonly fieldsJson?: string;
}

interface EntriesResponse {
  readonly entries: readonly ForeshadowingEntry[];
}

export interface ParsedForeshadowing {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: ForeshadowingStatus;
  readonly plantedChapter: number;
  readonly targetChapter: number;
}

export interface ForeshadowingBoardProps {
  readonly bookId: string;
  /**
   * 本书当前（最大已完成）章号。拿不到时必须传 undefined —— 组件会显式显示
   * 「悬念未知」并说明原因，绝不用默认章号算出负数悬念让超期预警静默失效。
   */
  readonly currentChapter?: number;
  /** 点击"目标: 第X章"时跳转到写作区打开该章节 */
  readonly onJumpToChapter?: (chapterNumber: number) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLUMNS: readonly { status: ForeshadowingStatus; label: string; icon: React.ReactNode }[] = [
  { status: "已埋设", label: "已埋设", icon: <BookOpen className="w-3.5 h-3.5" /> },
  { status: "部分揭示", label: "部分揭示", icon: <Eye className="w-3.5 h-3.5" /> },
  { status: "已回收", label: "已回收", icon: <EyeOff className="w-3.5 h-3.5" /> },
  { status: "已废弃", label: "已废弃", icon: <Trash2 className="w-3.5 h-3.5" /> },
];

const SETTLED_STATUSES: readonly ForeshadowingStatus[] = ["已回收", "已废弃"];

const VALID_STATUSES: readonly ForeshadowingStatus[] = ["已埋设", "部分揭示", "已回收", "已废弃"];

const DROPPABLE_IDS = COLUMNS.map((c) => c.status) as string[];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseCustomFields(entry: ForeshadowingEntry): Record<string, unknown> {
  if (entry.customFields && typeof entry.customFields === "object") {
    return entry.customFields;
  }
  if (entry.fieldsJson && typeof entry.fieldsJson === "string") {
    try {
      return JSON.parse(entry.fieldsJson) as Record<string, unknown>;
    } catch {
      // ignore
    }
  }
  return {};
}

function parseForeshadowing(entry: ForeshadowingEntry): ParsedForeshadowing {
  const fields = parseCustomFields(entry);
  const rawStatus = typeof fields.status === "string" ? fields.status : "已埋设";
  const status: ForeshadowingStatus = VALID_STATUSES.includes(rawStatus as ForeshadowingStatus)
    ? (rawStatus as ForeshadowingStatus)
    : "已埋设";

  return {
    id: entry.id,
    name: (typeof fields.name === "string" ? fields.name : "") || entry.title || "未命名伏笔",
    description: (typeof fields.description === "string" ? fields.description : "") || entry.contentMd || "",
    status,
    plantedChapter: typeof fields.plantedChapter === "number" ? fields.plantedChapter : 0,
    targetChapter: typeof fields.targetChapter === "number" ? fields.targetChapter : 0,
  };
}

function findColumnByItemId(items: readonly ParsedForeshadowing[], itemId: string): ForeshadowingStatus | null {
  const item = items.find((i) => i.id === itemId);
  return item?.status ?? null;
}

/** 看板内唯一的债务判定入口，阈值与文案都来自 foreshadowing-debt。 */
export function debtOf(item: ParsedForeshadowing, currentChapter: number | undefined): ForeshadowingDebt {
  return computeForeshadowingDebt({
    plantedChapter: item.plantedChapter,
    currentChapter: currentChapter ?? null,
    settled: SETTLED_STATUSES.includes(item.status),
  });
}

/**
 * 记忆证据匹配：narrative_memory 的 hook fact 只是证据，不是权威源。
 * 用伏笔名与 fact 的 object/subject 做包含匹配，够用且不会引入第二套 ID 体系。
 */
export function matchHookEvidence(
  item: ParsedForeshadowing,
  facts: readonly EntityFact[],
): readonly EntityFact[] {
  const name = item.name.trim();
  if (!name || name === "未命名伏笔") return [];
  return facts.filter((fact) => {
    if (fact.category !== "hook") return false;
    const haystack = `${fact.object ?? ""} ${fact.subject ?? ""} ${fact.predicate ?? ""}`;
    return haystack.includes(name) || name.includes((fact.object ?? "").trim());
  });
}

// ---------------------------------------------------------------------------
// SortableCard component
// ---------------------------------------------------------------------------

function SortableForeshadowingCard({
  item,
  currentChapter,
  evidence,
  onJumpToChapter,
}: {
  item: ParsedForeshadowing;
  currentChapter: number | undefined;
  evidence: readonly EntityFact[];
  onJumpToChapter?: (chapterNumber: number) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const debt = debtOf(item, currentChapter);
  const isOverdue = debt.level === "overdue";
  const isDueSoon = debt.level === "due-soon";

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`foreshadowing-card-${item.id}`}
      data-debt-level={debt.level}
      className={`rounded-md border p-3 bg-card text-card-foreground shadow-sm space-y-1.5 ${
        isOverdue ? "border-red-500 border-2" : isDueSoon ? "border-amber-400/70 border-2" : "border-border"
      } ${isDragging ? "ring-2 ring-primary" : ""}`}
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0 touch-none"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
        {(isOverdue || isDueSoon) && (
          <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${isOverdue ? "text-red-500" : "text-amber-500"}`} />
        )}
        <span className="text-sm font-medium truncate">{item.name}</span>
      </div>
      {item.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {item.plantedChapter > 0 && <span>埋设: 第{item.plantedChapter}章</span>}
        {item.targetChapter > 0 && (
          onJumpToChapter ? (
            <button
              type="button"
              onClick={() => onJumpToChapter(item.targetChapter)}
              className="cursor-pointer text-primary hover:underline underline-offset-2 transition-colors"
              title={`跳转到第${item.targetChapter}章`}
            >
              目标: 第{item.targetChapter}章
            </button>
          ) : (
            <span>目标: 第{item.targetChapter}章</span>
          )
        )}
        <span
          className={isOverdue ? "text-red-500 font-medium" : isDueSoon ? "text-amber-600 font-medium" : ""}
          title={debt.explanation}
        >
          {debt.label}
        </span>
      </div>
      {(isOverdue || isDueSoon || debt.level === "unknown") && (
        <p
          data-testid={`foreshadowing-explanation-${item.id}`}
          className={`text-[10px] leading-relaxed ${isOverdue ? "text-red-500" : isDueSoon ? "text-amber-600" : "text-muted-foreground"}`}
        >
          {debt.explanation}
        </p>
      )}
      {evidence.length > 0 && <HookEvidenceList evidence={evidence} />}
    </div>
  );
}

/**
 * 记忆证据：章后结算沉淀的 hook fact。只读展示，操作仍回到看板拖拽（经纬为源）。
 */
function HookEvidenceList({ evidence }: { evidence: readonly EntityFact[] }) {
  return (
    <div className="rounded border border-border/60 bg-muted/30 p-1.5 space-y-1" data-testid="hook-evidence">
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Info className="w-3 h-3 shrink-0" />
        <span>记忆证据 {evidence.length} 条（章后结算沉淀，只读）</span>
      </div>
      {evidence.slice(0, 3).map((fact) => (
        <div key={fact.id} className="text-[10px] text-muted-foreground truncate">
          第 {fact.sourceChapter ?? fact.validFromChapter ?? "—"} 章 · {fact.subject} {fact.predicate} {fact.object}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DragOverlay card (non-interactive snapshot shown during drag)
// ---------------------------------------------------------------------------

function DragOverlayCard({ item, currentChapter }: { item: ParsedForeshadowing; currentChapter: number | undefined }) {
  const isOverdue = debtOf(item, currentChapter).level === "overdue";

  return (
    <div
      className={`rounded-md border p-3 bg-card text-card-foreground shadow-xl space-y-1.5 ring-2 ring-primary rotate-2 ${
        isOverdue ? "border-red-500 border-2" : "border-border"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <GripVertical className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        {isOverdue && <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
        <span className="text-sm font-medium truncate">{item.name}</span>
      </div>
      {item.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ForeshadowingBoard({ bookId, currentChapter, onJumpToChapter }: ForeshadowingBoardProps) {
  const { data, loading, error } = useApi<EntriesResponse>(
    `/api/books/${bookId}/jingwei/entries?category=foreshadowing`,
  );

  // Local entries state for optimistic UI updates
  const [entries, setEntries] = useState<ParsedForeshadowing[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // 记忆证据（hook fact）：只作证据，取不到就静默降级为「无证据」。
  const [hookFacts, setHookFacts] = useState<readonly EntityFact[]>([]);

  useEffect(() => {
    let alive = true;
    void fetchFactsByEntity(bookId)
      .then((groups) => {
        if (!alive) return;
        setHookFacts(groups.flatMap((group) => group.facts).filter((fact) => fact.category === "hook"));
      })
      .catch(() => {
        if (alive) setHookFacts([]);
      });
    return () => { alive = false; };
  }, [bookId]);

  // Derive entries from API data (only when local state is null)
  const items = entries ?? (data?.entries ?? []).map(parseForeshadowing);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeItem = activeId ? items.find((i) => i.id === activeId) : null;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);

      if (!over) return;

      const draggedId = String(active.id);
      const overId = String(over.id);

      // Determine target column: over.id could be a column status or an item id
      let targetStatus: ForeshadowingStatus | null = null;
      if (DROPPABLE_IDS.includes(overId)) {
        targetStatus = overId as ForeshadowingStatus;
      } else {
        // Dropped on another card — find which column that card belongs to
        const overItem = items.find((i) => i.id === overId);
        if (overItem) {
          targetStatus = overItem.status;
        }
      }

      if (!targetStatus) return;

      const sourceStatus = findColumnByItemId(items, draggedId);
      if (!sourceStatus || sourceStatus === targetStatus) return;

      // Optimistic local update
      setEntries((prev) => {
        const source = prev ?? items;
        return source.map((item) =>
          item.id === draggedId ? { ...item, status: targetStatus! } : item,
        );
      });

      // Toast feedback
      toast(`伏笔状态已更新：${sourceStatus} → ${targetStatus}`, "success");

      // Fire-and-forget API update
      void (async () => {
        try {
          await fetchJson(
            `/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(draggedId)}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ customFields: { status: targetStatus } }),
            },
          );
        } catch {
          // 乐观更新失败需回滚，否则本地状态与服务端漂移
          setEntries((prev) =>
            (prev ?? items).map((item) =>
              item.id === draggedId ? { ...item, status: sourceStatus } : item,
            ),
          );
          toast("伏笔状态保存失败，已恢复原状态", "error");
        }
      })();
    },
    [items, bookId],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">加载伏笔数据…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-red-500">
        <AlertTriangle className="w-4 h-4 mr-2" />
        <span className="text-sm">加载失败: {error}</span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <BookOpen className="w-8 h-8 mb-2 opacity-40" />
        <span className="text-sm">暂无伏笔条目</span>
        <span className="text-xs mt-1">在叙事记忆中产生或确认伏笔事件后即可显示</span>
      </div>
    );
  }

  const grouped = COLUMNS.map((col) => ({
    ...col,
    items: items.filter((i) => i.status === col.status),
  }));

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {currentChapter === undefined ? (
        <div
          data-testid="foreshadowing-unknown-chapter"
          className="mx-3 mt-3 flex items-start gap-2 rounded-md border border-amber-400/60 bg-amber-50 p-2 text-[11px] text-amber-700 dark:bg-amber-950/20 dark:text-amber-400"
        >
          <AlertTriangle className="mt-0.5 w-3.5 h-3.5 shrink-0" />
          <span>
            读不到本书当前章号，超期预警已暂停。为避免给出错误结论，这里不按默认章号推算悬念；先在资源树里刷新章节列表（或写入第一章）后再看
            {FORESHADOWING_DEBT_THRESHOLD} 章超期提醒。
          </span>
        </div>
      ) : null}
      <div className="grid grid-cols-4 gap-3 p-3 h-full overflow-auto">
        {grouped.map((col) => (
          <DroppableColumn
            key={col.status}
            column={col}
            currentChapter={currentChapter}
            hookFacts={hookFacts}
            onJumpToChapter={onJumpToChapter}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeItem ? (
          <DragOverlayCard item={activeItem} currentChapter={currentChapter} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ---------------------------------------------------------------------------
// DroppableColumn — each status column with sortable cards
// ---------------------------------------------------------------------------

function DroppableColumn({
  column,
  currentChapter,
  hookFacts,
  onJumpToChapter,
}: {
  column: { status: ForeshadowingStatus; label: string; icon: React.ReactNode; items: readonly ParsedForeshadowing[] };
  currentChapter: number | undefined;
  hookFacts: readonly EntityFact[];
  onJumpToChapter?: (chapterNumber: number) => void;
}) {
  // SortableContext needs an array of IDs
  const itemIds = column.items.map((i) => i.id);

  return (
    <div className="flex flex-col min-w-0">
      <div className="flex items-center gap-1.5 mb-2 px-1">
        {column.icon}
        <span className="text-xs font-medium">{column.label}</span>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 ml-auto">
          {column.items.length}
        </Badge>
      </div>
      <SortableContext id={column.status} items={itemIds} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2 flex-1 min-h-[60px]">
          {column.items.map((item) => (
            <SortableForeshadowingCard
              key={item.id}
              item={item}
              currentChapter={currentChapter}
              evidence={matchHookEvidence(item, hookFacts)}
              onJumpToChapter={onJumpToChapter}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
