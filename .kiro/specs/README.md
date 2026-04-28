# Kiro Specs Execution Guardrails

本目录记录 NovelFork 的 Kiro specs。后续执行任何 spec 前，必须先读本文件，再读对应 spec 的 `requirements.md`、`design.md`、`tasks.md`。

## 当前总原则

1. **不再继续旧前端 UIUX patch**
   - 旧 `packages/studio/src` 页面保留为回退基线。
   - 旧前端只允许修构建失败、安全问题、阻塞级运行错误。
   - 不再往旧 `App.tsx`、旧 `BookDetail`、旧 `ChapterReader`、旧 `SessionCenter`、旧 `WorkflowWorkbench` 继续堆 UIUX 功能。

2. **新前端统一由 `studio-frontend-rewrite` 承接**
   - 新前端必须旁路建设，不能复用旧 `App.tsx` 的页面组织。
   - 第一阶段只做三条闭环：创作工作台、设置页、套路页。
   - 新前端必须先复用已有真实能力，再重写布局。

3. **NarraFork 只作为设置页、套路页、管理型布局参考**
   - 设置页学习 NarraFork 的管理型设计哲学。
   - 套路页直接学习 NarraFork 的固定 AI 专业功能集合。
   - NarraFork 的叙事线、叙述者、章节节点图不作为 NovelFork 小说创作主流程参考。

4. **小说创作主流程必须学习小说写作软件**
   - 主对象是作品、卷、已有章节、生成章节、草稿、正文、经纬资料。
   - 创作工作台必须包含资源管理器、主编辑器、AI/经纬面板。
   - AI 输出必须先进入生成章节或草稿候选，用户确认后才能合并到正式正文。

5. **所有 UI 完成标准必须是功能闭环**
   - 页面不能只有卡片、Badge、说明和空列表。
   - 每个页面必须有至少一条可点击完成的用户路径。
   - 空态必须有 CTA；错误态必须有原因；运行态必须有当前动作。
   - 未接入后端的能力必须标记“未接入/只读”，不得伪造成功。

## 设置页约束

设置页学习 NarraFork 的原因不是“菜单像”，而是其管理体验全面、好用、便捷。所有设置分区都必须遵循同一套模式：

```text
左侧稳定分区导航
  → 右侧当前分区详情
    → 分区总览指标
      → 资源卡片 / 列表
        → 单项详情页 / 编辑表单
          → 保存 / 刷新 / 测试 / 禁用 / 删除
```

### AI 供应商页是设置页样板

AI 供应商页必须支持：

- 供应商总览：供应商总数、已启用、可用模型数。
- 分组：平台集成、API key 接入。
- 添加供应商短表单：供应商名称、前缀、API Key、Base URL、API 模式、兼容格式。
- 支持 OpenAI compatible 与 Anthropic compatible 两种主流自定义格式。
- API 模式：`Completions`、`Responses`、`Codex`。
  - GPT-4 及更老模型、国产模型选择 Completions。
  - GPT-4o 及更新模型选择 Responses。
  - Codex 反代选择 Codex，并支持思考强度。
- 保存后可刷新模型列表。
- 每个模型行必须能单独测试、设置上下文长度、禁用/启用。
- 页面必须显示成功/失败、错误信息、延迟、可用模型数量。

这个范式必须应用到设置页其他分区，不能只有供应商页面做细。

## 套路页约束

套路页直接学习 NarraFork，不做小说化改名。固定分区为：

1. 命令
2. 可选工具
3. 工具权限
4. 全局技能
5. 项目技能
6. 自定义子代理
7. 全局提示词
8. 系统提示词
9. MCP 工具
10. 钩子

实现时必须优先复用：

- `packages/studio/src/types/routines.ts`
- `packages/studio/src/api/routes/routines.ts`
- `packages/studio/src/components/Routines/*`

旧 Routines 已有 global / project / merged scope，后续不得无理由新建第二套数据模型。

## 创作工作台约束

创作工作台是 NovelFork 新前端的小说专用主页面，不是 NarraFork 叙述者中心。

第一阶段必须包含：

- 左侧资源管理器：作品、卷、已有章节、生成章节、草稿、大纲、经纬/资料库。
- 中央主编辑器：章节标题、章节状态、字数、保存状态、正文编辑、对照视图。
- 右侧 AI/经纬面板：生成下一章、续写、审校、改写、去 AI 味、连续性检查、相关人物/地点/伏笔/前文摘要。

AI 输出流向固定为：

```text
AI 操作 → 生成章节 / 草稿候选 → 用户确认 → 合并到已有章节或保留为草稿
```

禁止 AI 结果直接覆盖正式正文。

## 既有 specs 的执行边界

### `novel-creation-workbench-complete-flow`

当前小说创作工作台完整闭环主线。执行时必须同时满足：

- Phase 0 先把已实现功能、透明占位和测试结果写入 `docs/`，避免文档继续落后于代码。
- Phase 1 先修 Tailwind 主题 token 与按钮/状态可辨识度，避免 UI 看起来像同色 mock 壳。
- Phase 2 优先做实小说资源管理器；首版资源管理器是小说资源树，不是通用 IDE 文件浏览器。
- Phase 3 以后再补大而全小说创作闭环：章节、草稿、候选稿、经纬、大纲、AI 写作模式、发布检查与导出。
- 所有 AI 输出必须先进入预览、候选稿或草稿，用户确认后才影响正式章节。
- 未接入能力继续用 unsupported / transparent placeholder，禁止恢复假成功。

### `studio-frontend-rewrite`

当前前端重写基线。后续新工作台闭环以 `novel-creation-workbench-complete-flow` 为主线；执行时仍必须满足：

- 冻结旧前端。
- 旁路建设新入口。
- 先做创作工作台、设置页、套路页。
- 吸收旧 spec 的可复用 UI/组件/API。
- 旧能力复用优先，缺能力时标记未接入。

### `writing-modes-v1`

- Tasks 1-11 可以继续作为核心能力与 API 底座推进。
- Tasks 12-16 不得接入旧 `BookDetail` / `ChapterReader` / 旧 `App.tsx`。
- Tasks 12-16 的 UI 最终挂载到 `studio-frontend-rewrite` 创作工作台：编辑器浮动工具栏、右侧 AI 面板、候选稿对照区、资源管理器导入入口。
- 若先实现 UI 组件，必须保持无旧路由依赖、无旧页面布局假设。

### `writing-tools-v1`

- Tasks 1-12 已作为新创作工作台可复用资产。
- Tasks 13-20 可以继续作为核心逻辑、持久化、Pipeline 与 API 底座推进。
- Tasks 21-24 不得接入旧书籍详情页、旧仪表盘或旧 `App.tsx`。
- Tasks 21-24 只实现可复用 UI 模块，最终由新创作工作台、健康视图、右侧资料/审计面板挂载。
- Task 25 验证分两段：当前 spec 验证核心/API/组件可用；完整页面级验收并入 `studio-frontend-rewrite`。

### `platform-compliance-v1`

- 只剩验证任务。
- 不再重写合规 UI。
- `PublishReadiness` 与 `components/compliance/*` 是新前端复用资产。
- 新创作工作台只提供入口或嵌入已有组件，不新建第二套合规页面。

### `writing-presets-v1`

- 第一阶段不重写预设中心。
- 新创作工作台只显示当前启用预设摘要或入口。
- 不继续扩展旧 `PresetManager` UI。
- 后续等新工作台稳定后，再把预设作为创作基底入口重做。

### `narrafork-platform-upgrade`

- 作为已完成底座复用。
- 不重建 Bun/SQLite、会话恢复、AI 请求历史、Admin Requests/Resources、权限模式等能力。

## 复用优先清单

后续实现新前端时，必须先检查并优先复用：

- 设置/运行时：`SettingsView`、`RuntimeControlPanel`、`ReleaseOverview`、旧高级设置弹窗。
- Provider：`shared/provider-catalog.ts`、`api/lib/provider-manager.ts`、`api/routes/providers.ts`。
- Routines：`types/routines.ts`、`api/routes/routines.ts`、`components/Routines/*`。
- 写作工具：`components/writing-tools/*`、`api/routes/writing-tools.ts`、`packages/core/src/tools/*`。
- 合规：`PublishReadiness`、`components/compliance/*`、`api/routes/compliance.ts`、`packages/core/src/compliance/*`。
- 经纬/资料库：`BibleView`、`api/routes/bible.ts`、Bible/Jingwei repositories。
- 章节/正文：`BookDetail`、`ChapterReader`、书籍/章节 API。
- 请求历史/资源：Admin Requests、Admin Resources。

若旧实现不满足新 UI，需要在任务或提交说明中写明“迁移/包裹/替换”的理由。

## 禁止事项

- 禁止继续在旧前端做 UIUX 大改。
- 禁止把 NarraFork 叙述者中心当成 NovelFork 小说主流程。
- 禁止把所有设置配置堆在一个页面。
- 禁止新建第二套 Routines / Provider / Compliance / Bible 数据模型。
- 禁止 AI 结果直接覆盖正式章节正文。
- 禁止页面只有说明卡、Badge、空态而没有真实操作路径。
- 禁止未接入后端时假装保存成功或功能可用。
- 禁止在没有浏览器路径验收的情况下把 UI 任务标记为完成。

## 执行前检查清单

执行任一 spec 前必须确认：

- [ ] 已阅读本 README。
- [ ] 已阅读目标 spec 的 `requirements.md`、`design.md`、`tasks.md`。
- [ ] 已确认该任务是否属于旧前端冻结范围。
- [ ] 已确认是否应并入 `studio-frontend-rewrite`。
- [ ] 已检查复用优先清单，避免重复造轮子。
- [ ] 已明确浏览器验收路径或标记为核心/API/组件底座任务。
- [ ] 已确认未接入能力会显示未接入/只读，而不是伪造成功。

## 当前推荐执行顺序

1. 执行 `novel-creation-workbench-complete-flow` Phase 0：把已完成能力、透明占位、API 与测试结果写入 docs，并清理重复文档。
2. 执行 `novel-creation-workbench-complete-flow` Phase 1：修复 Tailwind theme token 与 UI 可辨识度。
3. 执行 `novel-creation-workbench-complete-flow` Phase 2：做实小说资源管理器。
4. 执行 `novel-creation-workbench-complete-flow` Phase 3+：补齐章节、草稿、候选稿、经纬、大纲、AI 写作模式、发布检查与导出闭环。
5. 对照 `project-wide-real-runtime-cleanup` 的 ledger，确保新增能力不恢复 mock/fake/noop 假成功。
6. 旧 `studio-frontend-rewrite` 只作为新入口和布局基线参考，不再作为当前主执行顺序。
