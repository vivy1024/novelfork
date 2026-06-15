# 经纬数据层统一与题材自适应 — Requirements

**版本**: v1.0.0
**创建日期**: 2026-06-14
**状态**: draft（待审批）
**定位**: 纯后端地基 spec。前端（建书向导 UI、设定区 UI）作为后续独立 spec，依赖本 spec 定型的数据层。

---

## 问题陈述

经纬（jingwei）是 NovelFork 整个创作蓝图的统一主干（16 类结构化数据：设定族/结构族/追踪族）。但当前经纬数据层存在三个系统性缺陷，导致上层"经纬图谱失败、设定过度复杂、建书体验割裂"等表象问题：

> **缺陷一：经纬分类双轨割裂。** 前端编辑用一套分类（16 类，`category-schemas.ts`），agent 读取用另一套（15 类，`read-model` 的 `JINGWEI_READ_CATEGORIES`），靠 `CATEGORY_ALIASES` 字符串映射粘合。作者编辑的分类与 agent 实际读取的分类对不上。

> **缺陷二：经纬复杂度不随书自适应。** 不论书的轻重，建书一律走"重度世界观生成"（强制扩展世界观/力量体系层级/配角/伏笔种子），把番茄都市装逼打脸文也套上修仙级 16 类框架，成为负担。

> **缺陷三：建书数据流倒置。** md 文件已是残留（SQLite 才是经纬主干），但建书流程是「先写 md → AI 丰富 md → 再 `fetch localhost` 导入 SQLite」，以残留为主、主干为辅，且依赖硬编码端口的 HTTP 自调用。

此外，经纬作为"人机协同维护"的数据（用户手写 + agent 写作时写入 + 每章完成后 agent 后台自动修订），缺少**来源、修订历史、冲突标记**的数据结构，导致无法支撑"作者审阅 agent 改了什么、裁决冲突"。

---

## 用户已明确的边界（必须遵循）

- **经纬定位** = 大纲等参考资料，人机协同维护。三个写入源（用户说 / agent 写作时写入 / 每章完成后 agent 后台自动修订）最终汇到**同一份 SQLite 经纬**。
- **经纬要简化** = 复杂度匹配书的复杂度。轻量爽文不应被迫维护重度世界观经纬。简化根子在"题材决定经纬规模"。
- **git 仓库建立必要，不改** —— 它是版本管理/快照回滚的底层基础，保留。
- **模式系统不改** —— 作者模式/工作台模式双视角已是正确设计。
- **本 spec 纯后端** —— 不含前端 UI 改动。建书向导 UI、设定区 UI 是后续 spec。

---

## 已核实的事实（带证据）

| 编号 | 事实 | 证据 |
|------|------|------|
| F1 | UI 编辑用 16 类分类（character/event/worldview/power-system/geography/faction/item/skill/currency/special/outline/relationship/foreshadowing/plot/timeline/chapter-summary） | `pages/writing-workbench/jingwei/category-schemas.ts` CATEGORY_SCHEMAS |
| F2 | agent 读取用 15 类（premise/world-model/characters/relationships/factions/locations/power-system/timeline/chapter-summaries/foreshadowing/conflicts/props/rules/reference/unclassified） | `engine/jingwei/read-model/category-map.ts` JINGWEI_READ_CATEGORIES |
| F3 | 两套分类靠字符串别名映射粘合 | `category-map.ts` CATEGORY_ALIASES |
| F4 | SQLite 是经纬主干，md 是残留 | 用户明确；`build-jingwei-brief.ts` 从 SQLite repo 读取 |
| F5 | 建书写 4 个 md（story_bible/book_rules/volume_outline/current_state）后再导入 SQLite | `routes/storage.ts:606-706` 写 md；`:798` fetch import-from-files |
| F6 | 建书用 localhost 硬编码端口 HTTP 自调用导入经纬 | `routes/storage.ts:798` `fetch http://localhost:4567/...jingwei/import-from-files` |
| F7 | 题材→预设是写死一对一映射，无法处理题材组合 | `routes/storage.ts:709-735` GENRE_TO_PRESET |
| F8 | AI 丰富不分书轻重，强制扩展世界观/力量体系/2-3配角/3-5伏笔种子 | `routes/storage.ts:765-775` userPrompt |
| F9 | buildJingweiBrief 智能召回引擎成熟（时序可见/可见性源/优先层/任务相关/token降级） | `read-model/build-jingwei-brief.ts` |
| F10 | 经纬条目已有 visibilityRule（global/tracked/nested + visibleAfter/UntilChapter）、priorityTier、章节字段 | `engine/jingwei/types.ts`；`build-jingwei-brief.ts:44-71` |
| F11 | 经纬条目当前无"来源/修订历史/冲突"字段（仅 createdAt/updatedAt 时间戳，无 createdBy/updatedBy/source/revisionHistory/conflict） | `engine/jingwei/types.ts:78-102` StoryJingweiEntryRecord 已逐字段核实 |
| F12 | jingwei.write 是 agent 工具，写 SQLite 经纬 | `session-tool-executor.ts`；`handlers/jingwei-write-handler.ts` |

> 待补充核实（写 design 时确认）：建书后 settler 自动修订当前是否真写回 SQLite 经纬（v2 管线）；AI 丰富是否还有 guided-setup 之外的触发点。

---

## 需求（EARS 风格）

### R1 经纬分类双轨统一
- R1.1 系统**应**只有一套权威经纬分类定义，前端编辑与 agent 读取共用。
- R1.2 当统一分类后，**应**保留 buildJingweiBrief 的 15 类读取语义所需的全部召回能力（premise/world-model 等聚合视角不丢失）。
- R1.3 系统**应**为旧数据提供迁移/兼容，已存在的条目分类不丢失、不错配。
- R1.4 统一后**不应**再需要 CATEGORY_ALIASES 字符串映射来弥合两套分类。

### R2 题材自适应经纬模板（经纬简化的核心）
- R2.1 系统**应**定义"题材 → 经纬模板"，模板决定建书时初始展开哪些经纬分类。
- R2.2 模板**应**至少分轻/中/重三档：轻量（都市/职场/言情：角色+主线+冲突对象）、中度（系统流/游戏：+金手指/系统规则）、重度（修仙/玄幻/西幻：+力量体系/势力/地理/功法）。
- R2.3 当题材为轻量时，AI 丰富**不应**强制生成世界观/力量体系等无关设定。
- R2.4 作者**应**能在模板基础上手动增删分类（模板是起点不是牢笼）。
- R2.5 题材→预设映射**应**支持组合（一本书可命中多个题材/预设），不再写死一对一。

### R3 建书直建 SQLite 经纬（废除 md 倒置）
- R3.1 建书流程**应**直接生成 SQLite 经纬条目，不再以 md 文件为中间产物。
- R3.2 系统**不应**使用 localhost 硬编码端口 HTTP 自调用来导入经纬；**应**改为进程内函数直调。
- R3.3 md 文件**可**作为可选导出/兼容产物保留，但**不应**是经纬数据的权威来源或建书必经中间层。
- R3.4 git 仓库建立环节**应**保持不变。

### R4 经纬协同维护数据结构（支撑后续审阅 UI）
- R4.1 经纬条目**应**记录来源（用户手写 / agent 写作时写入 / 章节后自动修订）。
- R4.2 经纬条目**应**保留修订历史（谁、何时、改了什么）。
- R4.3 当多个写入源对同一条目产生不一致时，系统**应**能标记冲突，供后续 UI 裁决（本 spec 只建数据结构，不建 UI）。
- R4.4 每章完成后的 agent 自动修订**应**写回同一份 SQLite 经纬，并带上来源标记。

### R5 向后兼容与非破坏
- R5.1 现有书籍的经纬数据**应**在迁移后完整可读、可写。
- R5.2 buildJingweiBrief / jingwei.write / 现有 agent 工具**应**在统一后继续正常工作。
- R5.3 迁移**应**可重入（重复运行不损坏数据）。

---

## 非目标（本 spec 不做）

- 建书向导 UI、设定区 UI、协同审阅台 UI（后续独立 spec）。
- 总览区仪表盘、写作区 scene.spec 可视化（后续独立 spec）。
- 经纬图谱可视化的去留（属设定区 UI spec）。
- 模式系统、git 仓库流程的改动。

---

## 验收标准

- AC1：经纬只有一套权威分类，前后端共用，无 CATEGORY_ALIASES 粘合，旧数据迁移无丢失。
- AC2：建一本"都市"书，初始经纬只展开轻量分类，AI 丰富不生成力量体系；建一本"修仙"书，展开重度分类。
- AC3：建书全程无 md 中间产物、无 localhost HTTP 自调用，经纬条目直接落 SQLite。
- AC4：经纬条目带来源/修订历史/冲突字段，agent 章节后自动修订写回同一份经纬并标来源。
- AC5：迁移可重入，现有书 buildJingweiBrief / jingwei.write 正常。
- AC6：相关单测全绿，typecheck 干净。
