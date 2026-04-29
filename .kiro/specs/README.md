# Kiro Specs Execution Guardrails

本目录记录 NovelFork 的 Kiro specs。后续执行任何 spec 前，必须先读本文件，再读对应 spec 的 `requirements.md`、`design.md`、`tasks.md`。

## 当前状态

当前只保留一个 active spec：

| Spec | 角色 | 当前进度 | 执行口径 |
|---|---|---:|---|
| `novel-creation-workbench-complete-flow` | 当前唯一主线 | 31 / 45 | 推进小说创作工作台完整闭环；继续执行未完成 tasks，不能恢复 mock/fake/noop 假成功。 |

除 `novel-creation-workbench-complete-flow` 外，其余 spec 已归档到 `.kiro/specs/archive/`。归档 spec 只作为历史、参考或可复用资产来源，不再作为当前任务入口。

## 当前总原则

1. **当前主线只认 `novel-creation-workbench-complete-flow`**
   - 新工作台闭环、资源管理器、章节/候选/草稿、经纬、大纲、发布检查、导出与最终验收都在该 spec 内推进。
   - 旧 `studio-frontend-rewrite` 已归档，只作为新入口和布局基线参考。
   - `project-wide-real-runtime-cleanup`、`ui-quality-cleanup`、`docs-system-rearchitecture` 等已归档底座只作为事实来源和约束引用。

2. **不再继续旧前端 UIUX patch**
   - 旧 `packages/studio/src` 页面保留为回退基线。
   - 旧前端只允许修构建失败、安全问题、阻塞级运行错误。
   - 不再往旧 `App.tsx`、旧 `BookDetail`、旧 `ChapterReader`、旧 `SessionCenter`、旧 `WorkflowWorkbench` 继续堆 UIUX 功能。
   - 废弃代码如果阻塞构建，优先删除、正式退役或迁移为真实复用资产；禁止新增 shim、空 routes、假 provider、noop adapter 续命。

3. **小说创作主流程必须学习小说写作软件**
   - 主对象是作品、卷、已有章节、生成章节、草稿、正文、经纬资料。
   - 创作工作台必须包含资源管理器、主编辑器、AI/经纬面板。
   - AI 输出必须先进入预览、候选稿或草稿，用户确认后才能合并到正式正文。
   - 禁止 AI 结果直接覆盖正式正文。

4. **所有 UI 完成标准必须是功能闭环**
   - 页面不能只有卡片、Badge、说明和空列表。
   - 每个页面必须有至少一条可点击完成的用户路径。
   - 空态必须有 CTA；错误态必须有原因；运行态必须有当前动作。
   - 未接入后端的能力必须标记为 transparent unsupported、未接入或只读，不得伪造成功。

5. **归档 spec 不再反向驱动当前实现**
   - 可复用代码、测试、经验可以吸收。
   - 已归档的旧任务勾选状态不得覆盖当前主线 tasks。
   - 如果归档 spec 与主线冲突，以 `novel-creation-workbench-complete-flow` 的 requirements/design/tasks 和当前代码事实为准。

## 当前主线执行边界

### `novel-creation-workbench-complete-flow`

执行时必须同时满足：

- Phase 0 先把已实现功能、透明占位和测试结果写入 `docs/`，避免文档继续落后于代码。
- Phase 1 先修 Tailwind 主题 token 与按钮/状态可辨识度，避免 UI 看起来像同色 mock 壳。
- Phase 2 优先做实小说资源管理器；首版资源管理器是小说资源树，不是通用 IDE 文件浏览器。
- Phase 3 已完成到 AI actions、writing modes 安全应用和 AI 结果 metadata；后续不得破坏非破坏性写入原则。
- Phase 4 继续补经纬、大纲、发布检查与导出。
- Phase 5 收敛状态模型、真实统计和 typecheck 阻塞项。
- Phase 6 执行 mock scan、浏览器闭环验收和最终测试报告。
- 所有 AI 输出必须先进入预览、候选稿或草稿，用户确认后才影响正式章节。
- 未接入能力继续用 unsupported / transparent placeholder，禁止恢复假成功。

## 归档 spec 清单

| Archived spec | 归档口径 |
|---|---|
| `archive/docs-system-rearchitecture` | 文档体系重构已完成，作为 docs 结构和验证规则事实来源。 |
| `archive/project-wide-real-runtime-cleanup` | 反 mock / 真实运行时清理已完成，继续作为 mock debt ledger 和 transparent unsupported 约束来源。 |
| `archive/ui-quality-cleanup` | UI 质量清理已完成，当前 UI 继续由主线 spec 承接。 |
| `archive/provider-integration-rewrite` | Provider UI 骨架/prototype 历史 spec；真实运行时口径已被 runtime cleanup 吸收。 |
| `archive/real-provider-model-runtime` | 已被 `project-wide-real-runtime-cleanup` 吸收，保留为参考。 |
| `archive/old-frontend-decommission` | 已从 active 队列移除；旧前端处理纪律由本 README、CLAUDE.md 和 AGENTS.md 约束。 |
| `archive/studio-frontend-rewrite` | 新入口和布局基线参考，不再作为当前主执行顺序。 |
| `archive/writing-modes-v1` | 写作模式底座参考；当前接入以主线 writing modes apply 任务为准。 |
| `archive/writing-tools-v1` | 写作工具底座参考；当前接入以主线工作台闭环为准。 |
| `archive/writing-presets-v1` | 预设能力参考；首轮工作台只保留入口或摘要，不重写第二套预设中心。 |
| `archive/platform-compliance-v1` | 合规组件与发布检查参考；当前发布检查由主线 Phase 4 承接。 |
| `archive/novel-bible-v1` | 经纬/资料库底座参考；当前 Workspace 经纬接入由主线 Phase 4 承接。 |
| `archive/narrafork-platform-upgrade` | 底座能力复用参考，不重建 Bun/SQLite、会话恢复、AI 请求历史等能力。 |
| `archive/ai-taste-filter-v1` | 去 AI 味能力参考；当前工作台动作必须真实 route 或 transparent unsupported。 |
| `archive/storage-migration` | 存储迁移历史参考。 |
| `archive/onboarding-and-story-jingwei` | 首用体验/经纬历史参考，不作为当前任务入口。 |
| `archive/novelfork-narrafork-closure` | 历史收口参考。 |

## 复用优先清单

后续实现新工作台时，必须先检查并优先复用：

- 设置/运行时：`SettingsView`、`RuntimeControlPanel`、`ReleaseOverview`、旧高级设置弹窗中的可迁移真实能力。
- Provider：`shared/provider-catalog.ts`、`api/lib/provider-runtime-store.ts`、`api/routes/providers.ts`、provider adapter registry。
- Routines：`types/routines.ts`、`api/routes/routines.ts`、`components/Routines/*`。
- 写作工具：`components/writing-tools/*`、`api/routes/writing-tools.ts`、`packages/core/src/tools/*`。
- 合规/发布检查：`PublishReadiness`、`components/compliance/*`、`api/routes/compliance.ts`、`packages/core/src/compliance/*`。
- 经纬/资料库：`BibleView`、`api/routes/bible.ts`、Bible/Jingwei repositories。
- 章节/正文：书籍/章节 API、章节存储、Chapter editor 中已迁移的真实能力。
- 请求历史/资源：Admin Requests、Admin Resources 中仍有真实价值的资产。

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

执行任一主线任务前必须确认：

- [ ] 已阅读本 README。
- [ ] 已阅读 `novel-creation-workbench-complete-flow/requirements.md`、`design.md`、`tasks.md`。
- [ ] 已确认任务是否触碰旧前端冻结范围。
- [ ] 已检查归档 spec / 复用优先清单，避免重复造轮子。
- [ ] 已明确验证方式：route 测试、UI 测试、docs verify、typecheck、browser audit 或人工说明。
- [ ] 已确认未接入能力会显示 unsupported / 未接入 / 只读，而不是伪造成功。

## 当前推荐执行顺序

1. 进入 Phase 4：经纬资料、大纲、发布检查与导出。
2. 执行 Phase 5：状态模型、真实统计、typecheck 阻塞项。
3. 执行 Phase 6：mock scan、浏览器闭环验收、最终报告。
