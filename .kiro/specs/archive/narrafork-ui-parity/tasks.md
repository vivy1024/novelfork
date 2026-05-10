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

- [x] GUARD 15. 浏览器截图对比验证
  - 构建前端 dist（vite build 成功）
  - 启动 localhost:4567 API 服务器
  - 截图确认：
    - ✅ NarratorStatusBar 显示（● 空闲 + D M ⚡ 🛡️ 按钮）
    - ✅ Composer 极简（📎 + textarea + 发送按钮，无 select）
    - ⚠️ MarkdownRenderer 渲染未生效（粗体/列表仍为纯文本）— 需排查
    - ⚠️ 旧底部状态栏未移除（与 NarratorStatusBar 重叠）— 需清理
    - ⚠️ 章节图视图未验证（需要有章节数据的项目）

## 下一轮修复（浏览器验证暴露的问题）

1. 移除旧的底部状态栏（`Clock + 消息数 + binding + provider`），信息已合并到 NarratorStatusBar
2. 排查 MarkdownRenderer 在 build 后不渲染的问题（可能是 SSR/hydration 或 CSS 缺失）
3. 用有章节数据的项目验证图视图切换
