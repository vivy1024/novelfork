# Implementation Plan — NarraFork UI 对标

## Overview

基于 NarraFork 0.4.2 完整前端爬取（API/DOM/i18n/组件结构），分 4 个 Phase 对标。每个 Phase 独立可交付。

## Traceability

- Phase 1 (Task 1-7) → Req 1-4（对话核心体验）
- Phase 2 (Task 8-11) → Req 5-7（提供商与设置）
- Phase 3 (Task 12-14) → Req 8-9（章节与图）
- Phase 4 (Task 15) → Req 10（验证）

---

## Phase 1：对话窗口核心体验

### 已完成（前一轮）

以下在 `conversation-surface-real-closure` 中已完成，保留不动：
- MarkdownRenderer 替换（删除 inlineMarkdown）
- ToolCallBlock 替换（适配器 + renderer registry）
- 推理折叠 ThinkingBlock
- 叙述者状态模型扩展（NarratorState/substatus/streamingStartedAt）
- 搜索功能
- 中断/继续按钮三态

### 待修正

- [x] FEATURE 1. Composer 移除 model/permission select
- [x] FEATURE 2. 新增 NarratorStatusBar 组件
- [x] FEATURE 3. 模型选择 ActionIcon + DropdownMenu
- [x] FEATURE 4. 推理强度 ActionIcon + DropdownMenu
- [x] FEATURE 5. 权限模式 ActionIcon + DropdownMenu
- [x] FEATURE 6. 上下文环形图 + Fast Mode toggle
- [x] FEATURE 7. 消息右键上下文菜单

---

## Phase 2：提供商与设置

- [x] FEATURE 8. Provider 编辑表单新增 API 模式选择（已有）
- [x] FEATURE 9. Codex 模式额外配置（推理强度/AccountID/WebSocket）
- [x] FEATURE 10. ~~Codex 多账号管理~~ 跳过（NovelFork 通过 Sub2API 网关，不需要本地管理 ChatGPT 账号）
- [x] FEATURE 11. ~~设置→对话数据流验证~~ 已在之前 spec 中接通

---

## Phase 3：章节与图

- [x] FEATURE 12. 安装 react-flow 并创建 ChapterNode
- [x] FEATURE 13. 项目页新增图视图（资源树/章节图切换）
- [x] FEATURE 14. 章节操作栏（新建/分叉按钮 + 选中状态）

---

## Phase 4：验证

- [ ] GUARD 15. 浏览器截图对比验证
  - 启动 NovelFork localhost:4567
  - 截图 1：Composer 极简（📎 + textarea + 按钮）
  - 截图 2：NarratorStatusBar（模型/权限/推理 ActionIcon Menu 弹出）
  - 截图 3：消息右键菜单
  - 截图 4：提供商 API 模式选择
  - 截图 5：react-flow 章节图
  - 对比 NarraFork 7778 同页面截图
  - 验证：视觉对标确认
