# NovelFork Studio

**v0.0.5** | 2026-04-19 | 最后更新 2026-05-03 | 始终使用中文回复

你是 Claude Code。配置以本文件 + `.kiro/steering/` 为准。

**项目**: NovelFork — 网文小说 AI 辅助创作工作台（TypeScript + Bun + React 19 + Hono + SQLite + AI Agents）
**开发者**: 薛小川 | GitHub `vivy1024` — ❌ 禁止虚构
**上游**: Fork 自 [InkOS](https://github.com/Narcooo/inkos)，专注中文网文创作场景

---

## 版本管理

| 规则 | 说明 |
|------|------|
| 版本号 | `v0.0.1` 起，语义化版本（主.次.修订） |
| 标记位置 | `CLAUDE.md` 标题、根/包级 `package.json`、`AGENTS.md`、`CHANGELOG.md`、Git tag、GitHub Release |
| 版本变动 | 任何版本号变动必须同步更新 release 资料：`package.json`、`packages/*/package.json`、`CLAUDE.md`、`AGENTS.md`、`CHANGELOG.md` |
| 任务验收 | 用户要求提交、验收完成或明确要求收尾时，视为授权执行：相关验证 → Git 提交 → `git push origin <branch>`；不得只停留在本地提交 |
| 提交后 | 每次功能合入后更新 `CHANGELOG.md` Unreleased 段，并随提交一起 push |
| 文档同步 | 代码、配置、流程、测试数量、构建命令、产物路径、发布状态任一变化，必须同步相关 README、`docs/`、包级 README、`CLAUDE.md`、`AGENTS.md`；文档更新本身也必须记录到 `CHANGELOG.md` Unreleased |
| 发版时 | 将 Unreleased 内容移到新版本号下；运行 typecheck/test/compile/smoke；提交 release commit；打 `git tag vX.Y.Z`；推送提交与 tag；上传 GitHub Release 产物 |
| 发布产物 | GitHub Release 是正式分发源；必须上传 `dist/novelfork-vX.Y.Z-windows-x64.exe` 与 SHA256；本地 dist 不等于已发布 |
| 禁止 | 禁止手动改版本号到未来版本；禁止虚构 changelog 条目；禁止只打本地 tag 或只本地构建就宣称 release 完成 |

---

## 仓库结构

| 目录 | 角色 | 远端 |
|------|------|------|
| `.`（根） | NovelFork 主仓库 | `vivy1024/novelfork` |
| `packages/cli/` | CLI 工具（novelfork 命令） | — |
| `packages/studio/` | Web 工作台（React 19 + Hono + Vite） | — |
| `packages/core/` | 核心写作引擎 + Agent 管线 | — |


---

## 核心功能

- **多 Agent 写作管线**: 规划 → 编排 → 写作 → 审计 → 修订
- **NovelFork Studio**: Agent-native 本地 Web 工作台，左资源栏 / 中间画布 / 右侧固定叙述者会话
- **连续性审计**: 自动检测剧情矛盾、人物设定冲突
- **文风仿写**: 基于真相文件（ground truth）的风格迁移
- **去 AI 味**: 检测并优化 AI 生成痕迹
- **题材支持**: 玄幻、仙侠、都市、科幻等

---

## 当前状态

| 指标 | 值 |
|------|----|
| Specs | `agent-native-workspace-v1` 已完成（23/23 已完成） |
| TypeScript | typecheck 通过 |
| 测试 | 160 文件 / 937 测试（Studio）+ 12 文件 / 92 测试（CLI） |
| 编译 | `pnpm --dir packages/studio compile` → `dist/novelfork.exe` / 版本化 release 产物约 117MB |
| 运行 | `./novelfork.exe` → `http://localhost:4567` |

---

## 操作流程

```
代码修改 → 运行相关测试 → Git 提交 → git push origin <branch>
```

```
验收完成 → 更新 CHANGELOG Unreleased → 同步相关文档 → 相关验证 → Git 提交 → git push origin <branch>
```

```
文档/规则变更 → 核对关联 README/docs/包 README/规则文件 → 更新 CHANGELOG Unreleased → docs:verify → Git 提交 → git push origin <branch>
```

```
正式发版 → 同步版本资料与发布文档 → typecheck/test/compile/smoke → release commit → git tag → push commit/tag → GitHub Release 上传 exe + SHA256
```

```
排障 → 先看 git 日志/相关文档/记忆 → 再看日志/实测 → 再看代码
```

```
Git 检查 → git status --short
```

提交格式：`type(scope): description`

---

## 核心行为约束

### 验证与报告
- 说"已完成"前，至少核对 `git status`、相关 diff、实测，以及必要的 git 日志/记忆上下文
- 没运行就写"未运行"；没验活就写"未验活"

### 最小改动
- 不顺手重构、补功能、加抽象、补注释
- 不为不可能的场景加错误处理
- 文档任务专注文档，代码任务专注代码

### 文档纪律
- 修改代码/配置/流程后必须同步受影响文档与 CHANGELOG；禁止只改实现不改文档口径
- 更新测试数量、构建命令、产物名称、端口、运行方式、发布状态时，必须全仓搜索旧口径并更新当前文档
- 删除或迁移 `.md` 前必须先读取、提取有效信息、整合到目标文档；禁止创建一次性“完成报告/修复说明/实施总结”类临时文档

### 错误恢复
- 先读报错 → 验证假设 → 看代码配置 → 再决定换不换方案
- 不盲目重试，也不一次失败就放弃

### 输出效率
- 先做事再解释，工具调用间文字最短
- 不复述用户说的话，不逐步叙述过程

### 敏感区
- API Key / 模型配置改动前先理解当前口径
- ❌ 密码/Token/密钥不入仓库

### 废弃代码处理纪律
- 废弃前端、废弃路由、历史 Provider 或旧兼容入口一旦阻塞编译/测试，优先删除、迁移为真实复用资产，或从构建路径中正式退役。
- ❌ 禁止为了兼容废弃代码而新增 shim、空实现、假 provider、假 routes、noop adapter，或任何只为“让旧代码继续编译”的低质量兼容层。
- 旧代码备份以 Git 历史为准；不得把旧前端源码复制到主源码树内继续被扫描、编译或误判为当前事实。
- 若旧模块仍有价值，必须按当前新工作台边界重构为真实组件/API/类型，而不是用兼容层续命。

---

## 记忆与技能纪律

### 记忆 MCP（aivectormemory）

| 时机 | 操作 |
|------|------|
| 对话开始 | `recall` 查询相关记忆 |
| 关键决策/踩坑 | `remember` 立即存储 |
| 对话结束前 | `auto_save` 保存摘要 |

❌ 禁止只在结束时才存记忆（中途崩溃会丢失）

### Skills 协作（superpowers + qiushi-skill）

| 场景 | 优先使用 |
|------|---------|
| 需求不清、优先级不明 | qiushi `/contradiction-analysis` 矛盾分析 |
| 排障前置 | qiushi `/investigation-first` 先调查 |
| 复杂任务规划 | superpowers `/write-plan` → `/execute-plan` |
| 代码审查 | superpowers `code-reviewer` agent |
| 系统化调试 | superpowers `systematic-debugging` |
| 阶段性回顾 | qiushi `/criticism-self-criticism` |
| 资源聚焦 | qiushi `/concentrate-forces` |
| 完成前验证 | superpowers `verification-before-completion` |

协作原则：
1. 用户显式要求 > 本项目 steering > skills 建议 > 默认行为
2. 简单运维不强制走完整 TDD/brainstorm 流程
3. 每次改动不强制开 worktree
4. skills 触发的洞察写入 `remember`，形成跨会话积累
5. 以后复杂任务默认采用 Kiro spec 工作流：先写 `.kiro/specs/<feature>/requirements.md` 与 `design.md`，再生成 `tasks.md`，不再使用旧的自由 implementation plan 工作流

---

## 风险分级

| 风险 | 操作示例 | 处理 |
|------|---------|------|
| 🟢 | 读文件、搜索、看 Git、跑测试 | 直接执行 |
| 🟡 | 编辑代码、创建文件、装依赖 | 执行后报告 |
| 🔴 | 删文件/分支、push、改 CI、删数据、批量迁移 | **先确认** |

---

## 严格禁止

- ❌ 虚构部署结果、环境变量、API 行为、配置
- ❌ force push 到生产分支（用 `git revert`）
- ❌ 引用上游 InkOS 已废弃的口径（以本项目代码为准）

---

## 按需加载参考

| 场景 | 文件 |
|------|------|
| 项目事实与架构 | `.kiro/steering/project-rules.md` |
| Git 工作流详细 | `.kiro/steering/git-workflow.md` |
| Agent 管线设计 | `.kiro/steering/agent-pipeline.md` |
| 写作流程规范 | `.kiro/steering/writing-workflow.md` |
| 代码规范 | `.kiro/steering/project-standards.md` |
| MCP 工具使用 | `.kiro/steering/mcp-tools-reference.md` |
| 存储层扩展与 migration | `docs/04-开发指南/存储层开发指引.md` |

| 动态状态追踪 | git 日志 / 记忆 / 运维文档 |

---

## 兄弟项目

本项目与以下两个项目属于同一开发者的关联工作台，数据和经验互通。遇到相关问题时直接去对应目录查看，不要等用户手动指路。

| 项目 | 路径 | 定位 | 与本项目的关系 |
|------|------|------|----------------|
| **Sub2API** | `D:\DESKTOP\sub2api` | 订阅转 API 网关（Go + Vue + PostgreSQL + Redis + Zeabur） | 本项目的 AI API 调用走 Sub2API 网关；API 报错时需要同步排查；网关的 Mihomo 代理为本项目提供多出口支持 |
| **文字修仙** | `D:\DESKTOP\文字修仙` | 纯单机修仙游戏（Python FastAPI + Vue 3 + Electron），目标上 Steam | 游戏的叙事系统（storyteller.py）可借鉴本项目写作流程；游戏世界观数据（YAML 灵材/配方/地点）可作为本项目修仙题材模板；Electron 桌面壳经验互通 |
| **OpenClaw** | `D:\DESKTOP\openclaw` | 本地 AI 工作台 + QQ 群聊 bot「羽书」| 小说原文 `.txt` 共享；GraphRAG 知识图谱可与本项目联动；羽书的 agent 架构设计是参考范例 |

### 何时去看兄弟项目

- **API 网关相关** → Sub2API 运行状态看 `D:\DESKTOP\sub2api/OPS_RUNTIME_STATE.md`；环境变量看 `.kiro/steering/zeabur-env-vars.md`
- **小说原文 / 修仙书设** → openclaw 根目录有 `.txt` 原文；文字修仙有分析报告：`D:\DESKTOP\文字修仙\reference\*_分析报告.md`
- **修仙世界观** → `D:\DESKTOP\文字修仙\docs\`（50+ 设计文档，LEVSS 物理体系、境界体系、势力经济）
- **Electron 桌面壳** → 文字修仙有现成实现：`D:\DESKTOP\文字修仙\electron\`（本项目终态也要做桌面端）
- **GraphRAG 小说索引** → `D:\DESKTOP\openclaw/graphrag_novels/`（已建好的小说知识图谱）
- **提示词工程模式** → 三个项目共享同一套 CLAUDE.md / AGENTS.md / .kiro/steering/ / 记忆沉淀模式
