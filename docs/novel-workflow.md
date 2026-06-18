# 小说创作流程

NovelFork 的小说创作通过 Agent 工具链驱动，核心管线在 `packages/novel-plugin/` 中实现。

## 写作主管线

```
cockpit.snapshot          获取驾驶舱快照（当前书籍状态概览）
  → jingwei.read(scope=brief)   读取经纬简报（核心设定摘要）
  → pgi.ask                     PGI 追问（向用户确认关键决策）
  → AskUserQuestion             等待用户回答
  → scene.spec                  生成场景规格书
  → jingwei.read(scope=category) 按需读取特定分类设定
  → pipeline.write              执行写作管线（→ 生成候选稿）
  → resource.manage             更新资源账本
```

编排入口：`novel-plugin/src/handlers/pipeline-write-service.ts`（`executePipelineWrite`）。

## 写作 Agent

所有写作 Agent 继承 `engine/agents/base.ts`：

| Agent | 职责 |
|-------|------|
| **WriterAgent** | 章节正文生成：creative→observer→settler 三段式 + 动态词频提示 + 写后校验 |
| **ContinuityAuditor** | 37 维一致性审查，输出 critical/warning/info 三级 issue |
| **ReviserAgent** | 按审计 issue 执行定点修订（spot-fix） |
| **ArchitectAgent** | 架构规划（卷纲/全局结构） |
| **PlannerAgent** | 章节意图规划 |
| **ComposerAgent** | 上下文包组装 |
| **LengthNormalizerAgent** | 字数归一化（warning 不阻断） |
| **StateValidatorAgent** | 运行时状态校验 |
| **RadarAgent** | 选题雷达 |
| **InlineWriterAgent** | 行内续写（轻量模式） |
| **VariantGeneratorAgent** | 变体生成 |
| **DialogueGeneratorAgent** | 对话生成 |

## 经纬系统（Jingwei）

经纬系统管理小说全部设定数据，位于 `engine/jingwei/`。

### 16 分类

`premise` · `world-model` · `characters` · `relationships` · `factions` · `locations` · `props` · `outline` · `conflicts` · `foreshadowing` · `timeline` · `chapter-summaries` · `power-system` · `rules` · `reference` · `unclassified`

### 数据分层

| Layer | 含义 |
|-------|------|
| canon | 作者确认的正典设定 |
| dynamic | 剧情推进中自动产生的状态 |
| reference | 外部参考资料 |

### 优先级

`core` → `relevant` → `reference` → `auto`（PriorityTier）

### 可见性

- **global** — 始终对 Agent 可见
- **tracked** — 与当前场景相关时注入
- **nested** — 仅在父条目被引用时展开

### 读模型

`read-model/` 提供四种读取 scope：
- `brief` — 核心设定摘要（2000 token 内）
- `index` — 全分类目录索引
- `category` — 指定分类完整内容
- `search` — 关键词搜索

### 上下文注入

`context/` 目录负责 token 预算管理与分级注入：
- `token-budget.ts` — Token 预算分配
- `compose-context.ts` — 上下文组装
- `context-policy.ts` — 注入策略

## 质量机制

### 对抗式审查（Adversarial Audit）

`engine/agents/adversarial-audit.ts`：3 个独立视角同时审查：
- A视角：连续性（设定/时间线/角色一致性）
- B视角：叙事（节奏/张力/承诺兑现）
- C视角：文本（AI 痕迹/词频/可读性）

三个视角独立执行，结果由纯函数合成最终审查报告。

### 严重度门禁（Severity Gate）

`engine/agents/severity-gate.ts`：

| 级别 | 行为 |
|------|------|
| S1 Critical | 阻断发布，必须修复 |
| S2 Major | 自动触发 ReviserAgent 修订 |
| S3 Minor | 警告，不阻断 |
| S4 Suggestion | 建议，可忽略 |

### 资源账本

`core/src/state/state-reducer.ts`：
- `applyRuntimeStateDelta` — 资源变动验算
- `findKnowledgeViolations` — 知识边界检查
- `findTimelineConflicts` — 时间线冲突检测

### 动态词频 & AI 痕迹检测

- `engine/agents/writer.ts`：写作时注入词频控制提示（避免重复用词）
- `engine/agents/ai-tells.ts`：规则版 AI 痕迹检测（dim20-23 维度）

## 工具清单（24 个活跃工具）

### 核心工具（NOVEL_CORE_TOOLS，常驻）

| 工具 | 用途 |
|------|------|
| `jingwei.read` | 读取经纬设定（scope: brief/category/search） |
| `jingwei.write` | 写入/更新经纬条目 |
| `cockpit.snapshot` | 获取驾驶舱快照 |
| `chapter.read` | 读取章节内容 |
| `pipeline.write` | 触发写作管线 |
| `scene.spec` | 生成场景规格书 |
| `pgi.ask` | PGI 追问用户 |
| `resource.manage` | 管理资源账本 |

### 按需工具

`chapter.audit` · `chapter.list` · `candidate.create_chapter` · `pipeline.revise` · `pipeline.import_chapters` · `rewrite.segment` · `rewrite.apply` · `style.import` · `outline.suggest_next` · `character.check_consistency` · `hooks.manage` · `presets.read` · `presets.write` · `presets.check_compliance` · `beat.read` · `beat.write`
