**版本**: v3.0.0
**创建日期**: 2026-06-25
**更新日期**: 2026-06-25
**状态**: current
**文档类型**: current

# 03 - 产品与流程

NovelFork 小说创作的核心产品流程。

## 直接子文档

- [01-小说创作流程.md](./01-小说创作流程.md) — 从建书、设定、写作到正式章节结果/叙事记忆审批的用户流程

## 写作管线 v2

主链路流程：

```
用户意图
  │
  ▼
cockpit.snapshot        ← 驾驶舱快照（当前章节状态、进度、资源）
  │
  ▼
lore.read(brief)        ← 读取静态设定摘要（按 token 预算裁剪）
  │
  ▼
memory.read(write)      ← 读取动态叙事记忆（ContextCards/时间线/伏笔/事实）
  │
  ▼
pgi.ask                 ← PGI 追问（补充缺失信息）
  │
  ▼
AskUserQuestion         ← 等待用户回答（可跳过）
  │
  ▼
scene.spec              ← 生成场景规格（目标/约束/节拍）
  │
  ▼
lore.read(category) + memory.read  ← 按规格精确读取静态设定与动态上下文
  │
  ▼
pipeline.write          ← 三段式生成正文
  │                       creative → observer → settler
  ▼
正式章节结果             ← 带元数据的稳定正文结果，进入画布审阅
```

编排入口：`novel-plugin/src/handlers/pipeline-write-service.ts`

### 三段式写作（WriterAgent）

| 阶段 | 角色 | 目的 |
|------|------|------|
| Creative | 创作者 | 自由发挥，产出原始稿 |
| Observer | 观察者 | 审视叙事质量、节奏、AI 痕迹 |
| Settler | 定稿者 | 综合两者意见，输出终稿 |

## 经纬系统与叙事记忆的边界（v3.0.0 架构）

NovelFork v3.0.0 将"静态设定"与"动态叙事记忆"彻底分离：

| 维度 | 经纬（Lore） | 叙事记忆（Narrative Memory） |
|------|-------------|---------------------------|
| 定位 | 作者显式维护的静态设定库 | 动态叙事记忆系统 |
| 内容 | 人物、地点、势力、规则、物品、术语、作者备注 | 动态关系、时间线、角色弧线、伏笔状态、召回 diagnostics |
| 载体 | `jingwei_entry` | `narrative_fact` |
| 读取工具 | `lore.read`（默认排除 archived/draft/needs-review） | `memory.read`（ContextCard 召回） |
| 写入工具 | `lore.write`（canon/rules 强制 evidence） | `memory.events`（事件日志 + pending 审批） |
| 图谱工具 | — | `memory.graph`（关系图/时间线/弧线/伏笔/矛盾） |

> **迁移说明**：原经纬中 12 条动态设定（人物关系网、伏笔管理、时间线、核心矛盾等）已全量迁移为 `narrative_fact`，原经纬条目彻底归档。

## 经纬系统

设定管理核心，位于 `novel-plugin/src/engine/jingwei/`。

### 静态 Lore 分类

角色 · 势力 · 地点 · 物品 · 技能体系 · 世界规则 · 历史 · 文化 · 经济 · 政治 · 科技 · 宗教 · 自然 · 作者备注 · 术语 · 其他

> v3.0.0 起，动态关系、时间线、伏笔状态、章节后事实不再作为经纬/Lore 分类维护，统一进入 Narrative Memory。

### 三层模型

| Layer | 说明 | 可变性 |
|-------|------|--------|
| Canon | 作者确认的正典静态设定，AI 写入需 evidence | 受保护 |
| Rules | 平台/写作/世界规则，AI 写入需 reason/source/evidence | 受保护 |
| Reference | 参考资料、作者备注、非正文强约束材料 | 低优先 |

### 优先级分层（PriorityTier）

| 层级 | Token 预算 | 注入策略 |
|------|-----------|----------|
| Core | 最高优先 | 始终注入 |
| Relevant | 按相关度 | 场景匹配时注入 |
| Reference | 低优先 | 仅搜索时展示 |
| Auto | 系统管理 | 自动升降级 |

### Canon 保护（v3.0.0 evidence 门禁）

Canon 层条目受写保护：
- AI 工具调用 `lore.write` 写入 `canon` 和 `rules` 时强制要求带有 `reason/source/evidence`
- `lore.read` 默认排除 `archived`/`draft`/`needs-review` 状态的条目
- 只有用户通过 UI 显式编辑才能变更 Canon
- 防止 AI 在长对话中"漂移"核心设定

## 叙事记忆引擎（v3.0.0）

动态叙事记忆系统，位于 `novel-plugin/src/engine/narrative-memory/`（20+ 模块）。

### 8 通道本地检索

| 通道 | 内容 |
|------|------|
| facts | 事实三元组 |
| hard | 硬性约束 |
| hooks | 伏笔状态 |
| scene-spec | 场景规格 |
| semantic | 语义相似（exact cosine，默认关闭） |
| state | 运行时状态 |
| style | 文风 |
| timeline | 时间线 |

### Wave 终局算法层

本地纯 TS 实现，默认关闭，可通过 `waveConfig.enabled` 显式启用：
- narrative tag graph
- bell semantic gain
- EPA
- residual pyramid
- spike routing
- geodesic rerank

### NarrativeEvent 事件日志

章节结果结算后优先走事件日志和安全回写：
- canon / world fact / 高风险事件默认 pending，避免 LLM 自动污染 canon
- 用户通过 NarrativeMemoryPanel 一键 Approve/Reject

### 3D 结晶叙事记忆空间

纯 Canvas 2D 透视投影引擎，将 `narrative_fact` 可视化为 3D 水晶节点：
- 3D 星尘宇宙背景（80 颗呼吸闪烁星尘）
- 测地线粒子网络（Spike Routing 能量流 + 节点霓虹脉冲）
- 3D Fact Carousel（滚轮/键盘阻尼旋转 + 双击翻牌查证据）
- 入口：经纬面板 → "打开完整记忆图谱"按钮 → 主编辑器区域新 Tab 激活

## 资源管理

### 正式章节结果生命周期

```
pipeline.write → chapter:<number>（正式章节结果）
  ├→ 画布审阅 / 手动编辑
  ├→ 版本生成与对比
  └→ memory.events 整理动态叙事事件
```

- 每次 `pipeline.write` 产出或更新正式章节结果
- 不再创建 candidate/draft 主对象
- 用户可通过多版本、重写或行内编辑继续调整章节

### 资源账本

`resource.manage` 工具维护运行时资源状态：
- 追踪角色出场/退场
- 物品获取/消耗
- 地点转移
- 状态变更（受伤/升级/死亡）

账本数据用于一致性审查的资源验算。

## PGI 追问机制

PGI（Progressive Guided Inquiry）在管线启动时自动触发：

1. 分析用户意图 + 当前驾驶舱状态
2. 识别缺失信息（谁参与？在哪？目标？冲突？）
3. 生成 1-3 个精准追问
4. 用户回答后补充到场景规格

位于 `novel-plugin/src/engine/jingwei/pgi/pgi-engine.ts`

## 预设/节拍系统

### 预设（Presets）

写作风格模板：
- 控制叙事人称、时态、详略度
- 词频偏好（允许/禁止词列表）
- 长度目标（字数范围）
- 合规检查（`presets.check_compliance`）

### 节拍（Beats）

章节节奏控制：
- 定义章节内的节拍序列（开场/发展/高潮/收尾）
- 每个节拍带目标字数和情绪标签
- `beat.read/write` 工具管理
- `BeatProgressBar` 组件可视化进度

## 质量机制

### 对抗式审查（Adversarial Audit）

三个独立视角并行审查：

| 视角 | 关注点 |
|------|--------|
| A - 连续性 | 设定一致性、资源账本、时间线 |
| B - 叙事 | 节奏、张力、角色弧、逻辑 |
| C - 文本 | AI 痕迹、重复用词、文风漂移 |

三视角独立运行，结果通过纯函数合成最终报告。

### 严重度门禁（Severity Gate）

| 等级 | 行为 |
|------|------|
| S1 - Critical | 阻断发布，必须修复 |
| S2 - Major | 自动触发 ReviserAgent 修订 |
| S3 - Minor | 警告，不阻断 |
| S4 - Info | 记录，供参考 |

### 资源账本验算

`state-reducer.ts` 中的 `applyRuntimeStateDelta`：
- `findKnowledgeViolations()` — 检查知识边界违规
- `findTimelineConflicts()` — 检查时间线冲突
- 资源出入匹配验证
