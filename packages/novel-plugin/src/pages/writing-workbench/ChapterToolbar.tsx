/**
 * ChapterToolbar — 章节编辑器底部可展开工具栏
 *
 * 写章节时的体检面板入口：ChapterHealthCard（节奏/对话比）+ AiTasteReport（AI味检测）
 * Tab 切换，可收起/展开。
 */
import { useState } from "react";
import { ChevronUp, ChevronDown, Activity, Droplets, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ChapterHealthCard } from "./ChapterHealthCard";

type ToolbarTab = "health" | "ai-taste";

export interface ChapterToolbarProps {
  bookId: string;
  chapterNumber?: number;
}

export function ChapterToolbar({ bookId, chapterNumber }: ChapterToolbarProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<ToolbarTab>("health");

  return (
    <div className="shrink-0 border-t border-border bg-muted/20">
      {/* 收起状态：只显示切换条 */}
      <div className="flex items-center h-8 px-3 gap-1">
        <Button
          variant="ghost"
          size="xs"
          className="h-6 gap-1"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
          <span className="text-[10px]">章节体检</span>
        </Button>

        {expanded && (
          <>
            <div className="mx-1 h-4 w-px bg-border" />
            <Button
              variant={activeTab === "health" ? "secondary" : "ghost"}
              size="xs"
              className="h-6 gap-1"
              onClick={() => setActiveTab("health")}
            >
              <Activity className="size-3" />
              <span className="text-[10px]">节奏</span>
            </Button>
            <Button
              variant={activeTab === "ai-taste" ? "secondary" : "ghost"}
              size="xs"
              className="h-6 gap-1"
              onClick={() => setActiveTab("ai-taste")}
            >
              <Droplets className="size-3" />
              <span className="text-[10px]">AI味</span>
            </Button>
          </>
        )}
      </div>

      {/* 展开内容 */}
      {expanded && (
        <div className={cn("border-t border-border overflow-y-auto", "max-h-48 p-3")}>
          {activeTab === "health" && (
            <ChapterHealthCard bookId={bookId} chapterNumber={chapterNumber ?? 1} />
          )}
          {activeTab === "ai-taste" && (
            <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
              <Droplets className="size-6 opacity-30 mb-2" />
              <p className="text-xs">AI 味检测</p>
              <p className="text-[10px] mt-1 opacity-60">保存章节后可运行检测</p>
              <Button variant="outline" size="xs" className="mt-3 gap-1">
                <Play className="size-3" />
                运行检测
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
