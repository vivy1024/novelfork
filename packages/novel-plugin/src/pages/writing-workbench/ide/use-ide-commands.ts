/**
 * useIdeCommands — 构建 IDE 命令面板的命令列表（≥15 条）
 */
import { useMemo } from "react";
import type { PaletteCommand } from "./command-palette";

export interface IdeCommandOptions {
  switchView: (view: "write" | "explorer" | "jingwei" | "tools" | "search") => void;
  toggleSidebar: () => void;
  toggleChat: () => void;
  setShowSettings: (v: boolean) => void;
  closeTab: () => void;
  closeAllTabs: () => void;
  openFile?: (name: string) => void;
  /** 打开导入向导（拆书/续写旧书）。 */
  openImportWizard?: () => void;
  /**
   * 把一条明确请求交给当前叙述者执行（工具链与权限确认仍在 Runtime 侧）。
   * 命令面板的写作类命令通过它触发，前端不自行执行写工具。
   */
  sendToNarrator?: (message: string) => void;
}

export function useIdeCommands(options: IdeCommandOptions): PaletteCommand[] {
  return useMemo(
    () => [
      {
        id: "view.explorer",
        label: "显示: 资源管理器",
        category: "视图",
        shortcut: "Ctrl+1",
        execute: () => options.switchView("explorer"),
      },
      {
        id: "view.jingwei",
        label: "显示: 经纬",
        category: "视图",
        shortcut: "Ctrl+2",
        execute: () => options.switchView("jingwei"),
      },
      {
        id: "view.tools",
        label: "显示: 工具",
        category: "视图",
        shortcut: "Ctrl+3",
        execute: () => options.switchView("tools"),
      },
      {
        id: "view.sidebar.toggle",
        label: "切换侧栏",
        category: "视图",
        shortcut: "Ctrl+B",
        execute: options.toggleSidebar,
      },
      {
        id: "view.chat.toggle",
        label: "切换对话面板",
        category: "视图",
        shortcut: "Ctrl+J",
        execute: options.toggleChat,
      },
      {
        id: "settings.open",
        label: "打开写作设置",
        category: "设置",
        execute: () => options.setShowSettings(true),
      },
      {
        id: "tab.close",
        label: "关闭当前标签",
        category: "编辑器",
        shortcut: "Ctrl+W",
        execute: options.closeTab,
      },
      {
        id: "tab.closeAll",
        label: "关闭所有标签",
        category: "编辑器",
        execute: options.closeAllTabs,
      },
      {
        id: "editor.save",
        label: "保存",
        category: "编辑器",
        shortcut: "Ctrl+S",
        execute: () => window.dispatchEvent(new CustomEvent("ide:save")),
      },
      {
        id: "palette.quickOpen",
        label: "快速打开文件",
        category: "导航",
        shortcut: "Ctrl+P",
        execute: () => {}, // handled by mode switch
      },
      {
        id: "view.settings",
        label: "打开书籍设置",
        category: "设置",
        execute: () => options.setShowSettings(true),
      },
      {
        id: "editor.splitRight",
        label: "在侧边打开",
        category: "编辑器",
        shortcut: "Ctrl+\\",
        execute: () => {},
      },
      {
        id: "jingwei.refresh",
        label: "刷新经纬数据",
        category: "经纬",
        execute: () => window.location.reload(),
      },
      {
        id: "tools.health",
        label: "打开: 全书健康",
        category: "工具",
        execute: () => options.switchView("tools"),
      },
      {
        id: "tools.foreshadowing",
        label: "打开: 伏笔看板",
        category: "工具",
        execute: () => options.switchView("tools"),
      },
      {
        id: "view.write",
        label: "显示: 写作",
        category: "视图",
        execute: () => options.switchView("write"),
      },
      {
        id: "write.preflight",
        label: "写章预检（就绪度检查）",
        category: "写作",
        execute: () => options.switchView("write"),
      },
      {
        id: "write.import",
        label: "导入旧书 / 拆书",
        category: "写作",
        execute: () => options.openImportWizard?.(),
      },
      {
        id: "outline.volume",
        label: "卷纲：查看或生成草案",
        category: "写作",
        execute: () => options.sendToNarrator?.(
          "请用 outline.volume(action=get) 读取当前卷纲；如果还没有，就用 action=suggest 生成草案给我确认。",
        ),
      },
      {
        id: "publish.check",
        label: "发布自检（平台合规）",
        category: "写作",
        execute: () => options.sendToNarrator?.(
          "请用 publish.check 对最近章节做发布前自检，并按平台要求报告敏感词、AI 率与格式问题。",
        ),
      },
      {
        id: "help.shortcuts",
        label: "键盘快捷键",
        category: "帮助",
        execute: () => {},
      },
    ],
    [options]
  );
}
