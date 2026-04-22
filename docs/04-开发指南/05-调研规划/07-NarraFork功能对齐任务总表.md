# NovelFork → NarraFork 对齐总计划（唯一主文档）

> **目的**：把 NovelFork 从“有很多页面的工作台”推进成 **NarraFork 式本地单体 AI 写作平台**。  
> 这份文档已经吸收原 `06-Studio-UIUX改造清单.md` 与旧版 `07-NarraFork功能对齐任务总表.md` 的有效内容，后续只维护这一份。

**版本**: v2.3.0  
**创建日期**: 2026-04-20  
**更新日期**: 2026-04-22  
**状态**: 🔄 执行中（A/B/C 主链已完成并提交；D/E/F/G 第二轮主线已完成并验证；H 已完成 startup/compile smoke 第一轮闭环，整体进入终态与正式交付深化阶段）

---

## 1. 总目标

NovelFork 对齐 NarraFork，不是把界面“做得像 NarraFork”，而是逐步建立下面这套能力：

- **Project / Chapter / Narrator** 三层对象模型
- **Session / Narrator** 作为正式对象，而不是前端临时聊天窗口
- **Workflow / Routines / Tools / MCP / Permissions** 的统一编排层
- **Admin / Settings** 作为真实可用的运维与运行控制中心
- **本地单体运行时**：启动恢复、索引修复、资产内嵌、单入口、最终单文件分发

一句话：

> **把 NovelFork 从“页面集合”推进成“对象清晰、配置统一、会话内核稳定、运行时可恢复、平台能力完整”的本地 AI 写作平台。**

---

## 2. 非目标

当前不做这些事：

- 不机械照抄 NarraFork 的 Mantine 风格
- 不为了“像 NarraFork”而强行把章节系统改成图编辑器
- 不继续围绕旧 PWA / 多入口外壳堆功能
- 不把“补几个页面”误当作平台对齐完成

---

## 3. 当前源码实态：已经完成什么

> 以下判断以当前代码事实为准，包含近期已完成但尚在工作区中的收尾改动。
>
> 说明：`[x]` 表示已完成，`[~]` 表示半完成 / 仍有缺口，`[ ]` 表示未完成。

### 3.1 UI / 信息架构收口（已基本完成）

已完成：
- [x] `PageScaffold` / `PageEmptyState` 统一页面骨架
- [x] 侧边栏收敛为“主入口 + 工作台 + 系统台”三层结构
- [x] `WorkflowWorkbench` 成为统一工作流配置入口
- [x] `SessionCenter` 成为正式会话入口
- [x] `Admin` / `SettingsView` 已形成主平台页结构

仍保留的小尾项：
- [ ] 少量危险操作按钮 / 确认交互风格还未彻底统一
- [ ] 个别入口顺序与显示规则仍偏代码硬编码

### 3.2 Session / Narrator 内核化（A/B/C 主链已完成，进入深化阶段）

已完成：
- [x] `session-types.ts` / `session-service.ts` 建立正式 session 数据结构
- [x] `/api/sessions` 已改为磁盘持久化，不再只是进程内 Map
- [x] `useSession.ts` 已切到服务端 session API
- [x] `windowStore.ts` 已收口为窗口壳层，并通过 `sessionId` 与正式 session 关联
- [x] `SessionCenter` 支持会话创建、归档、恢复、筛选、排序
- [x] 支持 `standalone / chapter` 分类与 `chat / plan` 模式
- [x] 已建立 per-session chat / ws 最小可用协议
- [x] `ChatWindow` 已优先消费服务端 snapshot / state / message
- [x] `ChatWindow` 在 websocket reconnect 后会重新 hydration history / state
- [x] `SessionCenter` 打开已有 session 时，正式 session 流程已贯通到工作区
- [x] recent session history 已持久化，并能在恢复流程中继续推进
- [x] 已补完整聊天历史存储、`sinceSeq` 增量回补、`resumeFromSeq` 重连恢复与 `resetRequired` 全量回退闭环
- [x] `NewSessionDialog` 保留并补回“当前对象”概览区
- [x] `ChatWindow` 渲染主链已改成服务端消息视图优先，本地旧消息不会继续压过正式 snapshot
- [x] 最近消息已能服务端持久化，并在 runtime reload 后恢复
- [x] 从 `SessionCenter` 打开已有会话时，已直接带入 snapshot 最近消息

后续深化项：
- [ ] 继续削弱 `ChatWindow` 对本地窗口对象字段的读取，进一步逼近纯服务端事实源
- [ ] 把会话状态、恢复策略与错误态进一步统一成单一 server-first 心智
- [ ] 在 UI 层补更明确的 reconnect / replay / reset 反馈，而不只是协议层闭环

### 3.3 AI 透明化（第二轮主线已完成，进入终态深化）

已完成：
- [x] `ChatWindow` 已有上下文占用 / token 预算 / 模型 / 权限 / 推理强度可视化
- [x] `ContextPanel` 已支持会话上下文与来源分层
- [x] `ToolCallBlock` 已支持状态、耗时、错误、复制、展开/折叠
- [x] `ToolCallBlock` 已统一动作区
- [x] `ToolCallBlock` 已支持查看原始载荷，并把结果细节收口到统一入口
- [x] 已支持工具类型差异化展示
- [x] 子代理卡片已进入统一工具块视图
- [x] breadcrumb / 最近执行链 / 会话路径信息已进入主会话页
- [x] `ToolCallBlock` 已支持全屏查看 / 重跑 / 查看源码 / 打开定位
- [x] 最近执行链已从摘要升级为链级展开，并可复用 `ToolCallBlock`
- [x] replay 结果已回灌当前会话消息流，并写回正式 session 持久化链路
- [x] `source-preview` / `open-in-editor` 已形成最小可用后端能力

后续深化项：
- [ ] 继续把 ToolCall / ChatWindow 推向更完整的 run-level 回放与源码定位终态
- [ ] 继续削弱局部前端状态推断，让执行链展示更贴近统一运行事实源

### 3.4 Workflow / Routines 合流（已基本完成）

已完成：
- [x] `Routines` 改为消费 `/api/routines/*`
- [x] `routines-service.ts` 成为实际持久化层
- [x] `WorkflowWorkbench` 已吸收 Prompt / Tool Permissions / Sub-agents / Hooks 等区块
- [x] `WorkflowWorkbench` 已新增统一治理总览
- [x] `WorkflowWorkbench` 已把 workflow 编排摘要、toolAccess / mcpStrategy 和 MCP registry summary 放进同一页
- [x] 已建立 global / project / merged 第一轮边界

仍未完成：
- [ ] 更彻底的“统一执行心智”，尤其是和 MCP / 权限链的进一步打通

### 3.5 Admin 平台化（第二轮主线已完成）

已完成：
- [x] `RequestsTab` 已有真实请求摘要结构
- [x] `ProvidersTab` 已消费真实 provider manager 数据
- [x] `ResourcesTab` 已接资源快照与扫描结果结构
- [x] `DaemonTab` / `LogsTab` / `WorktreesTab` 已并入 `Admin`
- [x] `Admin` 已有 Terminal / Container 最小入口
- [x] Terminal / Container 的当前状态与后续接线能力已写清
- [x] `RequestsTab` 已接全局 run 事件流，能展示实时运行总览
- [x] `ResourcesTab` / `LogsTab` / `DaemonTab` / `TerminalTab` 已具备对应真实测试覆盖

后续深化项：
- [ ] 继续把实时 run 事实扩展到更多运维页联动，而不仅是 Requests 侧优先落地

### 3.6 Settings 运行控制面板（第二轮主线已完成）

已完成：
- [x] `SettingsView` 已成为主入口
- [x] 旧高级设置已被吸收到新设置体系
- [x] 默认模型 / 摘要模型 / 子代理模型池已进入统一配置流
- [x] 默认权限 / 推理强度 / 上下文阈值已进入统一配置流
- [x] 恢复 / 重试 / 退避已进入统一类型与持久化
- [x] 工具 allowlist / blocklist / MCP 策略已进入统一配置流
- [x] token / rate / dump / trace 调试项已进入主配置流
- [x] 上述配置已开始影响 session 默认值与 context manager 阈值
- [x] `tools.ts` / `mcp.ts` 已接 runtimeControls 的 recovery / runtimeDebug / governance 决策
- [x] `RuntimeControlPanel` / `WorkflowWorkbench` / `MCPServerManager` 已能解释这些配置如何影响执行链

后续深化项：
- [ ] 继续把更多执行器、日志与可观测性入口统一成同一套运行控制心智

### 3.7 MCP / Tool Registry（第二轮系统化已完成）

已完成：
- [x] `/api/mcp/registry` 已建立统一注册表视图
- [x] `MCPServerManager` 已展示 transport / status / tool count / discovered tools / enabled tools
- [x] 已支持创建 / 编辑 / 启停 / 删除 MCP server
- [x] 已支持注册表摘要卡片与系统级管理入口
- [x] MCP 策略已接入执行链，`mcp.test.ts` 已覆盖策略与运行时 recovery / trace / dump 元数据
- [x] MCP 管理页已明确展示“调用执行链遵循 Settings 配置”的统一治理口径

后续深化项：
- [ ] 继续把 routines / tool permissions / MCP tools 往单一治理模型再收一层

### 3.8 运行时与分发（第二轮回正已完成，进入正式交付深化）

已完成：
- [x] `main.ts` 已明确为主入口口径
- [x] `startStudioServer()` 已接入 startup orchestrator
- [x] 启动阶段已支持 runtime-state bootstrap 与 index rebuild 最小链路
- [x] startup orchestrator 已输出结构化 recoveryReport
- [x] 启动恢复已从静默 best-effort 变成显式恢复编排
- [x] embedded/filesystem 双路径已明确
- [x] `bun compile` smoke 已验证通过
- [x] CLI fallback 已明显收缩，legacy bridge 只保留兜底语义
- [x] startup orchestrator 已补 project bootstrap / static delivery / compile smoke 结构化动作
- [x] `pnpm bun:compile` 已形成当前固定 smoke 命令，并成功产出 `dist/novelfork.exe`

后续深化项：
- [ ] 安装器 / 签名 / 自动更新 / 首启 UX
- [ ] 继续补更完整巡检恢复体系 / migration / repair 闭环
- [ ] 把“compile smoke 成功”推进到更完整的正式交付体验

---

## 4. 总体计划：还没完成什么

## Phase A：统一平台事实源（已完成第一轮，进入跟随收口）

目标：
- 让 Session / Routines / Provider / Settings 各自只保留一套主事实源

当前状态：
- [x] 已完成第一轮主链统一
- [x] `windowStore` 已退出消息与协议事实源，只保留窗口壳职责
- [ ] 后续仍需随着 D/G/H 推进，继续收掉少量 UI 层对本地窗口字段的依赖

## Phase B：Project / 创建流程回正（主链已完成，转入产品化深化）

目标：
- 让项目创建升级为初始化工作流，而不是只建目录

当前已完成：
- [x] `NewProjectDialog` / `ProjectCreate` 已完成正式入口回正
- [x] 仓库来源 / 工作流模式 / 模板偏向 / worktree 预留字段已进入统一创建流
- [x] `initializationPlan` 已接入 `BookCreate` / `/api/books/create` / `.novelfork-project-init.json` sidecar
- [x] `new/existing/clone` 的真实 bootstrap 已接入 `/api/books/create`
- [x] 已完成 `repositoryRoot / baseBranch / worktreePath / worktreeBranch` 预备链
- [x] 已补 truthful fallback、唯一 worktree branch 命名与 sidecar 持久化链
- [x] 已补 route 层 worktree ownership guard：允许同书重试复用原 worktree，阻止不同书抢同一 `repo + worktreeName`，并返回 `409 PROJECT_BOOTSTRAP_WORKTREE_CONFLICT`
- [x] `BookCreate` 已在书籍创建完成后自动创建默认 writer 会话并打开工作窗口

后续深化项：
- [ ] 继续补 `ProjectCreate / BookCreate` 的产品化文案、创建中状态与错误反馈
- [ ] 把 bootstrap 之后的首个默认工作流继续推进到更完整的初始化体验

## Phase C：Narrator / Session 内核化（主链已完成，转入体验与终态深化）

总体判断：
- [x] reconnect / hydration、已有 session 打开、recent history、完整 history、seq/ack/replay 最小闭环都已完成
- [x] replay 结果已可回灌当前会话并写回正式 session 持久化链路

后续深化项：
- [ ] 继续把 `ChatWindow` 推向更纯的 server-first 终态
- [ ] 继续统一会话恢复、重连、状态恢复与错误提示体验
- [ ] 把协议闭环进一步转成用户可理解的 UI 状态反馈

## Phase D：AI 透明化深化（主线第二轮已完成）

总体判断：
- [x] 第二轮主线已完成，ToolCall 已具备全屏 / 重跑 / 查看源码 / 打开定位，执行链也已升级到链级展开

剩余重点：
- [ ] 继续把执行链透明化推进到更强的 run-level 回放与统一事实源终态

## Phase E：Workflow / Routines 合流（第二轮已完成）

总体判断：
- [x] 第二轮已完成

剩余重点：
- [ ] 继续把 Workflow / MCP / 权限 / 执行器统一成更单一的治理心智

## Phase F：Admin 平台化深化（第二轮已完成）

总体判断：
- [x] 第二轮已完成，Requests 已接实时运行事实，Resources / Logs / Daemon / Terminal 也已形成真实运维页与测试覆盖

剩余重点：
- [ ] 继续加强跨页联动与系统诊断深度

## Phase G：Settings 运行控制面板化（第二轮已完成）

总体判断：
- [x] 第二轮已完成，配置层与执行层已形成第一轮真正闭环

剩余重点：
- [ ] 继续把更多执行入口、日志与观测行为统一到同一套运行控制解释模型

## Phase H：运行时与分发回正（第二轮已完成，进入正式交付深化）

总体判断：
- [x] 第二轮已完成：startup orchestrator、delivery summary、compile smoke 与 embedded/filesystem 双路径都已形成第一轮闭环；正式交付体验仍需继续深化

剩余重点：
- [ ] 单文件分发正式闭环
- [ ] 安装器 / 签名 / 自动更新 / 首启 UX
- [ ] 更完整 startup recovery / migration / repair 机制

---

## 5. 当前最值得继续做的事

按价值和阻塞度排序，当前最值得继续推进的是：

1. **把 Settings / MCP 策略真正接进执行链（G + E）**
   - 让配置从“能保存”变成“真生效”，这是 A/B/C 完成后的最高价值主线
2. **补运行时正式分发与启动恢复闭环（H）**
   - 让平台从“开发可跑”进入“产品可交付”
3. **深化 AI 透明化（D）**
   - 把 ToolCall / 执行链从“可看”推进到“可追踪、可操作、可回放”
4. **补 Admin 更强实时性与系统诊断能力（F）**
   - 完成平台运维最后一层
5. **把 B/C 作为跟随深化项融入后续主线**
   - B：项目创建后的自动进入可工作状态、首个默认工作流、错误反馈产品化
   - C：会话状态提示、reconnect/replay/reset 的 UI 可见性、server-first 终态继续收口

---

## 5.1 近两三天章节 / 叙事线审计（2026-04-21）

本轮用 `Recall + git 图谱 + 当前 master` 交叉核对，当前可以把最近两三天的 4 条 `novelfork` 线这样理解：

1. **主整合线（当前 `novelfork` 主叙事线）**
   - 已完成 `72ccff5 feat(studio): complete abc convergence milestone`
   - 已完成 `2dafc90 feat(studio): close session and bootstrap convergence gaps`
   - merge 后主线稳定化修复为 `4ec76cb fix(studio): restore session runtime consistency after merge`

2. **章节线：`chapter/任务阶段4-0VHBYL`**
   - 关键提交：`085306d feat(studio): persist recent session history in workspace flow`
   - 作用：把 recent session history 持久化与 workspace 恢复流推入主链
   - 状态：已进入 `master` 祖先链

3. **章节线：`chapter/novelfork-fork-glpwlt-lIcIr9`**
   - 关键提交：`bb0a61b feat(studio): close platform convergence gaps`
   - 作用：完成 3.2–3.8 第一轮平台缺口收口，并同步任务总表
   - 状态：已进入 `master` 祖先链

4. **章节线：`chapter/novelfork-fork-4mfu0v-TDM_m2`**
   - 关键提交：`78fb763 feat(studio): finish narrafork 3.1-3.8 convergence`
   - 后续显式 merge：`d87ead9 Merge branch 'chapter/novelfork-fork-4mfu0v-TDM_m2'`
   - 说明：这次 merge 不是一次性干净合并，随后由主线 `4ec76cb` 做稳定化修复后，当前 master 才恢复到 typecheck / test 绿态

### 审计结论
- [x] 最近两三天的 4 条 `novelfork` 线，主成果都已进入当前 `master`
- [x] A / B / C 主链不是停留在章节 worktree 的临时实现，而是已进入主线历史
- [x] 本轮进一步补齐了文档此前保守的判断：`clone` bootstrap、window shell 收口、session seq/ack/replay 最小闭环都已完成并提交
- [~] 其中 `chapter/novelfork-fork-4mfu0v-TDM_m2` 的成果虽然已合并，但经历过一次 merge 后稳定化修复，说明后续仍要保持“先验证、后合并”的纪律

---

## 6. 最终验收口径

### 已完成
- [x] `SessionCenter` 可管理独立 / 章节会话，并支持归档 / 恢复 / 筛选 / 排序
- [x] `SessionCenter` 打开已有 session 与 formal session 流程已贯通
- [x] `ChatWindow` 已完成 reconnect 后的 history / state hydration
- [x] recent session history 已持久化，并可在恢复流程中继续推进
- [x] `NewSessionDialog` 保留并补回“当前对象”概览区
- [x] `ToolCallBlock` 已有统一动作区，原始载荷 / 结果细节也已收口到统一入口
- [x] `ToolCallBlock` 已具备全屏 / 重跑 / 查看源码 / 打开定位能力
- [x] `WorkflowWorkbench` 已具备统一治理总览，workflow 编排摘要、toolAccess / mcpStrategy 与 MCP registry summary 同页可见
- [x] `Admin` 已具备 Terminal / Container 最小入口，Requests / Resources / Logs / Daemon 已具备真实运维价值
- [x] startup orchestrator 已输出结构化 recoveryReport，不再只是静默 best-effort
- [x] startup delivery / compile smoke / embedded assets 已形成第一轮可验证链路
- [x] Routines 与 WorkflowWorkbench 已统一为一个编排工作台
- [x] 项目创建后已能自动创建默认 writer 会话并进入工作窗口

### 半完成 / 仍有缺口
- [~] `ChatWindow` 已显著转向 server-first，但仍未完全达到“纯服务端事实源”终态
- [~] `MCP / tool registry / workflow` 已收敛到统一治理口径，但仍未达到单一模型终态
- [~] 运行时与分发路径已形成 compile smoke 与 startup 闭环，但正式交付体验仍未完成

### 未完成
- [ ] Project / Chapter / Narrator 三层对象模型完整
- [ ] 项目创建后的完整初始化工作流与产品化反馈终态
- [ ] 更深层的安装器 / 签名 / 自动更新 / 首启 UX 闭环
- [ ] 更完整的运行时 repair / migration / 系统级实时诊断终态

---

## 7. 一句话主线

> **NovelFork 当前已经明显进入 NarraFork 式平台形态的中后段，接下来最重要的不是继续加页面，而是继续收口会话内核、执行权限链与运行时分发链。**
