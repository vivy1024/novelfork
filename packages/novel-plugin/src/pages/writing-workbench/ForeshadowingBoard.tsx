import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Loader2, Eye, EyeOff, Trash2, BookOpen } from "lucide-react";
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

// ---------------------------------------------------------------------------
// Card component
// ---------------------------------------------------------------------------

function ForeshadowingCard({
  item,
  currentChapter,
}: {
  item: ParsedForeshadowing;
  currentChapter: number;
}) {
  const suspenseDays = item.plantedChapter > 0 ? currentChapter - item.plantedChapter : 0;
  const isOverdue = item.status === "已埋设" && suspenseDays > DEBT_THRESHOLD;

  return (
    <div
      className={`rounded-md border p-3 bg-card text-card-foreground shadow-sm space-y-1.5 ${
        isOverdue ? "border-red-500 border-2" : "border-border"
      }`}
    >
      <div className="flex items-center gap-1.5">
        {isOverdue && <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
        <span className="text-sm font-medium truncate">{item.name}</span>
      </div>
      {item.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {item.plantedChapter > 0 && <span>埋设: 第{item.plantedChapter}章</span>}
        {item.targetChapter > 0 && <span>目标: 第{item.targetChapter}章</span>}
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
// Main component
// ---------------------------------------------------------------------------

export function ForeshadowingBoard({ bookId, currentChapter = 1 }: ForeshadowingBoardProps) {
  const { data, loading, error } = useApi<EntriesResponse>(
    `/api/books/${bookId}/jingwei/entries?category=foreshadowing`,
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

  const items = (data?.entries ?? []).map(parseForeshadowing);

  const grouped = COLUMNS.map((col) => ({
    ...col,
    items: items.filter((i) => i.status === col.status),
  }));

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <BookOpen className="w-8 h-8 mb-2 opacity-40" />
        <span className="text-sm">暂无伏笔条目</span>
        <span className="text-xs mt-1">在经纬系统中添加 foreshadowing 分类条目后即可显示</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-3 p-3 h-full overflow-auto">
      {grouped.map((col) => (
        <div key={col.status} className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5 mb-2 px-1">
            {col.icon}
            <span className="text-xs font-medium">{col.label}</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 ml-auto">
              {col.items.length}
            </Badge>
          </div>
          <div className="flex flex-col gap-2 flex-1">
            {col.items.map((item) => (
              <ForeshadowingCard key={item.id} item={item} currentChapter={currentChapter} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
