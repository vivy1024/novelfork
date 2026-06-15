# 设定区 UI 重设计 — Design

**版本**: v1.0.0
**创建日期**: 2026-06-15
**对应 Requirements**: `requirements.md` R1-R6

---

## 设计总览

核心改动：DefaultCockpitView 中的 JingweiPanel 从"图谱满屏"改为"分类侧边栏 + 条目卡片列表 + 多 tab 编辑器"。图谱降级为可选视图。新增伏笔看板组件。

涉及文件均在 `packages/novel-plugin/src/pages/writing-workbench/jingwei/`。

---

## 组件设计

### 1. JingweiCategorySidebar 改造

```ts
// 从 unified-categories 读取 CATEGORY_META
// 按 book.visibleCategories 过滤（题材模板决定的初始可见分类）
// 渲染：icon + 中文名 + 条目计数 badge
// 点击切换右侧条目列表
```

### 2. 条目列表视图（JingweiEntryList）

- 每个条目渲染为卡片：名称 / 标签 / 来源 icon / 冲突红点
- 来源 icon 映射：user=铅笔 / agent=机器人 / auto-settle=时钟
- conflictStatus=pending → 右上角红点 + hover 提示
- 点击卡片打开 JingweiEntryEditor

### 3. JingweiEntryEditor 多 tab 升级

**Header**：类型标签 / 名称（可编辑）/ 来源标记 / 冲突状态

**Tab 结构**：
| Tab | 内容 |
|-----|------|
| 详情 | 基础字段（按 category field schema 动态渲染）/ 优先级 / 可见性规则 |
| 关系 | relatedEntryIds 渲染为关联条目列表（名称+类型+点击跳转）/ 添加/移除关联 |
| 追踪 | AI 注入策略（visibilityRule/priorityTier）/ 修订历史时间线（source+timestamp+diff摘要）|

### 4. ForeshadowingBoard 看板组件

- 四列看板：已埋设 / 部分揭示 / 已回收 / 已废弃
- 数据源：筛选 category="foreshadowing" 的条目，按 `status` 字段分列
- 卡片内容：名称 / 埋设章节号 / 目标章节号 / 悬念天数（当前章 - 埋设章）
- 悬念债务：悬念天数 > 阈值（默认 15 章）→ 卡片边框变红 + ⚠️ 图标
- 入口：分类侧边栏点击"伏笔"时，列表上方显示"看板视图"切换按钮

### 5. 图谱降级

- JingweiGraphWorkspace 从 DefaultCockpitView 默认渲染中移除
- 在 JingweiPanel 底部加"查看实验性图谱"按钮，点击打开图谱弹窗/抽屉
- 图谱组件本身不改动，只改入口位置和展示方式

### 6. 正文联动接口

```ts
// novel-plugin/src/engine/jingwei/highlight-api.ts
export function getEntryHighlightRanges(
  chapterId: string, entryId: string
): { start: number; end: number; text: string }[]
// 实现：从章节正文中搜索条目名称/别名的出现位置
// 本 spec 只建接口和基础实现，不接入 UI
```

---

## 数据流

```
CATEGORY_META (unified-categories.ts)
  → JingweiCategorySidebar (过滤 visibleCategories)
  → JingweiEntryList (按选中分类 fetch 条目)
  → JingweiEntryEditor (条目详情/关系/追踪)

ForeshadowingBoard: fetch entries where category=foreshadowing → 按 status 分组 → 看板渲染
```

---

## 非破坏性

- 现有 JingweiEntryEditor 的保存逻辑不变，只增加 tab 包装
- 图谱代码不删除，只改入口
- 新增组件均为独立文件，不影响现有导入
