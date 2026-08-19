/**
 * usePanelManager — React hook wrapping the imperative PanelManager
 *
 * - 在 useEffect 中创建 PanelManager(需要 DOM 容器 ref)
 * - 提供 show() 方法(命令式切换)
 * - 提供 containers 供 createPortal 使用
 * - 提供 activeId state 供 UI 轻量同步(ActivityBar 高亮等)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { PanelManager, type PanelId } from "./panel-manager";

/**
 * 面板视图标识。
 *
 * 彻底消除经纬与叙事记忆技术割裂：
 * - `characters-lore`：角色与设定（人物卡、世界观、门派势力）
 * - `storyline`：故事脉络（大纲、伏笔看板、全景时间线与关系图、章后事实待审）
 *
 */
export type ViewId =
  | "write"
  | "explorer"
  | "characters-lore"
  | "storyline"
  | "skills-style"
  | "tools"
  | "search";

const VIEW_IDS: ViewId[] = [
  "write",
  "explorer",
  "characters-lore",
  "storyline",
  "skills-style",
  "tools",
  "search",
];

export interface UsePanelManagerReturn {
  activeView: ViewId;
  showPanel: (id: ViewId) => void;
  hostRef: React.RefObject<HTMLDivElement | null>;
  getContainer: (id: ViewId) => HTMLDivElement | null;
  /** true after PanelManager is initialized (DOM containers created) */
  ready: boolean;
}

export function usePanelManager(initial: ViewId = "explorer"): UsePanelManagerReturn {
  const hostRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<PanelManager | null>(null);
  const [activeView, setActiveView] = useState<ViewId>(initial);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const manager = new PanelManager(host, VIEW_IDS);
    manager.show(initial);
    managerRef.current = manager;
    setReady(true); // trigger re-render so portals can mount
    return () => {
      manager.dispose();
      managerRef.current = null;
      setReady(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const showPanel = useCallback((id: ViewId) => {
    managerRef.current?.show(id);
    setActiveView(id);
  }, []);

  const getContainer = useCallback((id: ViewId) => {
    return managerRef.current?.getContainer(id) ?? null;
  }, []);

  return { activeView, showPanel, hostRef, getContainer, ready };
}
