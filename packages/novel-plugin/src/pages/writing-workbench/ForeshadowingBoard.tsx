import { useState, useCallback } from "react";
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
import { AlertTriangle, Loader2, Eye, EyeOff, Trash2, BookOpen, GripVertical } from "lucide-react";
import { useApi } from "@/hooks/use-api";

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

interface ParsedForeshadowing {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: ForeshadowingStatus;
  readonly plantedChapter: number;
  readonly targetChapter: number;
}

export interface ForeshadowingBoardProps {
  readonly bookId: string;
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

const DEBT_THRESHOLD = 30;

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

// ---------------------------------------------------------------------------
// SortableCard component
// ---------------------------------------------------------------------------

function SortableForeshadowingCard({
  item,
  currentChapter,
  onJumpToChapter,
}: {
  item: ParsedForeshadowing;
  currentChapter: number;
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

  const suspenseDays = item.plantedChapter > 0 ? currentChapter - item.plantedChapter : 0;
  const isOverdue = item.status === "已埋设" && suspenseDays > DEBT_THRESHOLD;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-md border p-3 bg-card text-card-foreground shadow-sm space-y-1.5 ${
        isOverdue ? "border-red-500 border-2" : "border-border"
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
        {isOverdue && <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
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
        {item.plantedChapter > 0 && (
          <span className={isOverdue ? "text-red-500 font-medium" : ""}>
            悬念: {suspenseDays}章
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DragOverlay card (non-interactive snapshot shown during drag)
// ---------------------------------------------------------------------------

function DragOverlayCard({ item, currentChapter }: { item: ParsedForeshadowing; currentChapter: number }) {
  const suspenseDays = item.plantedChapter > 0 ? currentChapter - item.plantedChapter : 0;
  const isOverdue = item.status === "已埋设" && suspenseDays > DEBT_THRESHOLD;

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

export function ForeshadowingBoard({ bookId, currentChapter = 1, onJumpToChapter }: ForeshadowingBoardProps) {
  const { data, loading, error } = useApi<EntriesResponse>(
    `/api/books/${bookId}/jingwei/entries?category=foreshadowing`,
  );

  // Local entries state for optimistic UI updates
  const [entries, setEntries] = useState<ParsedForeshadowing[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Derive entries from API data (only when local state is null)
  const items = entries ?? (data?.entries ?? []).map(parseForeshadowing);

  // Sync from API when data changes and local state hasn't been modified
  if (entries === null && data?.entries) {
    // This runs on re-render; entries will be set on next state update if needed
  }

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
          const res = await fetch(
            `/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(draggedId)}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ customFields: { status: targetStatus } }),
            },
          );
          if (!res.ok) {
            throw new Error(`${res.status}`);
          }
        } catch {
          toast("伏笔状态保存失败，请重试", "error");
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
      <div className="grid grid-cols-4 gap-3 p-3 h-full overflow-auto">
        {grouped.map((col) => (
          <DroppableColumn
            key={col.status}
            column={col}
            currentChapter={currentChapter}
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
  onJumpToChapter,
}: {
  column: { status: ForeshadowingStatus; label: string; icon: React.ReactNode; items: readonly ParsedForeshadowing[] };
  currentChapter: number;
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
              onJumpToChapter={onJumpToChapter}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
