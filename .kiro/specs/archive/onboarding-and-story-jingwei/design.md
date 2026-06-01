# Design Document

## Overview

本设计将 NovelFork 的首用体验从“未配置 AI 就触发失败”改为“配置模型是第一步，但不是硬阻断”；同时把用户侧的 Bible 概念重命名为 **故事经纬 / 经纬**，并把经纬从固定 4 表或固定 10 维度升级为“可编辑栏目 + 通用条目 + AI 上下文动态装配”的作者向知识系统。

本 spec 不是完整重写 `novel-bible-v1` 的底层能力，而是在现有 Bible / AI 味过滤 / Studio UI 基础上补齐：

- 首次欢迎弹窗
- 首页开始使用任务清单
- 模型配置第一步但不阻断
- 新建书籍本地优先路径
- 故事经纬命名与 UI 迁移
- 故事经纬可编辑栏目结构
- 功能页空态教学
- 作者模式 / 工作台模式边界
- shadcn/ui 设计系统约束

## Goals

- 让用户第一次打开软件时知道“先配模型，但不配也能先用”。
- 彻底消除“未配置 provider 导致无法建书 / 无法看软件”的首用阻断。
- 将 UI 里的 Bible 改为更中文、更作者向的“故事经纬 / 经纬”。
- 保留惯用词：人物、事件、设定、章节摘要、伏笔、名场面、核心记忆。
- 支持每本书自定义故事经纬栏目，避免把《没钱修什么仙》结构当通用标准。
- 使用 shadcn/ui 作为新增 UI 的基础组件体系，保持 Studio 视觉一致。

## Non-Goals

- 不实现完整模板市场。
- 不实现大型预制世界资产包。
- 不破坏性重命名已有 `bible_*` 数据库表。
- 不实现完整 Coding Agent 工作台，仅定义入口与模式边界。
- 不实现关系图可视化。
- 不实现自动重写已写章节。
- 不改动 provider 凭据来源或第三方平台授权机制。

## Design Principles

### 配置模型是第一步，但不是门槛

首页和首次欢迎都把 `配置 AI 模型` 放在第一位；但应用启动、本地建书、故事经纬维护、章节编辑都不依赖 provider。

### 故事经纬是可编辑结构

默认基础经纬只有人物 / 事件 / 设定 / 章节摘要。伏笔 / 名场面 / 核心记忆是增强栏目。其他题材专属结构必须可选导入、可编辑、可删除。

### 范本不等于标准

`D:/DESKTOP/novelfork/没钱修什么仙` 是高级范本与导入样例，不是默认 schema。v0.4 调研结论优先于 v0.3 的激进预制资产方案。

### 作者模式优先

默认 UI 服务写作，不展示 Terminal、MCP、Browser、Shell 权限等 coder 概念。工作台模式需要用户显式开启。

## UI Foundation：shadcn/ui

新增界面基于 **shadcn/ui + Tailwind CSS**，遵守现有 Studio 主题变量。

推荐组件映射：

| 场景 | shadcn/ui 组件 |
|---|---|
| 首次欢迎弹窗 | `Dialog`, `Card`, `Button`, `Badge` |
| 首页任务清单 | `Card`, `Button`, `Badge`, `Checkbox`, `Progress`, `Separator` |
| 模型配置提示 | `Alert`, `Button`, `Dialog` |
| 新建书籍流程 | `Dialog`, `Form`, `Input`, `Select`, `Tabs`, `Checkbox`, `Switch` |
| 经纬栏目管理 | `Tabs`, `Table`, `DropdownMenu`, `Dialog`, `Form`, `Input`, `Textarea`, `Switch` |
| 功能页空态 | `Card`, `Alert`, `Button`, `Badge` |
| 工作台模式说明 | `Dialog`, `Sheet`, `Alert`, `Button` |
| 字段编辑器 | `Form`, `Input`, `Textarea`, `Select`, `Checkbox`, `Switch` |

样式原则：

- 复用现有 `bg-background`, `text-foreground`, `border-border`, `bg-card`, `text-muted-foreground`, `bg-primary` 等 token。
- 保持暗色模式可读。
- 不引入新的 UI 框架。
- 不写大段独立 CSS；复杂布局用 Tailwind utility 与现有组件组合。
- 所有 Dialog / Sheet / Dropdown 必须键盘可达、焦点清晰、aria label 完整。

## Architecture

### 分层

```text
packages/core/src/jingwei/
  types.ts                         ← StoryJingweiSection / StoryJingweiEntry / visibility 类型
  templates.ts                     ← 空白 / 基础 / 增强 / 题材推荐模板
  context/
    build-jingwei-context.ts       ← 从当前书启用栏目动态装配 AI 上下文
    visibility-filter.ts           ← tracked / global / nested + 时间线过滤
    section-adapter.ts             ← legacy bible_* 与 jingwei 通用模型之间的适配
  repositories/
    section-repo.ts
    entry-repo.ts

packages/studio/src/api/routes/jingwei/
  sections.ts                      ← 栏目 CRUD
  entries.ts                       ← 条目 CRUD
  templates.ts                     ← 模板列表 / 应用模板
  preview-context.ts               ← AI 上下文预览

packages/studio/src/components/onboarding/
  FirstRunDialog.tsx
  GettingStartedChecklist.tsx
  OnboardingProvider.tsx

packages/studio/src/components/jingwei/
  JingweiPage.tsx
  JingweiSectionTabs.tsx
  JingweiSectionManager.tsx
  JingweiEntryList.tsx
  JingweiEntryForm.tsx
  JingweiEmptyState.tsx
  VisibilityRuleEditor.tsx
  CustomFieldEditor.tsx

packages/studio/src/components/workbench/
  WorkbenchModeGate.tsx
  WorkbenchIntroEmptyState.tsx
```

### 与现有 Bible 模块关系

短期设计不破坏已有 `novel-bible-v1`：

- 内部已有 `bible_*` 表可继续存在。
- UI 层将这些数据适配为故事经纬栏目。
- 后续如果需要统一 schema，可以通过独立 migration spec 做非破坏性迁移。

适配关系：

| Legacy | Story Jingwei |
|---|---|
| `bible_character` | 人物栏目条目 |
| `bible_event` | 事件栏目条目 |
| `bible_setting` | 设定栏目条目 |
| `bible_chapter_summary` | 章节摘要栏目条目 |
| `bible_conflict` / 其他高级对象 | 自定义或增强栏目条目 |

## Data Model

### StoryJingweiSection

```ts
export interface StoryJingweiSection {
  id: string;
  bookId: string;
  key: string;                    // people | events | settings | chapter-summary | custom-...
  name: string;                   // 人物 / 事件 / 设定 / 章节摘要 / 自定义
  description: string;
  icon?: string;
  order: number;
  enabled: boolean;
  showInSidebar: boolean;
  participatesInAi: boolean;
  defaultVisibility: VisibilityRuleType;
  fieldsJson: JingweiFieldDefinition[];
  builtinKind?: "people" | "events" | "settings" | "chapter-summary" | "foreshadowing" | "iconic-scenes" | "core-memory";
  sourceTemplate?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}
```

### JingweiFieldDefinition

```ts
export interface JingweiFieldDefinition {
  id: string;
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "multi-select" | "chapter" | "tags" | "relation" | "boolean";
  required: boolean;
  options?: string[];
  helpText?: string;
  participatesInSummary?: boolean;
}
```

### StoryJingweiEntry

```ts
export interface StoryJingweiEntry {
  id: string;
  bookId: string;
  sectionId: string;
  title: string;
  contentMd: string;
  tags: string[];
  aliases: string[];
  customFieldsJson: Record<string, unknown>;
  relatedChapterNumbers: number[];
  relatedEntryIds: string[];
  visibilityRule: VisibilityRule;
  participatesInAi: boolean;
  tokenBudget?: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}
```

### VisibilityRule

```ts
export type VisibilityRuleType = "tracked" | "global" | "nested";

export interface VisibilityRule {
  type: VisibilityRuleType;
  visibleAfterChapter?: number;
  visibleUntilChapter?: number;
  keywords?: string[];
  parentEntryIds?: string[];
}
```

### Persistence Strategy

优先方案：新增通用表，legacy 表用 adapter 兼容。

```ts
story_jingwei_section
  id
  book_id
  key
  name
  description
  icon
  order
  enabled
  show_in_sidebar
  participates_in_ai
  default_visibility
  fields_json
  builtin_kind
  source_template
  created_at
  updated_at
  deleted_at

story_jingwei_entry
  id
  book_id
  section_id
  title
  content_md
  tags_json
  aliases_json
  custom_fields_json
  related_chapter_numbers_json
  related_entry_ids_json
  visibility_rule_json
  participates_in_ai
  token_budget
  created_at
  updated_at
  deleted_at
```

兼容策略：

1. 若一本书已有 legacy bible 数据但没有 `story_jingwei_section`，首次进入经纬页时生成 section 映射。
2. Legacy 数据只读或双写策略由实现阶段确认；本 spec 推荐短期 adapter 展示，新增自定义栏目写入通用表。
3. 不做破坏性 rename，不删除已有表。

## Onboarding Flow

### FirstRunDialog

显示条件：

```ts
showFirstRunDialog = !userPrefs.onboarding.dismissedFirstRun;
```

内容结构：

```text
欢迎使用 NovelFork

建议先配置 AI 模型；如果只是想先看看软件，也可以跳过配置，直接创建本地书籍。

[配置 AI 模型]
  配置后可使用续写、改写、评点、消 AI 味、生成经纬、工作台 Agent。

[创建第一本书]
  不配置模型也可以创建本地书籍，整理故事经纬，写章节。

[了解工作台模式]
  高级 Agent 能力，普通写作不需要开启。
```

交互：

- `配置模型`：打开设置中的模型配置页或 provider 配置 Dialog。
- `新建书籍`：关闭弹窗并打开新建书籍流程。
- `先看看界面 / 暂时跳过`：关闭弹窗，进入首页。
- 关闭后写入 `kv_store` 或用户设置。

### GettingStartedChecklist

状态源：

```ts
interface GettingStartedState {
  modelConfigured: boolean;
  modelLastTest?: "success" | "failed" | "unknown";
  hasAnyBook: boolean;
  hasOpenedJingwei: boolean;
  hasAnyChapter: boolean;
  hasTriedAiWriting: boolean;
  hasTriedAiTasteScan: boolean;
  hasReadWorkbenchIntro: boolean;
  dismissed: boolean;
}
```

任务顺序固定：

1. 配置 AI 模型
2. 创建第一本书
3. 认识故事经纬
4. 创建第一章 / 导入正文
5. 试用 AI 写作与评点
6. 试用 AI 味检测
7. 了解工作台模式

未配置模型时，第 1 项显示推荐状态，第 5 项显示需要模型但不报错。

## Book Creation Flow

### Step 1：基础信息

字段：

- 书名
- 题材
- 平台
- 每章字数
- 目标章数
- 工作流模式：先大纲 / 先开稿 / 连载推进

### Step 2：故事经纬结构

选项：

#### 空白经纬

不创建默认栏目。

#### 基础经纬，默认推荐

```text
人物
事件
设定
章节摘要
```

#### 增强经纬

```text
人物
事件
设定
章节摘要
伏笔
名场面
核心记忆
```

#### 按题材推荐

题材推荐只生成候选清单，用户可以勾选。

示例：

```text
修仙 / 玄幻：境界体系、功法、势力、资源、法宝、秘境
悬疑 / 盗墓：线索、谜团、误导项、案件时间线、真相层
女频 / 感情流：关系变化、情感节点、误会与和解、家庭关系、人物成长
科幻：科技树、星图、组织、术语表、实验记录
都市：职业线、关系网、资产、城市地图、社会身份
```

#### 导入已有经纬

支持：

- Markdown 目录
- JSON
- 现有 NovelFork 书籍
- 《没钱修什么仙》式目录结构

导入说明必须提示：高级范本是参考，不是默认标准。

### Step 3：AI 初始化，可选

若模型已配置：

- 使用 AI 生成初始故事经纬
- 使用 AI 生成简介 / 卖点
- 使用 AI 生成前三章方向

若模型未配置：

显示 Alert：

```text
当前尚未配置 AI 模型。你仍然可以创建本地书籍，稍后再用 AI 补全故事经纬和大纲。
```

主按钮永远是：

```text
创建本地书籍
```

AI 初始化失败时不回滚本地书籍。

## Story Jingwei UI

### 页面结构

```text
故事经纬
  顶部说明 + 当前书经纬模式
  操作区：新建条目 / 管理栏目 / 导入 / 预览 AI 上下文
  栏目 Tabs：人物 / 事件 / 设定 / 章节摘要 / ...
  当前栏目内容区
  空态或条目列表
```

### Section Manager

字段：

- 栏目名
- 说明
- 图标
- 排序
- 是否启用
- 是否显示在侧栏
- 是否参与 AI
- 默认可见性
- 字段定义

字段定义编辑器允许新增字段：

```text
字段标签
字段 key
字段类型
是否必填
是否参与摘要
帮助说明
```

### Entry Form

通用表单：

- 标题
- 正文 Markdown
- 标签
- 别名 / 关键词
- 关联章节
- 关联条目
- 自定义字段
- 可见性规则
- 是否参与 AI
- token 预算

可见性编辑器：

```text
可见性类型：tracked / global / nested
章节可见：visible_after_chapter / visible_until_chapter
关键词：用于 tracked 命中
父条目：用于 nested
```

## Empty State Design

空态不是“暂无数据”，而是教学组件。

统一结构：

```text
标题
一句话解释功能价值
2-4 个下一步动作
可选：模型配置提示 / 示例入口
```

### 故事经纬空态

动作：创建栏目、使用基础经纬、导入经纬、查看示例。

### 人物空态

动作：新建人物、从正文提取人物、导入人物表。

### 设定空态

动作：新建设定、导入设定、用 AI 生成设定。

### 伏笔空态

动作：新建伏笔、从章节标记伏笔、检查未回收伏笔。

### 名场面空态

动作：记录名场面、从章节提取、设计名场面。

### 核心记忆空态

动作：创建核心记忆、从经纬生成核心记忆、查看核心记忆示例。

### AI 味检测空态

动作：检测一段文字、检测当前章节、查看 AI 味 12 特征。

### 工作台模式空态

动作：开启工作台模式、查看能做什么、查看权限说明。

## AI Graceful Degradation

统一判断：

```ts
function requireModelForAiAction(action: AiAction): AiGateResult {
  if (providerStatus.hasUsableModel) return { ok: true };
  return {
    ok: false,
    reason: "model-not-configured",
    message: "此功能需要配置 AI 模型。你可以先配置模型，也可以继续使用本地写作功能。",
  };
}
```

触发位置：

- AI 续写
- AI 改写
- AI 评点
- AI 生成故事经纬
- AI 深度味检测
- Coding Agent / 工作台任务

不触发位置：

- 应用启动
- 首页浏览
- 新建本地书籍
- 手动编辑章节
- 手动编辑故事经纬
- 基础规则版 AI 味检测
- 查看功能说明 / 空态

提示 Dialog：

```text
此功能需要配置 AI 模型

配置模型后可使用续写、改写、评点、生成故事经纬等能力。

[配置模型] [取消]
```

要求：不清空当前输入，不关闭当前编辑器，不丢失选中文本。

## Dynamic Jingwei Context Assembly

`buildJingweiContext()` 取代 UI 层对固定栏目名的假设。

```ts
export interface BuildJingweiContextInput {
  bookId: string;
  currentChapter: number;
  sceneText?: string;
  tokenBudget?: number;
}

export interface JingweiContextResult {
  items: JingweiContextItem[];
  totalTokens: number;
  droppedEntryIds: string[];
  sectionStats: Array<{ sectionId: string; sectionName: string; count: number }>;
}
```

流程：

```text
1. 加载当前书启用且 participatesInAi=true 的栏目
2. 加载这些栏目下未删除且 participatesInAi=true 的条目
3. 按 visible_after_chapter / visible_until_chapter 做时间线过滤
4. global 直接进入候选
5. tracked 用标题 / 别名 / 关键词扫描 sceneText
6. nested 从已命中条目的 relatedEntryIds / parentEntryIds 展开
7. 核心记忆栏目优先进入预算
8. 按 tokenBudget 裁剪
9. 返回格式化上下文
```

格式：

```text
【核心记忆】...
【人物】张三：...
【设定】灵气规则：...
【自定义-线索】纸条：...
```

重要约束：

- 不假设存在羽书系统、现实映射、势力机构等特定栏目。
- 没有某栏目时不报错。
- 当前书有什么栏目，AI 就按什么栏目组织上下文。

## Author Mode / Workbench Mode

### Author Mode

默认入口：

- 书籍列表
- 书籍总览
- 章节编辑
- 故事经纬
- AI 写作
- AI 味检测
- 写作预设
- 设置

默认隐藏：

- Terminal
- MCP
- Browser
- Git worktree
- Shell 权限
- Agent 原始日志
- NarraForkAdmin

### Workbench Mode

开启入口：

- 首页任务清单最后一项
- 设置页
- 工作台空态

开启前 Dialog：

```text
工作台模式会暴露高级工具和更高 token 消耗。普通写作不需要开启。
```

开启后入口：

- Agent 控制台
- 工具调用记录
- 文件树
- 终端
- MCP 工具
- 扫榜任务
- 批量资料任务
- 一致性审计任务
- 提示词 A/B 测试

状态存储：用户级偏好。

## API Sketch

### Onboarding

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/onboarding/status` | 获取首次引导与任务状态 |
| PATCH | `/api/onboarding/status` | 更新 dismissed / task completed 状态 |

### Story Jingwei Sections

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/books/:bookId/jingwei/sections` | 栏目列表 |
| POST | `/api/books/:bookId/jingwei/sections` | 新增栏目 |
| PUT | `/api/books/:bookId/jingwei/sections/:sectionId` | 更新栏目 |
| DELETE | `/api/books/:bookId/jingwei/sections/:sectionId` | 软删 / 归档栏目 |
| POST | `/api/books/:bookId/jingwei/templates/apply` | 应用空白 / 基础 / 增强 / 题材模板 |

### Story Jingwei Entries

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/books/:bookId/jingwei/entries?sectionId=` | 条目列表 |
| POST | `/api/books/:bookId/jingwei/entries` | 新建条目 |
| PUT | `/api/books/:bookId/jingwei/entries/:entryId` | 更新条目 |
| DELETE | `/api/books/:bookId/jingwei/entries/:entryId` | 软删条目 |
| POST | `/api/books/:bookId/jingwei/preview-context` | 预览当前章节 AI 上下文 |

### Provider Gate

可复用现有 provider 状态接口；若不存在，补：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/providers/status` | 返回是否有可用模型、默认模型、最近连接错误 |

## Migration / Compatibility

### 阶段 1：UI 命名替换

- 侧边栏和页面文案从 Bible 改为故事经纬 / 经纬。
- 内部 API 可暂时保持 `bible`，通过 adapter 输出 jingwei 视图。

### 阶段 2：新增通用 section / entry

- 添加 `story_jingwei_section` 与 `story_jingwei_entry`。
- 对 legacy 4 表生成默认栏目映射。
- 新增自定义栏目写通用表。

### 阶段 3：上下文构建切换

- 新 AI 功能使用 `buildJingweiContext()`。
- 旧 `buildBibleContext()` 可包装调用新函数或保持兼容。

### 阶段 4：导入范本

- 支持 Markdown 目录导入。
- 《没钱修什么仙》目录作为高级范本测试 fixture。

## Testing Strategy

### Unit Tests

- `requireModelForAiAction()`：未配置 / 已配置 / 配置失败。
- `buildJingweiContext()`：global / tracked / nested / 时间线过滤 / 栏目禁用 / 不参与 AI。
- 模板应用：空白 / 基础 / 增强 / 题材推荐。
- section / entry 软删除与启用状态。

### Integration Tests

- 未配置模型时：打开首页 → 关闭欢迎 → 新建本地书籍 → 进入书籍总览。
- 新建书籍选择基础经纬后生成 4 个栏目。
- 新建书籍选择增强经纬后生成 7 个栏目。
- 自定义栏目新增、改名、禁用后 AI 上下文变化正确。
- 点击 AI 续写但未配置模型时弹配置提示且不清空编辑器内容。

### E2E Smoke

- 首次欢迎弹窗可见。
- 首页任务清单第一项是配置 AI 模型。
- 未配置模型仍可创建本地书籍。
- 进入故事经纬看到空态说明。
- 工作台模式默认隐藏，高级入口需显式开启。

### Accessibility Checks

- Dialog 可 Escape 关闭。
- 表单字段有 label。
- 任务清单可键盘操作。
- Dropdown / Sheet / Tabs 焦点顺序正确。
- 深浅色模式文字对比足够。

## Open Decisions Resolved

- 原 Bible 用户侧命名：采用 **故事经纬 / 经纬**。
- `名场面`、`设定`、`伏笔`、`核心记忆` 保留惯用词，不强行文言化。
- 模型配置放新手任务第一步，但不作为硬阻断。
- 《没钱修什么仙》作为高级范本 / 导入样例，不作为默认结构。
- UI 基础采用 shadcn/ui。

## Risks

### Legacy Bible 命名残留

风险：代码和 UI 同时存在 Bible / 经纬两套叫法，造成维护混乱。

缓解：短期允许内部 legacy，用户可见层统一经纬；后续独立 migration 再收敛内部命名。

### 可编辑栏目导致 schema 复杂

风险：完全动态字段会增加表单、校验、上下文构建复杂度。

缓解：基础栏目用内置字段模板，自定义栏目使用 JSON 字段，第一版不做复杂字段类型和公式。

### 模板推荐再次滑向强制

风险：题材模板、范本导入会被误用成默认标准。

缓解：所有题材栏目必须可取消；文案明确“推荐，不强制”。

### 首用引导过重

风险：弹窗 + 任务清单 + 空态都在教学，可能显得啰嗦。

缓解：弹窗可关闭，任务清单可隐藏，空态只在无内容时显示。
