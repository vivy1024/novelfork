# 模板市场 v2 — 设计

## 架构

```
┌─────────────────────────────────────────────┐
│              TemplateMarketPanel             │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  │
│  │ 内置(26)│  │ 用户自建 │  │ 远程市场  │  │
│  └────┬────┘  └────┬─────┘  └─────┬─────┘  │
│       │            │               │        │
│       ▼            ▼               ▼        │
│  ┌─────────────────────────────────────┐    │
│  │       统一 Bundle 接口              │    │
│  │  { id, name, genre, tone, beats,   │    │
│  │    jingweiTemplate, prompt, source } │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
         │
         ▼ 应用
┌─────────────────────┐
│  applyTemplate()    │
│  - 设置 genre       │
│  - 应用经纬分区     │
│  - 设置文风 tone    │
│  - 设置节拍模板     │
└─────────────────────┘
```

## 数据模型

### Bundle 统一接口

```typescript
interface TemplateBundle {
  id: string;
  name: string;                    // "凡人宗门仙侠"
  genre: string;                   // "xianxia"
  description: string;             // 一句话描述
  source: "builtin" | "user" | "remote";
  version?: string;
  author?: string;

  // 内容
  genrePrompt: string;             // 流派写作指导 prompt
  toneId?: string;                 // 推荐文风 ID
  tonePrompt?: string;             // 自定义文风 prompt（用户自建时）
  beatTemplateId?: string;         // 推荐节拍模板 ID
  jingweiTemplate?: string;        // 经纬分区模板 ID（blank/basic/enhanced/genre-recommended）
  jingweiSections?: JingweiSectionTemplate[];  // 自定义经纬分区
  sampleOpening?: string;          // 示例开头（可选）
  tags?: string[];                 // 标签（用于搜索）
}
```

### SQLite 表（用户模板）

```sql
CREATE TABLE user_template (
  id TEXT PRIMARY KEY,
  book_id TEXT,              -- 可选绑定到书籍
  name TEXT NOT NULL,
  genre TEXT,
  description TEXT,
  bundle_json TEXT NOT NULL, -- JSON 序列化的 TemplateBundle
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
```

### 远程市场 API

```
GET  /api/market/templates              → { templates: TemplateBundle[] }
GET  /api/market/templates/:id          → { template: TemplateBundle }
POST /api/market/templates/:id/download → 下载到本地 user_template 表
```

远程数据源（v0.1.0）：GitHub raw JSON 文件
```
https://raw.githubusercontent.com/vivy1024/novelfork-templates/main/index.json
```

## 26 流派内容生成策略

每个流派 bundle 的内容由 Agent 生成，包含：
1. **genrePrompt**（200-500 字）：该流派的核心写作规则、常见套路、读者期待
2. **推荐文风**：从现有 5 个 tone 中选择最匹配的
3. **推荐节拍**：从现有 beat 模板中选择或新建
4. **经纬分区推荐**：该流派常用的设定分类（如仙侠需要"境界体系""宗门势力""法宝丹药"）

生成后存为 `packages/core/src/presets/genres/{genre-id}.ts`。

## 修改文件清单

| 文件 | 改动 |
|------|------|
| `packages/core/src/presets/genres/*.ts` | 新增 20 个流派文件 |
| `packages/core/src/presets/bundles/*.ts` | 新增 20 个 bundle 文件 |
| `packages/core/src/presets/index.ts` | 注册新 bundle |
| `packages/core/src/storage/schema.ts` | 新增 user_template 表 |
| `packages/studio/src/api/routes/presets.ts` | 用户模板 CRUD + 远程市场代理 |
| `packages/studio/src/app-next/writing-workbench/TemplateMarketPanel.tsx` | 三栏展示 + 创建/编辑 UI |
| `packages/studio/src/types/settings.ts` | TemplateBundle 类型定义 |
