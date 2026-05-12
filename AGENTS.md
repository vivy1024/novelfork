# NovelFork Agent Rules

本仓库的主规则源是 `CLAUDE.md`、`.kiro/steering/README.md` 与 `.kiro/steering/project-profile.md`。

---

## 版本与发布

- **当前目标版本**: v0.2.0
- **版本管理**: `CLAUDE.md` 标题 → 根/包级 `package.json` → `AGENTS.md` → `CHANGELOG.md` → release commit → `git tag` → GitHub Release
- **版本变动**: 任何版本号变动必须同步更新 release 资料
- **任务验收**: 用户要求提交、验收完成或明确要求收尾时，视为授权执行验证、Git 提交与 push
- **每次功能合入**: 在 `CHANGELOG.md` 的 `## Unreleased` 段下记录
- **文档同步**: 代码变化必须同步相关文档和 CHANGELOG
- **正式发版**: typecheck/test/compile/smoke → release commit → tag → push → GitHub Release 上传 exe + SHA256

## 当前前端边界

- `packages/studio/src/app-next/**` 是 Studio 当前前端入口
- 不再恢复旧 routes / 旧 provider / 旧 shell
- 所有按钮、资源节点和写作动作必须来自 `backend-contract/` 的真实合同

## 已实现的核心功能

| 层面 | 功能 |
|------|------|
| 写作工作台 | 三栏布局、资源树、章节 CRUD、驾驶舱、经纬编辑、候选稿管理、写作工具面板、Checkpoint |
| AI 写作 | 写作模式（6种）、AI 动作（6种）、选区变换、行内续写、智能大纲 |
| 引导式生成 | PGI 追问（UserQuestionGate）、Guided Plan 批准、Tier 1 问卷 |
| 叙述者对话 | Context Ring、模型切换、权限、Slash 命令、确认门、文件追踪、压缩 |
| Agent 管线 | PipelineRunner、5 种角色、workflow-executor、WorkflowProgressCard |
| 设置与套路 | 供应商配置、套路 7 Tab、继承机制 |
| Onboarding | 首次欢迎弹窗、空态引导、学习中心（9 篇 + /next/learn） |

## Spec 驱动开发

- 新功能先写 spec（`requirements.md` → `design.md` → `tasks.md`）
- 归档目录：`.kiro/specs/archive/`（37 个已完成 spec）
- 活跃 spec：`.kiro/specs/functionality-audit/`（P0-P3 全部完成）
- 功能缺口清单：`.kiro/specs/functionality-audit/gaps-from-archived-specs.md`

## AI 输出原则

- AI 结果只进候选区/草稿区，用户确认后才影响正式正文
- 不恢复 mock/fake/noop 假成功
- 未接入能力标记 unsupported，不伪造
- 数据来源必须标注 source

## 文档纪律

- 修改代码/配置/流程后必须同步受影响文档与 CHANGELOG
- 删除或迁移 `.md` 前必须先读取、提取有效信息、整合到目标文档

## 构建与测试

```bash
pnpm --dir packages/studio typecheck        # 类型检查
pnpm --dir packages/studio exec vitest run   # 全量测试
pnpm --dir packages/studio compile           # 单文件编译
bun run docs:verify                          # 文档验证
```

## 废弃代码处理

- 废弃代码阻塞编译/测试时，优先删除或迁移
- 禁止新增 shim/noop/fake adapter
- 旧代码备份以 Git 历史为准

## 禁止事项

- 禁止虚构部署结果、环境变量、API 行为
- 禁止引用上游 InkOS 已废弃口径
- 禁止把 planned/unsupported 能力写成 current
- 禁止只用局部测试声明完整功能完成
