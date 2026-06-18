# 03 - 产品与流程

NovelFork 小说创作的核心产品流程。

## 写作管线 v2

主链路流程：

```
用户意图
  │
  ▼
cockpit.snapshot        ← 驾驶舱快照（当前章节状态、进度、资源）
  │
  ▼
jingwei.read(brief)     ← 读取设定摘要（按 token 预算裁剪）
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
jingwei.read(category)  ← 按规格精确读取相关设定
  │
  ▼
pipeline.write          ← 三段式生成正文
  │                       creative → observer → settler
  ▼
候选稿                   ← 带元数据的草稿，等待用户裁决
```

编排入口：`novel-plugin/src/handlers/pipeline-write-service.ts`

### 三段式写作（WriterAgent）

| 阶段 | 角色 | 目的 |
|------|------|------|
| Creative | 创作者 | 自由发挥，产出原始稿 |
| Observer | 观察者 | 审视叙事质量、节奏、AI 痕迹 |
| Settler | 定稿者 | 综合两者意见，输出终稿 |

## 经纬系统

设定管理核心，位于 `novel-plugin/src/engine/jingwei/`。

### 16 分类

角色 · 势力 · 地点 · 物品 · 技能体系 · 世界规则 · 历史 · 文化 · 经济 · 政治 · 科技 · 宗教 · 自然 · 事件 · 关系 · 其他

### 三层模型

| Layer | 说明 | 可变性 |
|-------|------|--------|
| Canon | 正典设定，不可被 AI 修改 | 只读 |
| Dynamic | 剧情推进产生的动态设定 | 可写 |
| Reference | 参考资料，不注入正文生成 | 只读 |

### 优先级分层（PriorityTier）

| 层级 | Token 预算 | 注入策略 |
|------|-----------|----------|
| Core | 最高优先 | 始终注入 |
| Relevant | 按相关度 | 场景匹配时注入 |
| Reference | 低优先 | 仅搜索时展示 |
| Auto | 系统管理 | 自动升降级 |

### Canon 保护

Canon 层条目受写保护：
- AI 工具调用 `jingwei.write` 不能修改 Canon 条目
- 只有用户通过 UI 显式编辑才能变更
- 防止 AI 在长对话中"漂移"核心设定

## 资源管理

### 候选稿生命周期

```
生成 → pending（待审）
  ├→ accepted（采纳）→ 写入章节正文
  ├→ rejected（拒绝）→ 归档保留
  └→ revision（修订）→ 重新进入管线
```

- 每次 `pipeline.write` 产出一个候选稿
- 候选稿独立存储，不直接覆盖章节
- 用户可对比多个候选稿后选择采纳

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
