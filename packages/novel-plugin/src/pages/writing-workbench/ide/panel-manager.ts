/**
 * PanelManager — 纯命令式 DOM 面板管理器
 *
 * 学 VS Code CompositePart:
 * - 面板容器由 PanelManager 创建和管理(纯 DOM)
 * - React 通过 createPortal 往容器里渲染内容
 * - 切换面板 = 直接操作 DOM display,同步完成
 * - React 完全不参与面板的显/隐决策
 *
 * 使用方式:
 * 1. 创建 manager: const pm = new PanelManager(containerEl, ["explorer","jingwei","tools"])
 * 2. 初始化: pm.show("explorer")
 * 3. 切换: pm.show("tools") — 同步 DOM 操作
 * 4. 获取容器: pm.getContainer("tools") — 用于 createPortal
 */

export type PanelId = string;

export class PanelManager {
  private panels = new Map<PanelId, HTMLDivElement>();
  private activeId: PanelId | null = null;
  private host: HTMLElement;

  constructor(host: HTMLElement, panelIds: PanelId[]) {
    this.host = host;
    // 创建所有面板容器(纯 DOM,不经过 React)
    for (const id of panelIds) {
      const el = document.createElement("div");
      el.dataset.panelId = id;
      el.style.position = "absolute";
      el.style.inset = "0";
      el.style.overflow = "auto";
      el.style.display = "none";
      el.setAttribute("aria-hidden", "true");
      host.appendChild(el);
      this.panels.set(id, el);
    }
  }

  /** 同步切换:隐藏旧面板,显示新面板 */
  show(id: PanelId): void {
    if (this.activeId === id) return;
    // 隐藏旧
    if (this.activeId) {
      const old = this.panels.get(this.activeId);
      if (old) {
        old.style.display = "none";
        old.setAttribute("aria-hidden", "true");
      }
    }
    // 显示新
    const next = this.panels.get(id);
    if (next) {
      next.style.display = "";
      next.removeAttribute("aria-hidden");
    }
    this.activeId = id;
  }

  /** 获取面板 DOM 容器(用于 React createPortal) */
  getContainer(id: PanelId): HTMLDivElement | null {
    return this.panels.get(id) ?? null;
  }

  /** 当前激活面板 */
  getActiveId(): PanelId | null {
    return this.activeId;
  }

  /** 销毁所有面板 */
  dispose(): void {
    this.panels.forEach((el) => el.remove());
    this.panels.clear();
    this.activeId = null;
  }
}
