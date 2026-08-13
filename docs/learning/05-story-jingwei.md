---
title: 故事经纬
summary: 静态 Lore 设定库，管理作者确认的世界规则、人物、地点与术语，并与叙事记忆分工
tags: [经纬, Lore, 世界观, 设定, 叙事记忆]
routes:
  - /next/books/:bookId
---

# 故事经纬

> 经纬现在是 **静态 Lore 设定库**：只放作者明确维护、希望 AI 长期遵守的设定；动态剧情变化交给叙事记忆。

## 核心概念

**经纬（Jingwei / Lore）**：二级结构——分区 → 条目。适合保存作者确认的静态材料：人物、地点、势力、世界规则、物品、术语、作者备注等。

**叙事记忆（Narrative Memory）**：保存动态叙事事实：人物关系变化、时间线推进、角色弧线、伏笔埋设/触发/兑现、章节后抽取事实、召回 diagnostics。

二者分工：

| 类型 | 放在哪里 | 工具 |
|------|----------|------|
| 世界规则、人物固定设定、地点、势力、术语 | 经纬 / Lore | `lore.read` / `lore.write` |
| 章节后发生的事件、关系变化、伏笔状态、时间线推进 | 叙事记忆 | `memory.read` / `memory.events` / `memory.graph` |
| 作者临时参考、素材摘录 | 经纬参考类条目 | `lore.read(scope=search)` |

## 在资源树中的展示

```
📁 经纬资料 / Lore
├── 人物设定
├── 地点与势力
├── 世界规则
├── 术语与物品
└── 作者备注

📁 叙事记忆
├── 动态事实
├── 时间线
├── 伏笔网络
├── 角色弧线
└── 关系图 / 矛盾地图
```

> v3.0.0 起，原经纬中关系、伏笔、时间线、核心矛盾等动态条目已迁移为 `narrative_fact`，不再作为静态经纬分类维护。

## AI 上下文参与

AI 写作前会按链路读取：

```
write.preflight → lore.read(scope=brief) → memory.read(purpose=write)
  → 读取写作技能（Skill 工具）→ scene.spec（叙述者提交蓝图）
  → lore.read(scope=category) + memory.read → pipeline.write（叙述者提交正文）
```

- `lore.read(scope=brief)`：读取静态设定核心摘要（含剧情线状态卡）。
- `lore.read(scope=category/search)`：按 scene.spec 中角色、地点、规则补读精确信息。
- `memory.read(purpose=write)`：读取动态 ContextCard（时间线、伏笔、状态、事实等）；state 通道首段为剧情线状态卡——从当前章有效事实按主体聚合"每条剧情线停在哪"。

### 经纬智能注入

- **关键词触发**：`visibilityRule.keywords` 命中场景文本/章节意图才注入（tracked 条目）。
- **章号可见窗口**：`visibleAfterChapter` / `visibleUntilChapter` 控制条目只在指定章段参与 AI。
- **关联级联**：条目通过 `relatedEntryIds` 关联的其他条目会随主条目自动带出（一级，防循环，上限 8 条）。
- **同组互斥**：`visibilityRule.group` 相同的条目只注入优先级最高的一条——用来表达"重伤中/已痊愈"这类互斥状态，避免矛盾设定同时进上下文。
- **Token 预算**：所有注入按优先级与重要性排序，超预算逐条降级（full→normal→summary→brief）再丢弃。

### 剧情线状态卡

叙事记忆的宏观层轻量版：写前从当前章有效的 `narrative_fact` 中，按主体（角色/势力/地点/道具）聚合出每个主体的最新事实（如「林舟：伤势已痊愈（第20章起）」），随 state 通道注入。纯确定性生成，不调用模型；写 200 章时叙述者一眼能看到每条剧情线停在哪，而不是只看到零散事实。

## Canon / Rules 写入门禁

为了防止 AI 长对话中污染正史，静态 Lore 写入有以下门禁：

- `lore.read` 默认排除 `archived` / `draft` / `needs-review` 条目。
- `lore.write` 写 `canon` 或 `rules` 必须提供 `reason`、`source`、`evidence`。
- 动态事实不得直接写进 Lore；应通过 `memory.events` 创建 pending NarrativeEvents，由用户批准。
- `jingwei.read/write` 仍保留为兼容别名，但新流程优先使用 `lore.*`。

## 推荐使用流程

1. 建书时先维护少量核心 Lore：世界规则、主角、主要势力、关键术语。
2. 把“会随剧情变化”的内容放到叙事记忆：关系、伏笔状态、章节后事实、时间线。
3. 对正史/规则条目保持精简，避免把剧情进展塞进 canon。
4. 用互斥组表达互斥状态（`visibilityRule.group`），用关联关系表达级联（`relatedEntryIds`）。
5. 写作前用经纬侧栏的「AI 注入预览」按章检查叙述者会拿到哪些设定。
6. 使用经纬审计检查不参与 AI 的未确认/归档/待审核条目。

## 常见坑

- **把角色关系网放进经纬** → 关系会随剧情变化，应进入 Narrative Memory。
- **把时间线当静态设定写** → 时间线推进属于动态记忆，应走 `memory.events`。
- **AI 写出未确认设定** → 检查是否把 draft/needs-review 条目误参与 AI，或让 AI 绕过 evidence 门禁。
- **经纬越写越臃肿** → 只保留长期稳定的静态事实，章节摘要与事件交给叙事记忆。

## Agent 查阅提示

- 静态设定优先用 `lore.read(scope=brief/category/search)`。
- 动态上下文优先用 `memory.read(purpose=write|audit|revise)`。
- 写完章节后的摘要、角色变化、伏笔推进默认生成 `memory.events` pending 事件。
- 不要把 `memory.events` 可表达的动态事实直接写进 `lore.write(canon/rules)`。

## 可跳转功能入口

- 经纬管理：在作品工作台中查看和编辑静态 Lore 条目。 (/next/books/:bookId)
- 叙事记忆：在写作工作台中查看 ContextCard 诊断、Pending Events 与完整记忆图谱。
