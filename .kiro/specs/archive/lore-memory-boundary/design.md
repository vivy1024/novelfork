# Lore / Narrative Memory 职责拆分 — Design

## 设计原则

1. **经纬不是记忆。** 经纬只保存作者显式维护的静态设定。
2. **Narrative Memory 不是工具箱。** Narrative Memory 只负责动态叙事记忆、召回、事件和记忆图谱。
3. **图谱属于动态记忆。** 关系图、时间线、角色弧线、伏笔网络、矛盾地图迁入 Narrative Memory。
4. **先改边界与入口，再改内部实现。** 本轮优先修正产品心智、工具语义和 prompt，避免一次性重写数据层。

---

## 新信息架构

IDE ActivityBar 保持简洁：

```txt
资源
经纬
叙事记忆
工具
搜索
```

### 经纬 / Lore

经纬 Sidebar 只承担静态设定管理：

```txt
经纬
├─ 人物
├─ 地点
├─ 势力
├─ 规则
├─ 物品
├─ 术语
├─ 平台 / 书籍规则
└─ 作者备注
```

经纬保留：

- 条目树
- 分类筛选
- 条目编辑器
- 手动创建 / 修改 / 删除
- 静态资料导入

经纬移除主入口：

- 图谱
- 时间线
- 角色弧线
- 矛盾地图
- 伏笔看板 / 伏笔网络
- 召回 diagnostics
- Pending NarrativeEvents

### Narrative Memory

叙事记忆 Sidebar 承担动态记忆与记忆图谱：

```txt
叙事记忆
├─ 记忆总览
│  ├─ 最近召回
│  ├─ 通道状态
│  ├─ Token 预算
│  ├─ Wave 摘要
│  └─ Pending Events
│
└─ 记忆图谱
   ├─ 关系图
   ├─ 时间线
   ├─ 角色弧线
   ├─ 伏笔网络
   ├─ 矛盾地图
   └─ 事件链
```

Narrative Memory 可以跳转到 Lore 条目，例如“查看人物设定”，但不在记忆图谱里内嵌 Lore 编辑器。

---

## 组件迁移

| 当前组件 / 能力 | 新归属 | 处理 |
|---|---|---|
| `NarrativeMemoryPanel` | Narrative Memory / 记忆总览 | 保留并作为默认页 |
| `JingweiGraphWorkspace` 关系图 | Narrative Memory / 记忆图谱 | 重命名或包装为 `NarrativeMemoryGraphWorkspace` |
| `JingweiGraphWorkspace` 时间线 | Narrative Memory / 时间线 | 迁移入口，改文案 |
| `JingweiGraphWorkspace` 角色弧线 | Narrative Memory / 角色弧线 | 迁移入口，复用现有实现 |
| `JingweiGraphWorkspace` 矛盾地图 | Narrative Memory / 矛盾地图 | 迁移入口，改数据语义 |
| `ForeshadowingBoard` | Narrative Memory / 伏笔网络 | 迁移入口 |
| `CharacterArcsPanel` | Narrative Memory / 角色弧线 | 迁移入口，可与图谱视图合并 |
| `JingweiEntryEditor` | 经纬 / Lore | 保留，不迁移 |
| `JingweiEntryTree` / 分类表单 | 经纬 / Lore | 保留，不迁移 |

迁移时优先新增包装组件，避免大规模改动原组件内部：

```txt
NarrativeMemoryGraphWorkspace
├─ RelationshipGraphView   ← 复用原 JingweiGraphView 或包装
├─ MemoryTimelineView      ← 复用 JingweiProgressions / narrative timeline 数据
├─ CharacterArcView        ← 复用 CharacterArcsPanel 能力
├─ ForeshadowingNetwork    ← 复用 ForeshadowingBoard 能力
└─ ConflictMapView         ← 复用原 conflicts view
```

---

## 工具协议设计

### Lore 工具

```txt
lore.read
lore.write
```

职责：读取 / 写入作者显式维护的静态设定。

建议参数：

```ts
type LoreReadInput = {
  scope: "brief" | "category" | "search" | "entry";
  category?: "character" | "location" | "faction" | "rule" | "item" | "term" | "platform" | "note";
  query?: string;
  entryId?: string;
};

type LoreWriteInput = {
  category: string;
  title: string;
  contentMd: string;
  layer: "canon" | "reference" | "rules";
  reason: string;
};
```

### Memory 工具

```txt
memory.read
memory.graph
memory.events
```

职责：读取动态叙事记忆、查看记忆图谱、处理待确认事件。

建议参数：

```ts
type MemoryReadInput = {
  purpose: "write" | "revise" | "audit" | "outline" | "diagnose";
  chapterNumber?: number;
  entities?: string[];
  sceneText?: string;
  budgetTokens?: number;
  channels?: Array<"hard" | "state" | "timeline" | "hooks" | "facts" | "style">;
};

type MemoryGraphInput = {
  view: "relationship" | "timeline" | "character_arc" | "foreshadowing" | "conflict" | "event_chain" | "wave";
  focusEntity?: string;
  chapterRange?: [number, number];
};

type MemoryEventsInput = {
  action: "list" | "approve" | "reject";
  eventId?: string;
  reason?: string;
};
```

### Lore 读取过滤与写入门禁

`lore.read` 与兼容别名 `jingwei.read` 默认只返回可参与 AI 的有效静态设定：

```txt
exclude archived
exclude draft
exclude needs-review
exclude participates_in_ai=0
exclude equivalent inactive lifecycle/status markers
```

`lore.write` 与兼容别名 `jingwei.write` 写入 canon/rules 层时必须携带：

```txt
reason
source 或 evidence
明确的确认语义
```

动态事实、章节后抽取事实、Pending NarrativeEvents 不得直接写入 Lore canon；它们应进入 Narrative Memory 事件流程。

### 兼容层

现有工具先不硬删：

```txt
jingwei.read  → deprecated alias of lore.read
jingwei.write → deprecated alias of lore.write
```

工具说明必须写清楚：

> `jingwei.*` 只读写静态设定，不返回动态叙事记忆。动态上下文请使用 `memory.read`。

---

## Prompt / workflow 改造

### 旧语义

```txt
cockpit.snapshot → jingwei.read → pgi.ask → scene.spec → pipeline.write
```

### 新语义

```txt
lore.read 静态设定
→ memory.read 动态叙事记忆
→ scene.spec / plan scene
→ pipeline.write
→ pending NarrativeEvents
```

Prompt 需要明确：

- 经纬是 Lore，不是 Memory。
- 写作前必须分别读取静态设定和动态记忆。
- 动态事实不直接写入 Lore。
- Pending NarrativeEvents 需要用户或门禁批准后才能成为确认记忆。
- 市场材料、诊断结果、工具输出不得自动污染 Lore canon。

---

## 数据边界

本 spec 不要求立即重写存储模型，但要求 UI 和工具语义遵守边界：

| 数据类型 | 归属 |
|---|---|
| 作者手写人物设定 | Lore |
| 世界规则 / 平台规则 | Lore |
| 章节后抽取的人物状态变化 | Narrative Memory |
| 关系变化 | Narrative Memory |
| 伏笔埋设 / 推进 / 回收状态 | Narrative Memory |
| 时间线事件 | Narrative Memory |
| 写作召回 ContextCard | Narrative Memory |
| Pending NarrativeEvents | Narrative Memory |

---

## 验证策略

### 自动验证

- `bun run typecheck`
- 相关组件测试：IDE sidebar、NarrativeMemoryPanel、Jingwei/Lore sidebar。
- 工具 schema / handler 测试：`lore.*` alias、`memory.*` 工具说明和路由。

### Browser 验证

必须截图证明：

1. 左侧“经纬”只展示静态设定树与编辑入口。
2. 左侧“叙事记忆”展示记忆总览。
3. 叙事记忆中能打开关系图、时间线、角色弧线、伏笔网络、矛盾地图入口。
4. 主 UI 不再显示“经纬图谱”命名。

---

## 迁移注意事项

- 不删除用户现有经纬数据。
- 不删除现有组件，只移动入口和重命名包装。
- 若旧组件依赖 `jingwei` API，可以先保持内部实现，外层产品文案和入口先改为 Narrative Memory。
- 内部数据源后续可逐步从 Jingwei 表迁移到 NarrativeFact / NarrativeEvent / retrieval log。
