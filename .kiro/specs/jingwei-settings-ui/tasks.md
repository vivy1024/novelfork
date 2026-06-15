# 设定区 UI 重设计 — Tasks

**对应 Design**: `design.md` 组件 1-6
**执行顺序**: 1 → 2 → 3 → 4 → 5 → 6（侧边栏先行，编辑器依赖列表，看板独立可并行）

---

## Task 1：JingweiCategorySidebar 改造
- [ ] 从 `unified-categories` 导入 CATEGORY_META
- [ ] 按 `book.visibleCategories` 过滤显示分类
- [ ] 渲染 icon + 中文名 + 条目计数
- [ ] 点击分类切换右侧列表

## Task 2：条目列表视图（JingweiEntryList）
- [ ] 卡片组件：名称/标签/来源 icon（铅笔/机器人/时钟）
- [ ] conflictStatus=pending 时红点 + hover 提示
- [ ] 点击打开编辑器

## Task 3：JingweiEntryEditor 多 tab 升级
- [ ] Header：类型标签/名称/来源标记/冲突状态
- [ ] Tab 1 详情：按 category field schema 动态渲染字段
- [ ] Tab 2 关系：relatedEntryIds 列表 + 跳转 + 增删
- [ ] Tab 3 追踪：AI 注入策略 + 修订历史时间线

## Task 4：ForeshadowingBoard 看板组件
- [ ] 四列看板布局（已埋设/部分揭示/已回收/已废弃）
- [ ] 卡片渲染（名称/埋设章节/目标章节/悬念天数）
- [ ] 悬念债务告警（超阈值红边框 + ⚠️）
- [ ] 在伏笔分类下加"看板视图"切换入口

## Task 5：图谱降级
- [ ] DefaultCockpitView 移除 JingweiGraphWorkspace 默认渲染
- [ ] JingweiPanel 底部加"实验性图谱"入口按钮
- [ ] 点击打开图谱抽屉/弹窗

## Task 6：验证
- [ ] typecheck 全量干净
- [ ] 正文联动接口 `getEntryHighlightRanges` 基础实现
- [ ] Browser 截图验证：分类切换/条目编辑/伏笔看板/图谱入口
