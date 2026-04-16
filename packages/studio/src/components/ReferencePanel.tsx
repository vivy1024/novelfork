/**
 * ReferencePanel — bottom panel placeholder for Phase 3.
 * Will eventually contain: truth file preview, character cards,
 * world-info entries, timeline, and other reference materials.
 */

import { BookOpen } from "lucide-react";

interface ReferencePanelProps {
  readonly height: number;
}

export function ReferencePanel({ height }: ReferencePanelProps) {
  return (
    <div
      style={{ height }}
      className="border-t border-border bg-background/50 flex flex-col overflow-hidden"
    >
      <div className="px-4 py-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground border-b border-border/40 shrink-0">
        <BookOpen size={12} />
        <span>参考面板</span>
        <span className="text-[10px] text-muted-foreground/50 ml-auto">Phase 3</span>
      </div>
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground/40 italic">
        参考资料面板将在 Phase 3 实现（设定文件预览、角色卡片、世界观词条）
      </div>
    </div>
  );
}
