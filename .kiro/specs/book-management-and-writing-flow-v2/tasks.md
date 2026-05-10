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
