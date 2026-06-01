# Studio Frontend Rewrite Design

## 设计目标

重写 NovelFork Studio 前端，停止在旧前端上继续 UIUX patch。新前端第一阶段聚焦三个可验收闭环：

1. **创作工作台**：专门为小说创作设计，学习小说写作软件。
2. **设置页**：学习 NarraFork 的管理型设置布局。
3. **套路页**：直接学习 NarraFork 的 AI 专业功能集合。

本设计明确：NarraFork 的叙事线、叙述者、章节节点图不作为小说创作主界面参考。NovelFork 的主对象是作品、卷、章节、生成稿、草稿和经纬资料，而不是 AI 会话。

## 设计原则

### 1. 小说创作优先

新前端主入口必须服务小说创作：查看已有章节、生成章节、草稿、正文编辑、资料引用和 AI 辅助创作。

### 2. AI 服务正文，不替代正文

AI 面板是辅助工具。AI 输出必须先进入生成章节或草稿候选，再由用户确认合并到正式正文。

### 3. NarraFork 只用于固定 AI 工作台能力

设置页和套路页可直接学习 NarraFork：这些是 AI 工作台基础设施，不需要被小说化重命名。

### 4. 旧前端冻结

旧前端保留回退，但不再进行 UIUX 修补。新前端以旁路方式建设，达到替代标准后再删除旧页面。

### 5. 每页必须有任务闭环

页面不能只有卡片和说明。每个页面必须有至少一条能完成真实任务的点击路径。

### 6. 先复用，再重写

前端重写不是功能重造。旧前端中已经真实接入 API、数据模型和测试的能力必须优先迁移、包裹或复用；只有当旧实现与新页面模型冲突时，才允许替换，并且要写明替换理由。

## 调研事实矩阵

### NarraFork 设置页事实

设置页要学习的不只是字段，而是 NarraFork 的管理型页面范式：

```text
左侧稳定分区导航
  → 右侧当前分区详情
    → 分区总览指标
      → 资源卡片 / 列表
        → 单项详情页 / 编辑表单
          → 保存 / 刷新 / 测试 / 禁用 / 删除
```

这个范式必须应用到所有设置分区。AI 供应商页只是最典型样板：先显示供应商总览，再按平台集成/API key 接入分组展示卡片；点击供应商进入详情；详情中可配置 API key、Base URL、API 模式；保存后刷新模型；模型行可单独测试、设上下文长度、禁用。

| 分区 | 已实测能力 | NovelFork 映射 |
|---|---|---|
| 个人资料 | 头像上传、Git 用户名、Git 邮箱 | `ProfilePanel` 可作为基础，头像上传若未接入则显示未接入 |
| 模型 | 默认模型、摘要模型、Explore/Plan 子代理模型偏好、模型池限制、全局/Codex 推理强度、模型列表入口 | 复用 provider catalog、agent/runtime config、Admin Providers |
| AI 代理 | 默认权限、最大轮次、旧编码、刷新 Shell、翻译思考、Dump 请求、默认展开推理、宽松规划、输出中断检查、重试/退避、自定义重试规则、WebFetch 代理、上下文阈值、会话行为、token/速率调试、目录/命令白名单黑名单 | 复用 `RuntimeControlPanel`、tool access、request observability、session permission modes |
| 通知 | 通知配置 | 复用旧通知配置或显示未接入 |
| 外观与界面 | 主题/界面配置 | 复用 `AppearancePanel` |
| 服务器与系统 | 运行资源、启动诊断、系统信息 | 复用 Admin Resources / startup diagnostics |
| 使用历史 | 请求历史、token、TTFT、成本 | 复用 `RequestsTab` / `/api/admin/requests` |
| 关于 | 版本、commit、平台、作者、更新日志 | 复用 `ReleaseOverview` |

### 设置页统一交互模式

所有设置分区都必须满足同一套交互骨架，避免只把 AI 供应商页做细，其他页退回配置堆叠。

| 页面层级 | 目的 | 设计要求 |
|---|---|---|
| 分区导航 | 快速定位能力域 | 左侧固定；分组显示个人设置/实例管理；当前项高亮 |
| 分区总览 | 先让用户理解当前状态 | 显示 2-4 个关键指标，例如供应商总数、启用数、可用模型数、连接状态 |
| 资源分组 | 降低复杂度 | 按平台集成/API key 接入、系统/用户、已启用/未启用等自然分组 |
| 资源卡片 | 快速比较和进入 | 卡片显示名称、类型、状态、数量、摘要；有启用开关和进入详情动作 |
| 单项详情 | 完成具体配置 | 表单只显示当前对象字段；高级字段折叠；明确保存 |
| 即时动作 | 验证是否可用 | 刷新、测试、禁用、删除、查看错误必须可见 |
| 反馈状态 | 建立信任 | 保存成功、测试延迟、错误原因、模型数量、最近刷新时间必须展示 |

### AI 供应商页范式

AI 供应商页是设置页最重要样板，新前端应按截图反馈设计：

- 供应商总览：供应商总数、已启用、可用模型数。
- 分组：平台集成、API key 接入。
- 卡片：供应商名、接入类型、启用开关、模型摘要。
- 添加供应商：短表单，至少包含供应商名称、供应商前缀、API Key、Base URL、API 模式。
- API 模式：`Completions`、`Responses`、`Codex`。
- 模式说明：GPT-4 及更老模型、国产模型选择 Completions；GPT-4o 及更新模型选择 Responses；Codex 反代选择 Codex 并支持思考强度。
- 保存后动作：刷新模型列表。
- 模型行操作：单独测试、设置上下文长度、禁用/启用。
- 连接反馈：成功/失败、错误信息、延迟、可用模型数量。

### NarraFork 套路页事实

| 分区 | 已实测能力 | 当前旧前端状态 | 新前端处理 |
|---|---|---|---|
| 命令 | `/命令名`、空态、添加命令 | `CommandsTab` 已有增删改、启用、prompt | 迁移表单逻辑，改中文与布局 |
| 可选工具 | 工具名、`/LOAD`、说明、开关；Terminal/ShareFile/Recall/Browser/ForkNarrator/NarraForkAdmin | `ToolsTab` 仅内置工具列表与开关，工具集合偏旧 | 扩展工具 catalog 与 `/LOAD` 展示 |
| 工具权限 | 内置工具、MCP 工具权限、Bash allow/block/default | `PermissionsTab` 有 allow/ask/deny 和 pattern | 复用表单，补来源、Bash allow/block、MCP 规则 |
| 全局技能 | 扫描路径、刷新、创建技能 | `SkillsTab` 合并 global/project | 拆分为独立 tab |
| 项目技能 | 项目级技能 | `SkillsTab` 合并 global/project | 拆分为独立 tab |
| 自定义子代理 | 专用提示词与工具权限、创建子代理 | `SubAgentsTab` 已有基础数据结构 | 补工具权限字段与创建体验 |
| 全局提示词 | 全局提示词管理 | `PromptsTab` 合并 global/system | 拆分为独立 tab |
| 系统提示词 | 系统提示词管理 | `PromptsTab` 合并 global/system | 拆分为独立 tab |
| MCP 工具 | 导入 JSON、添加服务器、连接状态、传输方式、工具数量、断开、编辑 | `MCPToolsTab` 只管理工具审批/启用 | 升级为服务器级管理，复用 `MCPServerManager`/registry 能力 |
| 钩子 | Shell/Webhook/LLM 生命周期钩子、创建钩子 | 旧 Routines 缺失；`WorkflowWorkbench` 有 hooks 入口 | 新增独立 tab，复用 `HookDashboard` 或对应 API |

## 当前任务与复用边界

| Spec / 旧代码 | 状态 | 新前端关系 |
|---|---|---|
| `narrafork-platform-upgrade` | 任务 1-15 已完成 | 复用 Bun/SQLite、会话恢复、请求历史、权限模式、Admin Resources/Requests，不重建底座 |
| `writing-presets-v1` | requirements/design 已定义，相关代码在推进 | 第一阶段不重写预设中心；创作工作台只预留入口和读取已启用预设 |
| `writing-tools-v1` | 任务 1-12 已完成，13-25 待推进 | 创作工作台必须承接 `components/writing-tools/`，不重复写节奏/对话/钩子/POV/日更等组件 |
| `platform-compliance-v1` | 任务 1-12 已完成，13 验证待执行 | 发布就绪/合规作为现有页面或工作台入口复用，不第一阶段重写 |
| `writing-modes-v1` | 定义细粒度 AI 写作模式 | 创作工作台右侧 AI 面板为这些模式预留：选段续写、扩写、对话、多版本、补写、大纲分支 |
| `SettingsView.tsx` | 已有设置分区与 Runtime/Release 组件 | 迁移已接入面板，不重复写运行时和版本信息 |
| `Routines.tsx` + `/api/routines/*` | 已有 7 tab、scope 与持久化 | 保留 API 与类型，补齐 NarraFork 缺口 |
| `BibleView.tsx` + `/api/books/:bookId/bible/*` | 已有经纬资料 API/页面 | 创作工作台资料库面板复用 Bible 数据，不新建孤立 codex 表 |
| `BookDetail.tsx` / `ChapterReader.tsx` | 已有书籍与章节入口、写作工具挂载点 | 新创作工作台迁移其真实动作，不照搬旧布局 |

## 禁止重复实现清单

- 不重复实现 Routines 读写 API；复用 `/api/routines/global|project|merged|reset`。
- 不重复实现 AI 请求历史；复用 `/api/admin/requests` 和 `RequestsTab`。
- 不重复实现启动诊断/资源扫描；复用 Admin Resources。
- 不重复实现写作工具核心算法；复用 `packages/core/src/tools/` 与 `packages/studio/src/components/writing-tools/`。
- 不重复实现合规扫描；复用 `packages/core/src/compliance/`、`api/routes/compliance.ts`、`components/compliance/`。
- 不重复实现经纬资料库；复用 Bible/Jingwei repositories 与 API。
- 不重复实现 provider/model catalog；复用现有 provider catalog 与 settings/provider API。

## 信息架构

```text
NovelFork Studio Next
├─ 创作工作台
│  ├─ 资源管理器
│  │  ├─ 作品
│  │  ├─ 卷
│  │  ├─ 已有章节
│  │  ├─ 生成章节
│  │  ├─ 草稿
│  │  ├─ 大纲
│  │  └─ 经纬 / 资料库
│  ├─ 主编辑器
│  │  ├─ 正文编辑
│  │  ├─ 章节状态
│  │  ├─ 字数 / 保存状态
│  │  └─ 对照视图
│  └─ AI / 经纬面板
│     ├─ 生成下一章
│     ├─ 按大纲生成
│     ├─ 续写
│     ├─ 审校
│     ├─ 改写
│     ├─ 去 AI 味
│     ├─ 连续性检查
│     └─ 抽取到经纬
├─ 设置
│  ├─ 个人资料
│  ├─ 模型
│  ├─ AI 代理
│  ├─ 通知
│  ├─ 外观与界面
│  ├─ 服务器与系统
│  ├─ 存储空间
│  ├─ 运行资源
│  ├─ 使用历史
│  └─ 关于
└─ 套路
   ├─ 命令
   ├─ 可选工具
   ├─ 工具权限
   ├─ 全局技能
   ├─ 项目技能
   ├─ 自定义子代理
   ├─ 全局提示词
   ├─ 系统提示词
   ├─ MCP 工具
   └─ 钩子
```

## 页面设计

### 创作工作台

#### 布局

```text
┌───────────────────────────────────────────────────────────┐
│ 顶栏：作品选择 / 搜索 / 当前运行状态 / 设置 / 套路             │
├────────────────┬───────────────────────────┬──────────────┤
│ 资源管理器       │ 主编辑器 / 对照视图           │ AI / 经纬面板  │
│                │                           │              │
│ 作品            │ 章节标题 / 状态 / 字数 / 保存   │ 生成下一章      │
│ 卷              │ 正文编辑器                    │ 续写           │
│ 已有章节         │                           │ 审校           │
│ 生成章节         │ 生成稿 vs 已有稿              │ 改写           │
│ 草稿            │ 大纲 vs 正文                  │ 去 AI 味       │
│ 大纲            │ 前文 vs 当前章                │ 连续性检查      │
│ 经纬/资料库       │                           │ 相关经纬        │
└────────────────┴───────────────────────────┴──────────────┘
```

#### 资源管理器

资源管理器是创作工作台左侧核心，不是普通导航菜单。它负责表达小说资产结构。

首阶段对象：

- 作品
- 卷
- 已有章节
- 生成章节
- 草稿
- 大纲
- 经纬/资料库
  - 人物
  - 地点
  - 势力
  - 物品
  - 伏笔
  - 世界规则

资源管理器必须区分正式资产和候选资产：

- 已有章节：可被视为正式正文。
- 生成章节：AI 候选稿，不自动进入正式树。
- 草稿：用户或 AI 未定稿内容。

#### 主编辑器

主编辑器以正文为中心。打开已有章节时，中央区域显示正文编辑；打开生成章节时，中央区域显示候选稿，并提供合并、替换、另存草稿动作。

编辑器需要显示：

- 章节标题
- 章节状态
- 字数
- 保存状态
- 当前视图：编辑 / 对照 / 预览

第一阶段对照视图至少支持一种，优先顺序：

1. 生成稿 vs 已有章节
2. 大纲 vs 正文
3. 前文 vs 当前章
4. 原文 vs 修订稿

#### AI / 经纬面板

右侧面板服务当前章节，包含两类内容：

1. AI 操作
   - 生成下一章
   - 按大纲生成
   - 续写当前段落
   - 审校当前章
   - 改写选中段落
   - 去 AI 味
   - 连续性检查

2. 相关经纬
   - 当前章节相关人物
   - 地点
   - 伏笔
   - 前文摘要
   - 大纲目标
   - 风格提示

AI 输出流向：

```text
AI 操作 → 生成章节 / 草稿候选 → 用户确认 → 合并到已有章节或保留为草稿
```

禁止直接覆盖正式正文。

### 设置页

设置页学习 NarraFork 的管理型设置模式。它不是创作页面，也不混入小说工作流。

分区：

- 个人资料
- 模型
- AI 代理
- 通知
- 外观与界面
- 服务器与系统
- 存储空间
- 运行资源
- 使用历史
- 关于

设置页可以展示尚未接入的配置，但必须明确标记“未接入”或“只读”，不得伪造成可用。

### 套路页

套路页直接学习 NarraFork 的 Routines 页面，保持 AI 专业功能集合，不做过度小说化改名。

固定分区：

- 命令
- 可选工具
- 工具权限
- 全局技能
- 项目技能
- 自定义子代理
- 全局提示词
- 系统提示词
- MCP 工具
- 钩子

每个分区的首阶段目标：

| 分区 | 首阶段能力 |
|---|---|
| 命令 | 查看、添加、编辑、删除命令 |
| 可选工具 | 查看工具名称、说明、启用状态 |
| 工具权限 | 查看/管理工具权限分类 |
| 全局技能 | 查看、刷新、创建入口 |
| 项目技能 | 查看当前项目技能 |
| 自定义子代理 | 查看、创建入口、权限说明 |
| 全局提示词 | 查看、编辑入口 |
| 系统提示词 | 查看、编辑入口 |
| MCP 工具 | 导入 JSON、添加服务器、状态、工具数量 |
| 钩子 | 查看、创建入口 |

套路页可以在说明中提供小说场景示例，但分区名称和能力模型保持 AI 工作台专业口径。

## 技术边界

### 旧前端处理

- 保留旧 `packages/studio/src` 作为回退。
- 不在旧 `App.tsx` 上继续加 UIUX 改造。
- 若需要接入新入口，应通过隔离路由或新 entry，而不是复用旧页面结构。

### 新前端目录建议

可选方案：

1. `packages/studio/src-next/`
   - 优点：复用当前包、API client、构建环境。
   - 缺点：需要明确隔离旧 src。

2. `packages/studio-next/`
   - 优点：隔离最彻底。
   - 缺点：需要额外配置 workspace、构建、开发脚本。

首阶段推荐：`packages/studio/src-next/` 或 `packages/studio/src/app-next/`，降低搭建成本，但必须保持路由、组件、状态与旧页面隔离。

### API 复用

新前端应优先复用现有后端能力：

- 书籍 / 章节 API
- 经纬 / Bible API
- 会话 / AI 运行 API
- Routines API
- Admin / Requests API
- Provider / 模型配置 API

若后端缺能力，前端应显示“未接入”状态，不得伪造假功能。

## 数据对象草案

### StudioResourceNode

```ts
interface StudioResourceNode {
  id: string;
  type: "book" | "volume" | "chapter" | "generated-chapter" | "draft" | "outline" | "codex-group" | "codex-entry";
  title: string;
  status?: "draft" | "generated" | "reviewing" | "final" | "error";
  parentId?: string;
  metadata?: Record<string, unknown>;
}
```

### ChapterWorkspaceState

```ts
interface ChapterWorkspaceState {
  activeResourceId: string | null;
  editorMode: "edit" | "compare" | "preview";
  compareTargetId?: string;
  rightPanelTab: "ai" | "codex" | "outline" | "runs";
}
```

### GeneratedChapterCandidate

```ts
interface GeneratedChapterCandidate {
  id: string;
  bookId: string;
  targetChapterId?: string;
  title: string;
  content: string;
  source: "generate-next" | "rewrite" | "continue" | "audit-fix";
  createdAt: string;
  status: "candidate" | "accepted" | "rejected" | "archived";
}
```

## 验收路径

第一阶段只验收三条路径。

### 路径 1：创作工作台

1. 打开新前端。
2. 选择或进入一本书。
3. 左侧看到资源管理器。
4. 点击已有章节。
5. 中央打开正文编辑器。
6. 点击右侧“生成下一章”。
7. AI 输出进入生成章节/草稿区域。
8. 用户可以打开候选稿并选择合并/另存/放弃。

### 路径 2：设置页

1. 打开设置。
2. 左侧/分区看到个人资料、模型、AI 代理、通知、外观、服务器、存储、运行资源、使用历史、关于。
3. 点击模型。
4. 看到默认模型、摘要模型、子代理模型偏好或未接入状态。
5. 点击关于。
6. 看到版本、commit、平台信息。

### 路径 3：套路页

1. 打开套路。
2. 看到命令、可选工具、工具权限、全局技能、项目技能、自定义子代理、全局提示词、系统提示词、MCP 工具、钩子。
3. 点击 MCP 工具。
4. 看到导入 JSON、添加 MCP 服务器、连接状态、工具数量入口或未接入状态。
5. 点击命令。
6. 能查看命令列表并进入添加命令流程。

## 非目标

第一阶段不做：

- 旧前端物理删除
- 完整发布系统
- 完整移动端适配
- 复杂节点图编辑器
- NarraFork 式叙事线主流程
- NarraFork 式叙述者中心主流程
- 完整世界观百科系统
- 预设中心重写
- 所有后端缺口一次性补齐

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 重写再次变成大而全 | 第一阶段只做三条验收路径 |
| 旧前端影响新设计 | 新入口隔离，旧前端冻结 |
| AI 功能伪完成 | AI 输出必须进入生成章节/草稿并可操作 |
| 套路页被小说化导致专业能力丢失 | 固定采用 NarraFork Routines 功能集合 |
| 设置页伪造配置 | 未接入项必须明确标记 |
| 创作工作台变成聊天页 | 主对象固定为资源管理器和章节编辑器 |
