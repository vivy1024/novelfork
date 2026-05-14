# 经纬系统重做 — 任务清单

## Phase 1：经纬前端 CRUD UI + 结构化表单 + 模板补全

### 1.1 数据库 Migration
- [ ] 1.1.1 新增 migration SQL：扩展 jingwei_entries（parent_id, category, fields_json, aliases_json, visibility_rule_json, sort_order）
- [ ] 1.1.2 新增 migration SQL：创建 jingwei_relations 表
- [ ] 1.1.3 新增 migration SQL：创建 jingwei_progressions 表
- [ ] 1.1.4 更新 core schema.ts 导出新表定义
- [ ] 1.1.5 验证：migration 执行成功，表结构正确

### 1.2 后端 API 扩展
- [ ] 1.2.1 扩展 GET /jingwei/entries 支持 category + parentId 筛选
- [ ] 1.2.2 扩展 POST /jingwei/entries 支持 fields_json + parent_id + category + aliases_json + visibility_rule_json
- [ ] 1.2.3 新增 PATCH /jingwei/entries/:id/move（修改 parentId）
- [ ] 1.2.4 新增 GET /jingwei/tree?category=xxx（返回嵌套树）
- [ ] 1.2.5 新增 GET/POST/DELETE /jingwei/relations
- [ ] 1.2.6 验证：curl 测试所有端点

### 1.3 分类 Schema 定义
- [ ] 1.3.1 创建 category-schemas.ts，定义 16 个分类的字段 schema
- [ ] 1.3.2 每个分类：id + name + icon + color + fields[] + defaultVisibility
- [ ] 1.3.3 验证：TypeScript 类型正确

### 1.4 前端组件 — JingweiPanel 主面板
- [ ] 1.4.1 创建 JingweiPanel.tsx（三栏布局：侧栏 + 列表 + 表单）
- [ ] 1.4.2 创建 JingweiCategorySidebar.tsx（16 个分类 + 图标 + 计数）
- [ ] 1.4.3 创建 JingweiEntryList.tsx（条目列表 + 搜索 + 新建按钮）
- [ ] 1.4.4 创建 JingweiEntryForm.tsx（动态 schema 表单渲染）
- [ ] 1.4.5 创建 hooks/useJingweiEntries.ts（CRUD + 缓存）
- [ ] 1.4.6 接入 WritingWorkbenchRoute（替换旧的经纬渲染）
- [ ] 1.4.7 验证：浏览器中能新建/编辑/删除条目

### 1.5 题材模板补全
- [ ] 1.5.1 创建 genre-templates.ts，定义 26 个题材的经纬模板
- [ ] 1.5.2 每个模板：sections[] + 每个 section 的示例条目
- [ ] 1.5.3 更新 novel-init-handler.ts：建书时应用完整模板
- [ ] 1.5.4 验证：选择"诡秘"题材建书后，经纬自动有序列/途径/非凡特性等 section

## Phase 2：层级树 + 关系图谱 + Progressions

### 2.1 层级树
- [ ] 2.1.1 JingweiEntryList 改为树形渲染（递归组件）
- [ ] 2.1.2 支持展开/折叠
- [ ] 2.1.3 支持拖拽调整父子关系（调用 PATCH /move）
- [ ] 2.1.4 验证：创建多级层级，拖拽移动

### 2.2 关系图谱
- [ ] 2.2.1 创建 JingweiGraphView.tsx（react-flow）
- [ ] 2.2.2 自定义节点组件（条目卡片：名称 + 类型图标 + 摘要）
- [ ] 2.2.3 自定义边组件（关系标签 + 方向箭头 + 颜色按类型）
- [ ] 2.2.4 拖拽连线创建关系
- [ ] 2.2.5 右键菜单（编辑/删除关系）
- [ ] 2.2.6 hooks/useJingweiRelations.ts
- [ ] 2.2.7 验证：图谱中看到角色关系网，拖拽创建新关系

### 2.3 Progressions
- [ ] 2.3.1 后端 API：GET/POST /jingwei/entries/:id/progressions
- [ ] 2.3.2 条目详情页显示"演变时间线"
- [ ] 2.3.3 buildBibleContext 注入时使用当前章节对应的最新状态
- [ ] 2.3.4 验证：角色境界变化后，AI 使用新境界

## Phase 3：长篇连贯性机制

### 3.1 递归摘要
- [ ] 3.1.1 新增 volume_summaries 表（book_id, volume_number, summary, token_count）
- [ ] 3.1.2 新增 arc_summaries 表（book_id, arc_number, summary, token_count）
- [ ] 3.1.3 Pipeline post-write hook：每 30 章自动生成卷摘要
- [ ] 3.1.4 Pipeline post-write hook：每 100 章自动生成篇摘要
- [ ] 3.1.5 buildBibleContext 注入递归摘要（书级 + 当前篇 + 当前卷 + 最近 5 章）
- [ ] 3.1.6 验证：写到第 31 章时自动生成卷 1 摘要

### 3.2 经纬自动更新
- [ ] 3.2.1 Pipeline post-write hook：调用 LLM 提取本章变化
- [ ] 3.2.2 变化类型：角色状态变化 / 新实体出现 / 关系变化 / 伏笔推进
- [ ] 3.2.3 自动创建 Progression 记录
- [ ] 3.2.4 自动更新条目 fields_json
- [ ] 3.2.5 验证：主角突破后经纬自动更新

### 3.3 写前 Briefing
- [ ] 3.3.1 新增 buildChapterBriefing(bookId, chapterNumber) 函数
- [ ] 3.3.2 内容：主线 + 计划 + 活跃角色 + 未解决事项 + 硬约束 + 文风
- [ ] 3.3.3 Agent 写章时注入 Briefing 到 system prompt
- [ ] 3.3.4 验证：Agent prompt 中包含结构化 Briefing

### 3.4 因果链
- [ ] 3.4.1 新增 jingwei_causal_chains 表
- [ ] 3.4.2 Pipeline post-write hook：提取新因果链
- [ ] 3.4.3 自动升级 urgency（20 章 medium / 50 章 high / 100 章 overdue）
- [ ] 3.4.4 PGI 引擎集成：overdue 因果链强制追问
- [ ] 3.4.5 验证：50 章未推进的冲突在 PGI 中出现

### 3.5 角色生命周期
- [ ] 3.5.1 jingwei_entries 新增 lifecycle 字段（active/recurring/dormant/dead/retired）
- [ ] 3.5.2 定时任务：50 章未出场 → dormant，100 章 → retired
- [ ] 3.5.3 buildBibleContext 按 lifecycle 过滤注入
- [ ] 3.5.4 验证：dormant 角色不占用 token 预算

## Phase 4：智能预设反思

- [ ] 4.1 写后调用反思模型分析章节内容
- [ ] 4.2 生成预设建议（启用/禁用/调整）
- [ ] 4.3 前端显示建议卡片
- [ ] 4.4 验证：写完章节后看到预设建议

## Phase 5：联想层

- [ ] 5.1 从已写章节自动提取实体 Tag
- [ ] 5.2 构建 Tag 共现矩阵
- [ ] 5.3 脉冲传播联想检索
- [ ] 5.4 做梦系统（每卷结束后发现隐藏联系）
- [ ] 5.5 验证：写章时除了精确匹配还能看到联想建议
