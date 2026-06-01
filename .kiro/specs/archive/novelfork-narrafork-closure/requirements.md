# Requirements Document

## Introduction

本 Kiro spec 不讨论“如何迁移 workflow 规范”，而是专门承接 `06-Studio-UIUX改造清单.md`、`07-NarraFork功能对齐任务总表.md`、`08-NarraFork快速收口执行计划.md` 里**仍未完成的实际任务**。

它要回答的不是“以后用什么格式写计划”，而是：

1. **06 / 07 / 08 还剩什么没做完**
2. **这些剩余任务应按哪些主线包推进**
3. **每个主线包做到什么程度才算完成**
4. **全部做完后还剩哪些长期愿景项**

本 spec 只覆盖当前仍然有效的剩余任务，不回溯已完成项。

## Requirements

### Requirement 1: 完成执行链与治理链最终收口（来源：07 Phase E/G、08 Wave 1）
**User Story:** 作为维护者，我希望 Settings、Workflow、MCP、Permissions、Tools 形成真正统一的执行治理链，这样配置、执行、解释与日志不会继续分裂。

#### Acceptance Criteria
1. WHEN 用户在 Settings 或 WorkflowWorkbench 中修改运行控制配置 THEN THE SYSTEM SHALL 让这些配置真实影响工具权限、MCP 策略、retry/backoff/recovery、trace/dump 等执行行为。
2. WHEN 前台或后台展示执行原因时 THEN THE SYSTEM SHALL 统一 reason / source / trace / governance 解释口径。
3. WHEN WorkflowWorkbench 展示治理状态时 THEN THE SYSTEM SHALL 让其成为执行链真实投影，而不只是摘要页。
4. WHEN 本主线包完成时 THEN THE SYSTEM SHALL 使 `Workflow / MCP / 权限 / 执行器` 更接近单一治理心智。

### Requirement 2: 完成运行时与分发闭环（来源：07 Phase H、08 Wave 2）
**User Story:** 作为交付者，我希望 NovelFork 的启动恢复、repair/migration、embedded/filesystem 与 compile smoke 进入正式闭环，这样平台具备真实本地交付能力。

#### Acceptance Criteria
1. WHEN 冷启动、异常恢复、缺索引恢复或 migration 发生时 THEN THE SYSTEM SHALL 有明确且可验证的恢复路径。
2. WHEN 运行 `pnpm bun:compile` 与相关 startup smoke 时 THEN THE SYSTEM SHALL 提供稳定、可重复的单文件交付链路。
3. WHEN 运行时进入损坏或半损坏状态时 THEN THE SYSTEM SHALL 提供 repair / migration / recovery 的完整决策链，而不只是输出日志。
4. WHEN 本主线包完成时 THEN THE SYSTEM SHALL 明确“单文件分发正式闭环”和“安装器 / 签名 / 自动更新 / 首启 UX”之间的边界。

### Requirement 3: 深化 AI 透明化与 Admin 实时化（来源：07 Phase D/F、08 Wave 3）
**User Story:** 作为操作者，我希望 ToolCall、执行链与 Admin 都能围绕同一运行事实工作，这样我不仅能看结果，还能追踪、回放和定位问题。

#### Acceptance Criteria
1. WHEN 用户查看 ToolCall 或执行链时 THEN THE SYSTEM SHALL 支持更强的 run-level 回放、定位与统一事实源展示。
2. WHEN 用户在 Admin 中查看运行信息时 THEN THE SYSTEM SHALL 从静态快照提升到更强的实时联动与系统诊断能力。
3. WHEN 同一条运行事实出现在 ChatWindow、ToolCall、Requests、Logs、Resources 等位置时 THEN THE SYSTEM SHALL 共享一致语义。
4. WHEN 本主线包完成时 THEN THE SYSTEM SHALL 让前台执行链与后台运维视角可互相对应。

### Requirement 4: 完成创建 / 会话体验终态（来源：07 Phase B/C、08 Wave 4）
**User Story:** 作为用户，我希望项目创建、默认工作流进入、会话恢复与状态反馈形成完整主线，而不是一组零碎拼接流程。

#### Acceptance Criteria
1. WHEN 用户完成项目/书籍创建时 THEN THE SYSTEM SHALL 提供更完整的初始化工作流，而不只是建书完成。
2. WHEN 会话发生 reconnect / replay / reset / recovery 时 THEN THE SYSTEM SHALL 在 UI 中给出用户可理解、server-first 的状态反馈。
3. WHEN 会话恢复完成后 THEN THE SYSTEM SHALL 明确继续沿用正式消息链和正式快照，而不是依赖本地窗口私有状态。
4. WHEN 本主线包完成时 THEN THE SYSTEM SHALL 使 ChatWindow 更接近纯服务端事实源。

### Requirement 5: 收掉仍有效的 UI/入口收口尾项（来源：06 剩余有效项、07 3.1 尾项）
**User Story:** 作为使用者，我希望平台的危险操作、入口顺序和少量剩余硬编码问题被收口，这样最后阶段不会因为 UI 尾项破坏整体一致性。

#### Acceptance Criteria
1. WHEN 用户触发危险操作时 THEN THE SYSTEM SHALL 使用统一的确认交互风格。
2. WHEN 用户浏览主导航和核心入口时 THEN THE SYSTEM SHALL 避免继续依赖明显硬编码的顺序与显示规则。
3. WHEN 最后阶段做 UI 收口时 THEN THE SYSTEM SHALL 只处理仍然有效的尾项，而不是重做已完成的页面骨架工作。

### Requirement 6: 明确顶层未完大项与最终验收口径（来源：07 最终验收、08 Done Definition）
**User Story:** 作为执行者，我希望剩余工作有明确的 done definition 和最终未完成边界，这样不会把零散修补误判为 closure 完成。

#### Acceptance Criteria
1. WHEN 每个主线包结束时 THEN THE SYSTEM SHALL 同时满足后端、前端、测试、验证和文档更新要求。
2. WHEN 一个主线包未形成闭环时 THEN THE SYSTEM SHALL 不把少量局部修补视为完成。
3. WHEN 全部主线包收口完成时 THEN THE SYSTEM SHALL 明确剩余的长期愿景项至少包括：
   - `Project / Chapter / Narrator` 三层对象模型完整
   - 更深层的安装器 / 签名 / 自动更新 / 首启 UX 闭环
   - 更完整的运行时 repair / migration / 系统级实时诊断终态

### Requirement 7: 保持执行顺序与节奏（来源：08 执行规则）
**User Story:** 作为维护者，我希望剩余任务继续按主线包推进，而不是重新回到一次磨一个小点的方式。

#### Acceptance Criteria
1. WHEN 规划剩余工作时 THEN THE SYSTEM SHALL 以主线包而不是散点任务组织后续执行。
2. WHEN 执行某一主线包时 THEN THE SYSTEM SHALL 把该包涉及的后端、前端、测试和文档一起闭环。
3. WHEN 包内尚未闭环时 THEN THE SYSTEM SHALL 不频繁切换到其他主线包。
