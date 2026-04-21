# NovelFork Studio UI/UX 改造清单

> **来源**：基于 `docs/03-代码参考/06-NarraFork-UIUX与交互功能调研.md` 提炼。目标不是复制 NarraFork 外观，而是把其已验证的产品结构，转成 NovelFork Studio 的可执行改造任务。

**版本**: v1.1.0  
**创建日期**: 2026-04-20  
**更新日期**: 2026-04-20  
**状态**: 🔄 执行中（已完成一轮全量翻新与收尾）

---

## 0. 目标与原则

**总目标**：
把 NovelFork Studio 从“功能很多但分散、风格不稳、部分硬编码”的状态，推进到“对象建模清晰、信息架构稳定、AI 过程透明、配置收口统一”的平台形态。

**不做的事**：
- 不为了模仿 NarraFork 而强行改成 Mantine 风格
- 不把章节编辑器硬改成流程图编辑器
- 不在没有统一设计令牌前继续堆零散页面和特例样式

**必须坚持的原则**：
1. 先统一结构，再统一视觉，最后补复杂功能
2. 先减入口、减分散，再加页面
3. 先去硬编码、去临时样式，再谈精致 UI
4. 每个阶段都要有明确验收标准

### 0.1 补充事实：NarraFork 不只是前端界面

> 基于 `06-NarraFork-UIUX与交互功能调研.md`、`05-NarraFork更新日志参考.md` 与 v0.1.20 启动日志补充。

当前对 NarraFork 的判断不能只停留在“页面长什么样”，因为它已经具备明确的平台内核特征：

- 启动时会执行 **数据库迁移**（Drizzle migration）
- 会在非正常退出后 **重建 FTS 索引**
- 会检测 **Git**、清理陈旧 **terminal** 状态
- 会在启动阶段初始化 **MCP server**，并把工具同步进 **tool registry**
- 会对异常 narrator 状态做 **状态迁移修复**（例如 `thinking → idle`）
- 以前端嵌入资产 + 本地 HTTP 服务的方式运行在 **编译后的单文件可执行程序** 中

这意味着后续对齐 NarraFork 时，不能只补 UI 壳，还要逐步补下面这些平台级能力：

- narrator/session 的后端持久化与状态恢复
- 请求历史的真实统计维度（provider/model/token/TTFT/cost/cache）
- MCP/tool registry 的系统级接入，而不是页面级配置
- 终端 / worktree / 项目数据库同步等运行时基础设施

---

## 1. 改造总分期

### Phase 0：基础收口（设计令牌 + 页面骨架）
先修“风格不统一、颜色/间距/卡片/按钮硬编码”的根问题。

### Phase 1：信息架构重排（侧边栏减负）
把 20+ 入口重新分层，减少低频功能常驻。

### Phase 2：统一工作流配置台
把 Agent / MCP / Plugin / Prompt / 权限相关入口收口成一个页面。

### Phase 3：会话中心与独立会话升级
把对话从“附属面板”升级为正式对象。

### Phase 4：AI 透明化
把上下文、工具调用、模型/权限/推理强度显性化。

### Phase 5：平台运维页补齐
补请求历史、供应商视图强化、存储/资源扫描。

### Phase 6：项目/章节创建流程升级
把“建项目/建章节”升级为“初始化工作流”。

---

## 2. Phase 0：基础收口（最高优先级）

### Task 0.1：建立统一设计令牌层

**目标**：停止颜色、间距、圆角、阴影、按钮状态在组件内各写一套。

**重点文件**：
- `packages/studio/src/hooks/use-colors.ts`
- `packages/studio/src/index.css`
- `packages/studio/src/components/**/*.tsx`
- `packages/studio/src/pages/**/*.tsx`

**清单**：
- [ ] 把 `use-colors.ts` 明确拆成两类输出：
  - class 类名令牌
  - CSS 变量值令牌
- [ ] 禁止组件混用“不存在的颜色字段名”与临时 inline style
- [ ] 建立统一 token 命名：
  - `text`
  - `textSecondary`
  - `bg`
  - `bgSecondary`
  - `border`
  - `accent`
  - `danger`
  - `warning`
  - `success`
- [ ] 建立统一组件级语义 token：
  - `card`
  - `panel`
  - `toolbar`
  - `btnPrimary`
  - `btnSecondary`
  - `input`
  - `badge`
- [ ] 把 ChatWindow / WindowControls / Settings / Sidebar 先迁到统一 token

**验收标准**：
- 不再出现“组件引用不存在的颜色字段”
- 不再出现一半 Tailwind class、一半临时 `style={{ color: ... }}` 的混用状态
- 常用页面（Sidebar / Dashboard / Settings / ChatWindow）视觉语言一致

---

### Task 0.2：统一基础页面骨架

**目标**：统一“页面标题 + 描述 + 主操作区 + 内容区”的基本结构。

**重点文件**：
- `packages/studio/src/App.tsx`
- `packages/studio/src/components/Sidebar.tsx`
- `packages/studio/src/pages/*.tsx`
- `packages/studio/src/components/ui/*`

**清单**：
- [ ] 提取统一页面壳组件，例如：`PageScaffold`
- [ ] 页面头部统一为：
  - 标题
  - 副标题/说明（可选）
  - 主操作按钮区
- [ ] 页面内容区统一留白、卡片间距、滚动策略
- [ ] 统一空态组件：
  - 无数据
  - 无搜索结果
  - 首次使用
  - 功能未配置
- [ ] 统一危险操作按钮与确认弹窗风格

**验收标准**：
- 主要页面不再各自有不同标题排版和按钮摆放方式
- 空态文案和按钮结构统一

**当前进度（2026-04-20）**：
- [x] 已提取统一页面壳 `PageScaffold`，主流页面已迁入统一标题 / 描述 / 主操作区结构
- [x] 已提取统一空态组件 `PageEmptyState`，并在 Dashboard / Analytics / BookDetail / ChapterReader / Admin 等页面复用
- [x] 页面内容区的留白、卡片间距、滚动区策略已明显统一到新壳层
- [ ] 危险操作按钮与确认弹窗风格还未完全统一，仍有局部页面沿用旧实现

---

## 3. Phase 1：信息架构重排（侧边栏减负）

### Task 1.1：重构侧边栏分层

**目标**：减少 Studio 侧边栏过载问题。

**重点文件**：
- `packages/studio/src/components/Sidebar.tsx`
- `packages/studio/src/hooks/use-tabs.ts`
- `packages/studio/src/App.tsx`

**建议分层**：

#### 一级常驻
- 仪表盘
- 项目/书籍
- 会话中心
- 工作流配置
- 设置

#### 二级工作台
- 分析工具台
  - 搜索
  - 文风
  - 诊断
  - 伏笔
  - AIGC 检测
  - Pipeline

#### 二级系统台
- 请求历史
- 供应商
- MCP
- 插件
- 守护进程/日志
- 存储与资源

**清单**：
- [ ] 把低频入口从一级侧边栏移出
- [ ] 合并“系统”和“工具”里语义重叠的入口
- [ ] 一级入口控制在 8～12 个以内
- [ ] 补充图标、文案、顺序的统一规则

**验收标准**：
- 新用户能在 5 秒内看懂主导航
- 侧边栏不再像功能仓库

**当前进度（2026-04-20）**：
- [x] 侧边栏已收敛为“主入口 + 工作台 + 系统台”三层结构，不再把低频工具全部堆在一级入口
- [x] 一级常驻入口已压缩为项目总览 / 会话中心 / 工作流配置 / 管理中心 / 设置等核心对象
- [x] grouped route 结构已建立，Workflow / Admin / Settings 都支持统一分组跳转
- [ ] 入口顺序与显示规则仍偏代码硬编码，后续可继续向配置驱动迁移

---

### Task 1.2：新增“工作流配置”统一入口

**目标**：把分散入口收成一个中心页。

**重点文件**：
- `packages/studio/src/components/AgentPanel.tsx`
- `packages/studio/src/components/MCPServerManager.tsx`
- `packages/studio/src/components/PluginManager.tsx`
- `packages/studio/src/pages/LLMAdvancedConfig.tsx`
- 新建：`packages/studio/src/pages/WorkflowWorkbench.tsx`

**标签建议**：
- Agent
- MCP 工具
- 插件
- 模型与路由
- 提示词模板
- 工具权限
- 高级行为

**清单**：
- [ ] 新建 `WorkflowWorkbench` 页面
- [ ] 把分散面板并入标签页结构
- [ ] 统一顶部说明区和保存策略
- [ ] 明确哪些是“项目级”、哪些是“全局级”配置

**验收标准**：
- 用户不需要在 3～4 个页面来回跳配置 AI 工作流

**当前进度（2026-04-20）**：
- [x] `WorkflowWorkbench` 已落地，并把 Agent / MCP / Plugin / 高级配置 / 调度 / 检测 / 通知收口到统一工作台
- [x] 已完成 grouped route 兼容，历史入口可映射到 `workflow + section`
- [x] 已补充“项目级 / 全局级 / 混合”配置边界与保存策略说明
- [x] 代码库中已存在 `Routines` / routines API / routines service 这套能力储备，说明命令 / 工具 / 权限 / 技能 / 提示词 / MCP 并不是从零开始
- [ ] `Routines` 体系与 `WorkflowWorkbench` 还没有完全并到同一产品心智中，提示词模板 / 工具权限 / 自定义子代理入口仍需继续收口

---

## 4. Phase 2：会话中心与独立会话升级

### Task 2.1：新增会话中心页面

**目标**：让对话从“底部附属面板”升级为正式对象。

**重点文件**：
- `packages/studio/src/components/ChatWindowManager.tsx`
- `packages/studio/src/components/ChatBar.tsx`
- 新建：`packages/studio/src/pages/SessionCenter.tsx`
- 相关 store / hooks

**页面结构建议**：
- 类型筛选：
  - 全部
  - 独立会话
  - 章节会话
- 排序：最近更新 / 创建时间 / 活跃度
- 列表项展示：
  - 标题
  - 关联项目/章节
  - 模型
  - 消息数
  - 最后活跃时间
  - 状态标签

**清单**：
- [ ] 把现有会话对象梳理成统一数据结构
- [ ] 增加正式会话列表页
- [ ] 为独立会话和章节会话打类型标签
- [ ] 增加归档入口预留

**验收标准**：
- 不再只能靠侧边栏或弹窗管理会话

**当前进度（2026-04-20）**：
- [x] 已新增正式 `SessionCenter` 页面，支持从主导航进入会话管理视图
- [x] 已具备会话对象结构、IndexedDB 持久化 hook 与基础 session API 路由
- [x] 会话中心已支持基础列表展示与创建入口，不再只能依赖侧栏或临时弹窗
- [ ] 与 NarraFork 相比，仍缺“独立会话 / 章节会话”明确分类、已归档视图、工作目录展示、更多操作菜单等对象管理能力
- [ ] 归档 / 恢复 / 更细粒度筛选排序仍待继续补齐

---

### Task 2.2：升级独立会话创建流程

**目标**：参考 NarraFork 的“独立叙述者”能力。

**重点文件**：
- 新建或修改：`packages/studio/src/components/NewSessionDialog.tsx`
- `packages/studio/src/components/ChatWindowManager.tsx`

**字段建议**：
- 会话名称
- 工作目录（可选）
- 关联项目（可选）
- 模型（可覆盖默认）
- 权限模式
- 是否以计划模式启动

**清单**：
- [ ] 去掉当前“prompt 输入 Agent ID”这类临时交互
- [ ] 改成结构化表单
- [ ] 为独立会话留出不绑定项目的能力

**验收标准**：
- 新建会话流程不再依赖技术用户脑补内部 ID

**当前进度（2026-04-20）**：
- [x] 已移除 prompt 式临时交互，改为 `NewSessionDialog` 结构化表单
- [x] 已提供写作 / 规划 / 审计 / 设定等会话预设，支持标题自动生成与自定义 Agent ID
- [x] 独立会话对象已能不绑定章节直接创建
- [ ] 与 NarraFork 对齐后仍需补：工作目录、模型（含“跟随默认”语义）、计划模式启动、关联项目/主目录说明
- [ ] 这些字段后续应与 narrator/session 持久化接口打通，而不是只停在前端表单层

---

## 5. Phase 3：AI 透明化

### Task 3.1：上下文占用可视化

**目标**：像 NarraFork 一样，把上下文状态显性化。

**重点文件**：
- `packages/studio/src/components/ChatBar.tsx`
- `packages/studio/src/components/ChatWindow.tsx`
- `packages/studio/src/components/AgentPanel.tsx`

**清单**：
- [ ] 增加上下文百分比指示器
- [ ] 增加颜色分级：安全 / 警告 / 临界
- [ ] 给出后续动作入口：压缩 / 清理 / 新开会话（先占位）

**验收标准**：
- 用户知道为什么会话开始“变笨”或“变慢”

**当前进度（2026-04-20）**：
- [x] 已在 `ChatWindow` 补上上下文占用百分比、颜色分级与 token 预算展示
- [x] 已补充上下文动作入口：压缩 / 裁剪 / 新开会话，并把详情区挂到 `ContextPanel`
- [x] `ContextPanel` 已支持会话模式，可直接查看最近会话消息形成的上下文条目
- [ ] 当前 token 估算仍是前端近似值，后续可再接更精确的会话级上下文统计
- [ ] 与 NarraFork 对比还缺会话顶部 breadcrumb / 项目路径信息，以及更接近真实运行时的上下文来源分层

---

### Task 3.2：工具调用日志可视化

**目标**：把 Agent 执行过程从黑盒变成半透明。

**重点文件**：
- `packages/studio/src/components/AgentPanel.tsx`
- `packages/studio/src/components/ChatWindow.tsx`
- 新建：`packages/studio/src/components/ToolCallBlock.tsx`

**每条日志建议显示**：
- 工具名
- 开始时间
- 耗时
- 状态（成功/失败/运行中）
- 摘要输出
- 可展开原始输出

**清单**：
- [ ] 设计统一的 ToolCallBlock 结构
- [ ] 先接 Bash / Read / Write / Browser / MCP 几类核心调用
- [ ] 支持折叠和复制

**验收标准**：
- 用户能知道 AI 刚才到底做了什么，而不是只看到一句总结

**当前进度（2026-04-20）**：
- [x] 已新增统一 `ToolCallBlock` 结构，支持状态、摘要、展开/折叠、复制
- [x] 已在 `ChatWindow` 接入最小可用版工具调用日志
- [x] 已加入 mock-friendly 解析层，兼容多种 `toolCalls/tool_calls/tools` 负载格式
- [ ] 目前主要是通用结构与 ChatWindow 入口；尚未对 Bash / Read / Write / Browser / MCP 做逐类专门展示增强
- [ ] 与 NarraFork 对比还缺子代理卡片、逐步耗时、源码查看 / 全屏查看 / 重新运行等更深的过程透明化动作
- [ ] 仍需考虑是否同步接入 AgentPanel 或其他会话主视图

---

### Task 3.3：会话页即时切换模型/权限/推理强度

**目标**：减少到设置页来回跳转。

**重点文件**：
- `packages/studio/src/components/ChatBar.tsx`
- 新建：`packages/studio/src/components/ModelSelector.tsx`
- 新建：`packages/studio/src/components/PermissionModeSelector.tsx`

**清单**：
- [ ] 做可复用 `ModelSelector`
- [ ] 做权限模式下拉
- [ ] 做推理强度选择器
- [ ] 让当前会话覆盖默认设置

**验收标准**：
- 会话页成为“当前任务的控制面板”，而不是纯输入框

**当前进度（2026-04-20）**：
- [x] 已在 `ChatWindow` 增加当前会话控制区，直接展示模型、权限模式、推理强度
- [x] 已支持当前窗口内即时切换，改动写回会话对象本身（`windowStore.sessionConfig`）
- [x] 已与 `SessionCenter` 的对象化会话模型打通，新建窗口默认带会话控制配置
- [ ] 当前仍是本地会话级配置，后续可再接后端 narrator/session 配置持久化接口

---

## 6. Phase 4：平台运维能力补齐

### Task 4.1：请求历史页

**目标**：像 NarraFork 一样，让成本、延迟、Tokens 可追踪。

**重点文件**：
- 新建：`packages/studio/src/pages/UsageHistory.tsx`
- 新建对应 API 路由 / store

**建议字段**：
- 时间
- 会话/章节
- 提供商
- 模型
- 输入/输出 tokens
- TTFT
- 总耗时
- 成本
- 状态

**清单**：
- [ ] 先落表格页
- [ ] 再加筛选
- [ ] 再加统计卡片

**验收标准**：
- 能回答“这轮对话贵不贵、慢不慢、用的是谁”

**当前进度（2026-04-20）**：
- [x] 已落地 `RequestsTab`，包含总请求数 / 成功率 / 慢请求 / 平均耗时等摘要卡
- [x] 已有最近请求表格，可查看时间、方法、端点、状态、耗时、用户
- [x] 已支持 limit 切换与刷新动作，管理中心入口也已接好
- [ ] 与 NarraFork 相比，仍缺 provider / model / token / TTFT / cost / narrator / cache 等更细维度字段与筛选器
- [ ] 后续应优先让请求历史对接真实 provider/model/usage 数据，而不是继续停留在 HTTP 请求日志层

---

### Task 4.2：强化供应商页

**目标**：让模型供应结构可见，而不是藏在配置里。

**重点文件**：
- `packages/studio/src/pages/ProviderManager.tsx`
- 相关共享类型文件

**清单**：
- [ ] 显示供应商总数 / 启用数 / 模型数
- [ ] 区分平台集成 vs API Key 接入
- [ ] 每个 provider 卡片展示状态、模型数量、验证情况

**验收标准**：
- 用户能快速理解当前模型资源池

**当前进度（2026-04-20）**：
- [x] 已落地 `ProvidersTab`，支持供应商总数 / 启用数 / 模型总数摘要展示
- [x] 已支持启用 / 禁用、连接测试、API Key 显隐与模型资源池浏览
- [x] 已能在卡片中展示供应商类型、优先级、基础连接摘要
- [ ] 与 NarraFork 相比，仍缺“平台集成 vs API Key 接入”更明确分组，以及已验证 / 未验证等更细的状态分层
- [ ] 还需要把供应商页与真实模型注册表、默认模型选择、请求历史统计进一步串起来

---

### Task 4.3：存储/资源扫描页（可后置）

**目标**：为平台化留出口。

**重点文件**：
- 新建：`packages/studio/src/pages/StoragePanel.tsx`
- 新建：`packages/studio/src/pages/RuntimeResources.tsx`

**清单**：
- [ ] 先做占位页与“扫描”动作
- [ ] 后续再逐步接入真实数据

**验收标准**：
- 不必一次做完，但页面结构先站住

**当前进度（2026-04-20）**：
- [x] 已把 `ResourcesTab` 从单一资源快照页升级为“运行资源 + 存储扫描”双区块结构
- [x] 已明确区分“已接入”和“待接入”，并补齐刷新 / 扫描动作文案
- [x] 已为扫描结果区、接入状态区预留承载结构，页面骨架已站住
- [ ] 存储扫描目前仍是前端占位动作，尚未接入真实后端扫描任务与历史结果

---

## 7. Phase 5：创建流程升级

### Task 5.1：项目创建升级为“初始化工作流”

**目标**：参考 NarraFork 的“新建叙事线”。

**重点文件**：
- 新建或修改：`packages/studio/src/components/NewProjectDialog.tsx`
- 项目创建相关 API 与 store

**字段建议**：
- 项目名
- 仓库来源：本地 / 新建 / 克隆
- 路径
- 工作流模式：写作 / 策划 / 审校 / 混合
- 模板/题材初始化

**清单**：
- [ ] 把“项目创建”从目录创建升级成流程初始化
- [ ] 为后续 Git/worktree 留出字段

**验收标准**：
- 新项目创建后，用户立刻进入可工作的状态，而不是还要补一堆配置

**补充说明（基于 NarraFork 文档）**：
- NarraFork 的“新建叙事线”已经把 **仓库来源（已有 / 新建 / 克隆）** 与 **流程模式（经典 / 标尺）** 绑定在创建入口里
- 这说明项目创建不是“建一个目录”，而是正式的工作流初始化入口
- NovelFork 后续应把 Git/worktree、模板/题材、默认工作流模式一起纳入创建流程，而不是后置到多个分散页面

---

### Task 5.2：章节操作前置

**目标**：减少深层页面跳转。

**重点文件**：
- 章节列表组件
- 编辑器顶部工具栏
- 项目页组件

**清单**：
- [ ] 给章节项加快捷动作：生成标题 / 续写 / 审校 / 分叉 / Git
- [ ] 给项目页加统一操作区

**验收标准**：
- 用户不需要反复进入细页才能完成常用动作

**补充说明（基于 NarraFork 文档）**：
- NarraFork 的章节虽然是节点图，不必照抄成流程图编辑器，但它非常强调“章节状态可视化”和“章节操作前置”
- NovelFork 可以不做图编辑器，但至少要把活跃状态、运行状态、上下文临界、生成标题 / 续写 / 审校 / 分叉 / Git 等动作尽量前置到章节卡片或列表层

---

## 8. 硬编码清理专项

### 专项 A：颜色与样式硬编码
- [ ] 清查 `style={{ ... }}` 中的固定颜色值
- [ ] 清查组件里自造的 class 语义
- [ ] 所有卡片、按钮、badge 走统一 token

### 专项 B：功能入口硬编码
- [ ] 清查 Sidebar 中写死的页面顺序和入口
- [ ] 把低频功能改为配置驱动或集中页驱动

### 专项 C：文案与状态硬编码
- [ ] 清查 `InkOS`、旧品牌、旧文案残留
- [ ] 清查状态字符串与 badge 文案分散定义

### 专项 D：会话创建硬编码
- [ ] 移除 prompt 式输入 Agent ID
- [ ] 改成结构化选择器与表单

---

## 9. 执行顺序（推荐）

### 第一批：一周内能落地
- [ ] Phase 0.1 统一设计令牌
- [x] Phase 0.2 统一页面骨架
- [x] Phase 1.1 侧边栏减负
- [x] Phase 2.2 升级独立会话创建流程（第一版）

### 第二批：平台感明显提升
- [x] Phase 1.2 工作流配置台
- [x] Phase 3.1 上下文占用可视化
- [x] Phase 3.3 模型/权限/推理强度即时切换

### 第三批：从工具到平台
- [x] Phase 2.1 会话中心
- [x] Phase 3.2 工具调用日志
- [x] Phase 4.1 请求历史页
- [x] Phase 4.2 供应商页强化

### 第四批：长期深化
- [x] Phase 4.3 存储/运行资源页
- [ ] Phase 5.1 项目创建升级
- [ ] Phase 5.2 章节操作前置

---

## 10. 验收口径

当下面 6 条都成立时，可以认为 Studio 的 UI/UX 改造进入正轨：

- [ ] 侧边栏不再过载，一级入口控制在合理范围
- [ ] Agent / MCP / 插件 / 提示词 / 权限有统一入口
- [ ] 会话是正式对象，而不是附属聊天框
- [x] 当前会话的模型、权限、推理强度、上下文状态是可见的
- [x] 工具调用过程对用户半透明
- [ ] 请求历史和供应商状态可追踪

---

## 11. 一句话结论

这份改造清单的核心，不是“把界面改得像 NarraFork”，而是：

> 把 NovelFork Studio 从“功能堆积型界面”推进成“对象清晰、配置收口、AI 透明、平台能力成体系”的工作台。
