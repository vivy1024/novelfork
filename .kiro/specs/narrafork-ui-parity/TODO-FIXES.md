# 待修复清单（2026-05-08 对比 NarraFork 后）

## 执行顺序（下一轮）

### Step 0：安装依赖（必须先做）

```bash
# shadcn 组件
npx shadcn@latest add dropdown-menu context-menu popover command tooltip sheet avatar

# 核心功能依赖
pnpm --dir packages/studio add broad-infinite-list flowtoken shiki @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities diff
```

### Step 1：shadcn 组件替换（45 个文件）

按模块逐个替换，每替换一个 build + 截图：

1. **Composer** → Button（发送/中断/继续）
2. **NarratorStatusBar** → DropdownMenu（模型/推理/权限菜单）+ Tooltip（按钮提示）
3. **ConversationSurface 顶部工具栏** → Button variant="ghost" size="icon" + Tooltip
4. **MessageItem 右键菜单** → ContextMenu
5. **ConfirmationGate** → Button + Card
6. **搜索输入框** → Input
7. **设置页手写 select** → Select（shadcn 已有）
8. **套路页手写 button** → Button
9. **会话中心** → Button + Card + Badge
10. **章节图操作栏** → Button

### Step 2：消息列表虚拟滚动

- MessageStream 替换为 `broad-infinite-list`
- 支持向上加载更早消息
- 新消息自动滚动到底部

### Step 3：流式打字机动画

- AI 回复使用 `flowtoken` 渲染流式文本
- 逐字/逐词出现效果

### Step 4：代码高亮升级

- `react-syntax-highlighter`（Prism）→ `shiki`
- MarkdownRenderer 的 CodeBlock 组件替换

### Step 5：工具栏按钮接通真实 handler

- 编辑标题 → prompt 输入 + PUT /api/narrators/:id/title
- 生成标题 → POST /api/narrators/:id/generate-title
- 文件修改 → Sheet 面板 + GET /api/narrators/:id/file-modifications
- 归档 → POST /api/narrators/:id/archive
- 外部链接 → window.open 新标签

### Step 6：拖拽排序

- 套路页钩子列表 → @dnd-kit sortable
- 章节图节点位置 → react-flow 已支持

### Step 7：路由规范化（可选，大改动）

- 手写 pushState → TanStack Router
- 路由懒加载 → React.lazy + Suspense

---

## 已修复
- [x] 设置页：模型页从调试 FactRow 改为真实 RuntimeControlPanel 表单
- [x] 套路页：隐藏 planned 命令，去掉调试信息（来源/状态）
- [x] Composer：移除 select 下拉，改为极简模式
- [x] NarratorStatusBar：添加模型/推理/权限/FastMode 按钮
- [x] MarkdownRenderer：安装 @tailwindcss/typography，prose 类生效
- [x] 旧底部状态栏：已移除
- [x] 端口占用闪退：自动递增重试
- [x] 用户消息气泡：深色 → 浅色边框
- [x] NarratorStatusBar 按钮：加大尺寸
- [x] 顶部工具栏：添加完整图标组
- [x] NarratorStatusBar：手写 PopoverButton → shadcn DropdownMenu + Tooltip（下拉菜单正常弹出）
- [x] 顶部工具栏：手写 button → shadcn Button ghost + Tooltip（hover 提示正常）
- [x] Composer：手写 button → shadcn Button + aria-label 无障碍
- [x] 消息列表：全量渲染 → broad-infinite-list 虚拟滚动
- [x] AI 回复：新增 flowtoken AnimatedMarkdown 流式打字机动画（isStreaming 时启用）
- [x] 代码高亮：react-syntax-highlighter (Prism) → shiki (github-dark)
- [x] 工具栏按钮接通 handler：编辑标题/生成标题/归档/外部链接
- [x] 消息右键菜单：手写 backdrop+fixed → shadcn ContextMenu（回退/分叉/压缩/编辑/删除）
- [x] 设置页行为 section 补全：yoloSkipReadonlyConfirmation/showTokenUsage/showOutputRate/scrollAutoLoadHistory/sendMode
- [x] 套路页钩子列表：@dnd-kit sortable 拖拽排序 + GripVertical 手柄

## 仍存在的问题

### 对话界面
- ~~顶部工具栏按钮无 handler~~ → 已接通（编辑标题/生成标题/归档/外部链接）
- 文件修改按钮需要 Sheet 面板 + GET /api/narrators/:id/file-modifications
- 会话信息按钮需要详情面板
- ~~消息右键菜单未验证是否真的弹出~~ → 已用 shadcn ContextMenu 替换
- 工具调用卡片未验证 ToolCallBlock 是否真的渲染
- 推理折叠未验证（无真实 thinking 数据）
- ~~消息列表无虚拟滚动~~ → 已用 broad-infinite-list 替换
- ~~AI 回复无流式打字机动画~~ → 已集成 flowtoken

### 设置页
- ~~RuntimeControlPanel 缺少字段~~ → 已补全 yoloSkipReadonlyConfirmation/showTokenUsage/showOutputRate/scrollAutoLoadHistory/sendMode
- 模型下拉显示原始 ID 而非友好名称（后端数据问题，前端已正确使用 modelLabel）

### 套路页
- ~~钩子列表无拖拽排序~~ → 已用 @dnd-kit sortable 实现
- 可选工具 tab 内容需验证
- MCP 工具 tab 连接状态需验证
- 技能/子代理/提示词/钩子 tab 需验证是否有 mock

### 章节图
- ChapterNode 内容区是占位文字
- 对话未嵌入节点

### 全局
- 45/47 个 app-next 文件不用 shadcn 组件
- 零虚拟滚动
- 零懒加载
- sidebar 不可折叠


## 对话界面差距（对比 NarraFork）

### 必须修
1. ~~用户消息气泡样式太丑~~ → 已改为浅色边框
2. ~~NarratorStatusBar 按钮太小看不清~~ → 已加大
3. ~~顶部工具栏缺图标~~ → 已添加（但 handler 未接通，见下）
4. ~~标题栏太简陋~~ → 已添加编辑/生成标题图标（handler 未接通）
5. 消息右键菜单 — 代码写了但没验证是否真的弹出并工作
6. 工具调用卡片 — 需要验证 ToolCallBlock 是否真的渲染
7. 推理折叠 — ThinkingBlock 代码写了但没有真实数据验证
8. 底部 Git 状态栏 — NarraFork 显示 章节名·分支·变更数，NovelFork 没有

### 紧急：工具栏按钮无 handler（又犯了同样的错误）
- 编辑标题按钮 → 需要接 updateNarratorTitle API
- 生成标题按钮 → 需要接 generateNarratorTitle API
- 文件修改按钮 → 需要接 getFileModifications API
- 信息按钮 → 需要显示会话详情面板
- 归档按钮 → 需要接 archiveNarrator API
- 外部链接按钮 → 需要在新标签打开

### 应该修
9. 对话嵌入 react-flow 节点 — ChapterNode 内容区是占位
10. 搜索结果点击无导航
11. 附件按钮 onAttach 未接通上层

## 设置页差距

### 必须修
12. RuntimeControlPanel 虽然有表单控件，但缺少 NarraFork 的一些字段：
    - 旧编码支持 switch
    - 刷新 Shell 环境 switch
    - 新叙述者默认进入计划模式 switch
    - 沉默工具调用阈值 number input
    - 跳过只读危险反思确认 switch
13. 模型页的下拉选择器显示原始 ID（deepseek-1778245457279:deepseek-chat）而不是友好名称

## 套路页差距

### 必须修
14. 可选工具 tab — NarraFork 显示高层 Agent 能力（Terminal/Browser/Recall 等），NovelFork 显示什么？需要验证
15. MCP 工具 tab — 有 UI 壳但连接状态是否真实？
16. 其他 tab（技能/子代理/提示词/钩子）— 需要逐个验证是否有 mock

## 首页差距

17. NarraFork 首页有统计卡片（活跃项目数/总项目数/独立会话数）— NovelFork 有类似的但需要验证数据是否真实

## 执行原则

- 每修一个，build + 截图验证
- 发现新问题当场修，不开新 spec
- 不写占位/mock/planned

## ⚠️ shadcn 组件库未使用（根本问题）

**全局筛查结果：app-next/ 下 45 个 tsx 文件不用 shadcn，只有 2 个用了。**

对话界面、设置页、套路页、章节图、搜索页、会话中心——全部手写 className，没有用 shadcn 组件。

需要安装并替换：
1. `dropdown-menu` — NarratorStatusBar 的模型/推理/权限弹出菜单
2. `context-menu` — 消息右键菜单
3. `popover` — 工具栏弹出面板
4. `command` — 模型搜索过滤（Command + CommandInput + CommandList）
5. `tooltip` — 所有图标按钮的 hover 提示
6. `sheet` — 文件修改面板（侧边抽屉）
7. `avatar` — 用户/AI 头像

替换清单：
- Composer 按钮 → `<Button>` variant/size
- 顶部工具栏按钮 → `<Button variant="ghost" size="icon">`
- NarratorStatusBar PopoverButton → `<DropdownMenu>`
- MessageContextMenu → `<ContextMenu>`
- 搜索输入框 → `<Input>`
- 确认门按钮 → `<Button>`
- 设置页所有手写 select → shadcn `<Select>`
- 套路页所有手写 button → `<Button>`

## ⚠️ 布局/自适应/性能问题

**全局筛查结果：**

| 问题 | 现状 | 应该 |
|------|------|------|
| 虚拟滚动 | ❌ 零使用（无 react-virtual/react-window/virtuoso） | 消息列表、资源树、模型列表需要虚拟滚动 |
| 懒加载 | ❌ 零使用（无 React.lazy/Suspense/dynamic import） | 设置页/套路页/章节图应该懒加载 |
| 自适应布局 | ⚠️ 有 112 处 Tailwind 响应式类，但 sidebar 是固定 250px | sidebar 应该可折叠，移动端隐藏 |
| ResizeObserver | ❌ 只有 textarea 自动高度 | 章节图节点、面板分割需要 |
| 消息列表滚动 | 简单 overflow-y-auto + scrollIntoView | 大量消息时性能差，需要虚拟滚动 |
| 模型列表 | 全量渲染所有模型 | 模型多时（100+）需要虚拟滚动 |
| 图片/附件 | 无懒加载 | 需要 IntersectionObserver 懒加载 |

优先级：
1. **消息列表虚拟滚动** — 安装 `broad-infinite-list`（NarraFork 用的同一个库）
2. **路由懒加载** — React.lazy + Suspense
3. **sidebar 可折叠** — 移动端/小屏适配
4. **模型列表虚拟滚动** — 模型多时下拉卡顿

## ⚠️ 关键依赖缺失（对比 NarraFork 依赖分析）

NarraFork 架构：Mantine + TanStack Router + TanStack Query + ReactFlow + xterm + broad-infinite-list + shiki + flowtoken + dnd-kit + i18next

| 缺失依赖 | 用途 | 优先级 |
|----------|------|--------|
| `broad-infinite-list` | 消息列表虚拟无限滚动 | 🔴 高 |
| `flowtoken` | AI 回复流式打字机动画 | 🔴 高 |
| `shiki` + `web-tree-sitter` | 高质量代码高亮（替代 react-syntax-highlighter） | 🟡 中 |
| `@dnd-kit/core` + `sortable` | 拖拽排序（套路/钩子/章节） | 🟡 中 |
| `diff` | 文件 diff 展示 | 🟡 中 |
| `@xterm/xterm` + `bun-pty` | 内嵌终端 | 🟡 中（后续） |
| `i18next` | 国际化 | ⚪ 低（当前只需中文） |
| `@tanstack/react-router` | 规范路由（替代手写 pushState） | 🟡 中 |
| IM 网关（Slack/Discord/Telegram/飞书） | IM 集成 | ⚪ 低 |

NovelFork 当前用 react-syntax-highlighter（Prism），NarraFork 用 shiki + tree-sitter（更准确、更快）。
NovelFork 当前手写路由（pushState），NarraFork 用 TanStack Router（类型安全、懒加载）。
NovelFork 当前消息列表全量渲染，NarraFork 用 broad-infinite-list（虚拟滚动 + 无限加载）。
