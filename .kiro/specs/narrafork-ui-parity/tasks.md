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

- [ ] FEATURE 1. Composer 移除 model/permission select
  - 删除 Composer 中的 `modelOptions`、`onModelChange`、`permissionOptions`、`onPermissionChange` props
  - 删除 Composer 中的两个 `<select>` 元素
  - Composer 恢复为极简结构：📎 + textarea + 按钮
  - 保留：附件、中断/继续/发送三态、slash command
  - 验证：typecheck 通过

- [ ] FEATURE 2. 新增 NarratorStatusBar 组件
  - 新建 `surface/NarratorStatusBar.tsx`
  - 左侧：StatusDot（颜色按 narratorState）+ 状态文案 + 耗时
  - 右侧预留插槽（Task 3-6 填充）
  - 放置在 ConversationSurface 的 Composer 上方
  - 验证：typecheck 通过

- [ ] FEATURE 3. 模型选择 ActionIcon + DropdownMenu
  - 在 NarratorStatusBar 右侧添加模型按钮（显示当前模型首字母）
  - 点击弹出 shadcn DropdownMenu
  - 菜单顶部有搜索输入框（Command 组件）
  - 模型按供应商分组显示
  - 选择后调用 session config update API
  - 验证：typecheck 通过

- [ ] FEATURE 4. 推理强度 ActionIcon + DropdownMenu
  - 按钮显示当前强度首字母（N/L/M/H/X/A）
  - 菜单项：关闭/低/中/高/超高/自动
  - 选择后调用 session reasoning effort update API
  - 验证：typecheck 通过

- [ ] FEATURE 5. 权限模式 ActionIcon + DropdownMenu
  - 按钮显示 shield 图标（shield-off=全部允许, shield=逐项询问）
  - 菜单项：逐项询问/允许编辑/全部允许/只读/全部拒绝/进入计划模式
  - 选择后调用 session permission mode update API
  - 验证：typecheck 通过

- [ ] FEATURE 6. 上下文环形图 + Fast Mode toggle
  - 上下文 SVG 圆环：从 status.contextUsage 读取百分比
  - Fast Mode ⚡ 按钮：toggle，调用 session fast mode update API
  - 验证：typecheck 通过

- [ ] FEATURE 7. 消息右键上下文菜单
  - 安装 shadcn/ui context-menu 组件（如未安装）
  - MessageItem 外层包裹 ContextMenu
  - 菜单项：回退到此处 / 从此处分叉 / 压缩到此消息前 / 编辑并重新生成 / 删除
  - 每项调用对应 API（rollback/fork/compact/editAndRegenerate/delete）
  - 验证：typecheck 通过

---

## Phase 2：提供商与设置

- [ ] FEATURE 8. Provider 编辑表单新增 API 模式选择
  - 在 provider 创建/编辑表单中新增 RadioGroup：Completions / Responses / Codex
  - 模式说明文案对标 NarraFork i18n
  - 保存到 provider config
  - 验证：typecheck 通过

- [ ] FEATURE 9. Codex 模式额外配置
  - API 模式为 Codex 时显示：
    - Codex 推理强度 select
    - Fast Mode switch
    - WebSocket switch
    - Account ID input
  - 非 Codex 模式隐藏这些字段
  - 验证：typecheck 通过

- [ ] FEATURE 10. Codex 多账号管理页面
  - 新增 Codex 凭据管理 UI（列表 + 导入 + 启用/禁用/删除）
  - 显示 tier badge + 用量
  - 负载均衡模式选择
  - 额度总览卡片
  - 验证：typecheck 通过

- [ ] FEATURE 11. 设置→对话数据流验证
  - 确认 /settings/models 保存后新建叙述者继承默认模型
  - 确认对话界面 NarratorStatusBar 的模型/权限/推理按钮显示正确值
  - 确认对话界面修改只影响当前叙述者
  - 验证：集成测试或浏览器验证

---

## Phase 3：章节与图

- [ ] FEATURE 12. 安装 react-flow 并创建 ChapterNode
  - 安装 `@xyflow/react`
  - 新建 `app-next/chapter-graph/ChapterNode.tsx`
  - ChapterNode 内嵌 ConversationSurface（精简版：消息列表 + 状态栏 + Composer）
  - 节点可拖拽、可调整大小
  - 验证：typecheck 通过

- [ ] FEATURE 13. 项目页替换为 react-flow 图
  - 当前项目页（WritingWorkbenchRoute）替换为 react-flow 画布
  - 从 `/api/projects/:id/graph` 或 chapters API 加载节点和边
  - 章节状态用颜色区分（green=active, yellow=dormant, blue=merged, gray=abandoned）
  - 验证：typecheck 通过

- [ ] FEATURE 14. 章节操作（fork/merge/新建）
  - 顶部操作栏：新建章节 / 批量合并 / 清理
  - 节点右键菜单：fork / 休眠 / 唤醒 / 归档
  - fork 创建新节点并添加 fork 边
  - 验证：typecheck 通过

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
