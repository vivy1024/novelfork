---
title: 故事经纬
summary: 经纬系统的分区与条目、可见性规则、模板、AI 上下文参与
tags: [经纬, 世界观, 设定, 可见性, AI上下文]
routes:
  - /workbench/:bookId
---

# 故事经纬

> 经纬系统是 NovelFork 的世界观管理核心——结构化存储你的设定，并精准控制 AI 能"看到"哪些信息。

---

## 核心概念

经纬（Jingwei）是一个二级结构：

```
经纬系统
├── 分区 (Section) — 如"角色"、"地点"、"势力"、"物品"
│   ├── 条目 (Entry) — 如"张三"、"青云山"、"天机阁"
│   ├── 条目 (Entry)
│   └── ...
├── 分区 (Section)
│   └── ...
└── ...
```

经纬不只是笔记本——它是 AI 写作的上下文来源。开启 `participatesInAi` 的条目会在 AI 生成时自动注入上下文。

---

## 分区（Section）

### 分区字段

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| bookId | string | 所属作品 |
| key | string | 程序化标识（如 characters） |
| name | string | 显示名称（如"角色"） |
| description | string | 分区说明 |
| icon | string | 图标标识 |
| order | number | 排序权重 |
| enabled | boolean | 是否启用 |
| showInSidebar | boolean | 是否在侧栏显示 |
| participatesInAi | boolean | 该分区是否参与 AI 上下文 |
| defaultVisibility | JingweiVisibilityRuleType | 新条目的默认可见性 |
| fieldsJson | JingweiFieldDefinitionView[] | 自定义字段定义 |
| builtinKind | string | 内置分区类型（如有） |
| sourceTemplate | string | 来源模板标识 |

### 自定义字段类型

分区可定义自定义字段，条目创建时按字段定义填写：

| 字段类型 | 说明 |
|---------|------|
| text | 单行文本 |
| textarea | 多行文本 |
| number | 数字 |
| select | 单选 |
| multi-select | 多选 |
| chapter | 章节引用 |
| tags | 标签列表 |
| relation | 关联其他条目 |
| boolean | 布尔开关 |

---

## 条目（Entry）

### 条目字段

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| bookId | string | 所属作品 |
| sectionId | string | 所属分区 |
| title | string | 条目标题（如"张三"） |
| contentMd | string | Markdown 格式的详细描述 |
| tags | string[] | 标签列表 |
| aliases | string[] | 别名列表（用于 AI 识别） |
| customFields | Record | 自定义字段值 |
| relatedChapterNumbers | number[] | 关联章节号 |
| relatedEntryIds | string[] | 关联其他条目 |
| visibilityRule | JingweiVisibilityRuleView | 可见性规则 |
| participatesInAi | boolean | 是否参与 AI 上下文 |
| tokenBudget | number | 上下文 token 预算 |

### aliases 的作用

别名用于 AI 在文本中识别该条目。例如角色"张三"可能有别名：
- "三哥"
- "张道长"
- "青云剑仙"

AI 在正文中遇到这些称呼时，能关联到同一个角色条目。

---

## 可见性规则

可见性规则控制条目在哪些章节对 AI 可见：

| 规则类型 | 说明 | 适用场景 |
|---------|------|---------|
| global | 全局可见，所有章节都能看到 | 核心设定、世界观基础 |
| tracked | 按章节范围可见 | 角色出场、剧情揭示 |
| nested | 继承父条目的可见性 | 子设定跟随父设定 |

### tracked 规则详情

```typescript
{
  type: "tracked",
  visibleAfterChapter: 5,    // 第 5 章之后可见
  visibleUntilChapter: 20,   // 第 20 章之前可见
  keywords: ["张三", "青云"] // 关键词触发
}
```

### 使用建议

- **核心世界观** → global（如修炼体系、世界地图）
- **角色设定** → tracked（角色出场后才可见）
- **剧情秘密** → tracked + visibleAfterChapter（揭示后才可见）
- **子设定** → nested（跟随父条目）

---

## 模板

创建作品时可选择经纬模板，自动生成分区结构：

| 模板 | 说明 |
|------|------|
| blank | 空白，不创建任何分区 |
| basic | 基础：角色、地点、物品 |
| enhanced | 增强：角色、地点、物品、势力、事件、规则 |
| genre-recommended | 题材推荐：根据选择的题材自动推荐分区 |

### 题材推荐示例

- **玄幻**：角色、功法、灵宝、宗门、秘境、天地规则
- **仙侠**：角色、法宝、门派、洞天、天道、因果
- **都市**：角色、公司、关系网、事件线、城市地标
- **科幻**：角色、科技、星球、文明、时间线

---

## AI 上下文参与

### 参与机制

```
AI 写作请求
    ↓
遍历所有 participatesInAi=true 的条目
    ↓
按可见性规则过滤（当前章节号）
    ↓
按 tokenBudget 裁剪内容
    ↓
组装为上下文注入 prompt
```

### tokenBudget

每个条目可设置 token 预算：
- `null`：使用系统默认值
- 具体数字：该条目最多占用的 token 数
- 超出预算时，系统智能截断（保留关键信息）

### 优化建议

- 核心角色给更多 budget（500-1000）
- 次要设定给较少 budget（100-200）
- 不需要 AI 参考的条目关闭 participatesInAi

---

## JingweiEntryEditor

经纬条目编辑器提供：

- Markdown 编辑区（contentMd）
- 标签编辑器（tags）
- 别名编辑器（aliases）
- 自定义字段表单（customFields）
- 可见性规则配置（VisibilityRuleEditor）
- 关联章节选择
- 关联条目选择
- AI 参与开关
- Token 预算设置

---

## 最佳实践

- **先建分区再填条目**：规划好分区结构，避免后期大量迁移
- **善用别名**：角色的各种称呼都加上，提高 AI 识别率
- **控制 global 数量**：global 条目越多，每次写作的上下文越大
- **用 tracked 控制剧透**：未揭示的秘密设为 visibleAfterChapter
- **定期清理**：删除不再需要的条目，保持上下文精简
- **关联章节**：标记条目首次出现的章节，方便追溯

---

## 常见坑

| 问题 | 原因 | 解决 |
|------|------|------|
| AI 写出了未揭示的秘密 | 条目可见性设为 global | 改为 tracked + visibleAfterChapter |
| AI 忽略了某个设定 | 条目 participatesInAi=false | 开启 AI 参与 |
| 上下文超限 | 太多条目参与 AI | 减少 budget 或关闭不必要的条目 |
| 别名冲突 | 两个角色有相同别名 | 确保别名唯一 |

---

## 可跳转入口

| 功能 | 路径 |
|------|------|
| 写作工作台（含经纬） | `/workbench/:bookId` |
