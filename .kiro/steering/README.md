# NovelFork Steering Index

本目录保留项目级稳定事实与路由索引。

## 读取顺序

1. 先读根目录 `CLAUDE.md` 的高优先级规则。
2. 再读本文件判断任务类型。
3. 需要项目事实、完成标准、领域门禁时读 `project-profile.md`。
4. 需要具体流程提醒时调用对应 skill。

## 当前项目状态

- **功能审计**：P0-P3 全部完成（引导式生成、Agent 编排、写作工具、驾驶舱、Onboarding、Checkpoint）
- **文档**：用户指南/产品流程/架构设计已重写；学习中心 9 篇已创建
- **下一步**：端到端浏览器验证 → v0.1.0 发布

## 任务路由

| 任务类型 | 事实源 | 优先 skill | 验收重点 |
|---|---|---|---|
| 用户可见功能 | `project-profile.md` | `feature-closure-gate` | 浏览器截图 + 真实数据 |
| Kiro spec | `.kiro/specs/<feature>/` | `kiro-spec-adapter` | requirements/design/tasks 一致 |
| Agent / 写作管线 | `project-profile.md` Agent 管线 | `feature-closure-gate` | 候选稿/确认门/状态一致 |
| Bug / 测试失败 | 相关代码和测试 | `systematic-debugging` | 根因、复现、最小修复 |
| 文档 / 规则 | `project-profile.md` 文档纪律 | `using-project-steering` | 同步文档 + CHANGELOG |
| Git / 发布 | `project-profile.md` 发布规则 | `verification-before-completion` | compile/smoke/tag/release |

## Steering 裁剪规则

**保留在 steering/profile 中：**
- 稳定项目事实、产品定位、技术栈、架构边界
- 完成标准、禁区、发布规则
- 已实现功能清单

**迁移到 skills 中：**
- 重复执行流程、完成门禁、检查清单

**删除：**
- 已被 `CLAUDE.md` 覆盖的重复段落
- 历史一次性状态和已过期口径
