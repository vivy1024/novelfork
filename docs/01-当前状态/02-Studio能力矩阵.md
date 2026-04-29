# Studio能力矩阵

**版本**: v1.0.1
**创建日期**: 2026-04-28
**更新日期**: 2026-04-28
**状态**: ✅ 当前有效
**文档类型**: current

---

## 1. 文档目的

本文记录 NovelFork Studio 当前功能真实状态，作为后续 `novel-creation-workbench-complete-flow` spec 的 Phase 0 事实源之一。

本文只描述当前已经能从代码、测试或浏览器审计中确认的事实：

- **真实可用**：有真实 API、持久化或真实 runtime 调用，失败时返回真实错误。
- **透明过渡**：功能仍是临时态、`process-memory`、`prompt-preview`、`chunked-buffer` 或 `unsupported`，但 UI/API 已明确标注，不冒充正式完成。
- **内部示例**：只用于开发、测试或 demo，不应出现在生产入口。
- **待迁移**：存在旧入口或兼容入口，当前不应继续扩展。

> 本文不是产品完成声明。`透明过渡` 和 `内部示例` 只能说明“没有再假装完成”，不能说明功能已经完整可用。

## 2. 主要事实来源

| 来源 | 用途 |
|---|---|
| `.kiro/specs/project-wide-real-runtime-cleanup/` | 反 mock 清理要求、设计与任务完成口径 |
| `.kiro/specs/novel-creation-workbench-complete-flow/` | 当前工作台完整闭环新主线 |
| `.kiro/specs/archive/novel-bible-v1/` | 已实现认知层能力事实：问卷、生成前追问、核心变更、上下文装配 |
| `.kiro/specs/archive/onboarding-and-story-jingwei/` | 首启引导、模型 gate、故事经纬命名与结构化 API / 组件事实 |
| `.kiro/specs/archive/ai-taste-filter-v1/`、`writing-presets-v1/`、`platform-compliance-v1/` | AI 味、预设资产、发布合规已实现能力事实 |
| `packages/studio/src/api/lib/mock-debt-ledger.ts` | mock/占位/真实化状态登记事实源 |
| `packages/studio/src/app-next/workspace/WorkspacePage.test.tsx` | 新创作工作台资源树、章节编辑、候选稿、AI gate、经纬面板、写作工具 UI 覆盖 |
| `packages/studio/src/api/routes/writing-tools.test.ts` | 写作工具、hook、节奏/对话/健康指标 route 覆盖 |
| `packages/studio/src/api/routes/writing-modes.test.ts` | 写作模式 prompt-preview route 覆盖 |
| `packages/studio/src/api/routes/bible.test.ts`、`packages/core/src/__tests__/bible-pgi.test.ts` | 问卷、CoreShift、生成前追问 route / core 规则覆盖 |
| `packages/studio/src/api/routes/jingwei.test.ts`、`packages/core/src/__tests__/jingwei-context.test.ts` | 故事经纬栏目/条目/上下文装配覆盖 |
| `packages/studio/src/api/routes/filter.test.ts`、`packages/studio/src/api/routes/compliance.test.ts`、`packages/studio/src/api/routes/presets.test.ts` | AI 味、发布合规、预设 API 覆盖 |
| `packages/studio/src/components/ChatPanel.test.tsx` | 轻量 Book Chat 临时历史状态覆盖 |
| recent commits `c4b60d4b`～`7349aad4` | runtime cleanup、mock scan、UI 透明占位、模型池边界、health 透明化等近期变更 |

## 3. AI Provider、模型池与会话运行时

| 功能 | 用户入口 | API / 组件入口 | 数据来源 | 持久化状态 | 当前状态 | 已知限制 | 验证文件或口径 |
|---|---|---|---|---|---|---|---|
| Provider runtime store | 设置页 → AI 供应商；Admin/Onboarding/WritingTools 内部读取 | `provider-runtime-store.ts`、`api/routes/providers.ts` | `ProviderRuntimeStore` | 真实持久化 | 真实可用 | 旧 `provider-manager` 仍作为兼容类和测试对象保留，但不应重新接入生产路由 | ledger `provider-runtime`；provider/admin/onboarding/writing-tools 相关测试 |
| Codex/Kiro 平台账号导入 | 设置页 → 平台集成 | `api/routes/platform-integrations.ts` | runtime store | Codex/Kiro JSON 账号持久化 | 真实可用 | 账号缺失或禁用时对应平台模型会从模型池过滤 | ledger `platform-integrations`；PlatformIntegration 相关测试 |
| Cline 平台账号导入 | 设置页 → 平台集成 | `api/routes/platform-integrations.ts` | 未接入 | 无 | 透明过渡 | 当前返回 `501 unsupported`，UI 需显示透明未接入 | ledger `platform-integrations`；PlatformIntegration 相关测试 |
| Runtime model pool | ChatWindow、Settings、NewSessionDialog、WritingTools AI gate | `/api/providers/models` | runtime provider/model/account store | 从持久化 runtime store 派生 | 真实可用 | 共享 provider catalog 只作为模板/类型来源，不是运行时模型池 | ledger `runtime-model-pool`；runtime-model-pool/provider route/UI 测试 |
| Session chat runtime | 会话中心 / ChatWindow | `session-chat-service.ts` | LLM runtime service + session config | 成功/失败响应携带 runtime metadata | 真实可用 | adapter 未接入、凭据缺失时返回 error envelope，不生成假 assistant 正文 | ledger `session-chat-runtime`；session-chat-service 测试 |
| Legacy Model UI | 旧模型选择组件 | `components/Model/ModelPicker.tsx`、`ProviderConfig.tsx` | `/api/providers/models` 或停用说明 | 不再维护第二套浏览器本地 provider 配置 | 待迁移 | 旧组件只保留兼容/引导，不应扩展新功能 | ledger `legacy-model-ui`；ModelPicker/ProviderConfig 测试 |

## 4. 创作工作台与小说资源

| 功能 | 用户入口 | API / 组件入口 | 数据来源 | 持久化状态 | 当前状态 | 已知限制 | 验证文件或口径 |
|---|---|---|---|---|---|---|---|
| 作品创建基础配置 | Dashboard 创建作品 | `book-create.ts`、Dashboard 创建表单 | 作品创建 payload 与项目初始化记录 | 真实持久化路径由书籍创建流程负责 | 真实可用 | 当前文档仅确认标准化和等待可读逻辑；完整创建 E2E 归入新 spec 后续任务 | `book-create.test.ts` |
| 章节资源树 | Workspace 左侧“小说资源管理器” | `WorkspacePage`、`resource-adapter.ts` | `/books`、`/books/:id`、候选稿 API | 从真实书籍/章节/候选稿数据派生 | 真实可用 | 目前覆盖作品、卷、已有章节、生成候选稿、大纲/经纬分类入口、story/truth 文件入口 | `WorkspacePage.test.tsx` |
| 章节创建、打开、编辑、保存 | Workspace 顶部按钮与中央编辑器 | `WorkspacePage`、`ChapterEditor` / migrated chapter API | 章节创建与正文 API | 创建章节 Markdown 与章节索引；正文真实保存 | 真实可用 | 新建后刷新资源树并打开新章节；保存失败恢复已覆盖 | `WorkspacePage.test.tsx`；`server-integration.test.ts` |
| AI 候选稿查看与处理 | Workspace 资源树 → 生成章节候选 | Candidate editor/actions | 候选稿 API | 候选稿正文、缺失错误、状态更新与章节/草稿写入由 API 处理 | 真实可用 | 候选稿正文真实展示；合并/替换/另存/放弃后刷新候选资源树，缺正文显示透明错误 | `WorkspacePage.test.tsx`；`chapter-candidates.test.ts` |
| 章节 hooks 应用 | Workspace → 写作工具 / hooks action | `api/routes/writing-tools.ts` | `pending_hooks.md` | 写入 Story 文件并触发资源树刷新 | 真实可用 | hook 与经纬伏笔结构化追踪仍需后续做实 | `writing-tools.test.ts`；`WorkspacePage.test.tsx` |
| 大纲入口 | Workspace 资源树 | resource tree outline node | 当前书籍/资源树派生 | 当前仅入口/空态为主 | 透明过渡 | 还不能作为完整大纲 viewer/editor | 新 spec Phase 4 |
| 完整小说资源管理器 | Workspace 左侧资源区 | resource snapshot + editor/viewer registry | 章节、草稿、候选稿、经纬、story/truth、素材、发布报告 | 部分真实、部分透明 | 透明过渡 | 章节、候选稿、草稿、story/truth viewer 与 mutation 后刷新已接入；大纲、经纬编辑、素材/发布报告仍需做实 | 新 spec Phase 2+ |
| 新建章节 | Workspace 顶部按钮 | `POST /books/:id/chapters` + Workspace action | 章节存储与章节索引 | 创建章节 Markdown、更新索引并刷新资源树 | 真实可用 | 成功后自动选中新章节；失败显示真实错误且不创建前端假节点 | `novel-creation-workbench-complete-flow` Task 19-20 |
| 导出 | Workspace 顶部按钮 | 待新增 export route | 已保存章节数据 | 未接入 | 透明过渡 | 当前按钮 disabled；至少需支持 Markdown/TXT | `novel-creation-workbench-complete-flow` Task 37-38 |

## 5. 写作工具、写作模式与 AI 动作

| 功能 | 用户入口 | API / 组件入口 | 数据来源 | 持久化状态 | 当前状态 | 已知限制 | 验证文件或口径 |
|---|---|---|---|---|---|---|---|
| Writing tools：hooks | Workspace 右侧写作工具 | `api/routes/writing-tools.ts` | Runtime model pool 或 session LLM | hook apply 写入 `pending_hooks.md` | 真实可用 | 模型不可用时返回 AI gate，不假生成 | `writing-tools.test.ts` |
| Writing tools：节奏分析 | Workspace 右侧写作工具 | `/writing-tools/rhythm` | 章节正文 | 即时计算 | 真实可用 | 指标以当前章节文本为准 | `writing-tools.test.ts` |
| Writing tools：对话分析 | Workspace 右侧写作工具 | `/writing-tools/dialogue` | 章节正文 | 即时计算 | 真实可用 | 指标以当前章节文本为准 | `writing-tools.test.ts` |
| Writing tools：书籍健康 | Workspace / 健康面板 | `/writing-tools/health`、`BookHealthDashboard` | 章节数、字数、敏感词、矛盾登记等 | 从真实文件/记录计算 | 真实可用 | 连续性评分、hook 回收率、AI 味、节奏多样性等未接统计显示 `unknown`，不得固定满分 | ledger `writing-tools-health`；`writing-tools.test.ts` |
| Conflict map / character arcs / tone check | Workspace 写作工具 | `api/routes/writing-tools.ts` | story truth / 章节文本 | 即时计算或读取文件 | 真实可用 | 输出受现有 story truth 文件完整度限制 | `writing-tools.test.ts` |
| Writing modes route | Workspace 写作模式 | `api/routes/writing-modes.ts` | prompt 构建逻辑 | 不写入正文 | 透明过渡 | 当前主要是 `prompt-preview`；应用按钮在无安全写入目标时 disabled | ledger `writing-modes-apply`；`writing-modes.test.ts`；`WorkspacePage.test.tsx` |
| Writing modes apply | Workspace 写作模式应用按钮 | 待新增安全 apply route | 预览、候选稿、草稿、章节目标 | 未接入 | 透明过渡 | Inline write、dialogue、variants、outline branch 不得 noop；后续必须走预览→确认→写入 candidate/draft/chapter | 新 spec Task 26-28 |
| Workspace AI actions | Workspace 右侧 AI/经纬面板 | action router / writing route | Runtime model pool + 章节上下文 | write-next 已走候选稿路径 | 透明过渡 | 除生成下一章外，续写、审校、改写、去 AI 味、连续性检查需要真实 route 或 unsupported | 新 spec Task 29-31 |
| Inline completion streaming | 编辑器/AI completion API | `api/routes/ai.ts` | 先取完整 LLM 结果再切片 SSE | 不代表上游原生流式 | 透明过渡 | payload 已标注 `streamSource: chunked-buffer`；不能称为原生 streaming | ledger `ai-complete-streaming` |

## 6. 轻量 Chat、Pipeline、Monitor 与 Admin

| 功能 | 用户入口 | API / 组件入口 | 数据来源 | 持久化状态 | 当前状态 | 已知限制 | 验证文件或口径 |
|---|---|---|---|---|---|---|---|
| 轻量 Book Chat | 书籍聊天面板 | `api/routes/chat.ts`、`ChatPanel` | 当前进程内存 Map | `process-memory`，不持久化 | 透明过渡 | 重启后历史不保证存在；UI/API 已标注当前进程临时历史 | ledger `book-chat-history`；`ChatPanel.test.tsx` |
| Pipeline runs | Pipeline API/页面 | `api/routes/pipeline.ts` | 当前进程内存 | `process-memory`，不持久化 | 透明过渡 | run/stage/list/SSE 仍是临时运行状态 | ledger `pipeline-runs` |
| Monitor status | Admin/Monitor | `api/routes/monitor.ts` | 未接 daemon/runtime 事实源 | 无持久化 | 透明过渡 | 无事实源时返回 `501 unsupported`，WS 发送 unsupported 后关闭 | ledger `monitor-status` |
| Agent config service | 设置/Agent 配置 | `agent-config-service.ts` | runtime JSON + 本机端口 listen 探测 | 配置与端口保留持久化 | 真实可用 | 资源使用未接真实 runtime 时返回 unknown | ledger `agent-config-service` |
| Admin users | Admin 用户管理 | `api/routes/admin.ts`、`UsersTab` | 本地单用户模式 | 无多用户 store | 透明过渡 | CRUD API 返回 `501 unsupported`；按钮 disabled 并说明本地单用户阶段 | ledger `admin-users` |
| Admin 容器、Worktree、Resources、Routines hooks、平台账号未来动作 | Admin / Settings / Routines | `UnsupportedCapability` 或等价透明占位 | 无真实后端事实源 | 无 | 透明过渡 | 未接入按钮 disabled；未来接真实运行时后再恢复交互 | ledger `transparent-admin-placeholders` |

## 7. 故事经纬、引导式生成、AI 味、合规与预设

| 功能 | 用户入口 | API / 组件入口 | 数据来源 | 持久化状态 | 当前状态 | 已知限制 | 验证文件或口径 |
|---|---|---|---|---|---|---|---|
| Workspace 经纬面板基础展示 | Workspace 右侧经纬 tab | `WorkspacePage`、Bible panel | 兼容层与经纬相关数据 | 当前视图层可切换 | 透明过渡 | 浏览器审计发现部分经纬请求存在 404；分类详情仍偏壳子，需要列表/编辑做实 | `WorkspacePage.test.tsx`；新 spec Task 32-33 |
| 故事经纬结构化 API | 经纬页面 / 新建书籍模板 / 后续工作台联动 | `api/routes/jingwei.ts` | `story_jingwei_section`、`story_jingwei_entry` | SQLite 持久化 | 真实可用 | API 与组件底座已落地；新工作台资源树深度编辑仍需接入 | `jingwei.test.ts`；`jingwei` core tests |
| 经纬模板应用 | 新建作品 / 模板应用入口 | `/api/books/:bookId/jingwei/templates/apply`、`applyJingweiTemplate` | 空白、基础、增强、题材推荐模板 | 写入经纬 section | 真实可用 | 题材推荐是可勾选候选项，不代表固定标准结构 | `server.test.ts`；`jingwei.test.ts` |
| 经纬上下文装配 | AI 写作上下文预览 / 后续生成上下文 | `/api/books/:bookId/jingwei/preview-context`、`buildJingweiContext` | 启用且参与 AI 的栏目与条目 | 即时装配，不自动改正文 | 真实可用 | 按 tracked/global/nested 和章节时间线裁剪；资料不完整会影响注入质量 | `jingwei.test.ts`；core context tests |
| 问卷中心 | 书籍资料页 / 问卷向导组件 | `/api/questionnaires`、`/api/books/:bookId/questionnaires/:templateId/responses`、`QuestionnaireWizard` | 内置问卷模板与回答 | 模板 seed + response 持久化 | 真实可用 | 当前需确认实际页面挂载；AI 建议必须经过模型 gate | `bible.test.ts`；`QuestionnaireWizard.test.tsx` |
| 生成前追问 | 生成章节前的引导问题 | `/api/books/:bookId/chapters/:chapter/pre-generation-questions`、`generatePGIQuestions` | escalating 矛盾、临近回收窗口伏笔等规则 | 返回问题；答案进入生成上下文/审计 metadata | 真实可用 | 规则当前只实现部分启发式；人设漂移、大纲偏离仍是 stub 边界；若 UI 未弹出则属于入口待接 | `bible-pgi.test.ts`；`bible.test.ts` |
| 核心设定变更历史 | 变更历史 / 复核流程 | `/api/books/:bookId/core-shifts`、`accept`、`reject` | premise、主线冲突、世界规则、人物弧等核心对象快照 | SQLite 持久化 | 真实可用 | propose 只记录影响；accept 才应用并标记受影响章节；不自动重写正文 | `bible-core-shift.test.ts`；`bible.test.ts` |
| AI 味过滤与报告 | AI 味报告 / 去 AI 味建议 | `/api/filter/*`、`components/filter/*` | 本地 12 规则、可选朱雀配置、章节报告 | `filter_report` 持久化 | 真实可用 | 朱雀未配置时本地规则仍可用；建议不自动覆盖正文 | `filter.test.ts`；filter component tests |
| 预设资产 | 预设管理 / 新建书籍预设绑定 | `/api/presets`、`/api/books/:id/presets` | genre、tone、beat、logic、AI 味、技法、bundle | 书籍预设可持久化 | 真实可用 | 不是模板市场终态；preset 只提供写作约束和推荐组合 | `presets.test.ts` |
| 合规 / 发布就绪 | 发布检查入口 / 合规组件 | `/api/books/:bookId/compliance/*`、`components/compliance/*` | 敏感词、AI 比例、格式规则、平台字典 | 即时扫描或导入词库 | 真实可用 / 待迁移 UI | 新工作台只提供入口或嵌入，不新建第二套合规页面 | `compliance.test.ts`；`.kiro/specs/README.md` platform-compliance 边界 |
| 导出 | Workspace 顶部 | 待新增 export route | 已保存章节数据 | 未接入 | 透明过渡 | 当前 disabled；至少需要全书 Markdown/TXT | 新 spec Task 37-38 |

## 8. 内部示例与低风险项

| 功能 | 用户入口 | API / 组件入口 | 数据来源 | 持久化状态 | 当前状态 | 已知限制 | 验证文件或口径 |
|---|---|---|---|---|---|---|---|
| ToolUsageExample | 无生产入口 | `components/ToolUsageExample.tsx` | `executeToolMock()` demo | 无 | 内部示例 | 仅展示 ToolUseCard/ToolResultCard/PermissionPrompt 交互；不得从生产组件 barrel 导出 | ledger `tool-usage-example` |
| Core 缺文件哨兵 | Core 内部 | `packages/core/src/**` | `(文件尚未创建)` 哨兵 | 非业务状态 | 真实可用 | 不是用户功能 mock；`noop-model` 仅能在 `requireApiKey=false` 非真实路径使用 | ledger `core-missing-file-sentinel`；core config-loader 测试 |
| CLI 生产源码 | CLI | `packages/cli/src/**` | CLI 生产源码 | 非 Studio UI 状态 | 真实可用 | 当前生产源码扫描无 mock 债务；测试目录 mock 不计入产品债务 | ledger `cli-production-source` |

## 9. 当前已知阻塞与后续主线

| 问题 | 当前事实 | 后续任务 |
|---|---|---|
| UI 看起来像同色 mock 壳 | 浏览器审计发现 Tailwind theme token 未生成，导致大量按钮样式高度相似 | `novel-creation-workbench-complete-flow` Phase 1 |
| 资源管理器不完整 | 已能查看章节、候选稿、草稿、story/truth 文件和注册 viewer；mutation 后刷新已统一，仍需做实大纲、经纬、素材、发布报告 | `novel-creation-workbench-complete-flow` Phase 2 |
| 新建章节、章节导入、候选稿、草稿与 hook mutation 已形成刷新闭环 | route 已能创建章节记录、导入章节文本并写入正文/索引；Workspace mutation 统一重新读取章节、候选、草稿、Story 文件资源，不再维护前端临时节点 | Task 26+ 写作模式应用 |
| 导出 disabled | 当前不是可用闭环 | Task 37-38 |
| 写作模式应用 disabled / prompt-preview | 当前不写入正式正文，且应保持透明 | Task 26-28 |
| 经纬面板 404 与分类壳子 | 结构化经纬 API 已可用，但 Workspace 分类视图仍未完整接入 | Task 32-33 |
| 引导式生成入口串联 | 问卷、生成前追问、核心变更和 AI 味报告已有底座，仍需确认当前主工作台是否完整串起 | `novel-creation-workbench-complete-flow` 后续流程任务 |
| Typecheck 阻塞已清理 | 旧 `routes`、`novelfork-context`、`use-tabs` 阻塞已通过旧前端退役清理，Studio typecheck 需先构建 core dist | 已在 `old-frontend-decommission` 完成 |

## 10. 完成口径

本文当前作为 `novel-creation-workbench-complete-flow` 的当前能力事实沉淀：

- 已把 runtime/provider/model/session、资源管理器、章节编辑、候选稿、writing tools、writing modes、故事经纬、引导式生成、AI 味、预设、合规、transparent placeholders、internal demo 统一归档。
- 已明确哪些能力真实可用，哪些只是透明过渡。
- 已同步小说创作流程、API 文档、测试报告、旧前端退役、新建章节、章节导入、草稿、候选稿与资源树刷新闭环的当前边界。
- 已保留已知缺口，避免把 spec 后续任务提前写成完成。

后续优先继续 Task 26-28，补齐 writing modes 安全应用 route 与 UI 流程。
