/**
 * WorldDimensions — Tab 4: 世界观维度浏览
 * 显示 9 个世界观维度，每个维度显示词条数量，点击跳转到 Lorebook 管理页面
 */

import { Globe, ChevronRight } from "lucide-react";
import { useApi } from "../hooks/use-api";

interface DimensionData {
  readonly key: string;
  readonly label: string;
  readonly entryCount: number;
  readonly description?: string;
}

interface WorldDimensionsProps {
  readonly bookId: string;
}

// 9 个世界观维度的默认配置
const DEFAULT_DIMENSIONS = [
  { key: "character", label: "角色", description: "人物、组织、势力" },
  { key: "location", label: "地点", description: "场景、地理、建筑" },
  { key: "item", label: "物品", description: "道具、装备、宝物" },
  { key: "skill", label: "技能", description: "功法、技术、能力" },
  { key: "event", label: "事件", description: "历史、传说、大事记" },
  { key: "concept", label: "概念", description: "设定、规则、术语" },
  { key: "culture", label: "文化", description: "风俗、制度、信仰" },
  { key: "creature", label: "生物", description: "种族、怪物、灵兽" },
  { key: "other", label: "其他", description: "未分类的世界观元素" },
];

export function WorldDimensions({ bookId }: WorldDimensionsProps) {
  const { data, loading, error } = useApi<{ dimensions: ReadonlyArray<DimensionData> }>(
    `/books/${bookId}/lorebook/dimensions`
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-xs text-muted-foreground">加载世界观维度...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-xs text-destructive">加载失败: {String(error)}</div>
      </div>
    );
  }

  // 合并 API 数据和默认配置
  const dimensions = DEFAULT_DIMENSIONS.map(def => {
    const apiData = data?.dimensions?.find(d => d.key === def.key);
    return {
      ...def,
      entryCount: apiData?.entryCount ?? 0,
    };
  });

  const totalEntries = dimensions.reduce((sum, d) => sum + d.entryCount, 0);

  return (
    <div className="flex flex-col h-full">
      {/* 顶部统计 */}
      <div className="shrink-0 px-4 py-3 border-b border-border/30 bg-background/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe size={16} className="text-primary" />
            <span className="text-sm font-medium text-foreground">世界观维度</span>
          </div>
          <div className="text-xs text-muted-foreground">
            共 <span className="font-mono text-foreground">{totalEntries}</span> 个词条
          </div>
        </div>
      </div>

      {/* 维度网格 */}
      <div className="flex-1 overflow-y-auto p-4">
        {totalEntries === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground/50">
            <Globe size={32} className="mb-2 opacity-40" />
            <div className="text-xs">暂无世界观词条</div>
            <div className="text-[10px] mt-1">通过 API 或导入功能添加世界观设定</div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {dimensions.map((dim) => (
              <DimensionCard key={dim.key} dimension={dim} bookId={bookId} />
            ))}
          </div>
        )}
      </div>

      {/* 底部提示 */}
      <div className="shrink-0 px-4 py-2 border-t border-border/30 bg-secondary/20">
        <div className="text-[10px] text-muted-foreground text-center">
          点击维度卡片查看详细词条 · 在 Lorebook 管理页面编辑
        </div>
      </div>
    </div>
  );
}

function DimensionCard({
  dimension,
  bookId
}: {
  dimension: DimensionData & { description?: string };
  bookId: string;
}) {
  const handleClick = () => {
    // 触发导航到 Lorebook 管理页面（通过自定义事件）
    window.dispatchEvent(
      new CustomEvent("inkos:navigate", {
        detail: { page: "lorebook", bookId, dimension: dimension.key }
      })
    );
  };

  const isEmpty = dimension.entryCount === 0;

  return (
    <button
      onClick={handleClick}
      disabled={isEmpty}
      className={`group relative border rounded-lg p-4 text-left transition-all ${
        isEmpty
          ? "border-border/30 bg-secondary/10 cursor-not-allowed opacity-50"
          : "border-border/40 bg-card hover:border-primary/50 hover:bg-primary/5 hover:shadow-md"
      }`}
    >
      {/* 维度图标和名称 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Globe size={14} className={isEmpty ? "text-muted-foreground/40" : "text-primary"} />
          <span className={`text-sm font-medium ${isEmpty ? "text-muted-foreground" : "text-foreground"}`}>
            {dimension.label}
          </span>
        </div>
        {!isEmpty && (
          <ChevronRight
            size={14}
            className="text-muted-foreground group-hover:text-primary transition-colors"
          />
        )}
      </div>

      {/* 词条数量 */}
      <div className={`text-2xl font-mono font-bold mb-1 ${
        isEmpty ? "text-muted-foreground/40" : "text-foreground"
      }`}>
        {dimension.entryCount}
      </div>

      {/* 描述 */}
      {dimension.description && (
        <p className="text-[10px] text-muted-foreground/60 line-clamp-2">
          {dimension.description}
        </p>
      )}

      {/* 空状态提示 */}
      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[10px] text-muted-foreground/40 italic">暂无词条</span>
        </div>
      )}
    </button>
  );
}
