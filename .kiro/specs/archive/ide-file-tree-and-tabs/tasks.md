# IDE 文件树与编辑器 Tab 对齐 VS Code — Tasks

**Spec**: `requirements.md` + `design.md`
**执行顺序**: 先基础（kind 重构）→ 再文件树功能 → 再 Tab 增强 → 最后集成验证

---

## Phase 1: 文件类型区分（R1 + R14 — 所有后续任务的前置）

### Task 1: use-book-file-tree.ts kind 重构
- **文件**: `packages/novel-plugin/src/pages/writing-workbench/ide/use-book-file-tree.ts`
- **实现**:
  - 新增 `classifyNode(entry)` 函数：`chapters/NNNN_*.md` → `"chapter"` + `metadata.isChapter = true`，其他文件 → `"file"`
  - 修改节点构建逻辑，不再统一 `kind: "chapter"`
  - 非章节 `.md/.txt/.json` 文件的 `capabilities.edit = true`（可编辑但无章节专属操作）
- **验证**: typecheck 通过

### Task 2: WorkbenchCanvas 章节功能条件化
- **文件**: `packages/novel-plugin/src/pages/writing-workbench/WorkbenchCanvas.tsx`
- **实现**:
  - 搜索所有 `kind === "chapter"` 判断，改为 `metadata?.isChapter === true`
  - 涉及：变体生成按钮、章节蓝图按钮、Tab AI 续写、变体对比面板、ChapterToolbar、ChapterActionsBar
  - `kind === "candidate"` / `kind === "draft"` 的分支（已废除）可以保留但加注释标记为废弃
- **验证**: typecheck 通过；非章节文件打开后无章节专属 UI

### Task 3: 图片预览 + 扩展名白名单（R15）
- **文件**: `use-book-file-tree.ts` + `WorkbenchCanvas.tsx`（或 `resource-viewers/index.tsx`）
- **实现**:
  - `OPENABLE_EXT` 增加 `.png/.jpg/.jpeg/.gif/.svg/.webp`
  - 新增 `IMAGE_EXT` Set
  - `resource-viewers` 注册表中增加图片渲染：`<img src={rawUrl} />`
  - 后端确认 `/api/books/:id/files/raw` 端点是否已存在（如果不存在需要新建）
  - 不支持的扩展名显示占位符 + 文件大小
- **验证**: typecheck 通过；图片文件可在编辑器中预览

---

## Phase 2: 文件树增强（R2-R8）

### Task 4: 右键菜单注册机制（R2）
- **文件**: 新建 `packages/novel-plugin/src/pages/writing-workbench/ide/context-menu-registry.ts` + 修改 `WorkbenchResourceTree.tsx`
- **实现**:
  - 定义 `ContextMenuItem` 接口和 `MENU_ITEMS` 注册表
  - `getMenuItems(node)` 改为从注册表过滤 `when(node) === true` 的项
  - 按 `group` 分组渲染分隔线
  - 章节专属菜单项（生成变体/章节蓝图）通过 `metadata.isChapter` 条件化
  - 新增"复制路径"菜单项
- **验证**: 右键章节文件和普通文件显示不同菜单

### Task 5: 复制路径（R5）
- **文件**: `WorkbenchResourceTree.tsx` 或 `IdeWorkbench.tsx`
- **实现**:
  - 右键"复制路径"调用 `navigator.clipboard.writeText(relativePath)`
  - 操作成功后 toast 提示"已复制路径"
- **验证**: 右键复制路径后粘贴到文本编辑器确认

### Task 6: 文件拖拽移动（R3）
- **文件**: `WorkbenchResourceTree.tsx` + `TreeNode` 组件
- **实现**:
  - `draggable` 属性（根节点不可拖）
  - `onDragStart`：设置 `dataTransfer` 数据
  - `onDragOver`：验证 `canDropOn`（循环检测）+ 设置 dropEffect + 500ms 自动展开定时器
  - `onDragLeave`：清除 dropTarget + 清除定时器
  - `onDrop`：调用后端 rename API + 刷新文件树
  - 拖拽中目标文件夹视觉高亮（边框/背景色）
- **验证**: 拖拽文件到文件夹确认移动成功；拖拽到自身子目录被阻止

### Task 7: 文件剪贴板（R4）
- **文件**: `IdeWorkbench.tsx`（状态管理 + 快捷键）+ `WorkbenchResourceTree.tsx`（视觉反馈）
- **实现**:
  - `clipboard` state：`{ nodeIds: string[], mode: "copy" | "cut" } | null`
  - `keybindingActions` 增加 copyFile/cutFile/pasteFile
  - 剪切态节点视觉半透明（`opacity: 0.5`）
  - 粘贴到文件夹：复制=创建副本（读内容+写新文件），剪切=rename 移动
  - Escape 清除剪切状态
  - 右键菜单"复制"/"剪切"/"粘贴"与快捷键联动
- **验证**: Ctrl+C → Ctrl+V 创建副本；Ctrl+X → Ctrl+V 移动文件

### Task 8: 文件过滤（R6）
- **文件**: `use-book-file-tree.ts`
- **实现**:
  - 默认排除 `node_modules/`、`.git/`、`*.lock` 文件
  - 后端 `/api/books/:id/files/tree` 增加 `exclude` 参数（glob 模式数组）
  - 前端过滤逻辑：构建树时跳过匹配 exclude 规则的条目
  - 已在编辑器中打开的被排除文件仍显示（标记 `isExcluded` metadata）
- **验证**: node_modules 目录不出现在文件树中

### Task 9: 文件排序（R7）
- **文件**: `use-book-file-tree.ts`
- **实现**:
  - 排序函数 `sortNodes(nodes, mode)`：`name`（默认）/ `type`（扩展名）/ `modified`（修改时间）
  - 所有模式文件夹在前
  - 排序设置存入 `localStorage`（per bookId）
  - 文件树顶部增加排序切换按钮（或右键菜单选项）
- **验证**: 切换排序方式后文件树重新排列

### Task 10: 树内搜索（R8）
- **文件**: `WorkbenchResourceTree.tsx`
- **实现**:
  - 搜索输入框：文件树顶部（或 Ctrl+F 触发）
  - `filterTreeBySearch(nodes, query)`：匹配文件名，保留父路径
  - 搜索时展开所有匹配节点的父路径
  - 退出搜索（Escape 或清空输入）恢复原始展开状态
  - 搜索结果高亮匹配文字
- **验证**: 输入关键词后文件树过滤，退出后恢复

---

## Phase 3: Tab 增强（R9-R13）

### Task 11: Tab Pin 固定（R10）
- **文件**: `EditorTabs.tsx` + `use-ide-tabs.ts`
- **实现**:
  - `pinnedTabs: Set<string>` state，存入 localStorage（per bookId）
  - Tab 右键菜单增加"固定"/"取消固定"
  - 固定 Tab 视觉区分：左侧 primary 色条
  - `closeOthers`/`closeSaved`/`closeAll` 过滤固定 Tab
  - 固定 Tab 排在非固定 Tab 前面（排序逻辑）
- **验证**: 固定 Tab 后"关闭其他"不关闭它

### Task 12: Tab 操作扩展（R11）
- **文件**: `EditorTabs.tsx` + `IdeWorkbench.tsx`
- **实现**:
  - 右键菜单增加"拆分到右侧"（调用已有的 `onSplitRight`）
  - 右键菜单增加"在新窗口打开"（占位，弹 toast "功能开发中"）
  - 双击文件树文件 = 在当前 Tab 打开（如果已有预览 Tab 则替换）
- **验证**: 右键"拆分到右侧"打开分屏

### Task 13: 自动定位（R9）
- **文件**: `IdeWorkbench.tsx`
- **实现**:
  - `activeTabId` 变化时，找到对应的文件树节点 ID
  - 调用 `scrollIntoView({ behavior: "smooth", block: "nearest" })`
  - 设置 `selectedNodeId` 高亮
  - 可配置关闭（后续版本加设置项）
- **验证**: 切换 Tab 后文件树自动滚动到对应文件

### Task 14: 面包屑增强（R12）
- **文件**: `EditorBreadcrumbs`（IdeWorkbench.tsx 内）
- **实现**:
  - 文件夹段可点击：弹出该目录下的文件列表下拉
  - 点击文件列表项 = 打开对应文件 Tab
  - 使用 Popover 或 DropdownMenu 组件
- **验证**: 点击面包屑中的文件夹段弹出文件列表

### Task 15: 编辑器操作栏（R13）
- **文件**: `EditorTabs.tsx` 或 `IdeWorkbench.tsx`
- **实现**:
  - Tab 栏右侧增加操作按钮区域
  - 默认按钮：更多操作 DropdownMenu（全部关闭/关闭已保存/全部折叠/全部展开）
  - 后续可扩展
- **验证**: 点击更多操作按钮弹出菜单

---

## Phase 4: 叙事记忆入口（R16）

### Task 16: Narrative Memory 侧边栏面板
- **文件**: 新建 `packages/novel-plugin/src/pages/writing-workbench/NarrativeMemoryPanel.tsx` + 修改 `ide/use-panel-manager.ts`、`ide/IdeWorkbench.tsx`
- **实现**:
  - 左侧 ActivityBar 增加“叙事记忆”入口，并注册为 `narrative-memory` sidebar view
  - 面板请求 `/api/books/:bookId/narrative-memory/diagnostics/latest` 与 `/api/books/:bookId/narrative-memory/events/pending`
  - 展示最近召回摘要：purpose、chapterNumber、totalMs、totalEstimatedTokens、warnings
  - 展示 channel 表：channel、status、latencyMs、candidateCount、returnedCount、estimatedTokens
  - 展示预算摘要：injectedTokensByChannel、droppedCount、degradedCount
  - 展示 wave 摘要：logicDepth、entropy、activatedTags、fallback/rerank 信息（无 wave 时隐藏）
  - 展示 pending events：eventType、entity、confidence、risk、evidence、chapterNumber
  - diagnostics 404 时显示“还没有叙事记忆记录，请先运行一次写作”的空状态，不显示报错堆栈
  - 第一版只读展示，不实现 approve/reject
- **验证**: Browser 打开写作工作台，点击左侧“叙事记忆”入口；分别验证有 log 和无 log 的显示状态并截图

---

## Phase 5: 验证

### Task 17: 全量 typecheck + 功能验证
- `bun run typecheck` 零错误
- 验证清单：
  - [ ] 章节文件 kind="chapter" + isChapter=true
  - [ ] 非章节文件 kind="file"，无章节专属 UI
  - [ ] 右键菜单根据文件类型显示不同选项
  - [ ] 文件拖拽移动成功
  - [ ] Ctrl+C/X/V 剪贴板操作
  - [ ] 图片文件预览
  - [ ] Tab 固定 + 批量关闭保护
  - [ ] 树内搜索过滤 + 恢复
  - [ ] 自动定位
  - [ ] 叙事记忆入口可见，能展示 diagnostics 或明确空状态
- **验证**: Browser 截图
