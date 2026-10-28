/**
 * useIdeKeybindings — IDE 快捷键系统
 *
 * 对齐 VS Code 常用快捷键:
 * - Ctrl+S  保存当前文件
 * - Ctrl+W  关闭当前 Tab
 * - Ctrl+B  切换 Sidebar
 * - Ctrl+J  切换 Chat Panel
 * - Ctrl+Shift+Enter  专注模式（只留稿面；再按恢复原布局）
 * - Ctrl+\  分屏（预留）
 * - Ctrl+Tab / Ctrl+Shift+Tab  切换 Tab
 * - Ctrl+1/2/3  切换到 资源/作品基础/故事推进 视图
 */
import { useEffect } from "react";
import { tinykeys } from "tinykeys";
import type { ViewId } from "./use-panel-manager";

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
  toggleFocusMode?: () => void;
  nextTab: () => void;
  prevTab: () => void;
  switchView: (view: ViewId) => void;
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
      // 写正文时也要能用，所以不判 isEditingContext；Enter 本身不会被吞（带了修饰键）
      // 带修饰键，写正文时按也不会插入换行。
      "$mod+Shift+Enter": (e) => {
        if (!actions.toggleFocusMode) return;
        e.preventDefault();
        actions.toggleFocusMode();
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
        actions.switchView("resources");
      },
      "$mod+Digit2": (e) => {
        e.preventDefault();
        actions.switchView("characters-lore");
      },
      "$mod+Digit3": (e) => {
        e.preventDefault();
        actions.switchView("storyline");
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
