/**
 * useIdeKeybindings — IDE 快捷键系统
 *
 * 对齐 VS Code 常用快捷键:
 * - Ctrl+S  保存当前文件
 * - Ctrl+W  关闭当前 Tab
 * - Ctrl+B  切换 Sidebar
 * - Ctrl+J  切换 Chat Panel
 * - Ctrl+\  分屏（预留）
 * - Ctrl+Tab / Ctrl+Shift+Tab  切换 Tab
 * - Ctrl+1/2/3  切换到 资源管理器/经纬/工具 视图
 */
import { useEffect } from "react";
import { tinykeys } from "tinykeys";

/** Check if the currently focused element is an input/textarea/contenteditable */
function isEditingContext(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export interface IdeKeybindingActions {
  save: () => void;
  closeTab: () => void;
  toggleSidebar: () => void;
  toggleChat: () => void;
  nextTab: () => void;
  prevTab: () => void;
  switchView: (view: "explorer" | "jingwei" | "tools") => void;
  splitEditor?: () => void;
  openCommandPalette?: () => void;
  openQuickOpen?: () => void;
}

export function useIdeKeybindings(actions: IdeKeybindingActions) {
  useEffect(() => {
    const unsubscribe = tinykeys(window, {
      "$mod+KeyS": (e) => {
        e.preventDefault();
        actions.save();
      },
      "$mod+KeyW": (e) => {
        if (isEditingContext()) return; // don't hijack input
        e.preventDefault();
        actions.closeTab();
      },
      "$mod+KeyB": (e) => {
        e.preventDefault();
        actions.toggleSidebar();
      },
      "$mod+KeyJ": (e) => {
        e.preventDefault();
        actions.toggleChat();
      },
      "$mod+Tab": (e) => {
        if (isEditingContext()) return;
        e.preventDefault();
        actions.nextTab();
      },
      "$mod+Shift+Tab": (e) => {
        if (isEditingContext()) return;
        e.preventDefault();
        actions.prevTab();
      },
      // Ctrl+1/2/3 切换 ActivityBar 视图
      "$mod+Digit1": (e) => {
        e.preventDefault();
        actions.switchView("explorer");
      },
      "$mod+Digit2": (e) => {
        e.preventDefault();
        actions.switchView("jingwei");
      },
      "$mod+Digit3": (e) => {
        e.preventDefault();
        actions.switchView("tools");
      },
      // 分屏（预留）
      "$mod+Backslash": (e) => {
        e.preventDefault();
        actions.splitEditor?.();
      },
      // 命令面板
      "$mod+Shift+KeyP": (e) => {
        e.preventDefault();
        actions.openCommandPalette?.();
      },
      // 快速打开
      "$mod+KeyP": (e) => {
        e.preventDefault();
        actions.openQuickOpen?.();
      },
    });

    return unsubscribe;
  }, [actions]);
}
