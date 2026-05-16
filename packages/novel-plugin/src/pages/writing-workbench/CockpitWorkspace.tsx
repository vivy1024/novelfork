/**
 * CockpitWorkspace — 驾驶舱重构主组件
 *
 * 替代 CockpitOverview，作为画布区域无选中资源时的默认视图。
 * 布局：经纬图谱（主区域）+ 底部状态条（固定）+ 可展开面板（按需）
 */
import { useState, useCallback } from "react";

import type { WorkbenchResourceNode } from "./useWorkbenchResources";
import { StatusBar } from "./StatusBar";
import { ExpandablePanel, type PanelType } from "./ExpandablePanel";
import { JingweiGraphWorkspace } from "./JingweiGraphWorkspace";

export interface CockpitWorkspaceProps {
  bookId?: string;
  nodes: readonly WorkbenchResourceNode[];
  onGuideComplete?: () => void;
  onSelectNode?: (nodeId: string) => void;
}

export function CockpitWorkspace({ bookId, nodes, onGuideComplete, onSelectNode }: CockpitWorkspaceProps) {
  const [activePanel, setActivePanel] = useState<PanelType>(null);
  const [panelHeight, setPanelHeight] = useState<number>(320);
  const [panelMaximized, setPanelMaximized] = useState(false);

  const handleStatusBarClick = useCallback((panel: NonNullable<PanelType>) => {
    setActivePanel((prev) => (prev === panel ? null : panel));
    setPanelMaximized(false);
  }, []);

  const handlePanelClose = useCallback(() => {
    setActivePanel(null);
    setPanelMaximized(false);
  }, []);

  const handlePanelMaximize = useCallback(() => {
    setPanelMaximized((prev) => !prev);
  }, []);

  if (!bookId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>请先选择或创建一本作品</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col min-h-0">
      {/* 主区域：经纬图谱（面板最大化时隐藏） */}
      {!panelMaximized && (
        <div className="flex-1 min-h-0">
          <JingweiGraphWorkspace
            bookId={bookId}
            onSelectNode={onSelectNode}
          />
        </div>
      )}

      {/* 可展开面板 */}
      {activePanel && (
        <ExpandablePanel
          activePanel={activePanel}
          height={panelMaximized ? undefined : panelHeight}
          maximized={panelMaximized}
          bookId={bookId}
          onClose={handlePanelClose}
          onMaximize={handlePanelMaximize}
          onHeightChange={setPanelHeight}
        />
      )}

      {/* 底部状态条（始终可见） */}
      <StatusBar
        bookId={bookId}
        activePanel={activePanel}
        onPanelClick={handleStatusBarClick}
      />
    </div>
  );
}
