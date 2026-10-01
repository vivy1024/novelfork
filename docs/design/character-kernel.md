**版本**: v0.1.0
**创建日期**: 2026-08-21
**更新日期**: 2026-08-21
**状态**: current
**文档类型**: current

# 角色内核（Character Kernel）设计

## 0. 问题陈述（真实数据，不可替代）

在《这个世界修仙讲科学》（20 章已结算）的生产数据库实测得到：

- 195 条 `narrative_fact`，195-open 中含 71 条 `character_state`。仅主角一人 **53 条 open 状态**，全量注入写作上下文约 2800 字。
- slot 折叠（同一 subject+predicate 前者被后者顶替）的真实折叠率：**1%**（71→70 未关闭）。唯一正常折叠的是 `location`（86%），因为 predicate 恰好经常是"位置"。
- 25/53 条 object 超 40 字——大量"身体先于仪器感知 → 山路上耳鸣水膜感指尖麻……"这类长句，本质是**剧情流水账被错放进状态槽**。
- 结论：现有 Narrative Memory 能回答"第 N 章发生了什么"，回答不了"这个人在这一章是谁"。写章时最缺的信息不是事实清单，而是**角色的当前心理结构**：他现在想干什么、在怕什么、和谁有账没算清。

## 1. 目标与边界

- 目标：写章前向 AI 注入每个出场角色的"内核摘要"（短小、可直接写入 prompt），让生成文本的心理一致性与主线方向稳定；让作者可以在 UI 上看到每个角色此刻是谁，并可手动修正。
- 边界（不做的）：
  - 不改 canon 层级、不需要"审批状态机"（候选缓冲）——内核就是可写的动态数据，AI 和作者都能改，争议处理交给 `时态切片 + 版本历史` 解决。
  - 不做算法复杂识别（"心理弯曲检测 / OOC 检测"）——第一版只做存储与注入，检测将在后续版本基于内核数据再做。
  - 不在本迭代处理 predicate 词表归一化（那是 memory.write 的另一个问题；设计关联放在 §7）。

## 2. 全自由配置原则（硬约束，写在前面）

整个 Feature 不引入任何硬编码枚举、模板、词表。所有可配置项都来自作品级或全局级配置，未配置时用默认实现。三层优先级：作品配置 > 全局默认 > 内置默认值。

```ts
interface CharacterKernelConfig {
  /** 总开关；**默认 false**（不改写老书行为，不消耗 LLM 预算） */
  enabled: boolean;
  /** 生成 prompt 自定义；null = 使用内置极简模板 */
  promptTemplate: string | null;
  /** 写章前的注入预算（占总召回预算的比例上限，0–0.5），默认 0.1 */
  injectBudgetRatio: number;
  /** 每角色内核正文最大长度（字），0 = 不截断；默认 200 */
  stateSummaryMaxChars: number;
  /** 结算时触发的最小 eventTypes（自由文本列表，非枚举，见下），默认空 = 任意事件都会触发 */
  triggerEventTypes: string[];
  /** 内核字段定义：数组式描述，完全自定义；author 可为角色增加字段 */
  fields: KernelFieldSpec[];
}

interface KernelFieldSpec {
  key: string;              // 字段键（如 "motivation"）
  label: string;            // UI 显示名
  kind: "short_text" | "long_text" | "list";   // UI 形态
  llmExtract: boolean;      // 是否让结算器生成（true=LLM 产出 / false=仅作者手填）
  injectOnWrite: boolean;   // 是否在写章时注入 prompt
  injectPriority: number;   // 字段优先级，预算分配用
}
```

**默认字段集（作品新建时自动落盘，都可改）**：

| key | label | kind | llmExtract | injectOnWrite | priority |
|-----|-------|------|-----------|---------------|---------|
| `motivation` | 核心动机 | short_text | true | true | 100 |
| `emotionalCenter` | 情绪重心 | short_text | true | true | 90 |
| `conflictAxis` | 主要矛盾轴 | short_text | true | true | 80 |
| `stateSummary` | 当前状态摘要（纯叙述，≤200 字） | long_text | true | true | 70 |
| `activeScars` （list） | 活跃心理伤痕 | list | false | true | 50 |
| `notes` | 作者备注 | long_text | false | false | 0 |

## 3. 数据模型

### 3.1 表（packages/core storage schema / drizzle）

```sql
CREATE TABLE character_kernel (
  id TEXT PRIMARY KEY NOT NULL,            -- uuid
  book_id TEXT NOT NULL,
  character_id TEXT NOT NULL,              -- 经纬字符表的人名或 UUID
  entry_status TEXT NOT NULL,              -- 'active' | 'archived'
  fields_json TEXT NOT NULL,               -- JSON: Record<key, value>; 值类型随 KernelFieldSpec.kind
  evidence_json TEXT NOT NULL,             -- [{"factId" | "eventId", "excerpt"}] 最后结算的依据
  updated_chapter INTEGER NOT NULL,        -- 更新发生的章
  updated_at TEXT NOT NULL,
  origin TEXT NOT NULL                     -- 'settle' | 'manual' | 'import'
);
CREATE INDEX idx_ck_book ON character_kernel (book_id, character_id);
CREATE UNIQUE INDEX idx_ck_unique ON character_kernel (book_id, character_id); -- 单角色唯一，覆盖更新，不做历史版本表
```

所有字段自由定制——`fields_json` 存路径由 `CharacterKernelConfig.fields` 决定。historical版本不做单独的版本表（与 NarrativeFact 一致：必要时加 revision 表，不在第一版范围内）。

### 3.2 与经纬的关系

- 不变：`characters` 分类的经纬条目仍是"底档"（名字、声音、设定），canon/dynamic 由作者控制，不自动依赖。
- 新增：`character_kernel` 是"当下心理构造"，独立表，对该分类的读者和写作双双注入。
- 关联：章节结算时从 platform_files 表按 `characters = scene.characters` 读取出场者名 → 对出场角色做一次重结。

## 4. 结算钩子

挂在 `settleChapter` 的持久化处理中（在 `applyRuntimeStateDelta` 之后、`runConsistencyCheck` 之前）：

```
settleChapter
  ├─ stage(s) 现有：facts/events/...
  └─ 新增阶段（仅当 characterKernelConfig.enabled===true）:
       kernelReconcile:
         for actor in chapterSceneSpec.characters:
           if entry.status != active or config 事件类型未命中本章 event types → skip
           payload = {
             current: readKernel(bookId, actor),
             previousFacts: related facts for actor（chapter N 章前后，取 5 条 max）
             chapterExcerpt: chapter text truncate
             fields: config.fields (只取 llmExtract=true 的)
           }
           invoke LLM（generate）→ 写一版新的 fields（**覆盖式**）+ evidence_json
           writeKernel(bookId, actor, fields, evidence, chapterNumber)
```

- 失败策略：单次 LLM 失败记 warn，不阻断结算；章报告加一条 warning。
- 幂等：同章重复结算（welcome retry）会重写同一条 kernel（fields + updated_at 会变化），这是预期行为（覆盖式语义的天然幂等）。

## 5. 写章注入

挂在 `buildNarrativeContext` 的 state 通道 **之前**（高优先级下标志性的新 channel：channel `"character-kernel"`），该通道输出 JSON 结构化的 NarrativeContextCard：

```json
{
  "channel": "character-kernel",
  "source": "character_kernel",
  "summary": "【角色内核·薛行之】沈月初临逸愤：向 OpenQi 讨回说法｜中心：负罪感+怕身份被识破｜矛盾轴：伪装 vs 公开｜当前状态：……",
  "priority": 500,          // 比现有 state/facts 都高
  "entities": ["薛行之"],
  "estimatedTokens": 取决面字段配置
}
```

- 只给出场角色写，说明书里配置了 `characters = scene.characters`。
- 按 `injectPriority` 排序；预算控制由 channelBudgetPolicy 处理（新增 channel 加入预算表；若不足默认丢弃，不阻断）。
- 本章内容已经包含完整正文时，与 prior summary 整合（不混淆事实）。

## 6. 前端（书籍设置-叙事记忆区子区）

`BookSettingsPanel` → `NarrativeMemorySettingsSection` 下新增 **“角色内核”子区**（独立折叠打开/AUTO铅笔默认关）：

- **配置面板**：启用开关、injectBudgetRatio、每角色最大长度、triggerEventTypes、字段表编辑器（加/删/改 KernelFieldSpec，基本小红卡片）
- **现有内核预览**：表格列出本作品的现有 roles，点击展开看各字段当前内容 + 更新时间 + “手动重算此角色”按钮（外层再跑 settlement 不好处理，第一版先不给自动重算按钮，仅读）

> 写作工作台 IDE 侧栏的 SkillsAndStyleSidebarPanel 已独立存在，不进任何设置界面。ConfigSection（pkg section、pluginsTooltip）不在本阶段调整。

## 7. 与既有问题的正确关系（不重复劳动）

- `predicate 自由文本`问题**不在第一版**：本功能的输出本身是长文本抖动提到 prompt 的另一种形式，不会加重 open facts 的差；如果要治理 fact 结构，另起一个命名步骤（先补词表 + 拆分 object 关曾用）
- `canon 可修改`：characters 分类已经是这是 fork 分层决定的（不必再做——canon 不可变已随改成 dynamic 消失，对本功能来说是先决条件成立了）

## 8. 验收标准（可测量）

1. 对我们的真实书场（20 章）执行一次 settlement（重结 1-20 章）后，写作下章时 prompt 里含有每张出场角色的 `<动机｜情绪｜矛盾》` 条目总字数 ≤ 800 字（不再出现 3000+ random dumping）
2. Chapter 写入后新一轮章节质量：prompt 清晰性受到新鲜激活记录清单影响
3. 新增默认配置关闭整个开关后期行为与 vintage：在开关打开前后，写章行为不依赖其他在使用中能力

## 9. 不做 / 不在本设计的范围

- 自动 OOC 检测（后续版本）——当前只记录，不判定
- 主题卡（theme card）抽象——观察数据淳朴再做（PlotPilot 主题模块概念未成熟）
- 阶段迁移（VolumeSnapshot 推前快照）
- 历史版本 diff——如后续证明需要，再单独加 revision_table
