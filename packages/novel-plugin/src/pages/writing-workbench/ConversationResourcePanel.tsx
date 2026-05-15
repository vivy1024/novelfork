/**
 * ConversationResourcePanel — 对话面板右侧资源管理器
 *
 * 通用设计：文件树 + 内容预览。
 * Agent 操作文件时自动跟随显示当前文件内容。
 */
import { useState, useEffect, useCallback } from "react";
import { ChevronRight, ChevronDown, FileText, FolderOpen, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface ResourceFile {
  id: string;
  title: string;
  kind: "chapter" | "story" | "jingwei" | "candidate" | "draft";
  path?: string;
}

export interface ConversationResourcePanelProps {
  bookId: string;
  /** Agent 当前正在操作的文件 ID（自动跟随） */
  activeFileId?: string | null;
  /** 文件列表 */
  files: ResourceFile[];
  /** 获取文件内容 */
  onLoadContent: (fileId: string) => Promise<string>;
  /** 可折叠 */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function ConversationResourcePanel({
  bookId,
  activeFileId,
  files,
  onLoadContent,
  collapsed,
  onToggleCollapse,
}: ConversationResourcePanelProps) {
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // Agent 操作文件时自动跟随
  useEffect(() => {
    if (activeFileId && activeFileId !== selectedFileId) {
      setSelectedFileId(activeFileId);
    }
  }, [activeFileId]);

  // 加载选中文件内容
  useEffect(() => {
    if (!selectedFileId) {
      setContent("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    onLoadContent(selectedFileId).then((text) => {
      if (!cancelled) {
        setContent(text);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setContent("加载失败");
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [selectedFileId, onLoadContent]);

  if (collapsed) {
    return (
      <div className="w-8 shrink-0 border-l border-border flex flex-col items-center pt-2">
        <Button variant="ghost" size="icon" className="size-6" onClick={onToggleCollapse}>
          <Eye className="size-3.5" />
        </Button>
      </div>
    );
  }

  // 按 kind 分组
  const groups = groupByKind(files);

  return (
    <div className="w-64 shrink-0 border-l border-border flex flex-col min-h-0 bg-background">
      {/* 标题栏 */}
      <div className="flex h-8 items-center justify-between border-b border-border px-2">
        <span className="text-xs font-medium text-muted-foreground">资源</span>
        <Button variant="ghost" size="icon" className="size-5" onClick={onToggleCollapse}>
          <ChevronRight className="size-3" />
        </Button>
      </div>

      {/* 文件树 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-1">
        {groups.map((group) => (
          <FileGroup
            key={group.kind}
            kind={group.kind}
            files={group.files}
            selectedFileId={selectedFileId}
            onSelect={setSelectedFileId}
          />
        ))}
        {files.length === 0 && (
          <p className="px-2 py-4 text-xs text-muted-foreground text-center">暂无文件</p>
        )}
      </div>

      {/* 内容预览 */}
      {selectedFileId && (
        <div className="border-t border-border flex-1 min-h-[120px] max-h-[50%] overflow-y-auto">
          <div className="sticky top-0 bg-muted/50 px-2 py-1 text-[10px] text-muted-foreground border-b border-border">
            {files.find((f) => f.id === selectedFileId)?.title ?? "预览"}
            {loading && " — 加载中..."}
          </div>
          <pre className="p-2 text-xs whitespace-pre-wrap break-words font-mono leading-relaxed">
            {content || (loading ? "" : "空文件")}
          </pre>
        </div>
      )}
    </div>
  );
}

// --- 内部组件 ---

const KIND_LABELS: Record<string, string> = {
  chapter: "章节",
  story: "大纲与设定",
  jingwei: "经纬资料",
  candidate: "候选稿",
  draft: "草稿",
};

function groupByKind(files: ResourceFile[]) {
  const map = new Map<string, ResourceFile[]>();
  for (const f of files) {
    const arr = map.get(f.kind) ?? [];
    arr.push(f);
    map.set(f.kind, arr);
  }
  return Array.from(map.entries()).map(([kind, files]) => ({ kind, files }));
}

function FileGroup({
  kind,
  files,
  selectedFileId,
  onSelect,
}: {
  kind: string;
  files: ResourceFile[];
  selectedFileId: string | null;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mb-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/50"
      >
        {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <FolderOpen className="size-3" />
        <span>{KIND_LABELS[kind] ?? kind}</span>
        <span className="ml-auto text-[10px] tabular-nums">{files.length}</span>
      </button>
      {expanded && (
        <div className="ml-3 space-y-px">
          {files.map((file) => (
            <button
              key={file.id}
              onClick={() => onSelect(file.id)}
              className={cn(
                "flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] transition-colors",
                selectedFileId === file.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              )}
            >
              <FileText className="size-3 shrink-0" />
              <span className="truncate">{file.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
