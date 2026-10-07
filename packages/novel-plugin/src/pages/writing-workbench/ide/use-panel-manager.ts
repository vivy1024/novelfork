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
 * - `resources`：资源（书里的文件树 + 分析工具，无标签时中央显示作品总览）
 * - `characters-lore`：角色与设定（人物卡、世界观、门派势力）
 * - `storyline`：故事脉络（章节与大纲、章后事实待审；顶部打开故事画布：下一章 / 推进 / 故事树）
 *
 * 旧版的 `explorer`（资源管理器）与 `tools`（分析工具）已合并为 `resources`；
 * 落盘的旧值只在 use-ide-tabs 的读取边界归一，运行时不再出现。
 */
export type ViewId =
  | "write"
  | "resources"
  | "characters-lore"
  | "storyline"
  | "skills-style"
  | "search";

const VIEW_IDS: ViewId[] = [
  "write",
  "resources",
  "characters-lore",
  "storyline",
  "skills-style",
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

export function usePanelManager(initial: ViewId = "resources", layoutKey = "split"): UsePanelManagerReturn {
  const hostRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<PanelManager | null>(null);
  const [activeView, setActiveView] = useState<ViewId>(initial);
  const [ready, setReady] = useState(false);
  const activeViewRef = useRef(activeView);
  activeViewRef.current = activeView;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const manager = new PanelManager(host, VIEW_IDS);
    manager.show(activeViewRef.current);
    managerRef.current = manager;
    setReady(true);
    return () => {
      manager.dispose();
      managerRef.current = null;
      setReady(false);
    };
  }, [layoutKey]);

  const showPanel = useCallback((id: ViewId) => {
    managerRef.current?.show(id);
    setActiveView(id);
  }, []);

  const getContainer = useCallback((id: ViewId) => {
    return managerRef.current?.getContainer(id) ?? null;
  }, []);

  return { activeView, showPanel, hostRef, getContainer, ready };
}
