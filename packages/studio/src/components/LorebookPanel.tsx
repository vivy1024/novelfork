/**
 * LorebookPanel — Tab 1: 实体识别 + 关键参数
 * 显示当前章节触发的 Lorebook 词条，实时高亮匹配的关键词
 */

import { useState } from "react";
import { Globe, Edit2 } from "lucide-react";
import { useApi } from "../hooks/use-api";

interface LorebookEntry {
  readonly id: number;
  readonly dimension: string;
  readonly name: string;
  readonly keywords: string;
  readonly content: string;
  readonly priority: number;
  readonly enabled: boolean;
  readonly matched?: boolean;
}

interface LorebookPanelProps {
  readonly bookId: string;
  readonly chapterNumber?: number;
}

export function LorebookPanel({ bookId, chapterNumber }: LorebookPanelProps) {
  const [selectedEntry, setSelectedEntry] = useState<number | null>(null);

  // 获取当前章节触发的词条
  const { data, loading, error } = useApi<{
    entries: ReadonlyArray<LorebookEntry>;
    total: number;
    triggered: ReadonlyArray<number>;
  }>(
    chapterNumber
      ? `/books/${bookId}/lorebook/triggered?chapter=${chapterNumber}`
      : `/books/${bookId}/lorebook/entries`
  );

  const entries = data?.entries ?? [];
  const triggeredIds = new Set(data?.triggered ?? []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-xs text-muted-foreground">加载 Lorebook 词条...</div>
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

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground/50">
        <Globe size={32} className="mb-2 opacity-40" />
        <div className="text-xs">暂无 Lorebook 词条</div>
        <div className="text-[10px] mt-1">通过 API 或导入功能添加世界观设定</div>
      </div>
    );
  }

  const triggeredEntries = entries.filter(e => triggeredIds.has(e.id));
  const otherEntries = entries.filter(e => !triggeredIds.has(e.id));

  return (
    <div className="flex h-full">
      {/* 左侧列表 */}
      <div className="w-64 shrink-0 border-r border-border/30 overflow-y-auto">
        {/* 触发的词条 */}
        {triggeredEntries.length > 0 && (
          <div>
            <div className="px-3 py-2 text-[10px] font-medium text-primary bg-primary/5 sticky top-0">
              当前章节触发 ({triggeredEntries.length})
            </div>
            {triggeredEntries.map((entry) => (
              <EntryListItem
                key={entry.id}
                entry={entry}
                selected={selectedEntry === entry.id}
                triggered={true}
                onClick={() => setSelectedEntry(entry.id)}
              />
            ))}
          </div>
        )}

        {/* 其他词条 */}
        {otherEntries.length > 0 && (
          <div>
            <div className="px-3 py-2 text-[10px] font-medium text-muted-foreground bg-secondary/30 sticky top-0">
              其他词条 ({otherEntries.length})
            </div>
            {otherEntries.map((entry) => (
              <EntryListItem
                key={entry.id}
                entry={entry}
                selected={selectedEntry === entry.id}
                triggered={false}
                onClick={() => setSelectedEntry(entry.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 右侧详情 */}
      <div className="flex-1 overflow-y-auto p-4">
        {selectedEntry ? (
          <EntryDetail entry={entries.find(e => e.id === selectedEntry)!} />
        ) : (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground/40 italic">
            点击左侧词条查看详情
          </div>
        )}
      </div>
    </div>
  );
}

function EntryListItem({
  entry,
  selected,
  triggered,
  onClick
}: {
  entry: LorebookEntry;
  selected: boolean;
  triggered: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 border-b border-border/20 transition-colors ${
        selected
          ? "bg-primary/10 text-primary"
          : "hover:bg-secondary/50 text-foreground"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Globe size={11} className={triggered ? "text-primary" : "text-muted-foreground"} />
        <span className="text-xs font-medium truncate">{entry.name}</span>
        {!entry.enabled && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-red-500/10 text-red-500">禁用</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] px-1 py-0.5 rounded bg-secondary text-muted-foreground">
          {entry.dimension}
        </span>
        {triggered && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-primary/20 text-primary font-medium">
            已触发
          </span>
        )}
      </div>
    </button>
  );
}

function EntryDetail({ entry }: { entry: LorebookEntry }) {
  const keywords = entry.keywords.split(",").map(k => k.trim()).filter(Boolean);

  return (
    <div className="space-y-4">
      {/* 标题 */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-medium text-foreground mb-1">{entry.name}</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-0.5 rounded bg-secondary text-muted-foreground">
              {entry.dimension}
            </span>
            <span className="text-xs text-muted-foreground">
              优先级: {entry.priority}
            </span>
            {!entry.enabled && (
              <span className="text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-500">
                已禁用
              </span>
            )}
          </div>
        </div>
        <button
          className="p-2 hover:bg-secondary/50 rounded transition-colors"
          title="编辑词条"
        >
          <Edit2 size={14} className="text-muted-foreground" />
        </button>
      </div>

      {/* 关键词 */}
      {keywords.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">触发关键词</div>
          <div className="flex flex-wrap gap-1.5">
            {keywords.map((kw, i) => (
              <span
                key={i}
                className="text-xs px-2 py-1 rounded bg-primary/10 text-primary font-mono"
              >
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 内容 */}
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-2">词条内容</div>
        <div className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap bg-secondary/30 rounded-lg p-3">
          {entry.content}
        </div>
      </div>
    </div>
  );
}
