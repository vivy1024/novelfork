/**
 * EditorArea — 中间多 Tab 编辑器区域
 *
 * 支持多 tab 打开/切换/关闭，dirty 标记，关闭时保存提示。
 */

import { useState, useCallback, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface EditorTab {
  readonly id: string;
  readonly title: string;
  readonly dirty?: boolean;
  readonly content: ReactNode;
}

export interface EditorAreaProps {
  readonly tabs: readonly EditorTab[];
  readonly activeTabId: string | null;
  readonly onTabChange: (tabId: string) => void;
  readonly onTabClose: (tabId: string) => void;
}

/* ------------------------------------------------------------------ */
/*  TabBar                                                             */
/* ------------------------------------------------------------------ */

function TabBar({
  tabs,
  activeTabId,
  onTabChange,
  onTabClose,
}: EditorAreaProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="flex shrink-0 items-center gap-0 border-b border-border bg-muted/30 overflow-x-auto" role="tablist">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeTabId}
          className={cn(
            "group flex shrink-0 items-center gap-1 border-r border-border px-3 py-1.5 text-xs cursor-pointer transition",
            tab.id === activeTabId
              ? "bg-card text-foreground"
              : "text-muted-foreground hover:bg-card/50 hover:text-foreground",
          )}
          onClick={() => onTabChange(tab.id)}
          onKeyDown={(e) => { if (e.key === "Enter") onTabChange(tab.id); }}
          tabIndex={0}
        >
          <span className="truncate max-w-[120px]">
            {tab.dirty && <span className="mr-0.5 text-primary">●</span>}
            {tab.title}
          </span>
          <button
            type="button"
            aria-label={`关闭 ${tab.title}`}
            className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted"
            onClick={(e) => {
              e.stopPropagation();
              onTabClose(tab.id);
            }}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  EditorArea                                                         */
/* ------------------------------------------------------------------ */

export function EditorArea({ tabs, activeTabId, onTabChange, onTabClose }: EditorAreaProps) {
  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="flex h-full flex-col" data-testid="editor-area">
      <TabBar tabs={tabs} activeTabId={activeTabId} onTabChange={onTabChange} onTabClose={onTabClose} />

      <div className="min-h-0 flex-1 overflow-auto">
        {activeTab ? (
          activeTab.content
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <p className="text-sm text-muted-foreground">
              {tabs.length === 0
                ? "从左侧叙事线选择章节、经纬或大纲打开编辑。"
                : "选择一个标签页查看内容。"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  useEditorTabs hook                                                 */
/* ------------------------------------------------------------------ */

export interface UseEditorTabsReturn {
  readonly tabs: EditorTab[];
  readonly activeTabId: string | null;
  readonly openTab: (tab: EditorTab) => void;
  readonly closeTab: (tabId: string) => void;
  readonly setActiveTab: (tabId: string) => void;
  readonly setDirty: (tabId: string, dirty: boolean) => void;
}

export function useEditorTabs(): UseEditorTabsReturn {
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const openTab = useCallback((tab: EditorTab) => {
    setTabs((prev) => {
      const existing = prev.find((t) => t.id === tab.id);
      if (existing) return prev;
      return [...prev, tab];
    });
    setActiveTabId(tab.id);
  }, []);

  const closeTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      const index = prev.findIndex((t) => t.id === tabId);
      if (index === -1) return prev;
      const next = prev.filter((t) => t.id !== tabId);
      return next;
    });
    setActiveTabId((prev) => {
      if (prev !== tabId) return prev;
      const remaining = tabs.filter((t) => t.id !== tabId);
      return remaining.length > 0 ? remaining[remaining.length - 1]!.id : null;
    });
  }, [tabs]);

  const setDirty = useCallback((tabId: string, dirty: boolean) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, dirty } : t)));
  }, []);

  return {
    tabs,
    activeTabId,
    openTab,
    closeTab,
    setActiveTab: setActiveTabId,
    setDirty,
  };
}
