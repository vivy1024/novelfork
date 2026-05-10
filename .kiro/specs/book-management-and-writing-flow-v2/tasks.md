# 写作流程断裂修复与功能补全 v3

## 概述

基于 2026-05-11 全量断裂点审计，记录当前已知的功能断裂、缺口和待修复项。分为"代码断裂（能修）"和"功能缺口（需设计）"两类。

## 来源

- 2026-05-11 全量 spec 审计（42 个归档 spec 对照实际代码）
- 用户操作反馈
- NarraFork 对标分析

---

## P0：写作动作按钮 → Agent 无法执行

### 现状

用户点击"生成下一章"等按钮 → 创建会话 → 导航 → 自动发送 `/novel:write-next` → **命令返回"未处理"**。

### 根因

`command-registry.ts` 注册了 `/novel:write-next` 等命令，`novel-write-next-handler.ts` 独立模块已实现，但 `command-executor.ts` 需要 `executeNovelCommand` handler，**没有任何代码提供这个 handler**。

### 影响的按钮

| 按钮 | Slash Command | 状态 |
|------|--------------|------|
| 生成下一章 | `/novel:write-next` | ❌ 命令未处理 |
| 续写草稿 | `/novel:draft` | ❌ 命令未处理 |
| 扩写/改写 | `/novel:preview` | ❌ 命令未处理 |
| 连续性审校 | `/novel:audit` | ❌ 命令未处理 |
| 去 AI 味检测 | `/novel:detect` | ❌ 命令未处理 |
| 伏笔建议 | `/novel:hooks` | ❌ 命令未处理 |

### 修复方案

两条路：
1. **接通 slash command → pipeline**：在 session chat service 中提供 `executeNovelCommand` handler，调用 `PipelineRunner`
2. **绕过 slash command，直接调用 API**：写作动作按钮不走会话，直接 POST `/api/books/:id/write-next`（后端已有此路由）

方案 2 更简单但用户看不到 Agent 执行过程；方案 1 是正确架构但工作量大。

---

## P1：写作工具面板 onRunTool 空实现

### 现状

`WritingWorkbenchRoute.tsx` 传入 `onRunTool={async () => ({})}`，导致写作工具面板中 7/8 个工具点击后返回空 `{}`。

### 影响的工具

| 工具 | 后端 API | 前端状态 |
|------|---------|----------|
| AI 味检测 | `/api/filter/scan` | ✅ 有独立调用，不受影响 |
| 章末钩子生成 | `/api/books/:id/hooks/generate` | ❌ onRunTool 空 |
| 段落节奏分析 | `/api/books/:id/chapters/:ch/rhythm` | ❌ onRunTool 空 |
| 对话比例分析 | `/api/books/:id/chapters/:ch/dialogue` | ❌ onRunTool 空 |
| 全书健康 | `/api/books/:id/health` | ❌ onRunTool 空 |
| 矛盾地图 | `/api/books/:id/contradictions` | ❌ onRunTool 空 |
| 角色弧线 | `/api/books/:id/arcs` | ❌ onRunTool 空 |
| 文风检测 | `/api/books/:id/style/drift-check` | ❌ onRunTool 空 |

### 修复方案

实现 `onRunTool`：根据 `toolId` 和 `endpoint` 调用对应后端 API，返回结果。

---

## P1：Checkpoint/Rewind 面板不可达

### 现状

`CheckpointPanel` 组件完整实现，后端 API 完整，但没有任何页面渲染它。

### 修复方案

在写作工具面板或工作台顶部栏加入 Checkpoint 入口。

---

## P2：远程模板仓库不存在

### 现状

`REMOTE_TEMPLATES_URL` 指向 `vivy1024/novelfork-templates`，该仓库未创建。远程标签页永远为空。

### 修复方案

创建 GitHub 仓库 + 上传 `index.json`，或暂时隐藏远程标签页。

---

## P2：文风漂移输入为假数据

### 现状

`StyleDriftPanel` 用硬编码的 `avgSentenceLength: 18/22, vocabularyDiversity: 0.6/0.7` 调用 API，结果不反映真实文风。

### 修复方案

从书籍已有章节计算真实 style profile 作为 base，用当前章节作为 current。

---

## 功能缺口：大纲 → 章节过渡

### 现状

`volume_outline.md` 在引导时生成骨架，但：
- 没有大纲编辑 UI（拖拽排序、添加/删除章节条目）
- 没有"按大纲写第 N 章"的引导流程
- 大纲和 PGI 追问没有联动

### 需要设计

1. 大纲编辑器（资源树中可编辑 `volume_outline.md`，或结构化 UI）
2. 章节意图文件（`.intent.md`）从大纲条目自动生成
3. PGI 引擎读取当前章节的大纲条目作为追问依据

---

## 功能缺口：状态自动更新

### 现状

`current_state.md` 只在引导时生成一次。写完新章后不会自动更新世界状态。

### 需要设计

`StateValidatorAgent` 在管线末尾更新 `current_state.md`（角色状态变化、伏笔推进、时间线推进）。依赖 P0 管线修复。

---

## 功能缺口：伏笔资源树可见

### 现状

伏笔在 SQLite 中有记录（PGI 引擎查询用），但资源树里看不到、编辑不了。

### 需要设计

资源树增加"伏笔"分组，显示活跃伏笔列表（buried/escalating/resolved），可手动添加/编辑。

---

## 功能缺口：经纬文件夹重构

### 现状

当前经纬文件平铺在 `books/<id>/story/` 下：
```
story/
├── story_bible.md
├── book_rules.md
├── volume_outline.md
├── current_state.md
├── pending_hooks.md
├── particle_ledger.md
├── subplot_board.md
├── emotional_arcs.md
└── character_matrix.md
```

问题：
1. 所有设定塞一个 `story_bible.md`，不可维护
2. 命名用 `bible`（上游 InkOS 遗留），中文作者无语义
3. 没有按类别分文件夹，无法单独管理角色/势力/设定

### 目标结构

```
books/<id>/jingwei/
├── 角色/
│   ├── 沈舟.md
│   ├── 林若.md
│   └── _index.json        ← 元数据（别名、可见性规则、关联章节）
├── 势力/
│   ├── 天机阁.md
│   └── 魔道联盟.md
├── 设定/
│   ├── 力量体系.md
│   ├── 世界地理.md
│   └── 经济规则.md
├── 伏笔/
│   ├── 玉佩来历.md         ← 状态：buried/escalating/resolved
│   └── 师父失踪.md
├── 大纲/
│   ├── 第一卷.md
│   └── 第二卷.md
├── 状态/
│   ├── current_state.md
│   ├── particle_ledger.md
│   └── pending_hooks.md
└── 规则/
    └── book_rules.md
```

### 迁移策略

1. 新书直接用新结构
2. 旧书保持兼容（读取时两种路径都尝试）
3. 提供一次性迁移命令

### 代码改动范围

- `resource-tree-adapter.ts`：读取新目录结构
- `ChapterAnalyzerAgent`：读取经纬文件路径更新
- `WriterAgent`：同上
- `buildBibleContext()`：同上
- `guided-setup` API：写入新路径
- 资源树前端：显示文件夹层级

---

## 经纬上下文注入机制（连贯性保障）

### 当前分层压缩策略

写第 N 章时，AI prompt 包含：

| 层 | 内容 | 来源 | 约 token |
|---|---|---|---|
| 经纬条目 | 角色/设定/伏笔（结构化摘要） | SQLite `bible_*` 表 + 经纬文件 | 2000-5000 |
| 章节摘要 | 每章 100-200 字摘要 × N 章 | `retrieveMemorySelection()` | 1000-3000 |
| 近章全文 | 最近 2-3 章完整正文 | 文件系统 `.md` | 3000-9000 |
| 规则+状态 | book_rules + current_state | 文件系统 | 500-1000 |
| 本章意图 | PGI 回答 + 大纲条目 | `.intent.md` + PGI engine | 300-500 |
| **总计** | | | **7000-18000** |

### 可见性过滤

- **global**：所有章节都注入（如主角设定、世界规则）
- **nested**：从某章开始注入（如新角色登场后）
- **tracked**：只在特定章节范围注入（如临时事件）

### Token 预算裁剪

`token-budget.ts` 按优先级排序经纬条目，超出预算时从低优先级开始裁剪：
1. 核心记忆（主角/金手指/世界规则）— 最高优先级
2. 活跃矛盾/伏笔
3. 配角设定
4. 历史事件摘要

### 关键依赖

整条连贯性链依赖管线执行（P0）：
- 章节摘要由 `ChapterAnalyzerAgent` 生成
- 经纬更新由 `saveJingweiFiles()` 在管线末尾执行
- 状态更新由 `StateValidatorAgent` 执行
- 伏笔状态由 `RadarAgent` 更新

**P0 不修，连贯性保障链条不工作。**

---

## 执行顺序

```
1. [P0] 管线入口修复（executeNovelCommand handler）
2. [重命名] bible → jingwei 全量重命名（70+ 文件，目录/函数/类型/SQL 别名）
3. [重构] 经纬文件夹重构（story/ 平铺 → jingwei/ 按类别分目录）
4. [P1] 写作工具面板 onRunTool 接通
5. [P1] Checkpoint 面板接入 UI
6. [P2] 文风漂移真实数据
7. [P2] PGI 规则 3/4 补完（人设漂移 + 大纲偏离）
8. [P2] 摘要滑动窗口（50+ 章长篇适配）
9. [发布] v0.1.0 release（验证 + tag + GitHub Release）
```

---

## 待执行：bible → jingwei 全量重命名

### 范围

- `packages/core/src/bible/` 目录 → `packages/core/src/jingwei/`（已有薄适配层，需合并）
- 70+ 文件中的 `bible` 引用（函数名、类型名、变量名）
- SQL 表名 `bible_*` → 加 migration 创建别名视图（不改表名，避免数据丢失）
- `packages/studio/` 中的 API 路由和前端引用
- 测试文件重命名

### 策略

1. 目录重命名：`bible/` → 合并到 `jingwei/`
2. 代码内 replace：`Bible` → `Jingwei`、`bible` → `jingwei`
3. SQL：新 migration 创建视图别名（`CREATE VIEW jingwei_character AS SELECT * FROM bible_character`）
4. 导出保持向后兼容：`index.ts` 同时导出旧名和新名（deprecated 标记）
5. 分批提交：目录 → 类型 → 函数 → 路由 → 前端 → 测试

---

## 已修复项（本轮）

| 问题 | 修复 commit |
|------|------------|
| 写作动作 → 导航后不发消息 | `pending-action-store` + auto-send |
| 引导完成 → 资源树不刷新 | `onGuideComplete → reloadResources` |
| 书籍删除入口 | `/next/books` 管理页 |
| Context Ring 不显示 | `contextUsage` 数据接通 + 自动压缩 |
| 行内续写 Tab 补全 | `TextBody` onKeyDown → inline-write API |
| 消息右键菜单 | rollback/fork/edit-regenerate/delete 全部接通 |
| 供应商创建流程冗余 | 直接创建进详情页 |
| 供应商详情页 UI | 对标 NarraFork（测试对话框、圆点启用、宽 context window） |
