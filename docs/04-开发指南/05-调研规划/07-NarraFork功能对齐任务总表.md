# NovelFork → NarraFork 功能对齐任务总表

> **目标**：不是把界面“做得像 NarraFork”，而是把 NovelFork 逐步推进到 **NarraFork 式本地单体 AI 工作台平台**。
>
> **产品目标参考**：`docs/03-代码参考/05-NarraFork更新日志参考.md`、`docs/03-代码参考/06-NarraFork-UIUX与交互功能调研.md`、v0.1.20 启动日志
>
> **工程实现参考**：`docs/03-代码参考/01-Claude Code实现经验.md`、`02-Claude Code配置系统参考.md`、`03-Claude Code体验优化参考.md` 以及 `D:\DESKTOP\novelfork\claude\restored-cli-src`

**版本**: v1.0.0  
**创建日期**: 2026-04-20  
**状态**: 🔄 执行中（重新定义主线）

---

## 0. 这份文档替代什么

这份文档不是替代 `06-Studio-UIUX改造清单.md`，而是站在更高一层重新定义主线：

- `06-Studio-UIUX改造清单.md` 解决的是 **页面与信息架构收口**
- 本文解决的是 **NovelFork 作为 NarraFork 式平台应该补齐哪些功能与内核**

简单说：

> `06` 是 UI/UX 改造清单，`07` 是产品与平台能力对齐总表。

---

## 1. 基本判断

### 1.1 NarraFork 的真实目标形态

基于文档与启动日志，可以确认 NarraFork 不是“聊天页 + 若干设置页”，而是一个：

- **Project / 叙事线**
- **Chapter / 章节节点**
- **Narrator / 叙述者会话**
- **Routines / 工作流编排层**
- **Admin / 平台运维层**
- **Settings / 运行策略控制层**
- **MCP / Tool Registry / Terminal / Provider / Request History**

共同组成的：

> **本地单体 AI 工作台平台**。

### 1.2 Claude Code 对 NovelFork 的真正价值

Claude Code 最值得借鉴的不是外观，而是工程模式：

- 会话是一等对象
- 权限分层（global/project/session/tool）
- 模型与 Provider 有 canonical registry
- 工具调用结构化透明化
- Routines/Skills/MCP 统一编排
- 恢复、压缩、持久化、回放、降噪
- 多 Agent / Coordinator / Worker 分工明确

所以后续原则必须明确：

> **产品形态向 NarraFork 对齐，工程实现优先参考 Claude Code。**

---

## 2. 非目标

以下内容不是当前主线：

- 不机械照抄 NarraFork 的 Mantine 风格
- 不为了“像 NarraFork”而强行把章节系统改成图编辑器
- 不继续围绕旧 PWA/多入口外壳堆功能
- 不把 Claude Code 参考理解成“照搬终端 UI”
- 不把“补几个页面”误当作完成平台对齐

---

## 3. NovelFork 当前现状（基于代码事实）

## 3.1 已经明显对齐 NarraFork 的部分

### A. 信息架构壳层
- 已有 `PageScaffold` / `PageEmptyState`
- 侧边栏已收口为主入口 + 工作台 + 系统台
- 已有 `WorkflowWorkbench`
- 已有 `SessionCenter`
- 已有 `Admin`
- 已有 `SettingsView`

### B. 会话页透明化第一版
- `ChatWindow` 已有：
  - 上下文占用
  - token 预算
  - 模型切换
  - 权限切换
  - 推理强度切换
  - ToolCallBlock
  - ContextPanel session 模式

### C. 平台页第一版
- `RequestsTab`
- `ProvidersTab`
- `ResourcesTab`

### D. 配置与编排储备
- 已有 `Routines` UI
- 已有 `routines-service`
- 已有 `/api/routines`
- 已有 `WorkflowWorkbench` 壳层

---

## 3.2 当前最关键的问题

现在最大的问题不是“功能没页面”，而是：

> **多套旧实现 + 新壳层 + 局部真实 API 并存，没有统一事实源。**

最明显的三组并行实现：

### A. 会话系统并行
- `windowStore.ts`：当前主工作台会话对象
- `hooks/useSession.ts`：IndexedDB 会话 CRUD
- `api/routes/session.ts`：内存 Map 的 session API

这三套还没有统一成真正的 narrator/session 内核。

### B. Routines / 工作流并行
- `components/Routines/Routines.tsx`：前端 IndexedDB 版本
- `api/routes/routines.ts`：服务端版本
- `api/lib/routines-service.ts`：磁盘持久化版本
- `WorkflowWorkbench.tsx`：新的产品壳

它们彼此没有真正合流。

### C. 设置 / 管理并行
- `SettingsView.tsx`：新的设置壳层
- `components/Settings/Settings.tsx`：旧弹窗式高级设置
- `Admin.tsx`：新的管理中心
- 多个旧的 Provider / Monitor / Daemon 入口仍在外部页面

---

## 3.3 当前缺失最大的不是 UI，而是平台内核

与 NarraFork 相比，NovelFork 当前最缺的是：

1. **正式的 narrator/session 后端持久化与状态恢复**
2. **统一的 model/provider/tool/routines 事实源**
3. **真实请求历史与 provider usage 数据链**
4. **MCP/tool registry 的系统级接入**
5. **terminal / daemon / worktree / runtime resource 的统一运行内核**
6. **项目创建 = 工作流初始化** 这一层产品结构

---

## 4. 最终目标定义（达到 NarraFork 功能）

当以下 8 组能力成立时，才算真正接近 NarraFork 的功能目标。

### 4.1 Project 是正式工作空间对象
- 新建项目时就确定：
  - 名称
  - 仓库来源（已有 / 新建 / 克隆）
  - 路径
  - 工作流模式
  - 模板/题材初始化
- Project 与 Git / worktree / workflow 绑定

### 4.2 Session / Narrator 是正式对象
- 可独立创建
- 可章节绑定创建
- 可筛选 / 排序 / 归档 / 恢复
- 可展示工作目录 / 模型 /消息数 / 最后活跃时间
- 可跨重启恢复状态

### 4.3 会话页本身是控制台
- 顶部显示：
  - breadcrumb / 项目路径
  - Context %
  - 模型
  - 权限
  - 推理强度
- 中部显示：
  - 消息流
  - 工具调用块
  - 子代理块
  - 耗时 / 错误 / 状态
- 底部输入区支持：
  - 发送 / 中断
  - 思考中状态

### 4.4 Routines 是统一编排层
统一管理：
- Commands
- Optional Tools
- Tool Permissions
- Skills
- Sub-agents
- Prompts
- MCP Tools
- Hooks

### 4.5 Admin 是可用的运维面板
至少包含：
- 请求历史
- 供应商
- 存储空间
- 运行资源
- 终端
- 容器 / daemon / worktree（按能力推进）

### 4.6 Settings 是运行控制面板
要能配置：
- 默认模型
- 摘要模型
- 子代理模型池
- 默认权限模式
- 推理强度
- 上下文阈值
- 恢复 / 重试 / 退避
- 白名单 / 黑名单
- 调试与监控项

### 4.7 MCP / Tool Registry 是系统级能力
- 启动时初始化 server
- 同步工具到 tool registry
- 页面中展示连接状态 / 工具数 / transport / 编辑
- 权限系统能纳管内置工具与 MCP 工具

### 4.8 运行时是本地单体应用
长期目标应为：
- Bun 单入口
- 本地 HTTP 服务
- 前端资产内嵌
- 启动即数据库迁移
- 支持恢复与索引重建
- 最终 `bun compile` 单文件分发

---

## 5. 工程原则（代码参考 Claude）

## 5.1 单一事实源原则
每个核心领域必须只有一套最终事实源：

- Session：不能同时靠 `windowStore` / `useSession` / `session route` 三套并行
- Routines：不能同时靠 IndexedDB UI 版和服务端磁盘版
- Provider / Model：不能前后端各自维护不同目录
- Settings：不能新壳层与旧弹窗长期并存

## 5.2 配置分层原则
参考 Claude Code：

- managed / global
- project
- session
- tool / command

NovelFork 新任务里所有“模型 / 权限 / 推理 / 工具规则”都必须明确所在层级。

## 5.3 模型注册表原则
必须建立统一的：
- provider registry
- canonical model id
- session override
- project default
- global default

## 5.4 工具透明化原则
每次工具执行至少应结构化记录：
- tool name
- input / command
- output
- duration
- status
- error
- copy / expand / rerun 能力（按阶段推进）

## 5.5 恢复优先原则
参考 Claude / NarraFork：
- 会话恢复
- WS 中断恢复
- 请求历史恢复
- 终端状态修复
- narrator 状态迁移修复
- 配置持久化后自动恢复

---

## 6. 新任务分期

## Phase A：统一平台事实源（最高优先级）

### 目标
解决“多套实现并存”的根问题，先统一平台内核口径。

### 任务
- [x] 统一 Session 模型：整合 `windowStore` / `useSession` / `/api/sessions`（第一轮已打通创建链路与服务端持久化）
- [x] 定义正式 narrator/session 数据结构（第一轮已落 `session-types` 与 `session-service`）
- [x] 统一 Routines 模型：整合 `Routines UI` / `/api/routines` / `routines-service`
- [x] 统一 Provider / Model registry，清理前后端目录不一致
- [x] 统一 Settings 数据源，制定“新设置中心吸收旧弹窗”的迁移策略

### 重点文件
- `packages/studio/src/stores/windowStore.ts`
- `packages/studio/src/hooks/useSession.ts`
- `packages/studio/src/api/routes/session.ts`
- `packages/studio/src/components/Routines/Routines.tsx`
- `packages/studio/src/api/routes/routines.ts`
- `packages/studio/src/api/lib/routines-service.ts`
- `packages/studio/src/shared/provider-catalog.ts`
- `packages/studio/src/api/lib/provider-manager.ts`
- `packages/studio/src/pages/SettingsView.tsx`
- `packages/studio/src/components/Settings/Settings.tsx`

### 验收标准
- Session / Routines / Provider / Settings 各自只有一个明确主事实源
- 文档和代码里不再同时维护两套相互独立方案

### 当前进度（2026-04-20，本轮已完成）
- 已新增 `packages/studio/src/shared/session-types.ts` 与 `packages/studio/src/api/lib/session-service.ts`，把 session 从前端临时对象推进成可持久化的正式记录。
- `packages/studio/src/api/routes/session.ts` 已改成读写磁盘持久化 service，不再是仅进程内 Map。
- `packages/studio/src/hooks/useSession.ts` 已从 IndexedDB CRUD 改为消费 `/api/sessions`。
- `packages/studio/src/stores/windowStore.ts` 已增加 `sessionId`，并允许窗口和正式 session 建立关联。
- `packages/studio/src/shared/provider-catalog.ts` 已成为 provider/model 的共享注册表；`provider-manager.ts` 与前端消费方已改为复用同一套目录定义。
- `packages/studio/src/components/Routines/Routines.tsx` 已去掉 IndexedDB 独立事实源，改走 `/api/routines/*` 与 `routines-service`。
- `packages/studio/src/pages/SettingsView.tsx` 已成为设置主入口；旧 `Settings` 弹窗改为兼容容器，`Config.tsx` 不再持有独立配置流。
- 当前仍未完全收口的部分：SessionCenter 主列表与 ChatWindow 运行时状态仍主要依赖窗口态展示，后续还要继续把“服务端 session 状态”推到主 UI 事实源。

---

## Phase B：Project / 创建流程回正

### 目标
把“新建书籍/新建对象”升级为“初始化工作流”。

### 任务
- [ ] 新建正式 `NewProjectDialog` / `ProjectCreate` 流程
- [x] 补仓库来源（已有 / 新建 / 克隆）（第一轮已进 BookCreate 初始化流程）
- [x] 补工作流模式（至少第一版）
- [x] 补模板/题材初始化入口
- [x] 与 Git/worktree 预留字段打通（第一轮已补 branch / worktree / path / clone URL 预留字段）

### 重点文件
- 新建：`packages/studio/src/components/NewProjectDialog.tsx`
- 新建或修改：项目创建 API / store
- 参考当前：`packages/studio/src/pages/BookCreate.tsx`

### 验收标准
- 项目创建不再等于“新建一个目录”
- 用户创建后直接进入可工作的项目空间

### 当前进度（2026-04-21，本轮已推进）
- `BookCreate.tsx` 已从“建书表单”推进成“初始化工作流”第一轮入口，补了仓库来源、工作流模式、模板偏向与 Git/worktree 预留字段。
- `/api/books/create` 现在会接收 `projectInit`，并把初始化信息落到书目录旁的 `.novelfork-project-init.json`，为后续真正的 clone / git / worktree 执行动作打底。
- 当前仍未正式拆出 `NewProjectDialog / ProjectCreate` 独立对象流，入口仍然沿用 `BookCreate`。

---

## Phase C：Narrator / Session 内核化

### 目标
把当前前端会话工作台升级为真正的 narrator/session 平台。

### 任务
- [x] 定义独立会话 / 章节会话的正式分类（第一轮已落 `standalone / chapter` 结构）
- [x] 增加工作目录字段（第一轮已保留 `worktree` 字段）
- [x] 增加模型“跟随默认 / 会话覆盖”语义（第一轮已把 `sessionConfig` 入正式 session 结构）
- [ ] 增加计划模式启动
- [x] 增加归档 / 恢复 / 分类筛选 / 排序（第一轮已落会话中心归档/恢复/筛选/排序）
- [x] 建立服务端会话生命周期接口（第一轮 CRUD 已落地）
- [ ] 建立 per-session chat / ws 协议
- [ ] 把 `ChatWindow` 改成真正消费服务端 session 状态的控制台

### 重点文件
- `packages/studio/src/pages/SessionCenter.tsx`
- `packages/studio/src/components/sessions/NewSessionDialog.tsx`
- `packages/studio/src/components/ChatWindow.tsx`
- `packages/studio/src/components/ChatWindowManager.tsx`
- `packages/studio/src/hooks/useSession.ts`
- `packages/studio/src/api/routes/session.ts`
- 新建：session/narrator service 与 ws route

### 验收标准
- 会话不是 UI 窗口对象，而是正式 narrator/session 对象
- 关闭并重开应用后会话状态可恢复

### 当前进度（2026-04-21，本轮已推进）
- `SessionCenter.tsx` 已开始直接消费服务端 session 列表，并补了归档 / 恢复 / 分类筛选 / 排序。
- `ChatWindow.tsx` 的 sessionConfig 改动已同步回写 `/api/sessions/:id`，不再只停留在本地窗口态。
- `windowStore.ts` 仍是“窗口工作台层”，但正式会话对象已经能通过 `sessionId` 与服务端记录关联。
- 当前仍未完成 per-session chat / ws 协议，以及更彻底的“ChatWindow 全量服务端状态驱动”。

---

## Phase D：AI 透明化深化

### 目标
从“基础透明化”升级到 NarraFork 水平的过程可见性。

### 任务
- [x] 精确化上下文 token 统计（第一轮已把工具调用内容计入估算）
- [x] 增加会话 breadcrumb / 项目路径（第一轮已落 session breadcrumb）
- [x] 做上下文来源分层（session/tool/project/memory 等）（第一轮已落 system/session/tool/other 分层）
- [x] 细化 ToolCallBlock 对 Bash / Read / Write / Browser / MCP 的专门展示
- [ ] 增加子代理卡片
- [x] 增加逐步耗时、错误态、更多操作（复制 / 查看源码 / 全屏 / 重跑）（第一轮已补耗时/错误态/复制操作）

### 重点文件
- `packages/studio/src/components/ChatWindow.tsx`
- `packages/studio/src/components/ContextPanel.tsx`
- `packages/studio/src/components/ToolCall/*`
- 相关 usage/context backend

### 验收标准
- 用户能知道 AI 做了什么、花了多久、为什么占用上下文、当前运行策略是什么

### 当前进度（2026-04-21，本轮已推进）
- `ChatWindow.tsx` 已补会话 breadcrumb 与“最近执行链”卡片，开始显式化当前会话路径和最近工具链。
- `ContextPanel.tsx` 已支持来源分层与工具结果条目，不再只有平铺消息列表。
- `ToolCallBlock.tsx` 已按工具类型差异化展示，并增加耗时、错误摘要与复制操作。
- 当前仍未落地子代理卡片，以及更完整的全屏 / 重跑 / 查看源码类操作。

---

## Phase E：Routines / WorkflowWorkbench 合流

### 目标
把“已有源码储备”变成真正的统一编排工作台。

### 任务
- [x] 把 `Routines` 体系并入 `WorkflowWorkbench` 主心智（第一轮已完成事实源收口与工作台说明）
- [x] 增加 Prompt / Tool Permissions / Sub-agents / Hooks 正式区块（第一轮已进入 WorkflowWorkbench 主界面）
- [x] 明确全局级 / 项目级 / 会话级配置边界（当前已完成 global / project / merged 第一轮口径）
- [x] 统一保存策略和持久化路径

### 重点文件
- `packages/studio/src/pages/WorkflowWorkbench.tsx`
- `packages/studio/src/components/Routines/Routines.tsx`
- `packages/studio/src/api/routes/routines.ts`
- `packages/studio/src/api/lib/routines-service.ts`

### 验收标准
- 用户能在一个地方理解和管理 AI 工作流的编排资源
- Routines 不再是“代码里有、产品里感知弱”的隐藏能力

### 当前进度（2026-04-21，本轮已推进）
- `Routines.tsx` 已改为消费 `/api/routines/global|project|merged`，不再维护浏览器本地独立配置库。
- `routines-service.ts` 已承担全局 / 项目 / 合并视图的文件持久化与规范化逻辑。
- `WorkflowWorkbench.tsx` 已把 Prompt / Tool Permissions / Sub-agents / Hooks 这些资源作为正式区块并到主工作台中，并复用同一套 routines 读写链路。

---

## Phase F：Admin 平台化深化

### 目标
把 Admin 从“有页面”推进到“有真实运维价值”。

### 任务
- [x] 请求历史接入真实 provider/model/token/TTFT/cost/cache/narrator 维度（第一轮已落 admin 域真实摘要结构）
- [x] 供应商页接入真实 registry 与验证状态（第一轮已落共享 registry + ProvidersTab 消费真实 manager 数据）
- [x] 存储扫描接后端任务与历史结果（第一轮已落真实扫描结构与缓存/强制刷新）
- [x] 运行资源接实时事件/刷新机制（第一轮已落 HTTP 刷新主链；WS 仍待主链化）
- [ ] 把 daemon / logs / worktree 从占位合并进管理中心体系
- [ ] 视情况补 terminal / container 管理入口

### 重点文件
- `packages/studio/src/components/Admin/Admin.tsx`
- `packages/studio/src/components/Admin/RequestsTab.tsx`
- `packages/studio/src/components/Admin/ProvidersTab.tsx`
- `packages/studio/src/components/Admin/ResourcesTab.tsx`
- `packages/studio/src/api/routes/admin.ts`
- `packages/studio/src/api/lib/provider-manager.ts`

### 验收标准
- Admin 能回答：谁在用、用了什么模型、花了多少 token、慢在哪、哪家 provider 可用、系统是否健康

### 当前进度（2026-04-21，本轮已推进）
- `ProvidersTab.tsx` 已切到真实 provider manager 数据结构，能展示共享 registry、启用状态、连接测试与模型池摘要。
- `RequestsTab.tsx` 已接入 admin 域真实请求日志结构，开始展示 provider/model/token/TTFT/cost/cache/narrator 等维度的摘要槽位与统计结构。
- `ResourcesTab.tsx` 已接入真实资源快照与存储扫描结果，并支持缓存读取与强制刷新。
- 当前仍未完成 daemon / logs / worktree / terminal 等系统运维入口的统一收口。

---

## Phase G：Settings 运行控制面板化

### 目标
让 Settings 不只是 UI 设置页，而是运行策略控制中心。

### 任务
- [x] 把旧高级设置逐步页内化（第一轮已把旧容器改成可嵌入内容，并由 `SettingsView` 直接承接）
- [ ] 增加默认模型 / 摘要模型 / 子代理模型池
- [x] 增加默认权限模式 / 推理强度 / 上下文阈值
- [ ] 增加恢复 / 重试 / 退避配置
- [ ] 增加工具白名单 / 黑名单 / MCP 策略入口
- [ ] 增加运行调试项（token、速率、dump、trace 等分阶段接入）

### 重点文件
- `packages/studio/src/pages/SettingsView.tsx`
- `packages/studio/src/components/Settings/Settings.tsx`
- `packages/studio/src/api/routes/settings.ts`

### 验收标准
- Settings 真正成为运行控制面板，而不是主题/编辑器设置集合

### 当前进度（2026-04-21，本轮已推进）
- `SettingsView.tsx` 已成为主入口，advanced 区块直接内嵌兼容设置内容，不再只是“打开旧弹窗”。
- `Settings.tsx` 已改成兼容容器；`Config.tsx` 不再持有独立 IndexedDB 配置流，而是明确迁移到 `/api/settings` 主配置流。
- `RuntimeControlPanel.tsx` 已把默认权限模式、默认推理强度、上下文压缩阈值、上下文截断目标接入 `/api/settings/user`。
- 这组字段现在已真正影响 session 默认值与 context manager 阈值，不再是只保存不生效的死配置。
- 当前仍未完成模型池、恢复退避、工具白名单等运行策略项，这部分还需要继续扩展设置页字段与后端配置结构。

---

## Phase H：运行时与分发回正（长期主线）

### 目标
向 NarraFork 的本地单体运行时靠拢。

### 任务
- [~] 继续验证和收敛 Bun 单入口方案（当前已明确 `main.ts` 为源码主入口，仍需继续压缩 legacy fallback）
- [~] 前端资产内嵌与本地 HTTP 服务模型明确化（embedded/filesystem 双路径已梳理，正式分发口径仍未闭环）
- [x] 启动期迁移、索引恢复、状态修复任务整理成正式清单（见 `docs/06-部署运维/03-启动期迁移与修复清单.md`）
- [ ] `bun compile` 单文件分发链路落地
- [~] CLI spawn studio 仅保留过渡职责（当前已优先转交 Bun 主入口，fallback 仍保留兼容桥）

### 重点文件
- 以 `docs/04-开发指南/05-调研规划/01-平台迁移方案.md`
- `02-平台回正规划.md`
- `03-平台迁移待办清单.md`
- `docs/06-部署运维/03-启动期迁移与修复清单.md`
- 以及 `main.ts` / `packages/cli/src/commands/studio.ts` / `packages/studio/src/api/server.ts` 为准

### 验收标准
- NovelFork 运行时口径明确且稳定
- 不再继续扩张旧外壳路径

---

## 7. 当前代码资产怎么用（避免推倒重来）

## 7.1 直接复用
- `PageScaffold` / `PageEmptyState`
- `Sidebar`
- `SessionCenter`
- `ChatWindow`
- `ContextPanel`
- `ToolCallBlock`
- `WorkflowWorkbench`
- `Admin`
- `SettingsView`

## 7.2 需要整合，不要废弃
- `useSession.ts`
- `api/routes/session.ts`
- `windowStore.ts`
- `components/Routines/Routines.tsx`
- `api/routes/routines.ts`
- `api/lib/routines-service.ts`
- `components/Settings/Settings.tsx`
- `BookCreate.tsx`

## 7.3 需要重构后吸收
- 旧聊天实现 / 旧 Provider 配置 / 旧 Monitor 入口
- 分散的 worktree / daemon / logs 页面

---

## 8. 最终验收口径

当下面这些条件成立时，才可以说 NovelFork 已基本达到 NarraFork 功能目标：

- [ ] Project / Chapter / Narrator 三层对象模型完整
- [ ] 项目创建已升级为初始化工作流
- [ ] SessionCenter 可管理独立/章节会话，并支持归档/恢复/筛选/排序
- [ ] ChatWindow 成为真正的会话控制台，而不是前端假对象
- [ ] 上下文 / 工具 / 子代理 / 模型 / 权限 / 推理全部在会话页透明可见
- [ ] Routines 与 WorkflowWorkbench 已统一为一个编排工作台
- [ ] Requests / Providers / Resources / Storage 已具备真实运维价值
- [ ] Settings 成为运行策略控制面板
- [ ] MCP/tool registry 进入系统级管理
- [ ] 运行时与分发路径明确向本地单体应用收敛

---

## 9. 一句话主线

这份新任务文档的核心不是“继续美化 Studio”，而是：

> **以 NarraFork 为产品目标，以 Claude Code 为工程参考，把 NovelFork 从“有很多页面的工作台”推进成“对象清晰、配置统一、会话内核稳定、运行时可恢复、平台能力完整”的本地 AI 写作平台。**
