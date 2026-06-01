# 任务：统一资源版本系统 + 经纬上下文分层

## Phase 1：数据层

### Task 1：创建 writing_resource 表 migration
- [ ] 新建 `packages/core/src/storage/migrations/0016_writing_resource.sql`
- [ ] 建表 + 索引
- [ ] 验证：启动后表存在，`PRAGMA table_info` 正确

### Task 2：创建 jingwei priority_tier migration
- [ ] 新建 `packages/core/src/storage/migrations/0017_jingwei_priority_tier.sql`
- [ ] ALTER TABLE 加列
- [ ] 验证：列存在，默认值 'auto'

### Task 3：WritingResourceRepository
- [ ] 新建 `packages/novel-plugin/src/engine/writing-resource/repository.ts`
- [ ] 实现 CRUD：list / getById / create / update / updateStatus / softDelete / getHistory
- [ ] 单元测试覆盖所有方法
- [ ] 验证：测试通过

### Task 4：WritingResourceService（状态机）
- [ ] 新建 `packages/novel-plugin/src/engine/writing-resource/service.ts`
- [ ] 实现 transition() 含状态机校验
- [ ] accept 动作：设置 chapter_number、archived 旧版本、version +1
- [ ] word_count 自动计算
- [ ] 单元测试覆盖所有合法/非法转换
- [ ] 验证：测试通过

### Task 5：文件数据迁移器
- [ ] 新建 `packages/novel-plugin/src/engine/writing-resource/migrate-from-files.ts`
- [ ] 读取 chapters/index.json + .md → 插入 accepted
- [ ] 读取 generated-candidates/index.json + .md → 插入 candidate
- [ ] 读取 drafts/index.json + .md → 插入 draft
- [ ] 幂等标记
- [ ] 集成测试：准备文件 → 迁移 → 验证数据库内容
- [ ] 验证：测试通过

## Phase 2：后端 API

### Task 6：写作资源 REST 路由
- [ ] 新建 `packages/novel-plugin/src/routes/writing-resource.ts`
- [ ] GET /resources (list with filters)
- [ ] GET /resources/:id
- [ ] POST /resources (create)
- [ ] PUT /resources/:id (update)
- [ ] POST /resources/:id/transition
- [ ] DELETE /resources/:id
- [ ] GET /resources/:id/history
- [ ] 注册到 novel-plugin 路由
- [ ] 验证：curl 测试所有端点

### Task 7：适配 candidate.create_chapter
- [ ] 修改 `candidate-tool-service.ts`：内部改为调用 WritingResourceService.create()
- [ ] 保持外部接口不变（bookId, chapterIntent, content, ...）
- [ ] 验证：编译通过 + 候选稿写入数据库

### Task 8：适配 cockpit.get_snapshot
- [ ] 修改 cockpit-service：章节列表改为查 writing_resource
- [ ] 验证：cockpit 返回正确章节数据

### Task 9：适配 chapter.read
- [ ] 修改 chapter-read handler：改为查 writing_resource
- [ ] 验证：读取章节内容正确

### Task 10：旧路由兼容层
- [ ] `chapter-candidates.ts` 内部转发到新 API
- [ ] 标记 deprecated
- [ ] 验证：旧前端调用不报错

## Phase 3：经纬上下文分层

### Task 11：JingweiContextPolicy
- [ ] 新建 `packages/novel-plugin/src/engine/jingwei/context/context-policy.ts`
- [ ] 实现 resolveLayer() 规则
- [ ] 单元测试
- [ ] 验证：测试通过

### Task 12：改造 buildJingweiContext
- [ ] 增加 mode 参数
- [ ] auto 模式：只返回 core + relevant
- [ ] full 模式：返回全部
- [ ] 按 priority_tier 字段 + 自动规则分层
- [ ] 验证：auto 模式 token ≤ 15000

### Task 13：适配 jingwei.read_context 工具
- [ ] schema 增加 mode 字段
- [ ] handler 传递 mode 到 buildJingweiContext
- [ ] 验证：工具调用返回分层结果

## Phase 4：前端

### Task 14：资源树改造
- [ ] WorkbenchResourceTree 改为从 /api/books/:id/resources 拉数据
- [ ] 按 type 分组显示
- [ ] 状态 badge
- [ ] 验证：浏览器截图

### Task 15：候选稿操作栏接入新 API
- [ ] CandidateActionsBar 的 onAccept/onReject/onArchive 改为调用 /transition
- [ ] 操作后刷新资源树
- [ ] 验证：浏览器截图

### Task 16：草稿操作栏
- [ ] 新建 DraftActionsBar 组件
- [ ] 保存/提交候选稿/直接采纳/删除
- [ ] 验证：浏览器截图

### Task 17：章节操作栏
- [ ] 新建 ChapterActionsBar 组件
- [ ] 编辑（创建 draft）/生成变体/查看历史
- [ ] 验证：浏览器截图

### Task 18：版本历史面板
- [ ] 新建 ResourceHistoryPanel 组件
- [ ] 显示 parent 链
- [ ] 验证：浏览器截图

### Task 19：经纬条目优先级标记 UI
- [ ] 经纬条目编辑表单增加 priority_tier 下拉
- [ ] 保存时写入数据库
- [ ] 验证：浏览器截图

## Phase 5：集成验证

### Task 20：端到端写章流程
- [ ] 启动编译产物
- [ ] 触发写章 → Agent 生成 → candidate.create_chapter → 资源树出现候选稿
- [ ] 采纳为章节 → 章节列表更新
- [ ] 验证：浏览器截图全流程

### Task 21：迁移验证
- [ ] 准备含旧文件结构的测试数据
- [ ] 启动 → 自动迁移 → API 返回正确数据
- [ ] 验证：curl + 浏览器

### Task 22：经纬分层验证
- [ ] 创建多层经纬条目
- [ ] jingwei.read_context auto → 只返回 core+relevant
- [ ] jingwei.read_context full → 返回全部
- [ ] 验证：token 计数 ≤ 15000 (auto)
