/**
 * useImperativeViews — 命令式视图切换(学 VS Code CompositePart 模式)
 *
 * 所有面板始终 mount,通过 ref 直接操作 DOM display 属性切换可见性。
 * 不触发 React re-render,不依赖虚拟 DOM diff,同步完成。
 */
import { useCallback, useRef, useState } from "react";

export type ViewId = "explorer" | "jingwei" | "tools";

export interface ImperativeViewsReturn {
  activeView: ViewId;
  switchTo: (view: ViewId) => void;
  /** 稳定的 ref 对象(不是 callback ref),直接赋给 div ref */
  explorerRef: React.RefObject<HTMLDivElement | null>;
  jingweiRef: React.RefObject<HTMLDivElement | null>;
  toolsRef: React.RefObject<HTMLDivElement | null>;
}

export function useImperativeViews(initial: ViewId = "explorer"): ImperativeViewsReturn {
  const explorerRef = useRef<HTMLDivElement>(null);
  const jingweiRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const [activeView, setActiveView] = useState<ViewId>(initial);
  const activeRef = useRef<ViewId>(initial);

  const switchTo = useCallback((view: ViewId) => {
    if (activeRef.current === view) return;
    const refs = { explorer: explorerRef, jingwei: jingweiRef, tools: toolsRef };
    // 隐藏旧
    const oldEl = refs[activeRef.current].current;
    if (oldEl) { oldEl.style.display = "none"; oldEl.setAttribute("aria-hidden", "true"); }
    // 显示新
    const newEl = refs[view].current;
    if (newEl) { newEl.style.display = ""; newEl.removeAttribute("aria-hidden"); }
    activeRef.current = view;
    setActiveView(view);
  }, []);

  return { activeView, switchTo, explorerRef, jingweiRef, toolsRef };
}
