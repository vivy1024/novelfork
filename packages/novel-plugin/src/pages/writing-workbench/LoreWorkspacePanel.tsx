/**
 * LoreWorkspacePanel — 经纬工作区（设定 + 进度）。
 *
 * 合并前「经纬」和「叙事记忆」是两个并列侧栏入口，作者要自己判断某条信息该去哪边找。
 * 现在按 CATEGORY_META.defaultLayer 的既有表态分成两个分区：
 * - 设定：canon/reference 层，作者手写、相对稳定；
 * - 进度：dynamic 层与章后结算产物，随剧情推进，含待确认事件。
 */
import { useState, type ReactNode } from "react";
import { BookMarked, Brain } from "lucide-react";

import { WorkbenchResourceTree, type ResourceTreeAction } from "./WorkbenchResourceTree";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";
import { NarrativeMemoryPanel } from "./NarrativeMemoryPanel";

export type LoreWorkspaceSection = "settings" | "progress";

export interface LoreWorkspacePanelProps {
  readonly bookId?: string;
  /** 静态设定分类树（canon/reference 层）。 */
  readonly settingsNodes: readonly WorkbenchResourceNode[];
  /** 章后推进产物树（dynamic 层）。 */
  readonly progressNodes: readonly WorkbenchResourceNode[];
  readonly selectedNodeId?: string | null;
  readonly onOpen: (node: WorkbenchResourceNode) => void;
  readonly onAction?: (action: ResourceTreeAction) => void;
}

function countEntries(nodes: readonly WorkbenchResourceNode[]): number {
  let total = 0;
  for (const node of nodes) {
    if (node.children?.length) total += node.children.length;
    else total += 1;
  }
  return total;
}

function SectionTab({ active, icon, label, count, onClick, testId }: {
  active: boolean;
  icon: ReactNode;
  label: string;
  count: number;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-selected={active}
      role="tab"
      className={`flex flex-1 items-center justify-center gap-1 border-b-2 px-2 py-1.5 text-[11px] transition-colors ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      <span>{label}</span>
      {count > 0 && <span className="text-[10px] text-muted-foreground">{count}</span>}
    </button>
  );
}

export function LoreWorkspacePanel({
  bookId,
  settingsNodes,
  progressNodes,
  selectedNodeId = null,
  onOpen,
  onAction,
}: LoreWorkspacePanelProps) {
  const [section, setSection] = useState<LoreWorkspaceSection>("settings");

  return (
    <div className="flex h-full flex-col" data-testid="lore-workspace-panel">
      <div className="flex shrink-0 border-b border-border" role="tablist" aria-label="经纬工作区分区">
        <SectionTab
          active={section === "settings"}
          icon={<BookMarked className="size-3.5" />}
          label="设定"
          count={countEntries(settingsNodes)}
          onClick={() => setSection("settings")}
          testId="lore-section-settings"
        />
        <SectionTab
          active={section === "progress"}
          icon={<Brain className="size-3.5" />}
          label="进度"
          count={countEntries(progressNodes)}
          onClick={() => setSection("progress")}
          testId="lore-section-progress"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {section === "settings" ? (
          settingsNodes.length > 0 ? (
            <WorkbenchResourceTree
              nodes={settingsNodes as WorkbenchResourceNode[]}
              selectedNodeId={selectedNodeId}
              onOpen={onOpen}
              onAction={onAction}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-center">
              <span className="text-xs text-muted-foreground">
                还没有设定条目。让叙述者用 lore.write 建立人物、世界与规则。
              </span>
            </div>
          )
        ) : bookId ? (
          <NarrativeMemoryPanel
            bookId={bookId}
            memoryNodes={progressNodes as WorkbenchResourceNode[]}
            selectedNodeId={selectedNodeId}
            onOpen={onOpen}
            onAction={onAction}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-center">
            <span className="text-xs text-muted-foreground">先打开一本书。</span>
          </div>
        )}
      </div>
    </div>
  );
}
