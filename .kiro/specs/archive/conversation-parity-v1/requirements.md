# Conversation Parity v1 Requirements

## Introduction

本 spec 参考本机 Claude Code CLI 2.1.69 的对话能力，补齐 NovelFork Studio 叙述者会话的产品化差距。目标不是复制终端 TUI，而是把对小说创作有价值的会话恢复、fork、slash command、compact、权限策略、headless stream-json、checkpoint/rewind 和执行结果统计落到 NovelFork 的 Web 工作台与 CLI 中。

本 spec 在 `frontend-live-wiring-v1` 完成后执行；其中涉及旧前端删除的前置清理由 `legacy-source-retirement-v1` 承担。本 spec 可以新增后端能力，但必须有真实存储、真实 API、真实 UI 和测试，不允许只做占位按钮。

---

## Requirement 1：会话恢复、继续与 fork UX

**User Story：** 作为作者，我希望像 Claude Code 一样能继续最近会话、恢复指定会话、从历史会话 fork 新分支，避免长篇创作上下文丢失。

### Acceptance Criteria

1. WHEN 用户打开叙述者入口 THEN THE SYSTEM SHALL 提供最近会话、按书籍/章节筛选、搜索和恢复入口。
2. WHEN 用户选择继续最近会话 THEN THE SYSTEM SHALL 打开当前目录/当前书籍范围内 lastModified 最新的 active session。
3. WHEN 用户选择恢复指定会话 THEN THE SYSTEM SHALL 通过 sessionId 打开历史并建立 replay cursor。
4. WHEN 用户选择 fork session THEN THE SYSTEM SHALL 创建新 session，继承原 session 的必要上下文和摘要，不复用原 sessionId。
5. WHEN fork 或 resume 失败 THEN THE SYSTEM SHALL 显示真实错误，不创建空假会话。
6. WHEN 会话已归档 THEN THE SYSTEM SHALL 支持只读查看或明确恢复为 active 后继续。

---

## Requirement 2：Slash Command 与命令面板

**User Story：** 作为作者，我希望在输入框里输入 `/compact`、`/model`、`/permission`、`/fork` 等命令快速控制会话，而不必到处找按钮。

### Acceptance Criteria

1. WHEN 用户在 Composer 输入 `/` THEN THE SYSTEM SHALL 展示会话命令建议列表。
2. WHEN 用户执行 `/compact` THEN THE SYSTEM SHALL 触发真实 compact 流程，生成摘要并压缩历史上下文。
3. WHEN 用户执行 `/model` THEN THE SYSTEM SHALL 打开模型选择器或聚焦状态栏模型控件。
4. WHEN 用户执行 `/permission` THEN THE SYSTEM SHALL 打开权限模式选择器或执行带参数的权限切换。
5. WHEN 用户执行 `/fork` THEN THE SYSTEM SHALL 进入 fork session 流程。
6. WHEN 命令不存在或参数非法 THEN THE SYSTEM SHALL 在对话流显示命令错误，不发送给模型伪装为普通消息。
7. WHEN 命令影响写入或权限 THEN THE SYSTEM SHALL 走确认门或权限策略，不绕过治理。

---

## Requirement 3：Compact、Memory 与上下文预算

**User Story：** 作为作者，我希望长会话能自动或手动压缩，保留关键剧情、设定、人物状态和未完成任务，而不是一到上下文上限就失控。

### Acceptance Criteria

1. WHEN 会话消息或 token 接近阈值 THEN THE SYSTEM SHALL 提示 compact 建议或自动 compact，具体行为由设置控制。
2. WHEN compact 执行 THEN THE SYSTEM SHALL 生成可读摘要，记录压缩前后消息范围、摘要时间和使用模型。
3. WHEN compact 完成 THEN THE SYSTEM SHALL 后续模型调用使用摘要和近期消息，而不是继续携带全部历史。
4. WHEN compact 失败 THEN THE SYSTEM SHALL 保留原历史，不破坏会话。
5. WHEN 用户查看会话详情 THEN THE SYSTEM SHALL 能看到 compact 摘要、上下文预算和最近压缩记录。
6. WHEN 项目/用户 memory 可用 THEN THE SYSTEM SHALL 将稳定偏好和项目事实以可审计方式写入 memory，不把临时剧情草稿误存为长期偏好。

---

## Requirement 4：细粒度工具权限策略

**User Story：** 作为维护者，我希望不同叙述者会话能有不同的工具 allow/deny/ask 策略，类似 Claude Code 的 allowedTools/disallowedTools，但符合小说写作场景。

### Acceptance Criteria

1. WHEN session config 展示 THEN THE SYSTEM SHALL 支持查看当前可用工具、被禁工具和需询问工具。
2. WHEN 用户修改工具策略 THEN THE SYSTEM SHALL 持久化到 session config 或 project-level policy。
3. WHEN Agent 请求工具 THEN THE SYSTEM SHALL 同时考虑 permissionMode、tool policy、resource risk 和 dirty canvasContext。
4. WHEN 工具被 deny THEN THE SYSTEM SHALL 返回结构化 tool_result 错误并展示原因。
5. WHEN 工具需要 ask THEN THE SYSTEM SHALL 显示确认门，批准/拒绝均写入审计。
6. WHEN 策略与模型工具能力冲突 THEN THE SYSTEM SHALL 显示 unsupported-tools 或 policy-disabled，不发送不可执行工具 schema。

---

## Requirement 5：Headless stream-json 会话入口

**User Story：** 作为高级用户，我希望脚本或外部工具可以像 Claude Code `--input-format stream-json --output-format stream-json` 一样驱动 NovelFork 会话，用于自动审稿、批处理和集成测试。

### Acceptance Criteria

1. WHEN 用户调用 headless chat API 或 CLI THEN THE SYSTEM SHALL 支持输入普通文本或 stream-json envelope。
2. WHEN 输出格式为 stream-json THEN THE SYSTEM SHALL 输出 user echo、assistant delta、tool_use、tool_result、error、result 等事件。
3. WHEN 指定 sessionId THEN THE SYSTEM SHALL 复用该 session；未指定时创建新 session 并返回 sessionId。
4. WHEN 设置 max turns 或预算限制 THEN THE SYSTEM SHALL 在达到限制时停止并返回结构化 result。
5. WHEN 发生权限确认 THEN THE SYSTEM SHALL 返回 pending confirmation 状态，不自动批准危险写入。
6. WHEN 用户禁用 session persistence THEN THE SYSTEM SHALL 不写入持久会话，并在输出中明确标识 ephemeral。

---

## Requirement 6：写作资源 checkpoint 与 rewind

**User Story：** 作为作者，我希望 AI 修改正文、草稿、经纬或 story/truth 前能自动留存 checkpoint，并可回滚到某次会话消息前的状态。

### Acceptance Criteria

1. WHEN session tool 或 Workbench 保存会修改正式资源 THEN THE SYSTEM SHALL 在写入前创建 checkpoint。
2. WHEN 写入只进入候选稿或 prompt-preview THEN THE SYSTEM SHALL 不强制创建正式资源 checkpoint。
3. WHEN 用户查看消息或工具结果 THEN THE SYSTEM SHALL 能看到该 turn 影响了哪些资源和 checkpointId。
4. WHEN 用户执行 rewind THEN THE SYSTEM SHALL 展示将恢复的文件列表、版本摘要和风险确认门。
5. WHEN rewind 被批准 THEN THE SYSTEM SHALL 恢复对应资源，并记录审计事件。
6. WHEN checkpoint 不存在、资源已移动或冲突 THEN THE SYSTEM SHALL 返回真实错误，不静默覆盖。

---

## Requirement 7：会话执行结果与成本/用量统计

**User Story：** 作为维护者，我希望每次 headless 或长会话执行都有结构化结果，包含轮数、耗时、token、模型使用、权限拒绝和错误原因。

### Acceptance Criteria

1. WHEN 会话 turn 完成 THEN THE SYSTEM SHALL 更新 turn duration、usage、modelUsage 和 stopReason。
2. WHEN 工具被拒绝 THEN THE SYSTEM SHALL 记录 permission_denials，包含 tool_name、tool_use_id、tool_input 摘要。
3. WHEN headless 执行完成 THEN THE SYSTEM SHALL 返回 success/error result envelope。
4. WHEN provider 不提供成本 THEN THE SYSTEM SHALL 不虚构 dollar cost，只显示 token/usage 和 unknown cost。
5. WHEN UI 展示统计 THEN THE SYSTEM SHALL 区分本轮、累计、本次 headless run 三种范围。

---

## Requirement 8：验证与不回归

**User Story：** 作为维护者，我希望每项 parity 能力都有真实测试，防止只做 UI 壳或占位 API。

### Acceptance Criteria

1. WHEN 本 spec 完成 THEN THE SYSTEM SHALL 通过 session route、headless API、CLI、Conversation UI 和 Workbench checkpoint 测试。
2. WHEN slash command 测试运行 THEN THE SYSTEM SHALL 覆盖合法命令、非法命令、带参数命令和权限命令。
3. WHEN compact 测试运行 THEN THE SYSTEM SHALL 覆盖成功、失败、上下文预算、摘要持久化。
4. WHEN checkpoint 测试运行 THEN THE SYSTEM SHALL 覆盖写入前快照、rewind 预览、批准恢复和冲突失败。
5. WHEN 文档更新 THEN THE SYSTEM SHALL 同步 CLI/API 使用说明、`.kiro/specs/README.md`、CHANGELOG 和能力矩阵。

---

## Non-goals

1. 不复制 Claude Code 的终端 TUI、tmux、Chrome bridge、remote-control 和插件市场。
2. 不把所有 Claude Code 内置命令一次性照搬；只实现 NovelFork 会话创作闭环需要的命令。
3. 不绕过 NovelFork 的候选稿/草稿/确认门边界。
4. 不虚构 provider 成本、工具能力或 checkpoint 成功结果。