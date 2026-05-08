# NovelFork Steering Index

本目录只保留项目级稳定事实与路由索引；可执行流程、完成门禁和重复提醒已迁移到 skills/profile 层，避免 steering 变成冗长规则堆。

## 读取顺序

1. 先读根目录 `CLAUDE.md` / `AGENTS.md` 的高优先级规则。
2. 再读本文件判断任务类型。
3. 需要项目事实、完成标准、领域门禁时读 `.kiro/steering/project-profile.md`。
4. 需要具体流程提醒时调用对应 skill，而不是继续扩写 steering。

## 任务路由

| 任务类型 | 事实源 | 必用/优先 skill | 验收重点 |
|---|---|---|---|
| 用户可见功能 | `project-profile.md` 的产品目标、任务分类、完成标准 | `using-project-steering`、`applying-project-profile`、`feature-closure-gate` | `/next`、CLI/headless、真实数据或资源回读等端到端证据 |
| Kiro spec | `.kiro/specs/<feature>/requirements.md`、`design.md`、`tasks.md` | `kiro-spec-adapter`、`writing-plans`、`executing-plans` | requirements/design/tasks 三者一致，FEATURE/ENABLER/GUARD/DOCS/RELEASE 分类清楚 |
| Agent / 小说管线 | `project-profile.md` 的 Agent 管线与写作工作流 | `feature-closure-gate`，必要时 `systematic-debugging` | Truth files、候选稿/草稿、非破坏确认、章节状态一致 |
| Bug / 测试失败 | 相关代码、测试、当前 spec、`project-profile.md` 安全规则 | `systematic-debugging`、`verification-before-completion` | 根因、复现、最小修复、回归验证 |
| 文档 / 规则 / prompt / skill | `project-profile.md` 的文档纪律与 Superpowers 分层 | `using-project-steering`、`applying-project-profile`、`writing-skills` | 同步受影响文档与 CHANGELOG；通用规则进 adapter，项目事实进 profile |
| Git / 发布 | `project-profile.md` 的 Git 与发布规则 | `verification-before-completion`、必要时 `finishing-a-development-branch` | git status、diff、验证命令、release 产物与 GitHub Release 证据 |
| MCP / 外部工具 | `project-profile.md` 的 MCP 边界 | `using-project-steering` | 区分项目内 MCP client 与 IDE/MCP 工具，不把开发配置混入项目配置 |

## Steering 裁剪规则

保留在 steering/profile 中：
- 稳定项目事实
- 产品定位、技术栈、架构边界
- 完成标准、禁区、发布规则
- 领域工作流的事实源

迁移到 skills 中：
- 重复执行流程
- 完成门禁
- 检查清单
- 路由逻辑
- 通用方法论

删除：
- 已被 `CLAUDE.md` / `AGENTS.md` 覆盖的重复段落
- 已被 skills/profile 承接的旧流程说明
- 历史一次性状态和已过期口径
- 可以由测试/脚本强制的纯机械规则
