# 经纬系统重做 — 设计文档

## Phase 1 架构

```
┌─────────────────────────────────────────────────────────────────┐
│ 前端 — 经纬管理面板 (JingweiPanel)                               │
│                                                                  │
│ ┌──────────┐  ┌────────────────────┐  ┌──────────────────────┐  │
│ │ 分类侧栏  │  │ 条目列表（树形）    │  │ 编辑表单（动态 schema）│  │
│ │ 16 个分类 │  │ 支持搜索/筛选      │  │ 按分类渲染不同字段    │  │
│ │ 图标+计数 │  │ 层级展开/折叠      │  │ 可见性规则编辑器      │  │
│ └──────────┘  └────────────────────┘  └──────────────────────┘  │
│                                                                  │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ 图谱视图 Tab（react-flow）                                    │ │
│ │ 节点 = 条目卡片 / 边 = 关系 / 拖拽连线                        │ │
│ └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                              │ API
┌─────────────────────────────▼──────────────────────────────────┐
│ 后端 API                                                        │
│ GET/POST/PUT/DELETE /api/books/:bookId/jingwei/entries           │
│ GET/POST/DELETE /api/books/:bookId/jingwei/relations             │
│ GET /api/books/:bookId/jingwei/tree                             │
│ POST /api/books/:bookId/jingwei/templates/apply                 │
└──────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────────┐
│ SQLite                                                          │
│ jingwei_sections (已有) + jingwei_entries (已有+扩展)            │
│ + jingwei_relations (新增) + jingwei_progressions (新增)         │
└──────────────────────────────────────────────────────────────────┘
```

## 文件结构

```
packages/studio/src/app-next/writing-workbench/jingwei/
├── JingweiPanel.tsx              — 主面板（三栏布局）
├── JingweiCategorySidebar.tsx    — 左侧分类列表
├── JingweiEntryList.tsx          — 中间条目列表（树形）
├── JingweiEntryForm.tsx          — 右侧编辑表单（动态 schema）
├── JingweiGraphView.tsx          — 图谱视图（react-flow）
├── JingweiSearchBar.tsx          — 搜索栏
├── category-schemas.ts           — 16 个分类的字段 schema 定义
├── genre-templates.ts            — 26 个题材的经纬模板
└── hooks/
    ├── useJingweiEntries.ts      — 条目 CRUD hook
    ├── useJingweiRelations.ts    — 关系 CRUD hook
    └── useJingweiCategories.ts   — 分类统计 hook
```

## 分类 Schema 设计

```typescript
// category-schemas.ts
export interface FieldSchema {
  key: string;
  type: "text" | "textarea" | "select" | "tags" | "number" | "chapter-ref";
  label: string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
}

export interface CategorySchema {
  id: string;
  name: string;
  icon: string;  // lucide icon name
  color: string; // tailwind color
  fields: FieldSchema[];
  defaultVisibility: "global" | "tracked" | "nested";
}

export const CATEGORY_SCHEMAS: CategorySchema[] = [
  {
    id: "character",
    name: "角色管理",
    icon: "Users",
    color: "blue",
    defaultVisibility: "tracked",
    fields: [
      { key: "name", type: "text", label: "姓名", required: true },
      { key: "aliases", type: "tags", label: "别名（AI 识别用）" },
      { key: "roleType", type: "select", label: "角色类型", options: ["主角", "配角", "反派", "路人", "已退场"] },
      { key: "realm", type: "text", label: "当前境界/等级" },
      { key: "personality", type: "tags", label: "性格标签" },
      { key: "goal", type: "textarea", label: "当前目标" },
      { key: "appearance", type: "textarea", label: "外貌特征" },
      { key: "backstory", type: "textarea", label: "背景故事" },
      { key: "firstChapter", type: "number", label: "首次出场章节" },
    ],
  },
  {
    id: "geography",
    name: "地理地图",
    icon: "Map",
    color: "green",
    defaultVisibility: "tracked",
    fields: [
      { key: "name", type: "text", label: "地点名称", required: true },
      { key: "aliases", type: "tags", label: "别名" },
      { key: "type", type: "select", label: "类型", options: ["大陆", "国家", "城市", "村镇", "秘境", "副本", "其他"] },
      { key: "description", type: "textarea", label: "描述" },
      { key: "features", type: "tags", label: "特征标签" },
      { key: "dangers", type: "textarea", label: "危险/限制" },
    ],
  },
  // ... 其他 14 个分类
];
```

## API 设计

### 条目 CRUD（扩展已有）

```
GET    /api/books/:bookId/jingwei/entries?category=character&parentId=null
POST   /api/books/:bookId/jingwei/entries
PUT    /api/books/:bookId/jingwei/entries/:entryId
DELETE /api/books/:bookId/jingwei/entries/:entryId
PATCH  /api/books/:bookId/jingwei/entries/:entryId/move  (修改 parentId)
```

### 关系 CRUD（新增）

```
GET    /api/books/:bookId/jingwei/relations?entryId=xxx
POST   /api/books/:bookId/jingwei/relations
DELETE /api/books/:bookId/jingwei/relations/:relationId
```

### 树形查询（新增）

```
GET    /api/books/:bookId/jingwei/tree?category=geography
→ 返回嵌套树结构 [{ id, title, children: [...] }]
```

## 数据库 Migration

```sql
-- 扩展 jingwei_entries
ALTER TABLE jingwei_entries ADD COLUMN parent_id TEXT REFERENCES jingwei_entries(id);
ALTER TABLE jingwei_entries ADD COLUMN category TEXT NOT NULL DEFAULT 'setting';
ALTER TABLE jingwei_entries ADD COLUMN fields_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE jingwei_entries ADD COLUMN aliases_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE jingwei_entries ADD COLUMN visibility_rule_json TEXT NOT NULL DEFAULT '{"type":"tracked"}';
ALTER TABLE jingwei_entries ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- 新增 relations 表
CREATE TABLE jingwei_relations (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  source_entry_id TEXT NOT NULL REFERENCES jingwei_entries(id) ON DELETE CASCADE,
  target_entry_id TEXT NOT NULL REFERENCES jingwei_entries(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  label TEXT,
  metadata_json TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_jingwei_relations_source ON jingwei_relations(source_entry_id);
CREATE INDEX idx_jingwei_relations_target ON jingwei_relations(target_entry_id);

-- 新增 progressions 表
CREATE TABLE jingwei_progressions (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES jingwei_entries(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  chapter_number INTEGER,
  description TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_jingwei_progressions_entry ON jingwei_progressions(entry_id);
```
