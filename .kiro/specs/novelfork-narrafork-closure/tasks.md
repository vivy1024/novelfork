# Implementation Plan

## Overview

本 tasks.md 只负责把 06/07/08 的**仍未完成主线**转成后续执行入口。它不再维护历史 backlog，也不再围绕 workflow 迁移本身写任务。

## Tasks

> 当前进度：Package 1 / Package 2 / Package 3 已完成并通过相关回归、typecheck 与文档回写；当前主线推进到 Package 4。

- [x] 1. 冻结并确认剩余任务事实
  - 以 07 的剩余项为主事实来源
  - 结合 08 的主线包与 done definition 去重
  - 仅吸收 06 中仍有效的 UI/入口尾项
  - 输出一份“仍未完成的真实任务簇”清单

- [x] 2. 执行 Package 1：Execution / Governance Closure
  - 打通 Settings / Workflow / MCP / Permissions / Tools 的最后一层真实影响链
  - 统一 reason / source / trace / governance 口径
  - 验证：定向测试 + typecheck + governance 相关回归

- [x] 3. 执行 Package 2：Runtime / Delivery Closure
  - 已完成 startup recovery / repair / migration 收口
  - 已完成 compile smoke 与正式交付边界固化
  - 已验证：startup/recovery/admin 相关测试 + typecheck

- [x] 4. 执行 Package 3：Transparency / Admin Deepening
  - 已完成 run-level 回放与统一运行事实源推进
  - 已完成 Admin 跨页联动与系统诊断深度强化
  - 已验证：ToolCall / Admin / run 事件流相关回归 + typecheck

- [ ] 5. 执行 Package 4：Creation / Session Endgame

  > 分工口径：**Cascade 负责事实源 / 运行时 / 协议 / 测试**；**薛小川负责产品交互 / UI 终态 / 文案 / 人工验收**。两侧接口以 `windowRuntimeStore` / `SessionChatSnapshot` / `recoveryStatus` 语义为契约，不得绕过。

  - [ ] 5.1 **（Cascade）会话事实源 server-first 收敛**
    - 削弱 `packages/studio/src/components/ChatWindow.tsx` 中的本地 `sessionMessages` / `sessionMessagesRef` / `recoveryStatus` 副本，改为以 `SessionChatSnapshot` + `windowRuntimeStore` 为单一事实源
    - `packages/studio/src/stores/windowStore.ts` 的 `persist` 只保留布局与 `sessionId` 关联，不再承载任何会话内容心智
    - `packages/studio/src/api/lib/session-chat-service.ts` 的 snapshot / state / message / history / ack 协议补齐边界（空会话、超时、resetRequired、超过 MAX_SESSION_MESSAGES）
    - 移除 `ChatWindow` 内 `persistSessionMessages` 直接 `PUT /api/sessions/:id` 的本地回写路径，改由服务端广播为唯一来源
    - 单测：session-chat-service 协议回归 + ChatWindow 快照/回放/重置路径
  - [ ] 5.2 **（Cascade）bootstrap 初始化工作流后端链**
    - 打通"建书完成 → 默认工作流进入 → 首个 session 可直达"的后端串联（project bootstrap → default session scaffolding → session snapshot 就绪）
    - 统一 bootstrap 完成信号，通过已有事件/快照体系而不是新增本地状态通知前端
    - 回归：既有 startup / recovery / admin 测试不得被回退
  - [ ] 5.3 **（Cascade）recovery 状态机补齐**
    - `WindowRecoveryState` 的五态（idle/recovering/reconnecting/replaying/resetting）在**后端事件**与**前端 store**之间一一对应，不允许仅靠前端本地定时器驱动
    - resetRequired / sinceSeq 越界 / 服务端主动 reset 的终态语义补齐并有测试
  - [ ] 5.4 **（Cascade）typecheck 与自动化回归**
    - `pnpm --filter @vivy1024/novelfork-studio typecheck` 通过
    - 创建流 / 会话恢复 / ChatWindow / SessionCenter 相关单元与集成测试通过
    - `git status --short` 干净

  - [ ] 5.5 **（narrafork）初始化工作流产品化 UI**
    - 基于 5.2 后端串联，确定"建书后引导用户进入默认工作流"的交互形态与文案（进入哪个页面、首个 session 卡片的默认模板、初次引导提示）
    - 在 `SessionCenter` / 新建会话对话框 / 首启空态中落实该产品决策
  - [ ] 5.6 **（narrafork）reconnect / replay / reset / recovery 终态 UI**
    - 在 `SessionCenter` 卡片、`ChatWindow` 头部、`Admin` 会话联动视图三处，对齐五态 Badge / 文案 / 颜色 / 可操作项（如 reset 时是否允许继续输入）
    - 当前 `SessionCenter.tsx` 的 `formatRecoveryStateBadge` / `formatRecoveryStateDescription` 与 `ChatWindow.tsx` 的头部状态需统一为同一套视觉与话术
    - 对"稳定"态也给出可见的正反馈，不再只是 idle 即隐藏
  - [ ] 5.7 **（narrafork）ChatWindow 心智降格的 UI 表达**
    - 配合 5.1，确认"窗口是会话对象的视图"这一心智在标题栏、窗口关闭、最小化、重新打开等交互上一致
    - 明确关闭窗口 ≠ 结束会话 的用户可见反馈
  - [ ] 5.8 **（narrafork）人工验收 & 包级文档回写**
    - 手动回归：建书 → 默认工作流 → 新建 session → 断网 → 恢复 → reset → 关窗重开，全流程可理解
    - Package 4 完成时按任务 7 的 done definition 统一回写文档（`03-代码参考` / `02-核心架构` / `04-开发指南` 按变更类型分发，不新建临时报告）

- [ ] 6. 执行 Package 5：Top-Level Model & Final Acceptance
  - 明确并推进 `Project / Chapter / Narrator` 三层对象模型最小闭环
  - 统一最终验收口径
  - 明确真正剩余的长期愿景项

- [ ] 7. 每个 package 完成时执行统一 done definition
  - 已完成：Package 1 / 2 / 3 已按该口径完成后端、前端入口/反馈、测试、typecheck、相关回归与文档回写
  - 待继续：Package 4 / 5 完成时继续执行同一 done definition
  - 检查项：后端完成
  - 检查项：前端入口/反馈完成
  - 检查项：测试补齐
  - 检查项：typecheck 通过
  - 检查项：相关回归测试通过
  - 检查项：`git status --short` 干净
  - 检查项：文档在包结束时回写一次

- [ ] 8. 当且仅当本 Kiro spec 已完整承接旧文档有效内容时，再退役旧文档
  - 删除 06 / 07 / 08
  - 删除旧自由 plan 文件
  - 保证后续入口只剩 `.kiro/specs/<feature>/requirements.md + design.md + tasks.md`
