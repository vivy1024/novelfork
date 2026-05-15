# NovelFork Studio

**v0.6.0** | 2026-04-19 | 最后更新 2026-05-15 | 始终使用中文回复

你是 Claude Code。配置以本文件 + `.kiro/steering/README.md` + `.kiro/steering/project-profile.md` 为准。

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
| `packages/studio/` | 通用 Agent 工作台（React 19 + Hono + Vite） | — |
| `packages/core/` | 通用基础设施（storage/llm/state/hooks/mcp/runtime） | — |
| `packages/novel-plugin/` | 小说领域插件（engine/routes/handlers/pages） | — |
| `packages/fitness-plugin/` | 健身领域插件骨架（证明可扩展性） | — |


---

## 核心功能

- **多 Agent 写作管线**: 规划 → 编排 → 写作 → 审计 → 修订（WorkflowProgressCard 可见执行链）
- **NovelFork Studio**: Agent-native 本地 Web 工作台，左资源栏 / 中间画布 / 右侧固定叙述者会话
- **新书引导向导**: NewBookGuide 11 题三模式（预设选择/自定义/跳过随机），自动生成初始真相文件
- **写作预设面板**: 流派/文风/基底/逻辑规则预设管理（PresetsPanel）
- **AI 味检测**: 12 规则本地检测 + 朱雀 API（AiTasteReport）
- **章节健康度**: 节奏/对话/句长直方图（ChapterHealthCard + BookHealthSummary）
- **选段写作**: 续写/扩写/补写 + 多版本变体（InlineWritePanel + VariantsPanel）
- **日更进度追踪**: 日更进度 + 节拍表（DailyProgressCard + BeatProgressBar）
- **平台合规检查**: 敏感词扫描 + 导出 TXT/Word/ePub（CompliancePanel + ExportPanel）
- **角色弧线与文风漂移**: 角色弧线追踪 + 文风漂移检测（CharacterArcsPanel + StyleDriftPanel）
- **模板市场**: 写作模板浏览与应用（TemplateMarketPanel）
- **连续性审计**: 自动检测剧情矛盾、人物设定冲突
- **文风仿写**: 基于真相文件（ground truth）的风格迁移
- **引导式生成**: PGI 生成前追问 + Guided Plan 计划批准 + UserQuestionGate
- **Checkpoint/Rewind**: 资源快照与回滚（CheckpointPanel）
- **题材支持**: 玄幻、仙侠、都市、科幻等

---

## 当前状态

| 指标 | 值 |
|------|----|
| Specs | `agent-runtime-robustness` Phase 1-6 全部完成；`ui-visibility-gaps` Phase 1-5 全部完成 |
| TypeScript | typecheck 通过 |
| 功能 | 新书引导向导、写作预设面板、AI 味检测、章节健康度、选段写作+变体、日更进度+节拍表、平台合规+导出、角色弧线+文风漂移+模板市场、引导式生成（PGI+Guided Plan）、Agent 编排可见链、写作工具面板、驾驶舱增强、Checkpoint/Rewind、学习中心、Onboarding 全部已接入新前端 |
| 文档 | 用户指南/产品流程/架构设计已重写；学习中心 9 篇；根 README 已重写 |
| 编译 | `dist/novelfork-v0.4.0-windows-x64.exe`；GitHub Release 已发布 |
| 下一步 | 内测分发 + 反馈收集 |

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

### ⚠️ 前端任务强制浏览器验证（绝对禁令）

**历史教训：163 个 UI 提交、43 次审计发现问题、38 个 spec 声称完成——打开软件全是假的。根因是用 typecheck/Vitest 冒充"功能完成"，从不打开浏览器看。**

以下规则无例外、无借口、不可跳过：

1. **任何前端改动，必须在提交前用 Browser 工具截图验证真实渲染结果。** typecheck 通过 ≠ 完成。Vitest 通过 ≠ 完成。只有浏览器截图中看到预期 UI 才算完成。

2. **发现问题必须当场修完，不得写入"下一轮修复"。** 禁止创建新 spec/新任务来记录未修复的问题。发现了就修，修完再截图，截图通过才能提交。

3. **禁止用以下方式冒充完成：**
   - ❌ "typecheck 通过" 代替浏览器验证
   - ❌ "组件测试通过" 代替真实渲染
   - ❌ "类型定义已写" 代替功能实现
   - ❌ "适配器已写" 代替端到端接通
   - ❌ "API route 已有" 代替前端调用并显示
   - ❌ 把问题记录到文档/spec/CHANGELOG 然后标完成
   - ❌ 创建新 spec 来"跟踪"未修复的问题

4. **mock/占位/假数据零容忍。** 用户打开软件看到的每一个文字、每一个数字、每一个状态都必须来自真实数据源。如果数据源不可用，显示明确的"未配置"或"不可用"，不显示假数据。

5. **编译产物验证。** 前端改动完成后必须 `vite build` + 启动 exe/服务器 + Browser 截图。开发模式验证不算数，必须验证编译后的产物。

违反以上任何一条，该任务视为未完成，必须回退重做。

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

### ⚠️ Spec/Plan/Todo 执行纪律（绝对禁令）

**历史教训：spec 写得清清楚楚，执行时跳过验证步骤就标 `[x]`，导致 38 个 spec 全部"完成"但软件不能用。**

以下规则无例外：

1. **标记 `[x]` 之前，必须完成该任务的"验证"步骤。** 如果验证步骤写"浏览器截图"，就必须截图。如果写"API 返回正确数据"，就必须 curl 验证。跳过验证步骤标完成 = 欺骗。

2. **一个任务没完成，不得开始下一个任务。** 禁止"先把所有任务代码写完再统一验证"。必须逐个完成、逐个验证、逐个标记。

3. **发现任务无法完成时，立即停下来说明原因。** 不得用"部分完成"、"底层已就绪"、"待下一轮"等话术绕过。要么完成，要么明确说"这个任务我做不到，原因是 X"。

4. **禁止用新 spec/新任务来替代修复当前问题。** 发现问题就修，不是记录问题然后开新 spec。只有真正的新功能才需要新 spec。

5. **每个 spec 执行前，先用 Browser 工具截图当前状态作为基线。** 执行后再截图对比。如果看不出区别，说明没有真正改变用户体验。

6. **禁止批量标记完成。** 不得一次性把 5 个、10 个任务标为 `[x]`。每标一个，必须有对应的验证证据（截图/curl 输出/实际运行结果）。

### ⚠️ GStack 执行流程（强制）

**来源：GStack 工作流。解决的问题：同一个上下文里做完所有事导致偏离计划、跳过验证、自欺欺人。**

执行 spec/plan 时必须使用以下流程：

#### 1. 使用 subagent 执行

每个任务派一个新的 subagent 执行（Agent 工具），不在主上下文里写实现代码。主上下文只负责：
- 读取计划
- 为 subagent 准备上下文（任务描述 + 相关文件路径 + 验证标准）
- 派发 subagent
- 审查 subagent 结果（`gstack-review` 标准）
- 标记完成或要求修复

#### 2. 审查（每个任务完成后）

```
Implementer subagent 完成 → gstack-review 审查 → 标记完成
                                    ↓ 不通过
                              修复后重新审查
```

#### 3. verification-before-completion（铁律）

```
声称完成前：
1. 确定：什么命令/操作能证明这个声明？
2. 执行：运行完整命令（新鲜的，不是之前的结果）
3. 阅读：完整输出，检查退出码，计数失败
4. 验证：输出是否确认了声明？
   - 否 → 报告实际状态
   - 是 → 带证据声明完成
5. 只有到这一步才能说"完成"

跳过任何步骤 = 撒谎
```

#### 4. 何时停下来

**立即停止执行：**
- 遇到阻塞（缺依赖、测试失败、指令不清）
- 计划有关键缺口
- 不理解某个指令
- 验证反复失败

**停下来问，不要猜。**

### 输出效率
- 先做事再解释，工具调用间文字最短
- 不复述用户说的话，不逐步叙述过程

### 敏感区
- API Key / 模型配置改动前先理解当前口径
- ❌ 密码/Token/密钥不入仓库

### 废弃代码处理纪律
- 废弃前端、废弃路由、历史 Provider 或旧兼容入口一旦阻塞编译/测试，优先删除、迁移为真实复用资产，或从构建路径中正式退役。
- ❌ 禁止为了兼容废弃代码而新增 shim、空实现、假 provider、假 routes、noop adapter，或任何只为"让旧代码继续编译"的低质量兼容层。
- 旧代码备份以 Git 历史为准；不得把旧前端源码复制到主源码树内继续被扫描、编译或误判为当前事实。
- 若旧模块仍有价值，必须按当前新工作台边界重构为真实组件/API/类型，而不是用兼容层续命。

### ⚠️ 插件化边界（绝对禁令）

**小说写作功能的代码必须且只能存在于 `packages/novel-plugin/` 中。**

| 层 | 位置 | 允许的内容 |
|---|------|-----------|
| 引擎 | `novel-plugin/src/engine/` | pipeline、agents、jingwei、filter、presets、compliance、tools、bible |
| 路由 | `novel-plugin/src/routes/` | 小说领域 API 路由（ai、jingwei、writing-modes、pipeline、filter、compliance、bible、writing-tools、context-manager） |
| 服务 | `novel-plugin/src/handlers/` | cockpit、candidate、pgi、guided-generation、questionnaire、narrative-line、novel-init、novel-audit、writing-mode |
| 前端 | `novel-plugin/src/pages/` | writing-workbench 全部组件 |
| 声明 | `novel-plugin/src/index.ts` | manifest、工具定义、预设列表 |

**以下操作严格禁止**：
- ❌ 在 `packages/core/src/` 中新增小说领域代码（pipeline/agents/jingwei/filter/presets/compliance/tools/bible）
- ❌ 在 `packages/studio/src/api/routes/` 中新增小说路由文件
- ❌ 在 `packages/studio/src/api/lib/` 中新增小说服务文件
- ❌ 在 `packages/studio/src/app-next/` 中新增小说 UI 组件
- ❌ 在 `packages/core/` 或 `packages/studio/` 中直接 import novel-plugin 的内部模块（只能通过 package.json exports 的公开路径）

**允许的跨包引用**：
- `novel-plugin` → `@vivy1024/novelfork-core`（storage/llm/types/utils）✅
- `studio` → `@vivy1024/novelfork-novel-plugin`（通过 exports 公开路径）✅
- `studio` → `@vivy1024/novelfork-novel-plugin/routes` / `/handlers` / `/pages/writing-workbench` ✅
- `core` → `novel-plugin` ❌ 禁止（单向依赖）

**新增小说功能时**：
1. 引擎逻辑 → `novel-plugin/src/engine/` 对应子目录
2. API 路由 → `novel-plugin/src/routes/`
3. 工具 handler → `novel-plugin/src/handlers/`
4. 前端组件 → `novel-plugin/src/pages/writing-workbench/`
5. 工具定义 → `novel-plugin/src/tool-schemas.ts` + `index.ts`

**通用功能（非小说领域）**：仍然放在 `core/` 或 `studio/` 中。判断标准：如果拔掉 novel-plugin 后该功能仍然有意义，它就是通用功能。

---

## 跨会话记忆（必须遵守）

记忆文件位于 `.narrafork/memory/`。

**会话开始时**：
1. 读取 `.narrafork/memory/context.md` 恢复上下文
2. 简要告诉用户"上次你在做 X，还剩 Y，要继续吗？"

**会话过程中**：
- 重要决策 → 追加到 `.narrafork/memory/decisions.jsonl`
- 踩坑/模式/下次能省时间的知识 → 追加到 `.narrafork/memory/learnings.jsonl`

**会话结束前**（用户说"收工"/"保存"/"下次继续"或长会话即将结束时）：
- 覆盖写 `.narrafork/memory/context.md`（当前任务、分支、决策、下一步、阻塞）

**格式**：
- `context.md`：Markdown，覆盖写
- `learnings.jsonl`：每行一条 JSON `{"ts":"...","content":"...","tags":[...]}`，追加写
- `decisions.jsonl`：每行一条 JSON `{"ts":"...","decision":"...","reason":"...","reversible":true/false}`，追加写

**规则**：
- 不要把琐碎的东西写进 learnings（"用户说了句话"不算）
- learning 标准：下次遇到同样情况能少走弯路
- decision 标准：影响架构/方向/技术选型的选择

---

## Skill 路由（GStack + Superpowers + 求是）

### 产品与规划

| 场景 | 调用 |
|------|------|
| 新功能/产品想法 | `/office-hours` |
| 方向/优先级审视 | `/plan-ceo-review` |
| 架构审查 | `/plan-eng-review` |
| 设计审查（计划阶段） | `/plan-design-review` |
| DX 审查 | `/plan-devex-review` |
| 全流程自动审查 | `/autoplan` |

### 实现与验证

| 场景 | 调用 |
|------|------|
| Bug/错误/异常 | `/investigate` |
| 前端 QA 测试+修复 | `/qa` |
| 前端 QA 仅报告 | `/qa-only` |
| 视觉设计审查（已实现） | `/design-review` |
| 代码审查 | `/review` |
| 代码健康度 | `/health` |
| 性能基准 | `/benchmark` |

### 发布与运维

| 场景 | 调用 |
|------|------|
| 发布/PR | `/ship` |
| 合并+部署+验证 | `/land-and-deploy` |
| 部署后监控 | `/canary` |
| 安全审计 | `/cso` |
| 文档更新 | `/document-release` |

### 上下文与复盘

| 场景 | 调用 |
|------|------|
| 保存进度 | `/context-save` |
| 恢复上下文 | `/context-restore` |
| 周复盘 | `/retro` |
| 学习管理 | `/learn` |

### 决策（求是体系）

| 场景 | 调用 |
|------|------|
| 需求不清/优先级冲突 | `contradiction-analysis` |
| 信息不足 | `investigation-first` |
| 资源有限选方向 | `concentrate-forces` |
| 假设→验证→迭代 | `practice-cognition` |
| 用户可见功能完成门禁 | `feature-closure-gate` |

### Spec 任务执行流程

**三套 skills 协作**：Superpowers 管执行框架，GStack 管验证/发布/运维，求是管决策。

1. **规划**：`/office-hours` 探索需求 → `writing-plans` 生成 tasks.md → `/plan-eng-review` 审查架构
2. **执行**：`executing-plans` 或 `subagent-driven-development` 逐任务实现（Kiro spec 三件套驱动）
3. **审查**：每个任务/Batch 完成后**必须**调用 `/review` 审查 diff，不得跳过
4. **验证**：`verification-before-completion` 铁律 + 前端用 `/qa`；后端用 typecheck + curl
5. **发布**：`finishing-a-development-branch` → `/ship` 创建 PR

**Spec 执行优先用 Superpowers skills**：
- 有完整三件套（requirements + design + tasks）→ 调用 `executing-plans`
- 任务独立可并行 → 调用 `subagent-driven-development`
- 需要写 tasks.md → 调用 `writing-plans`
- 需要适配 Kiro spec 格式 → 调用 `kiro-spec-adapter`

**GStack 在执行过程中的角色**：
- 每个 Batch 完成后 → `/review`（跨模型对抗审查）
- 前端改动 → `/qa`（浏览器验证）
- 声称完成前 → `verification-before-completion`（铁律）+ `/review`
- 准备发版 → `/ship`

**规划体系**：Kiro spec（`.kiro/specs/{feature}/requirements.md` + `design.md` + `tasks.md`）

协作原则：
1. 用户显式要求 > 本项目 steering > skills 建议 > 默认行为
2. 新功能必须先过 `/office-hours`，不准直接开写
3. 复杂任务采用 Kiro spec 工作流（`executing-plans` 驱动）
4. 简单运维不强制走完整流程
5. **自然语言触发**：当用户的话匹配 skill 触发场景时，主动调用对应 skill，不需要用户说 `/命令`。例如用户说"这个 bug 怎么回事"→ 调用 `/investigate`；说"发版吧"→ 调用 `/ship`；说"看看质量"→ 调用 `/health`

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

| 场景 | 文件 / Skill |
|------|------|
| 任务路由与 steering 裁剪 | `.kiro/steering/README.md` |
| 项目事实、完成标准、已实现功能清单 | `.kiro/steering/project-profile.md` |
| 用户可见功能完成门禁 | `feature-closure-gate` |
| Spec 任务索引与规划 | `.kiro/specs/README.md` |
| 学习中心内容 | `docs/learning/` |
| 存储层扩展与 migration | `docs/05-开发者指南/02-存储层开发指引.md` |
| 动态状态追踪 | git 日志 / 记忆 / 运维文档 |
| 小说写作调研与产品决策 | `docs/90-参考资料/小说写作与AI调研/01-小说写作与AI调研.md` |
| NarraFork UI/UX 参考 | `docs/90-参考资料/NarraFork参考/03-NarraFork-UIUX与交互功能调研.md` |
| Claude Code 实现参考 | `docs/90-参考资料/Claude-Code参考/` |
| 系统架构总览 | `docs/04-架构与设计/01-系统架构总览.md` |
| Agent 写作管线 | `docs/04-架构与设计/03-Agent写作管线.md` |
| 小说创作流程 | `docs/03-产品与流程/01-小说创作流程.md` |
| AI 味过滤器开发 | `docs/05-开发者指南/04-AI味过滤器开发指引.md` |

---

## NarraFork 学习参考

需要学习 NarraFork 的 UI/交互/渲染时，用 Browser 工具打开：

| 字段 | 值 |
|------|---|
| URL | `http://localhost:7778` |
| 用户名 | `vivy1024` |
| 密码 | `Xxxc1765563156.` |

参考文档位于 `.narrafork-reference/`：
- `CONVERSATION-INTERNALS.md` — WebSocket 事件、流式渲染、工具状态机
- `PROVIDER-AND-NARRATOR-MANAGEMENT.md` — 供应商、权限、叙述者创建
- `UI-COMPONENTS.md` — DOM 结构、状态栏、工具调用块
- `PROVIDERS.md` — 5 类供应商、API 模式

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
