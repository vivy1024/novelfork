# 经纬数据层统一与题材自适应 — Tasks

**对应 Design**: `design.md` 单元 1-4
**执行顺序**: 按依赖关系，单元 1 → 4 → 2 → 3（先统一分类+加字段，再模板系统，最后改建书流程）

---

## Phase 1：统一分类 + 协同维护字段（地基）

### Task 1.1 创建统一分类定义
- [ ] 新建 `novel-plugin/src/engine/jingwei/unified-categories.ts`
- [ ] 定义 `JINGWEI_CATEGORIES`（16 类）+ `JingweiCategory` 类型
- [ ] 定义 `CATEGORY_SUBCATEGORIES`（props/world-model 的子分类）
- [ ] 定义 `LEGACY_CATEGORY_MAP`（旧 category → 统一 category 映射）
- [ ] 定义每类的元数据（中文名/icon/color/默认可见性/recommendedWhen）
- [ ] 单测：映射覆盖所有旧值、无遗漏

### Task 1.2 SQLite 迁移（加列 + 分类迁移）
- [ ] 新增 migration：`source`/`revision_history`/`conflict_status`/`conflict_detail` 四列
- [ ] 分类迁移逻辑：遍历所有条目，按 LEGACY_CATEGORY_MAP 更新 category + 写入 subcategory
- [ ] 幂等保证：重复运行不损坏（检测已迁移标记）
- [ ] 单测：迁移前后数据完整、幂等

### Task 1.3 消费方迁移（删旧引新）
- [ ] `read-model/category-map.ts`：删除 JINGWEI_READ_CATEGORIES / CATEGORY_ALIASES，改为从 unified-categories 导入
- [ ] `pages/writing-workbench/jingwei/category-schemas.ts`：删除 CATEGORY_SCHEMAS 硬编码，改为从 unified-categories 导入 + 动态生成 field schema
- [ ] `build-jingwei-brief.ts`：sectionPriority 用统一分类名
- [ ] `jingwei-write-handler.ts`：校验 category 用统一枚举（旧值自动映射）
- [ ] `JingweiCategorySidebar.tsx`：从统一定义读取分类列表
- [ ] typecheck 全量干净
- [ ] 现有单测（build-jingwei-brief / jingwei-write / category-map）全绿

### Task 1.4 协同维护数据结构
- [ ] `StoryJingweiEntryRecord` 类型加 source / revisionHistory / conflictStatus / conflictDetail
- [ ] `CreateStoryJingweiEntryInput` / `UpdateStoryJingweiEntryInput` 同步更新
- [ ] entry-repo 的 create/update 方法：写入时自动设 source + 追加 revisionHistory
- [ ] 冲突检测逻辑：agent 写入时检查最近 user 修改 → 标 pending
- [ ] jingwei.write 工具：带 source="agent-write" 写入
- [ ] 单测：来源记录正确、冲突检测触发/不触发场景

---

## Phase 2：题材模板系统

### Task 2.1 模板定义
- [ ] 新建 `novel-plugin/src/engine/jingwei/genre-templates.ts`
- [ ] 定义 `GenreTemplate` interface + `GenreComplexity` type
- [ ] 实现三档默认模板（light/medium/heavy）+ visibleCategories + enrichConstraints
- [ ] 实现 `GENRE_TEMPLATE_MAP`（题材字符串 → complexity）
- [ ] 导出 `getGenreTemplate(genre: string): GenreTemplate`
- [ ] 单测：各题材正确映射、未知题材回退 medium

### Task 2.2 book config 扩展
- [ ] BookConfig 加 `complexity?: GenreComplexity` + `visibleCategories?: JingweiCategory[]`
- [ ] 建书时写入 complexity + 模板默认 visibleCategories
- [ ] 作者手动覆盖 visibleCategories 时存入 book config（后续 UI spec 实现编辑入口）

---

## Phase 3：建书直建 SQLite

### Task 3.1 createJingweiEntriesFromGuide 实现
- [ ] 新建函数：按 answers + template.complexity 决定创建哪些条目
- [ ] 总是创建：premise（故事前提）+ characters（主角）
- [ ] medium+：world-model + props（如有 goldenFinger）
- [ ] heavy：power-system + outline（第一卷骨架）
- [ ] 所有条目 source="system-init"
- [ ] 单测：light/medium/heavy 各档位输出正确条目数和分类

### Task 3.2 guided-setup 流程改造
- [ ] `routes/storage.ts` guided-setup：删除写 md 文件逻辑（story_bible/book_rules/volume_outline/current_state）
- [ ] 替换为：确定题材 → getGenreTemplate → createJingweiEntriesFromGuide
- [ ] 删除 `fetch localhost:port/jingwei/import-from-files` 自调用
- [ ] 保留异步 AI 丰富，但约束用 template.enrichConstraints（不再无差别重度生成）
- [ ] AI 丰富结果直接 upsert SQLite（source="ai-enrich"），不再写 md 再导
- [ ] 题材→预设：合并 template.presetIds + GENRE_TO_PRESET（支持多个）
- [ ] 集成测试：建书端到端无 md 无 localhost，SQLite 条目正确落库

### Task 3.3 兼容处理
- [ ] `localStoryFiles()` 保留但从建书链路摘除（仅供旧书导出/兼容入口）
- [ ] `import-from-files` 端点保留（仅旧书手动迁移用），改为进程内函数调用的 wrapper
- [ ] 旧书首次打开 lazy migration（Task 1.2 的分类迁移 + source 默认值填充）

---

## Phase 4：验收

### Task 4.1 端到端验证
- [ ] 建一本"都市"书 → 初始经纬只有 5 类（characters/conflicts/foreshadowing/outline/chapter-summaries），AI 丰富不生成力量体系
- [ ] 建一本"修仙"书 → 16 类全开，AI 丰富含力量体系/势力/地理
- [ ] 旧书打开 → lazy migration 正常，buildJingweiBrief 正常召回，jingwei.write 正常写入
- [ ] 迁移可重入（重复运行无报错无数据损坏）
- [ ] typecheck 干净，相关单测全绿

### Task 4.2 清理
- [ ] 删除 `CATEGORY_ALIASES`（已无引用）
- [ ] 删除旧 `CATEGORY_SCHEMAS` 硬编码（已被 unified-categories 取代）
- [ ] 更新 CODEMAP（`bun run codegraph`）
- [ ] 更新 CLAUDE.md 功能地图（经纬分类描述）
