# IDE 文件树与编辑器 Tab 对齐 VS Code

## 典型交互

**场景 A：打开非章节文件**
```
用户点击 story/world-model.md →
  use-book-file-tree.ts 识别为 kind: "file"（不在 chapters/ 目录）→
  WorkbenchCanvas 检查 metadata.isChapter === false →
  渲染纯 Textarea 编辑器，无变体/蓝图/AI 续写/ChapterActionsBar
```

**场景 B：拖拽移动文件**
```
用户拖拽 chapters/0003_战斗.md → 放到 drafts/ 文件夹上 →
  文件树高亮 drafts/ 文件夹 + 500ms 后自动展开 →
  调用 POST /api/books/:id/files/rename { oldPath, newPath } →
  刷新文件树
```

**场景 C：Tab 固定**
```
用户右键第一章 Tab → 点击"固定" →
  Tab 左侧出现 Pin 色条 →
  用户点"关闭其他" → 固定 Tab 保留，其他关闭 →
  固定状态存入 localStorage
```

---

## 架构总览

```
use-book-file-tree.ts (数据源)
  ├── 文件系统 API → 构建 WorkbenchResourceNode[]
  ├── kind 判定逻辑（R1 改造重点）
  └── 排序 + 过滤逻辑（R6/R7 新增）

WorkbenchResourceTree.tsx (树 UI)
  ├── TreeNode 渲染（图标按 kind 区分）
  ├── 右键菜单注册机制（R2 改造重点）
  ├── 拖拽支持（R3 新增）
  ├── 剪贴板操作（R4 新增）
  └── 树内搜索（R8 新增）

EditorTabs.tsx (Tab UI)
  ├── Tab Pin 状态管理（R10 新增）
  ├── 右键菜单扩展（R11 改造）
  └── 操作栏按钮（R13 新增）

NarrativeMemoryPanel.tsx (叙事记忆侧边栏，R16 新增)
  ├── 调用 diagnostics/latest 与 events/pending API
  ├── 展示 channels/tokens/warnings/wave 摘要
  └── 展示空状态与 pending NarrativeEvents

EditorBreadcrumbs (面包屑)
  ├── 点击文件夹弹出选择器（R12 增强）
  └── 路径段渲染

WorkbenchCanvas.tsx (编辑器内容)
  └── 章节功能条件化（R14 改造重点）
```

---

## 模块一：文件类型区分（R1）

### kind 体系重新设计

**修改文件**：`use-book-file-tree.ts`

```typescript
// 改前：所有文件 kind = "chapter"
// 改后：
function classifyNode(entry: TreeEntry, parentPath: string): WorkbenchResourceKind {
  if (entry.isDirectory) return "group";
  if (/^chapters[\\/]\d{4}_/.test(entry.path) && entry.name.endsWith(".md")) {
    return "chapter";  // 章节文件
  }
  return "file";  // 其他所有文件
}
```

### metadata 标记

```typescript
// 章节文件附加 isChapter: true
if (kind === "chapter") {
  node.metadata = { ...node.metadata, isChapter: true };
}
```

### WorkbenchCanvas 条件化（R14）

所有章节专属功能的条件从 `kind === "chapter"` 改为 `metadata.isChapter === true`：

```typescript
// 改前
{node.kind === "chapter" && <VariantButton ... />}
// 改后
{node.metadata?.isChapter && <VariantButton ... />}
```

涉及行：WorkbenchCanvas.tsx 中的变体/蓝图/AI 续写/ChapterActionsBar/ChapterToolbar 判断。

---

## 模块二：右键菜单注册机制（R2）

### 菜单注册表

**新建文件**：`ide/context-menu-registry.ts`

```typescript
interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** 条件：节点满足时才显示 */
  when: (node: WorkbenchResourceNode) => boolean;
  /** 快捷键提示（显示用，不绑定） */
  keybinding?: string;
  /** 分组：navigation / edit / clipboard / path */
  group: string;
}

const MENU_ITEMS: ContextMenuItem[] = [
  // 导航组
  { id: "open", label: "打开", group: "navigation",
    when: (n) => n.capabilities.open },
  { id: "open-side", label: "在侧边打开", group: "navigation",
    when: (n) => n.capabilities.open },
  // 编辑组
  { id: "new-file", label: "新建文件", group: "edit",
    when: (n) => n.metadata?.isDirectory === true },
  { id: "new-folder", label: "新建文件夹", group: "edit",
    when: (n) => n.metadata?.isDirectory === true },
  { id: "rename", label: "重命名", group: "edit", keybinding: "F2",
    when: (n) => n.capabilities.edit },
  { id: "delete", label: "删除", group: "edit", keybinding: "Delete",
    when: (n) => n.capabilities.delete },
  // 章节专属
  { id: "variant", label: "生成变体", group: "chapter",
    when: (n) => n.metadata?.isChapter === true },
  { id: "scene-spec", label: "章节蓝图", group: "chapter",
    when: (n) => n.metadata?.isChapter === true },
  // 剪贴板组
  { id: "copy-path", label: "复制路径", group: "clipboard",
    when: () => true },
  { id: "copy", label: "复制", group: "clipboard", keybinding: "Ctrl+C",
    when: (n) => !n.metadata?.isRoot },
  { id: "cut", label: "剪切", group: "clipboard", keybinding: "Ctrl+X",
    when: (n) => n.capabilities.edit },
  { id: "paste", label: "粘贴", group: "clipboard", keybinding: "Ctrl+V",
    when: (n) => n.metadata?.isDirectory === true },
];
```

### FloatingMenu 改造

`WorkbenchResourceTree.tsx` 的 `FloatingMenu` 改为从注册表读取菜单项，按 group 分组渲染分隔线。

---

## 模块三：文件拖拽（R3）

### 实现方案：HTML5 DnD API

选择原生 HTML5 Drag and Drop（不用 @dnd-kit），原因：
- @dnd-kit 在文件树场景下需要为每个节点包裹 `useSortable`，侵入性大
- 原生 DnD API 对文件树拖拽更自然（dragstart/dragover/drop）
- VS Code 也用原生 DnD

### 核心逻辑

```typescript
// TreeNode 中
<div
  draggable={!node.metadata?.isRoot}
  onDragStart={(e) => {
    e.dataTransfer.setData("text/plain", node.id);
    e.dataTransfer.effectAllowed = "move";
  }}
  onDragOver={(e) => {
    if (canDropOn(node)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropTarget(node.id);
      // 500ms 后自动展开文件夹
      startExpandTimer(node.id);
    }
  }}
  onDragLeave={() => setDropTarget(null)}
  onDrop={(e) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("text/plain");
    handleFileMove(sourceId, node.id);
  }}
>
```

### 循环检测

```typescript
function isDescendant(sourcePath: string, targetPath: string): boolean {
  return targetPath.startsWith(sourcePath + "/") || targetPath.startsWith(sourcePath + "\\");
}
```

### API 调用

```typescript
async function handleFileMove(sourceId: string, targetFolderId: string) {
  const sourceNode = resourceMap.get(sourceId);
  const targetNode = resourceMap.get(targetFolderId);
  if (!sourceNode || !targetNode) return;
  if (isDescendant(sourceNode.path, targetNode.path)) return;
  
  const oldPath = sourceNode.path;
  const newPath = `${targetNode.path}/${sourceNode.title}`;
  await fetch(`/api/books/${bookId}/files/rename`, {
    method: "POST",
    body: JSON.stringify({ oldPath, newPath }),
  });
  refreshFileTree();
}
```

---

## 模块四：文件剪贴板（R4）

### 状态管理

```typescript
const [clipboard, setClipboard] = useState<{
  nodeIds: string[];
  mode: "copy" | "cut";
} | null>(null);
```

### 快捷键绑定

在 IdeWorkbench 的 `keybindingActions` 中添加：
```typescript
copyFile: () => { /* 复制选中文件到 clipboard */ },
cutFile: () => { /* 剪切选中文件，标记半透明 */ },
pasteFile: () => { /* 粘贴到当前文件夹 */ },
```

### 粘贴逻辑

- 复制模式：调用后端创建副本 API（或读取内容 + 创建新文件）
- 剪切模式：调用 rename API 移动文件
- 粘贴后清除剪切状态

---

## 模块五：Tab Pin（R10）

### 状态存储

```typescript
// EditorTabs 组件内
const [pinnedTabs, setPinnedTabs] = useState<Set<string>>(() => {
  try {
    const saved = localStorage.getItem(`nf-pinned-tabs-${bookId}`);
    return new Set(saved ? JSON.parse(saved) : []);
  } catch { return new Set(); }
});

// 变化时持久化
useEffect(() => {
  localStorage.setItem(`nf-pinned-tabs-${bookId}`, JSON.stringify([...pinnedTabs]));
}, [pinnedTabs, bookId]);
```

### 批量关闭保护

```typescript
// closeOthers / closeSaved / closeAll 过滤固定 Tab
function closeOthers() {
  tabs.filter(t => !pinnedTabs.has(t.id) && t.id !== activeTabId)
      .forEach(t => closeTab(t.id));
}
```

### 视觉区分

```tsx
<div className={cn(
  "tab-item",
  pinnedTabs.has(tab.id) && "border-l-2 border-primary"  // 左侧色条
)}>
  {pinnedTabs.has(tab.id) && <Pin className="size-3" />}
  <span>{tab.title}</span>
</div>
```

---

## 模块六：面包屑增强（R12）

### 点击文件夹弹出选择器

```tsx
function BreadcrumbSegment({ segment, path, onNavigate }) {
  const [showPicker, setShowPicker] = useState(false);
  const children = getDirectoryChildren(path);
  
  return (
    <span onClick={() => setShowPicker(true)}>
      {segment}
      {showPicker && (
        <div className="absolute top-full left-0 z-50 w-48 bg-card border rounded-md shadow-lg">
          {children.map(child => (
            <button key={child.id} onClick={() => { onNavigate(child); setShowPicker(false); }}>
              {child.title}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
```

---

## 模块七：树内搜索（R8）

### 实现

```typescript
const [searchQuery, setSearchQuery] = useState("");
const [expandedBeforeSearch, setExpandedBeforeSearch] = useState<Set<string> | null>(null);

const filteredNodes = useMemo(() => {
  if (!searchQuery.trim()) return null; // null = 不过滤
  return filterTreeBySearch(nodes, searchQuery);
}, [nodes, searchQuery]);

function filterTreeBySearch(nodes: WorkbenchResourceNode[], query: string): WorkbenchResourceNode[] {
  const lower = query.toLowerCase();
  return nodes.filter(n => {
    const nameMatch = n.title.toLowerCase().includes(lower);
    const childMatch = n.children && filterTreeBySearch(n.children, query).length > 0;
    return nameMatch || childMatch;
  }).map(n => ({
    ...n,
    children: n.children ? filterTreeBySearch(n.children, query) : undefined,
  }));
}
```

搜索时：
1. 保存当前展开状态到 `expandedBeforeSearch`
2. 展开所有匹配节点的父路径
3. 退出搜索时恢复 `expandedBeforeSearch`

---

## 模块八：图片预览（R15）

### 扩展 OPENABLE_EXT

```typescript
const OPENABLE_EXT = new Set([
  ".md", ".txt", ".json", ".markdown", ".yaml", ".yml",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
]);

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);
```

### WorkbenchCanvas 渲染

```typescript
// 在 resource-viewers 注册表中
if (IMAGE_EXT.has(ext)) {
  return (
    <div className="flex items-center justify-center h-full p-4">
      <img src={`/api/books/${bookId}/files/raw?path=${encodeURIComponent(path)}`}
           alt={node.title}
           className="max-w-full max-h-full object-contain" />
    </div>
  );
}
```

需要后端提供 `/api/books/:id/files/raw` 端点返回文件原始内容（二进制）。

---

## 模块九：叙事记忆可见入口（R16）

### ActivityBar 视图接入

在 `use-panel-manager.ts` 中扩展视图枚举：

```typescript
export type ViewId = "explorer" | "jingwei" | "tools" | "search" | "narrative-memory";
```

在 `IdeWorkbench.tsx` 的 `SIDEBAR_VIEWS` 中新增“叙事记忆”视图，图标使用 `Brain` / `Network` / `Waves` 之一，标题显示为“叙事记忆”。

### 面板组件

**新建文件**：`NarrativeMemoryPanel.tsx`

面板负责请求两个 API：

```typescript
GET /api/books/:bookId/narrative-memory/diagnostics/latest
GET /api/books/:bookId/narrative-memory/events/pending
```

### UI 信息架构

```text
叙事记忆
├── 最近召回摘要
│   ├── purpose / chapterNumber / totalMs / totalEstimatedTokens
│   └── warnings
├── 通道状态
│   └── channel / status / latency / candidates / returned / tokens
├── 预算结果
│   └── injectedTokensByChannel / droppedCount / degradedCount
├── Wave 摘要（存在 wave diagnostics 时显示）
│   └── logicDepth / entropy / activatedTags / fallback/rerank
└── 待确认事件
    └── eventType / entity / confidence / risk / evidence
```

### 空状态和错误处理

- diagnostics 返回 404 时显示“还没有叙事记忆记录，请先运行一次写作”，并保留 pending events 区域。
- API 失败时显示轻量错误卡片和“重试”按钮，不让整个工作台崩溃。
- 第一版只读展示，不做 approve/reject，避免引入额外状态修改流程。

---

## 依赖关系

```
use-book-file-tree.ts (R1 kind 改造)
  ↓
WorkbenchResourceTree.tsx (R2/R3/R4/R5/R6/R7/R8)
  ↓
EditorTabs.tsx (R10/R11)
  ↓
EditorBreadcrumbs (R12)
  ↓
WorkbenchCanvas.tsx (R14/R15)

NarrativeMemoryPanel.tsx (R16)
  └── 独立依赖 narrative-memory API，可与文件树/Tab 增强并行实现
```

## 关键引用

| 参考来源 | 借鉴点 |
|----------|--------|
| VS Code `ExplorerView` | 右键菜单分组、条件化显示 |
| VS Code `FileDragAndDrop` | 拖拽验证规则、循环检测 |
| VS Code `FilesFilter` | .gitignore + exclude 过滤逻辑 |
| VS Code `EditorTabsControl` | Tab Pin、Split、操作栏布局 |
| VS Code `BreadcrumbsControl` | 面包屑点击弹出选择器 |
