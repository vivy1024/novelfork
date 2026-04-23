# Implementation Plan

## Overview

本 tasks.md 只负责把 06/07/08 的**仍未完成主线**转成后续执行入口。它不再维护历史 backlog，也不再围绕 workflow 迁移本身写任务。

## Tasks

> 当前进度：Package 1 已完成并通过相关回归与 typecheck；Package 2 进行中。

- [x] 1. 冻结并确认剩余任务事实
  - 以 07 的剩余项为主事实来源
  - 结合 08 的主线包与 done definition 去重
  - 仅吸收 06 中仍有效的 UI/入口尾项
  - 输出一份“仍未完成的真实任务簇”清单

- [x] 2. 执行 Package 1：Execution / Governance Closure
  - 打通 Settings / Workflow / MCP / Permissions / Tools 的最后一层真实影响链
  - 统一 reason / source / trace / governance 口径
  - 验证：定向测试 + typecheck + governance 相关回归

- [x] 3. 执行 Package 2：Runtime / Delivery Closure（已完成）
  - 收口 startup recovery / repair / migration
  - 固化 compile smoke 与正式交付边界
  - 验证：startup/recovery 相关测试 + compile smoke

- [ ] 4. 执行 Package 3：Transparency / Admin Deepening
  - 推进 run-level 回放与统一运行事实源
  - 强化 Admin 跨页联动与系统诊断深度
  - 验证：ToolCall / Admin / run 事件流相关回归

- [ ] 5. 执行 Package 4：Creation / Session Endgame
  - 推进 bootstrap 后完整初始化工作流
  - 推进 reconnect / replay / reset / recovery 终态 UI
  - 持续削弱 ChatWindow 本地窗口心智
  - 验证：创建流 / 会话恢复 / typecheck / 相关 UI 回归

- [ ] 6. 执行 Package 5：Top-Level Model & Final Acceptance
  - 明确并推进 `Project / Chapter / Narrator` 三层对象模型最小闭环
  - 统一最终验收口径
  - 明确真正剩余的长期愿景项

- [ ] 7. 每个 package 完成时执行统一 done definition
  - 后端完成
  - 前端入口/反馈完成
  - 测试补齐
  - typecheck 通过
  - 相关回归测试通过
  - `git status --short` 干净
  - 文档在包结束时回写一次

- [ ] 8. 当且仅当本 Kiro spec 已完整承接旧文档有效内容时，再退役旧文档
  - 删除 06 / 07 / 08
  - 删除旧自由 plan 文件
  - 保证后续入口只剩 `.kiro/specs/<feature>/requirements.md + design.md + tasks.md`
