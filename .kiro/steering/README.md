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
| 用户可见功能 | `project-profile.md` | `/qa` + 浏览器截图 | 真实数据 + 编译产物验证 |
| Kiro spec 执行 | `.kiro/specs/<feature>/tasks.md` | subagent 逐任务 + `/review` | 逐项验证，不批量标完成 |
| 新功能规划 | `.kiro/specs/<feature>/` | `/office-hours` → 手写 spec | requirements/design/tasks 一致 |
| Agent / 写作管线 | `project-profile.md` Agent 管线 | `/plan-eng-review` | 候选稿/确认门/状态一致 |
| Bug / 测试失败 | 相关代码和测试 | `/investigate` | 根因、复现、最小修复 |
| 文档 / 规则 | `project-profile.md` 文档纪律 | `/document-release` | 同步文档 + CHANGELOG |
| Git / 发布 | `project-profile.md` 发布规则 | `/ship` | compile/smoke/tag/release |
| 前端视觉问题 | 浏览器截图 | `/design-review` 或 `/qa` | before/after 截图对比 |
| 代码质量 | 相关代码 | `/health` | typecheck + lint + test 通过 |

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
