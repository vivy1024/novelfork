# NovelFork UI v1 Requirements

## Introduction

重做 NovelFork Studio 的前端布局，对标 NarraFork 的交互范式。两种页面：主界面（sidebar + 全宽对话框）和叙事线详情页（写作工作台）。对话框对标 Claude Code CLI / Codex CLI 的对话流。

之前的 `studio-ide-layout-v1` 和 `studio-frontend-integration-v1` 失败了——强行做三栏 IDE 布局导致每栏太窄、嵌套布局崩溃、叙述者面板文字竖排。本 spec 回归 NarraFork 验证过的布局：对话为主，编辑为辅。

**后端功能全部就绪**（1118 个测试通过），本 spec 只做前端。

---

## Requirement 1：主界面 — Sidebar + 全宽对话框

**User Story：** 作为作者，我打开 NovelFork 后看到的是 NarraFork 风格的界面——左侧窄 sidebar 导航，右侧全宽对话框。

### Acceptance Criteria

1. WHEN 用户打开主界面 THEN THE SYSTEM SHALL 显示左侧 sidebar（~220px）和右侧全宽内容区。
2. WHEN sidebar 显示 THEN THE SYSTEM SHALL 包含：叙事线（书籍列表，可展开）、叙述者（活跃会话列表）、套路、设置，底部显示版本号。
3. WHEN 用户点击叙述者中的会话 THEN THE SYSTEM SHALL 右侧显示该会话的对话界面（全宽）。
4. WHEN 用户点击套路 THEN THE SYSTEM SHALL 右侧显示套路页面。
5. WHEN 用户点击设置 THEN THE SYSTEM SHALL 右侧显示设置页面。
6. WHEN 没有活跃会话 THEN THE SYSTEM SHALL 右侧显示仪表盘或空状态引导。

---

## Requirement 2：对话框 — 对标 Claude Code CLI

**User Story：** 作为开发者，我希望对话框像 Claude Code CLI 一样——单栏对话流、工具调用内联、权限确认 overlay、底部输入框，占据右侧全部空间。

### Acceptance Criteria

1. WHEN 对话框显示 THEN THE SYSTEM SHALL 上方是对话流（消息+工具调用卡片内联），下方是输入区（固定底部）。
2. WHEN AI 回复 THEN THE SYSTEM SHALL 流式渲染，显示打字光标。
3. WHEN 工具调用完成 THEN THE SYSTEM SHALL 内联显示工具结果卡片，支持折叠/展开。
4. WHEN 工具需要确认 THEN THE SYSTEM SHALL 在对话流中内联显示确认门（不是弹窗）。
5. WHEN 输入区显示 THEN THE SYSTEM SHALL 包含：上下文监控（token 百分比）、模型选择器、权限模式、推理强度、输入框、发送/中断按钮。
6. WHEN AI 正在生成 THEN THE SYSTEM SHALL 显示中断按钮（红色），禁用输入框。
7. WHEN 对话框底部 THEN THE SYSTEM SHALL 显示 git 状态栏（分支+改动统计）。

---

## Requirement 3：叙事线详情页 — 写作工作台

**User Story：** 作为作者，我点击叙事线中的书进入一个独立的写作工作台页面，有资源管理器、编辑器、写作工具。

### Acceptance Criteria

1. WHEN 用户点击叙事线中的书 THEN THE SYSTEM SHALL 进入该书的叙事线详情页（独立页面，不是主对话框的子视图）。
2. WHEN 叙事线详情页显示 THEN THE SYSTEM SHALL 包含：资源管理器（章节/候选稿/草稿/经纬/大纲/故事文件/真相文件树）、编辑器区域、写作工具。
3. WHEN 用户点击资源树中的章节 THEN THE SYSTEM SHALL 在编辑器区域打开该章节正文。
4. WHEN 用户选择写作方式（续写/整章生成/审校等） THEN THE SYSTEM SHALL 自动创建或复用绑定该书的叙述者会话。
5. WHEN 写作过程中需要看 AI 对话 THEN THE SYSTEM SHALL 在页面内显示对话面板（可以是侧边弹出或底部面板）。
6. WHEN 用户点击返回 THEN THE SYSTEM SHALL 回到主界面。

---

## Requirement 4：叙事线资源管理器

**User Story：** 作为作者，我希望叙事线详情页的资源管理器能展示书的完整内容结构。

### Acceptance Criteria

1. WHEN 资源管理器显示 THEN THE SYSTEM SHALL 展示完整资源树：已有章节、生成章节（候选稿）、草稿、大纲、经纬/资料库（人物/地点/势力/物品/伏笔/世界规则）、故事文件、真相文件、素材、发布报告。
2. WHEN 资源节点有空状态 THEN THE SYSTEM SHALL 显示操作按钮（创建章节/生成下一章/导入章节等）。
3. WHEN 内容变更 THEN THE SYSTEM SHALL 自动刷新资源树。

---

## Requirement 5：两种页面的导航关系

**User Story：** 作为用户，我希望在主界面和叙事线详情页之间自由切换，sidebar 始终可见。

### Acceptance Criteria

1. WHEN 用户在任何页面 THEN THE SYSTEM SHALL sidebar 始终显示。
2. WHEN 用户点击叙事线的书 THEN THE SYSTEM SHALL 从主界面切换到叙事线详情页。
3. WHEN 用户点击叙述者的会话 THEN THE SYSTEM SHALL 从任何页面切换到主界面对话框。
4. WHEN 用户在叙事线详情页点击返回 THEN THE SYSTEM SHALL 回到主界面。
5. WHEN 用户点击套路/设置 THEN THE SYSTEM SHALL 从任何页面切换到对应页面。
6. WHEN 页面切换 THEN THE SYSTEM SHALL URL 同步更新（pushState）。

---

## Non-goals

1. 不做三栏 IDE 布局——对话为主，编辑为辅。
2. 不做可拖拽面板分割——固定的 sidebar + 全宽内容区。
3. 不重写 ChatWindow——复用现有的 WebSocket/消息/工具调用逻辑。
4. 不重写编辑器组件——复用现有的 ChapterEditor/CandidateEditor 等。
5. 不改变后端 API。
