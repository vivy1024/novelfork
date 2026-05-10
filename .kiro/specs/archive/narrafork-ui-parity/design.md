# Design — NarraFork UI 对标

## 参考文件

- `.narrafork-reference/API-REFERENCE.md` — 完整 API 端点
- `.narrafork-reference/UI-COMPONENTS.md` — DOM 结构（布局/Composer/工具调用/状态栏）
- `.narrafork-reference/PROVIDERS.md` — 提供商三种 API 模式 + Codex 多账号
- `.narrafork-reference/GAPS.md` — 功能差距清单

## 架构决策

### 1. Composer 修正

当前错误：Composer 里有 `<select>` 模型/权限下拉。
修正为 NarraFork 模式：

```
Composer (flex-shrink: 0, padding: md xs):
├── input[type=file, hidden]
└── Group (gap: xs, align: end):
    ├── ActionIcon(paperclip) → fileInput.click()
    ├── Textarea (flex: 1, placeholder: "发送消息...", rows: 2)
    └── Button: "继续"(蓝) / "发送"(primary) / "中断"(红)
```

### 2. 状态指示器行（新增组件）

在 Composer 上方新增 `NarratorStatusBar` 组件：

```
Group (justify: space-between, border-top, padding: xs md):
├── Left: StatusDot + Text("空闲") + Text("· 上轮耗时 1:05")
└── Right:
    ├── ContextRing (SVG 圆环) → Popover(压缩操作)
    ├── ModelButton (首字母) → DropdownMenu(模型列表, 带搜索)
    ├── ReasoningButton (首字母) → DropdownMenu(关闭/低/中/高/超高)
    ├── FastModeToggle (⚡)
    └── PermissionButton (shield) → DropdownMenu(权限列表)
```

使用 shadcn/ui 的 `DropdownMenu` + `Command`（搜索过滤）组件。

### 3. 消息右键菜单

使用 shadcn/ui 的 `ContextMenu` 组件包裹每条消息：

```tsx
<ContextMenu>
  <ContextMenuTrigger><MessageItem /></ContextMenuTrigger>
  <ContextMenuContent>
    <ContextMenuItem>回退到此处</ContextMenuItem>
    <ContextMenuItem>从此处分叉</ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem>压缩到此消息前</ContextMenuItem>
    <ContextMenuItem>编辑并重新生成</ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem destructive>删除</ContextMenuItem>
  </ContextMenuContent>
</ContextMenu>
```

### 4. 提供商 API 模式

在 ProviderSettingsPage 的 provider 编辑表单中新增：

```
RadioGroup "API 模式":
  - Completions (GPT-4/国产模型)
  - Responses (GPT-4o+)
  - Codex (反代，支持思考强度)

if mode === "codex":
  - NumberInput: Codex 推理强度
  - Switch: Fast Mode
  - Switch: WebSocket
  - Input: Account ID
```

### 5. react-flow 章节图

替换当前项目页的资源树为 react-flow 图：

```
ReactFlow:
  nodes: chapters.map(ch => ({
    id: ch.id,
    type: "chapterNode",
    data: { chapter: ch, narrator: ch.narrator }
  }))
  edges: chapterEdges.map(...)

ChapterNode 自定义节点:
  Card (resizable, draggable):
    ├── DragHandle: 标题 + Badge(状态)
    └── Content: 完整对话窗口（ConversationSurface 嵌入）
```

### 6. 文件修改追踪

使用已有的 `GET /api/narrators/:id/file-modifications` API（NarraFork 已有）。
NovelFork 后端需要对标实现此 API。

前端：顶部工具栏新增 `file-code` 按钮 → 弹出 Sheet/Drawer 显示文件列表 + diff。

## 实现顺序

Phase 1 优先（对话核心体验），因为这是用户每天接触最多的界面。
Phase 2 次之（提供商），因为影响模型调用。
Phase 3 最后（章节图），因为架构改动最大。
