# NovelFork → NarraFork 对齐总计划（唯一主文档）

> **目的**：把 NovelFork 从“有很多页面的工作台”推进成 **NarraFork 式本地单体 AI 写作平台**。  
> 这份文档已经吸收原 `06-Studio-UIUX改造清单.md` 与旧版 `07-NarraFork功能对齐任务总表.md` 的有效内容，后续只维护这一份。

**版本**: v2.1.0  
**创建日期**: 2026-04-20  
**更新日期**: 2026-04-21  
**状态**: 🔄 执行中（A/B/C 已完成本轮收口，继续推进执行链与运行时闭环）

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
> **补充说明（2026-04-21 再核对）**：针对“narrafork 章节叙事”阶段 A / B / C 的源码复查结果表明，这三阶段的主链成果已经进入当前 `master` 历史，不是游离分支上的临时实现。其中：
> - **阶段 A**：可判定为“第一轮主链完成”，平台事实源已经明显从前端临时状态转向正式服务层与配置层。
> - **阶段 B**：可判定为“第一轮入口回正完成”，项目创建已经具备正式对象流，但还没到完整初始化工作流终态。
> - **阶段 C**：可判定为“主链完成并进入中后段收口”，Session / Narrator 已经具备正式对象、snapshot/state/message 协议与历史恢复能力，但仍未完全达到纯服务端事实源。

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

### 3.2 Session / Narrator 内核化（本阶段目标已完成，进入深化阶段）

已完成：
- [x] `session-types.ts` / `session-service.ts` 建立正式 session 数据结构
- [x] `/api/sessions` 已改为磁盘持久化，不再只是进程内 Map
- [x] `useSession.ts` 已切到服务端 session API
- [x] `windowStore.ts` 已与正式 session 通过 `sessionId` 建立关联
- [x] `SessionCenter` 支持会话创建、归档、恢复、筛选、排序
- [x] 支持 `standalone / chapter` 分类与 `chat / plan` 模式
- [x] 已建立 per-session chat / ws 最小可用协议
- [x] `ChatWindow` 已优先消费服务端 snapshot / state / message
- [x] 完整聊天历史已独立持久化，不再只依赖 `recentMessages`
- [x] 已补 `chat/history` 补拉接口与 reconnect backfill 最小链路
- [x] `SessionCenter` 打开已有会话时已改为创建窗口壳，再由 `ChatWindow` 自行从服务端完成 hydration
- [x] `ChatWindow` 的消息列表与连接状态已明显下沉到组件态，`windowStore` 不再承担主要会话消息事实源

后续深化项：
- [ ] `windowStore` 仍保留少量 session 展示缓存，还不是纯布局 / UI shell store
- [ ] 仍可继续把 `ChatWindow` 推向更纯粹的服务端事实源
- [ ] 仍可继续增强完整聊天历史、恢复链与状态统一深度


### 3.3 AI 透明化（已完成第一轮，仍有体验尾项）

已完成：
- [x] `ChatWindow` 已有上下文占用 / token 预算 / 模型 / 权限 / 推理强度可视化
- [x] `ContextPanel` 已支持会话上下文与来源分层
- [x] `ToolCallBlock` 已支持状态、耗时、错误、复制、展开/折叠
- [x] `ToolCallBlock` 已支持查看原始载荷
- [x] 已支持工具类型差异化展示
- [x] 子代理卡片已进入统一工具块视图
- [x] breadcrumb / 最近执行链 / 会话路径信息已进入主会话页

仍未完成：
- [ ] 全屏 / 重跑 / 查看源码等更深层动作
- [ ] 更强的执行链级透明化，而不仅是消息级透明化

### 3.4 Workflow / Routines 合流（已基本完成）

已完成：
- [x] `Routines` 改为消费 `/api/routines/*`
- [x] `routines-service.ts` 成为实际持久化层
- [x] `WorkflowWorkbench` 已吸收 Prompt / Tool Permissions / MCP Tools / Sub-agents / Hooks 等区块
- [x] `WorkflowWorkbench` 已把 MCP Tools 的编排配置与实时 MCP 注册表摘要放进同一工作流台
- [x] 已建立 global / project / merged 第一轮边界

仍未完成：
- [ ] 更彻底的“统一执行心智”，尤其是和 MCP / 权限链的进一步打通

### 3.5 Admin 平台化（已完成第一轮）

已完成：
- [x] `RequestsTab` 已有真实请求摘要结构
- [x] `ProvidersTab` 已消费真实 provider manager 数据
- [x] `ResourcesTab` 已接资源快照与扫描结果结构
- [x] `DaemonTab` / `LogsTab` / `WorktreesTab` 已并入 `Admin`

仍未完成：
- [ ] terminal / container 管理入口
- [ ] 更深层实时事件流（当前以 HTTP 刷新为主）

### 3.6 Settings 运行控制面板（配置层已基本到位）

已完成：
- [x] `SettingsView` 已成为主入口
- [x] 旧高级设置已被吸收到新设置体系
- [x] 默认模型 / 摘要模型 / 子代理模型池已进入统一配置流
- [x] 默认权限 / 推理强度 / 上下文阈值已进入统一配置流
- [x] 恢复 / 重试 / 退避已进入统一类型与持久化
- [x] 工具 allowlist / blocklist / MCP 策略已进入统一配置流
- [x] token / rate / dump / trace 调试项已进入主配置流
- [x] 上述配置已开始影响 session 默认值与 context manager 阈值

仍未完成：
- [ ] 这些配置尚未全部接入执行器 / 工具调度器 / trace 管线

### 3.7 MCP / Tool Registry（已完成第一轮系统化）

已完成：
- [x] `/api/mcp/registry` 已建立统一注册表视图
- [x] `MCPServerManager` 已展示 transport / status / tool count / discovered tools / enabled tools
- [x] 已支持创建 / 编辑 / 启停 / 删除 MCP server
- [x] 已支持注册表摘要卡片与系统级管理入口

仍未完成：
- [ ] MCP 策略尚未完整打进权限系统与执行链
- [ ] routines / tool permissions / MCP tools 仍未完全统一成一个治理模型

### 3.8 运行时与分发（已完成第一轮回正）

已完成：
- [x] `main.ts` 已明确为主入口口径
- [x] `startStudioServer()` 已接入 startup orchestrator
- [x] 启动阶段已支持 runtime-state bootstrap 与 index rebuild 最小链路
- [x] embedded/filesystem 双路径已明确
- [x] `bun compile` smoke 已验证通过
- [x] CLI fallback 已明显收缩，legacy bridge 只保留兜底语义

仍未完成：
- [ ] `bun compile` 单文件分发正式闭环
- [ ] 安装器 / 签名 / 自动更新 / 首启 UX
- [ ] startup orchestrator 仍是 best-effort 最小骨架，不是完整巡检恢复体系
- [ ] Admin / Monitor websocket 等还没完全主链化

---

## 4. 总体计划：还没完成什么

## Phase A：统一平台事实源（本阶段目标已完成）

目标：
- 让 Session / Routines / Provider / Settings 各自只保留一套主事实源

当前状态：
- [x] 已完成平台事实源第一阶段统一
- [x] `windowStore` 已明显降权：消息与连接态已下沉到 `ChatWindow` 组件态 / 服务端快照链
- [x] settings / provider / workflow 的关键双轨事实源已完成本阶段收口

后续深化项：
- [ ] 继续把 `windowStore` 收口为纯布局 / UI shell
- [ ] 继续减少 provider / workflow / settings 的次级派生来源

## Phase B：Project / 创建流程回正（已完成第一轮）

目标：
- 让项目创建升级为初始化工作流，而不是只建目录

当前已完成：
- [x] `NewProjectDialog` / `ProjectCreate` 已完成正式入口回正
- [x] 仓库来源 / 工作流模式 / 模板偏向 / worktree 预留字段已进入统一创建流
- [x] `initializationPlan` 已接入 `BookCreate` / `/api/books/create` / `.novelfork-project-init.json` sidecar

后续深化项：
- [ ] clone / git / worktree 的真实执行动作链
- [ ] 项目创建后自动进入“可工作状态”的完整初始化链

## Phase C：Narrator / Session 内核化（本阶段目标已完成）

总体判断：
- [x] 已完成本阶段主链，Session / Narrator 已具备正式对象、history/recovery、snapshot/state/message 与 server-first 第一轮核心能力

后续深化项：
- [ ] 继续把 `ChatWindow` 推向更纯粹的服务端状态优先，进一步弱化本地窗口态
- [ ] 继续统一“会话状态即服务端状态”的最终口径
- [ ] 继续增强完整历史、transport ack 与恢复深度

## Phase D：AI 透明化深化（次主线）

总体判断：
- [~] 第一轮完成，用户已经能看见大部分关键过程

剩余重点：
- [ ] 全屏 / 重跑 / 查看源码
- [ ] 更强的执行链透明化，而不是只停留在消息展示层

## Phase E：Workflow / Routines 合流（已基本完成）

总体判断：
- [x] 第一轮已完成

剩余重点：
- [ ] 与 MCP / 权限系统 / 执行器做更强耦合

## Phase F：Admin 平台化深化（中后段）

总体判断：
- [~] 第一轮已完成，已具备实际运维价值

剩余重点：
- [ ] terminal / container 入口
- [ ] 更强的实时性与系统诊断能力

## Phase G：Settings 运行控制面板化（主链已完成一半）

总体判断：
- [~] 配置层已基本完成，执行层还没接完

剩余重点：
- [ ] 把恢复 / 重试 / 退避 / MCP 策略 / trace 等接到执行器与日志链

## Phase H：运行时与分发回正（长期主线）

总体判断：
- [~] 已完成“可跑通 + 主链收口”，但还没完成“可交付”

剩余重点：
- [ ] 单文件分发正式闭环
- [ ] 安装器 / 签名 / 自动更新 / 首启 UX
- [ ] 更完整 startup recovery / migration / repair 机制

---

## 5. 当前最值得继续做的事

按价值和阻塞度排序，当前最值得继续推进的是：

1. **补运行时正式分发闭环**
   - 让平台从“开发可跑”进入“产品可交付”
2. **继续深化 AI 透明化与执行链透明度**
   - 把全屏 / 重跑 / 查看源码 / 执行链级透明化补齐
3. **补 terminal / container / 更强 Admin 实时性**
   - 完成平台运维最后一层
4. **继续深化项目初始化工作流与会话内核终态**
   - 作为 A/B/C 完成后的下一层优化方向

---

## 6. 最终验收口径

当下面这些条件成立时，才可以说 NovelFork 已基本达到 NarraFork 功能目标：

- [ ] Project / Chapter / Narrator 三层对象模型完整
- [~] 项目创建已部分升级为初始化工作流：`new / existing` 可进入最小可工作状态，`clone` 仍未完成
- [x] SessionCenter 可管理独立 / 章节会话，并支持归档 / 恢复 / 筛选 / 排序
- [x] ChatWindow 已成为正式会话控制台的第一阶段完成形态，不再是前端假对象
- [ ] 上下文 / 工具 / 子代理 / 模型 / 权限 / 推理全部在会话页透明可见并统一治理
- [x] Routines 与 WorkflowWorkbench 已统一为一个编排工作台
- [x] Requests / Providers / Resources / Storage 已具备真实运维价值
- [~] Settings 成为运行策略控制面板
- [~] MCP / tool registry 进入系统级管理
- [~] 运行时与分发路径明确向本地单体应用收敛

---

## 7. 一句话主线

> **NovelFork 当前已经明显进入 NarraFork 式平台形态的中后段，接下来最重要的不是继续加页面，而是继续收口会话内核、执行权限链与运行时分发链。**
