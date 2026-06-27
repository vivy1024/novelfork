import type { ResourceTreeAction } from "../WorkbenchResourceTree";
import type { WorkbenchResourceNode } from "../useWorkbenchResources";

export type ResourceContextMenuGroup = "navigation" | "edit" | "chapter" | "clipboard";

export interface ResourceContextMenuItem {
  id: string;
  label: string;
  action: ResourceTreeAction["type"];
  group: ResourceContextMenuGroup;
  keybinding?: string;
  when: (node: WorkbenchResourceNode) => boolean;
}

function isDirectory(node: WorkbenchResourceNode): boolean {
  return node.metadata?.isDirectory === true;
}

function isRoot(node: WorkbenchResourceNode): boolean {
  return node.metadata?.isRoot === true;
}

function isChapter(node: WorkbenchResourceNode): boolean {
  return node.metadata?.isChapter === true;
}

export const RESOURCE_CONTEXT_MENU_ITEMS: readonly ResourceContextMenuItem[] = [
  { id: "open-side", label: "在侧边打开", action: "open-side", group: "navigation", when: (node) => node.capabilities.open || isDirectory(node) },
  { id: "create", label: "新建条目", action: "create", group: "edit", when: (node) => node.kind === "jingwei-section" },
  { id: "create-file", label: "新建文件", action: "create-file", group: "edit", when: isDirectory },
  { id: "create-folder", label: "新建文件夹", action: "create-folder", group: "edit", when: isDirectory },
  { id: "rename", label: "重命名", action: "rename", group: "edit", keybinding: "F2", when: (node) => node.capabilities.edit && !isRoot(node) },
  { id: "delete", label: "删除", action: "delete", group: "edit", keybinding: "Delete", when: (node) => node.capabilities.delete && !isRoot(node) },
  { id: "generate-variant", label: "生成变体", action: "generate-variant", group: "chapter", when: isChapter },
  { id: "scene-spec", label: "章节蓝图", action: "scene-spec", group: "chapter", when: isChapter },
  { id: "copy-path", label: "复制路径", action: "copy-path", group: "clipboard", when: (node) => typeof node.metadata?.filePath === "string" },
  { id: "copy", label: "复制", action: "copy", group: "clipboard", keybinding: "Ctrl+C", when: (node) => typeof node.metadata?.filePath === "string" && !isRoot(node) && !isDirectory(node) },
  { id: "cut", label: "剪切", action: "cut", group: "clipboard", keybinding: "Ctrl+X", when: (node) => node.capabilities.edit && typeof node.metadata?.filePath === "string" && !isRoot(node) },
  { id: "paste", label: "粘贴", action: "paste", group: "clipboard", keybinding: "Ctrl+V", when: isDirectory },
];

export function getResourceContextMenuItems(node: WorkbenchResourceNode): ResourceContextMenuItem[] {
  return RESOURCE_CONTEXT_MENU_ITEMS.filter((item) => item.when(node));
}
