# Studio IDE Layout v1 Design

## Architecture Overview

### 布局结构

```
┌──────────────┬──────────────────────────────┬─────────────────────┐
│  左侧 Sidebar │       中间内容区              │   右侧对话框         │
│  ~220px      │       flex-1                 │   ~400px            │
│  (可折叠)     │   (可拖拽调宽/关闭)           │  (可拖拽调宽/关闭)   │
│              │                              │                     │
│  ┌─────────┐ │   多 tab 编辑器               │  ┌───────────────┐ │
│  │叙事线 ▼ │ │   章节/候选稿/经纬/大纲        │  │ 会话头         │ │
│  │ 📖 书A  │ │                              │  │ 名称|详情|归档  │ │
│  │ 📖 书B  │ │                              │  ├───────────────┤ │
│  └─────────┘ │                              │  │               │ │
│  ┌─────────┐ │                              │  │ 对话流         │ │
│  │叙述者 ▼ │ │                              │  │ 或 Git 变更    │ │
│  │ 🟢 会话1│ │                              │  │               │ │
│  │ 🟢 会话2│ │                              │  │               │ │
│  └─────────┘ │                              │  ├───────────────┤ │
│              │                              │  │ git 状态栏     │ │
│  ─────────── │                              │  │ branch +n -n  │ │
│  套路        │                              │  ├───────────────┤ │
│  设置        │                              │  │ 输入区         │ │
│              │                              │  │ ⬤34.7% 模型   │ │
│              │                              │  │ 权限 推理      │ │
│              │                              │  │ [输入框][发送]  │ │
│              │                              │  └───────────────┘ │
└──────────────┴──────────────────────────────┴─────────────────────┘
```

### 组件层级

```
StudioApp
├── SplitView (水平三区，可拖拽分隔条)
│   ├── Sidebar (左)
│   │   ├── SidebarSection: 叙事线
│   │   │   └── StorylineTree (书籍/章节/资源树)
│   │   ├── SidebarSection: 叙述者
│   │   │   └── NarratorList (活跃/历史会话列表)
│   │   └── SidebarFooter: 套路 / 设置
│   ├── EditorArea (中)
│   │   ├── TabBar (多 tab 标题栏)
│   │   └── TabContent (当前 tab 内容)
│   │       ├── ChapterEditor (章节富文本)
│   │       ├── CandidatePreview (候选稿)
│   │       ├── BibleDetail (经纬资料)
│   │       ├── OutlineEditor (大纲)
│   │       ├── CockpitView (驾驶舱快照)
│   │       └── EmptyState (无 tab 时)
│   └── ConversationPanel (右)
│       ├── ConversationHeader (会话名/详情/归档)
│       │   ├── BackButton (返回)
│       │   ├── TitleEditable (会话标题，可编辑)
│       │   ├── GenerateTitleButton (摘要模型自动命名)
│       │   └── HeaderActions (图标按钮组)
│       │       ├── CodeRenderToggle (代码渲染开关)
│       │       ├── AgentSettingsButton (AI 代理快捷设置)
│       │       ├── ImageButton (图片/截图)
│       │       ├── FileRefButton (文件引用)
│       │       ├── SessionInfoButton (会话详情)
│       │       └── ArchiveButton (归档)
│       ├── ConversationBody (flex-1, 可切换视图)
│       │   ├── ChatFlow (对话流 — 默认视图)
│       │   │   ├── MessageBubble (用户/AI 消息)
│       │   │   ├── ToolCallCard (工具调用内联卡片)
│       │   │   ├── ConfirmationGate (确认门内联)
│       │   │   ├── ToolResultCard (工具结果卡片)
│       │   │   ├── ThinkingBlock (推理/思考块，可折叠，可翻译)
│       │   │   └── ScrollToBottomButton (滚动到底部)
│       │   └── GitChangesView (git 变更 — 切换视图)
│       │       ├── GitTabs: 变更 / 提交 / 暂存
│       │       ├── FileChangeList (全部暂存/丢弃全部)
│       │       └── DataSnapshot (创建/恢复快照)
│       ├── GitStatusBar (分支名 + 改动统计)
│       ├── StatusBar (思考状态 + 费用 + 浏览器标签)
│       └── InputArea (底部固定)
│           ├── AttachButton (📎 附件/图片/文件)
│           ├── ContextMonitor (上下文圆圈/百分比)
│           ├── ModelSelector (按供应商显示配置)
│           ├── PermissionMode
│           ├── ReasoningEffort
│           ├── PromptInput (支持 Enter/Ctrl+Enter 发送方式切换)
│           ├── SendButton / InterruptButton (发送 or 红色中断)
│           └── CostDisplay (累计费用 $xxx.xx)
└── FullPageOverlay (叙事线/叙述者全屏历史页)
```

---

## 关键设计决策

### 1. SplitView 实现

参考 VS Code 的 `splitview` 模式：
- 使用 CSS `display: flex` + 拖拽 `resize handle`
- 每个面板有 `minWidth`（Sidebar: 180px, Editor: 200px, Conversation: 320px）
- 拖拽时实时更新 `flex-basis`
- 双击 handle 恢复默认宽度
- 面板关闭时设置 `flex-basis: 0` + `overflow: hidden` + `display: none`
- 状态持久化到 `preferences.panelLayout`

### 2. 右侧对话框内部结构

对话框是一个多功能区域，不只是聊天：

```
ConversationPanel
├── ConversationHeader (固定顶部)
│   ├── 会话名称 (可编辑)
│   ├── [详情] 按钮
│   └── [归档] 按钮
├── ConversationBody (flex-1, overflow-y: auto)
│   ├── [对话] [Git] 视图切换 tab
│   ├── 对话视图: ChatFlow
│   │   └── 消息列表 (虚拟滚动)
│   └── Git 视图: GitChangesView
│       ├── [变更] [提交] [暂存] tab
│       └── 文件变更列表
├── GitStatusBar (固定)
│   └── 🏠 novelfork · master · +5140 -2029
└── InputArea (固定底部)
    ├── 上下文监控 (⬤ 34.7%)
    │   └── 点击展开: token 用量、裁剪/压缩/清空
    ├── 模型选择器 (按供应商显示配置)
    ├── 权限模式选择器
    ├── 推理强度选择器
    └── [输入框] [发送]
```

### 3. 叙事线与叙述者的关系

```
叙事线 (Storyline)          叙述者 (Narrator)
├── 书A ──────────────────→ 书A写作会话 (用户命名)
│   ├── 第1章               书A审校会话 (用户命名)
│   ├── 第2章
│   └── 经纬
├── 书B ──────────────────→ 书B会话
└── ...                     独立会话1 (摘要模型命名)
                            独立会话2 (摘要模型命名)
```

- 叙事线 = 书籍资源树，绑定 git 仓库
- 叙述者 = 会话列表，可绑定叙事线也可独立
- 从叙事线选择写书方式 → 自动创建绑定的叙述者
- 直接新建叙述者 → 独立会话，可选绑定目录

### 4. 上下文监控设计

输入区左侧的上下文指示器：

```
默认态:  ⬤ 34.7%  (小圆圈 + 百分比)

点击展开:
┌─────────────────────────────┐
│ 裁剪 95% · 压缩 99%         │
│ 上下文: 34.7%               │
│ 809,016 / 1,000,000 tokens  │
│ (估算)                      │
│                             │
│ ☐ 自动裁剪                  │
│ [立即压缩]  [清空上下文]     │
└─────────────────────────────┘
```

### 5. 模型选择器按供应商适配

不同供应商/模型有不同的配置项：

| 供应商 | 额外配置 |
|--------|---------|
| DeepSeek | 推理模式 (chat/reasoner) |
| OpenAI/Codex | fast 模式、推理强度 |
| Anthropic | 推理强度 (low/medium/high) |
| 通用 | 仅模型选择 + 权限 |

### 6. 从现有组件迁移

| 现有组件 | 迁移目标 |
|---------|---------|
| `NextShell` | → `StudioApp` + `SplitView` |
| `WorkspaceLeftRail` + `ResourceTree` | → `Sidebar` > `StorylineTree` |
| `SessionCenter` | → `Sidebar` > `NarratorList` + 全屏历史页 |
| `WorkspaceCanvas` (tab 系统) | → `EditorArea` |
| `ChatWindow` / `NarratorPanel` | → `ConversationPanel` > `ChatFlow` |
| `RoutinesNextPage` | → 套路页面 (保持) |
| `SettingsPage` | → 设置页面 (保持) |
| `DashboardPage` | → 移除或收入叙事线全屏页 |
| `WorkflowPage` | → 移除或收入设置 |

---

## 技术选型

### SplitView
- 自研轻量实现（参考 VS Code 的 `splitview` 但用 React + CSS flex）
- 不引入重型库（如 react-resizable-panels），保持依赖最小

### 虚拟滚动
- 对话流消息列表使用虚拟滚动（参考 Claude Code 的 `VirtualMessageList`）
- 现有 `ChatWindow` 的滚动逻辑可复用

### Git 操作
- 复用现有 `git-utils.ts`（`listWorktrees`、`getGitStatus` 等）
- 新增 `git-panel-service.ts` 封装变更/暂存/提交操作

---

## 上下文管理设计

参考 Claude Code CLI 源码（`D:\DESKTOP\novelfork\claude\restored-cli-src\src\services\compact\`）。

### Token 计数

```
主要方式: API 返回的 usage（input_tokens + output_tokens + cache）
粗估 fallback: content.length / 4（不用 tiktoken）
上下文窗口: 从 provider adapter 的 capabilities.contextWindow 读取
```

新增 `api/lib/token-counter.ts`：
- `tokenCountFromUsage(messages)` — 从最后一条有 usage 的消息提取精确计数
- `roughTokenEstimation(content)` — `Math.ceil(content.length / 4)` 粗估
- `tokenCountWithEstimation(messages)` — 精确 + 粗估混合（Claude Code 同名函数）

### 压缩策略（3 层，从轻到重）

```
每次 API 调用前:
  [1] MicroCompact — 旧工具结果替换为摘要占位符
  [2] 阈值检查 — tokenCount >= contextWindow * compressionThreshold%
  [3] Full Compact — 摘要模型生成对话摘要，替换旧消息
```

#### MicroCompact（新增 `api/lib/compact/micro-compact.ts`）

参考 Claude Code 的 `microCompact.ts`：
- 遍历消息，找到旧的工具结果（tool_result 类型）
- 将内容替换为 `[旧工具结果已折叠: {toolName} — {summary}]`
- 保留最近 N 条工具结果不折叠（N 由最近一次 API usage 的位置决定）
- 可折叠的工具：cockpit.get_snapshot、pgi.generate_questions、questionnaire.*、narrative.*

#### Full Compact（新增 `api/lib/compact/full-compact.ts`）

参考 Claude Code 的 `compact.ts` + `prompt.ts`：
- 调用摘要模型（`modelDefaults.summaryModel`）生成对话摘要
- 摘要模板（小说创作版）：
  1. 用户的主要写作请求和意图
  2. 当前章节进度和书籍状态
  3. 经纬/设定变更记录
  4. 工具调用历史摘要
  5. 待办任务和下一步
  6. 当前活跃的 guided generation 状态
- 压缩后恢复：最近读取的章节内容、当前 plan、活跃 guided state
- 最大输出 20,000 tokens
- 连续失败 3 次熔断

#### 触发时机

在 `agent-turn-runtime.ts` 的 `runAgentTurn` 循环中，每次调用 `generate()` 前：
1. 执行 MicroCompact
2. 计算 tokenCount
3. 如果 tokenCount >= threshold → 触发 Full Compact
4. 用压缩后的 messages 继续

### 消息上限改为 token 驱动

移除 `MAX_SESSION_MESSAGES = 50` 硬上限。改为：
- 内存中保留所有消息（不再 slice）
- 传给模型前由 MicroCompact + Full Compact 控制大小
- 持久化层不受影响（已有 session history store）

---

## Agent 工具循环增强设计

### 最大轮次可配置

- `RuntimeControlSettings` 新增 `maxTurnSteps: number`（默认 200）
- `session-chat-service.ts` 从 `userConfig.runtimeControls.maxTurnSteps` 读取，替代硬编码 6
- AI 代理设置面板新增"每条消息最大轮次"数字输入框

### 工具失败后模型继续

当前：`shouldContinueAfterToolResult` 在工具失败时返回 false → 停止。
改为：工具失败时将失败结果回灌给模型，让模型决定下一步。只在以下情况停止：
- pending-confirmation（确认门）
- 连续 3 次相同工具失败（防止死循环）

### 智能输出中断检测

新增 `api/lib/output-continuation.ts`：
- 空回复 → 立即重试（最多 2 次）
- 非空回复 → 调用摘要模型判断是否被截断
- 被截断 → 自动发送 "请继续" 消息

### 宽松规划模式

`plan` 权限模式当前和 `read` 完全相同（所有写入 deny）。
新增 `relaxedPlanning` 开关：开启后 plan 模式允许工具调用，但 confirmed-write/destructive 仍需确认。

### YOLO 跳过只读确认

新增 `yoloSkipReadonlyConfirmation` 开关：
- 开启后 `allow` 模式下 read 风险工具不暂停
- Edit/Write 视为可恢复，不暂停
- 只有 Write 覆盖、删除、destructive 仍暂停

---

## AI 代理设置面板重构

### 当前问题
- MCP 策略和 allowlist/blocklist 在设置页和套路页重复
- 行为开关（translateThinking 等）不在核心类型中
- 模型 section 是只读展示，实际编辑在 AI 代理面板

### 重构方案

**设置 > AI 代理**（全局默认行为）：
- 默认权限模式
- 每条消息最大轮次（默认 200）
- 裁剪起始 %（默认 80）
- 压缩起始 %（默认 95）
- 可恢复错误最大重试次数
- 重试退避时间上限
- 开关：翻译思考内容、Dump API 请求、默认展开推理、宽松规划、YOLO 跳过只读确认、智能输出中断检测、滚动自动加载、要求用户语言、显示 Token 用量、显示输出速率
- 自定义可重试错误规则（按内容关键词 + HTTP 状态码匹配）
- WebFetch 代理模式
- 上下文窗口阈值分两档：标准（≤600k）和大窗口（>600k），各自独立的裁剪%和压缩%
- 全局白名单/黑名单目录
- 全局命令白名单/黑名单（支持通配符，黑名单支持拒绝提示词）

**设置 > 模型**（改为可编辑）：
- 默认会话模型
- 摘要模型
- Explore 子代理模型
- Plan 子代理模型
- General 子代理模型
- 子代理可用模型池
- 默认推理强度
- Codex 专属推理强度

**套路页**（逐工具/逐资产）：
- 工具权限（逐工具 allow/deny/ask）
- MCP 工具 + 服务器管理
- 命令、技能、子代理、提示词、钩子

**从设置页 AI 代理面板移除**：
- MCP 策略（inherit/allow/ask/deny）→ 移到套路页
- allowlist/blocklist → 移到套路页工具权限

---

## NarraFork 对话框功能对照

从 NarraFork 实际页面提取的对话框功能，NovelFork 需要对齐：

### 对话框顶部栏

| NarraFork 功能 | NovelFork 对应 |
|---|---|
| ← 返回按钮 | 需要实现 |
| 会话标题（可编辑） | 需要实现 |
| ✏️ 编辑标题 | 需要实现 |
| ⚡ 生成标题（摘要模型） | Task 24 |
| 代码渲染开关 (code-off) | 需要实现 |
| AI 代理快捷设置 (robot) | 需要实现 |
| 图片/截图 (photo) | 需要实现 |
| 文件引用 (file-code) | 需要实现 |
| 会话详情 (info-circle) | Task 10 |
| 归档 (archive) | Task 10 |

### 对话框底部区域（从上到下）

| NarraFork 功能 | NovelFork 对应 |
|---|---|
| Git 状态栏（分支 + 改动统计） | Task 9 |
| 容器状态（启动/配置） | 不做（NovelFork 无容器概念） |
| 数据快照（创建/恢复） | 需要实现（git commit 快照） |
| Git 面板（变更/提交/暂存 + 文件列表） | Task 9 |
| 浏览器标签 | 不做（NovelFork 无内嵌浏览器） |
| 思考状态指示（思考中 + 耗时） | 需要实现 |
| 费用显示（$xxx.xx） | Task 20 |
| 模型选择器 | Task 8 |
| 权限模式 | Task 8 |
| 底部图标按钮组（source-code/git-fork/package/settings） | 需要实现 |
| 📎 附件按钮 | 需要实现 |
| 输入框（Enter/Ctrl+Enter 切换） | 需要实现 |
| 中断按钮（红色，AI 工作中显示） | 需要实现 |

### 设置 > 通知

| NarraFork 功能 | NovelFork 对应 |
|---|---|
| 叙述者完成时通知 | 需要实现 |
| 叙述者等待权限时通知 | 需要实现 |
| 浏览器推送通知 | 需要实现 |
| 音效通知（内置/自选） | 需要实现 |
| 钉钉通知 | 不做（NovelFork 单机） |
| 飞书通知 | 不做（NovelFork 单机） |

### 设置 > 外观与界面（NarraFork 有但 NovelFork 缺的）

| NarraFork 功能 | NovelFork 对应 |
|---|---|
| OLED 纯黑主题 | 需要实现 |
| 全屏模式 | 需要实现 |
| 屏幕常亮 | 不做（桌面端不需要） |
| 消息渲染器选择（React/PixiJS） | 不做 |
| 子代理加入最近标签 | 需要实现 |
| 终端主题/字号 | 不做（NovelFork 无终端） |
| 发送方式（Enter/Ctrl+Enter） | 需要实现 |

---

## 需要实现但之前遗漏的功能

### 终端管理
NarraFork 的终端管理是 **agent Terminal 工具创建的终端进程的管理界面**——查看运行中/已退出的终端列表、进程状态、工作目录、创建时间。NovelFork 也有 Terminal 工具，需要对应的管理界面。放在设置页的实例管理中。

### 代理管理（网络代理）
给每个 AI 供应商配置 HTTP 代理——Kiro 代理、Codex 代理、Anthropic 代理、WebFetch 代理。中国用户访问海外 API 必须的。NovelFork 的平台集成（Codex/Kiro）通过反代登录，需要对应代理配置。放在设置页的实例管理中。

### 模型聚合
把**不同供应商的同一模型聚合为一个条目**——比如 deepseek-v4-flash 在 deepseek 官方和 sub2api 都有，聚合后选择时可切换供应商或自动路由。这不是虚拟模型（不创造新模型），是真实模型的多供应商路由。放在设置 > 模型中。

### 章节与工作区管理
NarraFork 用容器隔离工作区，NovelFork 用 git worktree。需要对应的管理界面：最大活跃工作区数、工作区大小警告、休眠自动保存、不活跃自动休眠。放在设置页的实例管理中。

### Git Worktree 完整工作流
NarraFork 的叙事线详情页中，章节 = git worktree 中的对话，支持批量合并、清理。这是核心工作流，不能只铺基础。需要：
- 叙事线详情页显示所有章节（worktree）
- 每个章节可以打开对应的叙述者对话
- 批量合并（merge worktree 回主分支）
- 清理（删除已合并的 worktree）

---

## 不做的事

- 不实现 editor group 拆分（VS Code 的多编辑器组）
- 不实现文件拖拽排序
- 不实现 NarraFork 的 IM 网关（钉钉/飞书通知）——单机工作台用浏览器通知
- 不实现 NarraFork 的用户管理——单机单用户
- 不实现 NarraFork 的容器（Podman）——用 git worktree 替代
- 不实现屏幕常亮——桌面端不需要
- 不实现消息渲染器选择（React/PixiJS）——第一版用 React
