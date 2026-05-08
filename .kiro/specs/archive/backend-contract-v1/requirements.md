# Backend Contract v1 Requirements

## Introduction

本 spec 先于新前端重写执行，用来冻结 NovelFork Studio MVP 后端能力合同矩阵。它不是新增 UI，也不是把未来能力写成已完成；它只把当前真实 route、WebSocket、session tools、数据持久化边界和 unsupported 状态整理成前端唯一可依赖的数据合同。

前端重构必须以本合同为入口：所有按钮、资源节点、工具卡片、状态栏和写作动作只能来自合同矩阵中声明为 `current`、`process-memory`、`prompt-preview`、`chunked-buffer` 或 `unsupported` 的能力。任何未列入合同的能力，在 UI 中必须显示 disabled/unsupported，不得伪造成功、mock 数据或 noop adapter。

---

## Requirement 1：合同来源与状态术语

**User Story：** 作为维护者，我需要一个可以反查真实代码的后端能力合同，避免新前端再次用想象中的 API 做界面。

### Acceptance Criteria

1. WHEN 合同矩阵列出能力 THEN THE SYSTEM SHALL 标明能力名、用户动作、真实入口、状态术语、数据来源、失败/降级边界和前端呈现规则。
2. WHEN 状态是 `current` THEN THE SYSTEM SHALL 能反查到真实 route、WebSocket 或 session tool 实现。
3. WHEN 状态是 `process-memory` THEN THE SYSTEM SHALL 明确说明重启后不保证保留。
4. WHEN 状态是 `prompt-preview` THEN THE SYSTEM SHALL 明确说明只可预览/复制，不代表生成或写入正文。
5. WHEN 状态是 `chunked-buffer` THEN THE SYSTEM SHALL 明确说明这是完整结果后的分块发送，不是上游原生流式。
6. WHEN 状态是 `unsupported` THEN THE SYSTEM SHALL 要求前端禁用入口或展示真实失败说明，不得触发假成功。
7. WHEN 合同引用外部项目模式 THEN THE SYSTEM SHALL 只引用公开文档/合法开源交互范式，不复制未授权源码。

---

## Requirement 2：应用启动与侧栏数据合同

**User Story：** 作为前端开发者，我需要稳定的数据源来渲染应用壳、叙事线列表、叙述者列表、模型状态和基础运行状态。

### Acceptance Criteria

1. WHEN 前端启动 THEN THE SYSTEM SHALL 通过合同定义的入口读取书籍列表、会话列表、provider/model 状态和项目配置。
2. WHEN 侧栏渲染叙事线 THEN THE SYSTEM SHALL 使用 `/api/books` 的真实书籍摘要，不使用静态 demo 书。
3. WHEN 侧栏渲染叙述者 THEN THE SYSTEM SHALL 使用 `/api/sessions?sort=recent&status=active` 的真实会话列表。
4. WHEN 模型状态显示 THEN THE SYSTEM SHALL 使用 `/api/providers/status`、`/api/providers/models` 或 `/api/providers/summary`，不展示虚拟模型 fallback。
5. WHEN 进度或健康摘要显示 THEN THE SYSTEM SHALL 只使用 `/api/progress`、`/api/books/:bookId/health` 等真实测量值；未知指标按后端 `MeasuredMetric | null` 或 `unknown` metric 透明映射为未知状态。
6. WHEN 某个启动数据源失败 THEN THE SYSTEM SHALL 将失败映射成可见错误或空状态，不静默填充假数据。

---

## Requirement 3：叙述者会话与 Agent Shell 合同

**User Story：** 作为作者，我希望新前端对话框保留现有 session/WebSocket/工具调用/确认门能力，而不是只做静态聊天 UI。

### Acceptance Criteria

1. WHEN 前端打开会话 THEN THE SYSTEM SHALL 通过 `GET /api/sessions/:id/chat/state` 或 WebSocket snapshot 获取 server-first 状态。
2. WHEN 前端连接实时对话 THEN THE SYSTEM SHALL 使用 `/api/sessions/:id/chat` WebSocket，并处理 `session:state`、`session:snapshot`、`session:message`、`session:stream`、`session:error` envelope。
3. WHEN 前端发送消息 THEN THE SYSTEM SHALL 使用 `session:message` client envelope，并可附带 `ack` 与 `canvasContext`。
4. WHEN 前端需要恢复断线 THEN THE SYSTEM SHALL 使用 `resumeFromSeq`、`session:ack` 和 `GET /api/sessions/:id/chat/history?sinceSeq=` 的 cursor 语义。
5. WHEN 用户中断生成 THEN THE SYSTEM SHALL 发送 `session:abort`，不伪造“已停止”。
6. WHEN 工具需要确认 THEN THE SYSTEM SHALL 使用 `GET /api/sessions/:id/tools` 读取 pending confirmations，并通过 `POST /api/sessions/:id/tools/:toolName/confirm` 提交批准/拒绝。
7. WHEN 工具结果有 renderer/artifact/confirmation metadata THEN THE SYSTEM SHALL 原样保留并交给工具结果渲染器，不把结构化结果降级成纯文本。

---

## Requirement 4：叙事线资源与写作工作台合同

**User Story：** 作为作者，我需要新前端资源树只展示后端真实存在的章节、候选稿、草稿、经纬、故事文件、真相文件和叙事线快照。

### Acceptance Criteria

1. WHEN 资源树加载书籍详情 THEN THE SYSTEM SHALL 使用 `/api/books/:id`、章节、候选稿、草稿和文件列表接口组装资源。
2. WHEN 用户打开章节 THEN THE SYSTEM SHALL 使用 `GET /api/books/:id/chapters/:num` 读取正文，并使用 `PUT /api/books/:id/chapters/:num` 保存。
3. WHEN 用户打开候选稿 THEN THE SYSTEM SHALL 使用 `/api/books/:id/candidates*`，并尊重 accept 的 `merge`、`replace`、`draft` 边界。
4. WHEN 用户打开草稿 THEN THE SYSTEM SHALL 使用 `/api/books/:id/drafts*` 资源 CRUD（含 `GET/POST/PUT/DELETE`）；不得把异步 `POST /api/books/:id/draft` 当作草稿 CRUD。
5. WHEN 用户打开 story/truth 文件 THEN THE SYSTEM SHALL 使用 `/api/books/:id/story-files*` 和 `/api/books/:id/truth*`，非法文件名显示真实错误。
6. WHEN 用户打开经纬资料 THEN THE SYSTEM SHALL 使用 `/api/books/:bookId/jingwei/*` 和问卷/core-shifts 接口，不假装旧 Bible 面板数据完整。
7. WHEN 用户打开叙事线图 THEN THE SYSTEM SHALL 使用 `GET /api/books/:bookId/narrative-line` 或 `narrative.read_line` session tool 的只读快照。
8. WHEN 资源不支持编辑 THEN THE SYSTEM SHALL 显示只读或 unsupported 状态，不提供假保存按钮。

---

## Requirement 5：AI 写作动作与候选区边界

**User Story：** 作为作者，我需要 AI 写作动作清楚地区分“启动异步任务”“生成候选稿”“写入草稿”“修改正式正文”和“只返回提示词预览”。

### Acceptance Criteria

1. WHEN 用户请求“写下一章” THEN THE SYSTEM SHALL 优先走 session-native 工具链：`cockpit.get_snapshot → pgi.generate_questions → guided.enter/guided.exit → candidate.create_chapter`。
2. WHEN `candidate.create_chapter` 成功 THEN THE SYSTEM SHALL 只生成候选稿 artifact，不覆盖正式章节。
3. WHEN 使用 `/api/books/:id/write-next` THEN THE SYSTEM SHALL 把它标记为异步启动接口，等待事件或后续资源刷新，不写成同步正文返回。
4. WHEN 使用 `/api/books/:id/draft` THEN THE SYSTEM SHALL 把它标记为 AI draft 异步动作，不等同于 `/drafts*` 草稿资源 CRUD。
5. WHEN 使用 writing modes 生成 THEN THE SYSTEM SHALL 明确 `mode: generated`、`prompt-preview` 或失败状态，并通过 `/api/books/:bookId/writing-modes/apply` 执行安全写入。
6. WHEN AI 模型不可用或不支持工具 THEN THE SYSTEM SHALL 显示 provider/tool unsupported 状态，不生成假 assistant 正文。
7. WHEN 写入正式正文需要确认 THEN THE SYSTEM SHALL 使用候选稿 accept、确认门或显式用户动作，不自动覆盖。

---

## Requirement 6：Provider、模型池与运行时能力合同

**User Story：** 作为用户，我需要看到真实 provider 和真实模型状态，而不是虚拟模型、隐藏 fallback 或无法执行的工具能力。

### Acceptance Criteria

1. WHEN 前端列出 provider THEN THE SYSTEM SHALL 使用 `/api/providers` 的脱敏结果，不回传明文 `apiKey`，并用 `apiKeyConfigured` 表示密钥是否配置；WHEN 前端列出平台集成账号 THEN THE SYSTEM SHALL 使用 `/api/platform-integrations` 的脱敏视图，不回传 `credentialJson`。
2. WHEN 前端列出可选模型 THEN THE SYSTEM SHALL 使用 `/api/providers/models` 的 runtime model pool，只显示 enabled provider/model/account 组合。
3. WHEN 前端刷新或测试模型 THEN THE SYSTEM SHALL 使用 `/api/providers/:id/models/refresh`、`/api/providers/:id/models/:modelId/test` 或 `/api/providers/:id/test`，并展示真实失败 envelope。
4. WHEN adapter 不支持某项能力 THEN THE SYSTEM SHALL 显示 `unsupported`/`auth-missing`/`config-missing`/`upstream-error` 等真实 code。
5. WHEN 模型不支持工具调用 THEN THE SYSTEM SHALL 降级到只读解释、prompt-preview 或引导用户切换模型，不假装工具已执行。

---

## Requirement 7：错误、降级与前端禁用规则

**User Story：** 作为维护者，我希望每个后端失败或未接能力都有明确 UI 规则，避免前端按钮看起来能用但实际没有真实能力。

### Acceptance Criteria

1. WHEN API 返回 4xx/5xx THEN THE SYSTEM SHALL 保留错误 code/message 或 envelope，不覆盖成“操作成功”。
2. WHEN 合同能力是 `unsupported` THEN THE SYSTEM SHALL 默认禁用交互按钮，并提供说明或替代路径。
3. WHEN 合同能力是 `process-memory` THEN THE SYSTEM SHALL 在恢复、历史和刷新处标明临时状态。
4. WHEN 合同能力是 `prompt-preview` THEN THE SYSTEM SHALL 只允许复制、转候选、转草稿或显式 apply，不直接写正式正文。
5. WHEN 后端返回 `null` 指标值或 `unknown` metric THEN THE SYSTEM SHALL 在 UI 中显示未知/待接入，而不是满分、0 或绿色成功。
6. WHEN 合同矩阵与真实 route 不一致 THEN THE SYSTEM SHALL 以真实代码为准并更新合同，不让前端继续依赖过期文档。

---

## Requirement 8：类型化前端适配器与验证

**User Story：** 作为开发者，我需要可测试、可复用的前端 API 适配层，所有新 UI 都通过它访问后端合同。

### Acceptance Criteria

1. WHEN 新前端访问 API THEN THE SYSTEM SHALL 通过集中 contract client / hook，而不是在组件内散写 fetch 字符串。
2. WHEN contract client 定义类型 THEN THE SYSTEM SHALL 复用 `shared/contracts.ts`、`shared/session-types.ts`、`shared/agent-native-workspace.ts` 或补齐共享类型。
3. WHEN 组件需要判断能力可用性 THEN THE SYSTEM SHALL 使用合同状态映射，而不是组件内硬编码猜测。
4. WHEN 合同新增能力 THEN THE SYSTEM SHALL 补充 route/contract 测试，至少覆盖成功、缺失资源、unsupported/失败 envelope。
5. WHEN 前端重构完成 THEN THE SYSTEM SHALL 能通过 typecheck、相关 Vitest 和合同矩阵自查。

---

## Non-goals

1. 本 spec 不重写前端界面；它只定义前端可依赖的后端能力合同。
2. 本 spec 不新增虚拟 provider、虚拟模型、mock 书籍、mock 会话或 noop adapter。
3. 本 spec 不把历史 legacy route 删除；legacy 只能标清状态与迁移方向。
4. 本 spec 不把 prompt-preview、process-memory 或 unsupported 描述成 current。
5. 本 spec 不复制 Claude Code 非公开源码；Codex/Claude 只作为合法公开交互范式参考，实际能力以 NovelFork 后端合同为准。
