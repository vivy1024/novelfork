---
title: 故事经纬
summary: 世界观与设定的结构化存储，精准控制 AI 能看到哪些信息
tags: [经纬, 世界观, 设定, 可见性, AI上下文]
routes:
  - /next/workbench/:bookId/jingwei
---

# 故事经纬

> 世界观与设定的结构化存储，精准控制 AI 能看到哪些信息。

## 核心概念

### 经纬结构

**经纬（Jingwei）** — 二级结构：分区 → 条目。在资源树中的实际展示：

```
📁 经纬资料
├── 故事经纬     ← story_bible.md（核心前提/世界观/力量体系/主角设定）
├── 卷大纲       ← 分卷结构规划
├── 当前状态     ← 当前写作进度追踪
└── 书籍规则     ← AI 写作时必须遵守的规则约束
📁 伏笔
└── 待处理伏笔   ← 已埋设但未回收的伏笔线索
```

每个条目都是 Markdown 文件，在画布中以编辑器形式打开，支持全文阅读和编辑。新建书籍后条目内容初始为 `*(待 AI 生成)*`，完成向导后由 AI 自动填充。

### 条目格式

Markdown 正文 + YAML frontmatter（标签、别名、自定义字段、关联章节）。

### AI 上下文参与

开启 `participatesInAi` 的条目在 AI 生成时自动注入上下文。配合可见性规则和 tokenBudget 精确控制注入范围。

### 可见性规则

控制条目在哪些章节对 AI 可见：
- `global`：全局可见，适合核心世界观
- `tracked`：按章节范围可见，适合角色出场、秘密揭示
- `nested`：继承父条目可见性

## 推荐使用流程

1. 建书时选择经纬模板（blank / basic / enhanced / 题材推荐）
2. 先建分区结构，再逐步填充条目
3. 为角色添加别名（各种称呼），提高 AI 识别率
4. 用 tracked 规则控制剧情秘密的揭示时机
5. 为核心角色分配较高 tokenBudget（500-1000），次要设定给 100-200

## 最佳实践

- 控制 global 条目数量。global 越多，每次写作上下文越大。
- 未揭示的秘密用 `tracked + visibleAfterChapter` 防止 AI 剧透。
- 定期清理不再需要的条目，保持上下文精简。

## 常见坑

- **AI 写出未揭示的秘密** — 条目可见性误设为 global。改为 tracked + visibleAfterChapter。
- **AI 忽略某个设定** — 条目 participatesInAi 未开启。检查开关状态。
- **上下文超限** — 太多条目参与 AI。减少 budget 或关闭非必要条目的 AI 参与。
- **别名冲突** — 两个角色共享相同别名导致 AI 混淆。确保别名全局唯一。

## Agent 查阅提示

- Agent 通过 `jingwei.*` 工具读写经纬（jingwei.list_sections / jingwei.get_entry / jingwei.update_entry 等）
- 写作前自动遍历 participatesInAi=true 的条目 → 按当前章节号过滤可见性 → 按 tokenBudget 裁剪 → 注入 prompt
- 条目的 aliases 字段用于正文中的实体识别，Agent 应在创建角色时主动填充常见称呼
- 模板系统按题材推荐分区结构（玄幻：功法/灵宝/宗门/秘境；都市：公司/关系网/事件线）

## 可跳转功能入口

| 功能 | 路径 |
|------|------|
| 经纬管理 | `/next/workbench/:bookId/jingwei` |
