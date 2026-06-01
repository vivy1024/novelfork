# Legacy Source Retirement v1 Requirements

## Introduction

本 spec 在 `frontend-live-wiring-v1` 建立真实 live route 后执行，目标是删除已经从主构建路径退役的失败三栏前端、旧 ChatWindow 视觉层和未挂载旧 route 残留。删除不是为了“清爽”而盲删，而是为了防止后续误用旧事实源、旧布局和 process-memory 入口。

本 spec 必须遵守项目废弃代码纪律：不新增 shim、noop adapter、fake provider 或空实现；仍有复用价值的代码必须迁移到当前 Agent Shell、Conversation、Workbench 或 Backend Contract 边界下。

---

## Requirement 1：删除前必须建立依赖基线

**User Story：** 作为维护者，我需要知道哪些旧文件仍被测试、文档或 active 页面引用，避免删除时误伤真实功能。

### Acceptance Criteria

1. WHEN 开始删除旧源码 THEN THE SYSTEM SHALL 先全仓搜索旧入口引用，包括 `StudioApp`、`WorkspacePage`、`ChatWindow`、`ChatWindowManager`、`SplitView`、`EditorArea`、`ConversationPanel`、`useStudioData`、`windowStore`。
2. WHEN 某旧文件仍有 active consumer THEN THE SYSTEM SHALL 先迁移 consumer，再删除旧文件。
3. WHEN 某引用只存在于历史文档或测试示例 THEN THE SYSTEM SHALL 更新为当前路径或明确归档语义。
4. WHEN 删除清单形成 THEN THE SYSTEM SHALL 标明每项是删除、迁移、保留还是后续 route 退役候选。

---

## Requirement 2：退役失败三栏前端源码

**User Story：** 作为开发者，我不希望旧三栏 IDE 实验继续留在源码树里被误认为当前实现。

### Acceptance Criteria

1. WHEN `frontend-live-wiring-v1` 已完成 THEN THE SYSTEM SHALL 删除旧 `app-next/StudioApp.tsx` 和对应测试。
2. WHEN 旧 workspace 不再被 active route 引用 THEN THE SYSTEM SHALL 删除 `app-next/workspace/**`。
3. WHEN `EditorArea`、`ConversationPanel`、`GitChangesView`、`useStudioData` 仅服务旧三栏 THEN THE SYSTEM SHALL 删除这些文件和对应测试。
4. WHEN `components/split-view/**` 无其他 current consumer THEN THE SYSTEM SHALL 删除 split view 组件和布局缓存测试。
5. WHEN 删除完成 THEN THE SYSTEM SHALL 移除 tsconfig 中针对这些旧前端路径的 exclude 项，避免“靠 exclude 隐藏问题”。

---

## Requirement 3：退役旧 ChatWindow 视觉层

**User Story：** 作为作者，我希望所有叙述者会话都走新的单栏 Conversation，而不是旧 floating/docked ChatWindow。

### Acceptance Criteria

1. WHEN 新 Conversation route 已接通 THEN THE SYSTEM SHALL 删除 `components/ChatWindow.tsx` 和 `components/ChatWindow.test.tsx`。
2. WHEN floating window manager 不再承载 current 对话 THEN THE SYSTEM SHALL 删除或迁移 `ChatWindowManager.tsx`。
3. WHEN `NarratorPanel` 仍被旧 workspace 引用 THEN THE SYSTEM SHALL 随旧 workspace 一并删除，不能复制成兼容层。
4. WHEN 工具调用可视化仍有价值 THEN THE SYSTEM SHALL 迁移到 `app-next/agent-conversation` 或 `app-next/tool-results` 边界。
5. WHEN 文档仍描述 ChatWindow 当前集成 THEN THE SYSTEM SHALL 改为 ConversationSurface / Tool Result Renderer 口径。

---

## Requirement 4：迁移或删除 windowStore 相关消费者

**User Story：** 作为维护者，我希望会话事实源统一到 session service，而不是继续让 windowStore 代表运行时真相。

### Acceptance Criteria

1. WHEN `SessionCenterPage` 仍使用 `windowStore` THEN THE SYSTEM SHALL 迁移到 `/api/sessions` domain client 或当前 session store。
2. WHEN `Admin/SessionsTab` 仍使用 `windowStore` THEN THE SYSTEM SHALL 改为读取真实 session/runtime/recovery 数据。
3. WHEN `windowRecoveryPresentation` 仍有复用价值 THEN THE SYSTEM SHALL 重命名或迁移为 session recovery presentation。
4. WHEN `windowStore` 无 current consumer THEN THE SYSTEM SHALL 删除 store、持久化 fallback 和相关测试。
5. WHEN 仍需保留某个 window 概念 THEN THE SYSTEM SHALL 明确其是 UI workspace window，而不是 narrator session fact source。

---

## Requirement 5：清理 legacy route 与未挂载旧 route 残留

**User Story：** 作为维护者，我希望旧 route 要么真实保留并透明标注，要么删除，不继续以注释占位或 process-memory 入口混淆当前能力。

### Acceptance Criteria

1. WHEN `/api/chat/:bookId/*` 已无 current consumer THEN THE SYSTEM SHALL 删除 `routes/chat.ts`、相关测试和 matrix process-memory 条目。
2. WHEN `/api/agent` 已无 current consumer THEN THE SYSTEM SHALL 删除或正式退役该 route，并确认新入口使用 `/api/sessions`、`/api/exec` 或 session tools。
3. WHEN `poison-detector.ts`、`hooks-countdown.ts` 仍未挂载且无重构计划 THEN THE SYSTEM SHALL 删除文件、注释导出和 tsconfig.server exclude 项。
4. WHEN `/api/pipeline` 或 `/api/monitor` 仍需保留 THEN THE SYSTEM SHALL 继续 transparent process-memory/unsupported，不得写成 current。
5. WHEN 旧导出或旧 AI panel route 仍有文档/测试引用 THEN THE SYSTEM SHALL 保留并登记迁移条件，不在本 spec 中强删。

---

## Requirement 6：删除后必须更新守护、文档与验证

**User Story：** 作为维护者，我需要删除后有自动化守护，确保旧前端不会被重新引入。

### Acceptance Criteria

1. WHEN 旧源码删除完成 THEN THE SYSTEM SHALL 更新 `legacy-retirement.test.ts`，从“路径被 exclude”改为“路径不存在或无 current 引用”。
2. WHEN tsconfig exclude 被移除 THEN THE SYSTEM SHALL 确保 Studio typecheck 不依赖隐藏旧源码。
3. WHEN 文档更新 THEN THE SYSTEM SHALL 同步 `.kiro/specs/README.md`、CHANGELOG、ToolCall README、Studio/API 文档中的旧口径。
4. WHEN 验证运行 THEN THE SYSTEM SHALL 至少运行相关 app-next tests、API legacy route tests、Studio typecheck 和 docs verify。
5. WHEN 某 legacy route 被保留 THEN THE SYSTEM SHALL 在 Backend Contract matrix 中保留准确的 process-memory/deprecated/unsupported 状态。

---

## Non-goals

1. 不在本 spec 中实现新的 Conversation 功能；那属于 `frontend-live-wiring-v1` 或 `conversation-parity-v1`。
2. 不为了删除旧代码而破坏当前导出、pipeline 调试或 monitor unsupported 透明边界。
3. 不删除仍被文档/测试证明为 current 的真实后端能力。
4. 不新增任何兼容旧前端的 shim、noop adapter 或空组件。