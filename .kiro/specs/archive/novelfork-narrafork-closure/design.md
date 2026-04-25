# Design Document

## Overview

本设计把 06/07/08 的剩余任务重组为一份真正可执行的 closure spec。它不是关于 workflow 迁移的元规范，而是关于**还剩哪些任务、这些任务应如何分包、每包做到什么算完成**的执行设计。

这份设计以 07 的剩余项为主事实，以 08 的主线包与 done definition 为执行组织方式，并只吸收 06 中仍然有效的 UI/入口尾项。

## Goals

- 明确 06/07/08 当前仍未完成的真实任务
- 把这些任务压缩成少数几个主线包
- 为后续按包推进提供唯一 spec 入口
- 保留最终未完成长期愿景项的边界

## Non-Goals

- 不重新实现已完成主链
- 不把所有历史 backlog 原样搬进 Kiro spec
- 不用 workflow 迁移本身替代剩余任务本体
- 不提前宣布 closure 已完成

## Source Consolidation

### 来自 07 的核心剩余项
07 提供当前最可靠的剩余任务来源，主要包括：
- A：继续削弱 UI 对本地窗口字段的依赖
- B：初始化工作流与产品化反馈终态
- C：更纯的 server-first 会话终态
- D：run-level 回放与统一事实源终态
- E：Workflow / MCP / 权限 / 执行器的单一治理心智
- F：更强的跨页联动与系统诊断深度
- G：更多执行入口、日志与观测行为统一到同一运行控制解释模型
- H：单文件分发正式闭环、安装器/签名/自动更新/首启 UX、更完整 repair/migration
- 顶层：`Project / Chapter / Narrator` 三层对象模型完整

### 来自 08 的执行组织方式
08 的核心有效内容不是“某些具体实现细节”，而是：
- 剩余任务应按 **主线包 / Wave** 推进
- 每包必须完整闭环
- 每包有明确验证与提交粒度
- 推荐顺序：
  1. 执行链收口
  2. 运行时交付
  3. 透明化 + Admin 实时化
  4. 创建 / 会话体验终态

### 来自 06 的仍有效尾项
06 中大量内容已经被后续实现吸收，但仍保留少量有效尾项：
- 危险操作按钮 / 确认交互风格统一
- 个别入口顺序与显示规则仍偏硬编码
- 少量对象管理/入口体验的收口尾项

## Package Model

### Package 1: Execution / Governance Closure
覆盖：07 的 E/G 剩余项，以及 A 中与本地事实源残留相关的部分。

**目标：**
让 Settings、Workflow、MCP、Tools、Permissions 进一步统一为单一治理心智，并让执行解释口径一致。

**完成条件：**
- 配置真实影响执行行为
- Governance 解释口径一致
- WorkflowWorkbench 更接近执行链真实投影

### Package 2: Runtime / Delivery Closure
覆盖：07 的 H 剩余项。

**目标：**
让 startup recovery、repair/migration、embedded/filesystem、compile smoke 与交付边界形成正式闭环。

**完成条件：**
- 启动恢复链可验证
- compile smoke 稳定
- 正式交付边界清晰

### Package 3: Transparency / Admin Deepening
覆盖：07 的 D/F 剩余项。

**目标：**
让 ToolCall / 执行链 / Admin 围绕统一运行事实源工作。

**完成条件：**
- run-level 回放增强
- Admin 实时联动增强
- 前台执行链与后台运维视图可对照

### Package 4: Creation / Session Endgame
覆盖：07 的 B/C 剩余项，并吸收 08 Wave 4。

**目标：**
补齐项目初始化工作流、默认工作状态进入、会话恢复可见反馈、server-first 终态。

**完成条件：**
- 初始化体验更完整
- reconnect/replay/reset/recovery 终态 UI 明确
- ChatWindow 更接近纯服务端事实源

### Package 5: Top-Level Model & Final Acceptance
覆盖：07 最终未完成项与 08 done definition。

**目标：**
明确 closure 完成后的剩余长期愿景边界，并推进顶层对象模型最小闭环。

**完成条件：**
- 三层对象模型最小闭环范围被明确并推进
- 最终验收口径写清
- 剩余长期愿景项被明确标出

## Execution Order

推荐顺序保持与 08 一致：
1. Package 1: Execution / Governance Closure
2. Package 2: Runtime / Delivery Closure
3. Package 3: Transparency / Admin Deepening
4. Package 4: Creation / Session Endgame
5. Package 5: Top-Level Model & Final Acceptance

原因：
- Package 1/2 会决定平台是否真正从“能用”变成“可解释、可交付”
- Package 3/4 更偏完成度，但不应早于 1/2
- Package 5 必须建立在前四包稳定后再推进

## Verification Model

每个包结束时至少满足：
- 相关后端逻辑完成
- 相关前端入口/反馈完成
- 相关测试补齐
- `pnpm --filter @vivy1024/novelfork-studio typecheck` 通过
- 相关回归测试通过
- `git status --short` 干净
- 文档只在该包结束时回写一次

## Risks and Mitigations

### Risk 1: 把 closure spec 再次写成抽象 workflow 文档
**Mitigation:** 每个 package 都必须对齐 07 的具体剩余项与 08 的 done definition。

### Risk 2: 重新引入已完成事项
**Mitigation:** 只从 06 吸收仍有效的尾项，不把历史 backlog 全搬回来。

### Risk 3: 过早删除旧文档导致信息丢失
**Mitigation:** 只有当本 Kiro spec 已明确覆盖剩余任务、顺序和 done definition 后，旧文档才允许退役。

## Success Criteria

这份设计成功的标志是：
- 它能直接回答“06/07/08 还剩什么任务”
- 它给出了明确的主线包与顺序
- 它给出了每包完成标准
- 它没有被 workflow 迁移说明稀释掉任务本体
