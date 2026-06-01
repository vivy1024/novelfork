# Provider Runtime Control Plane v1 - Requirements

## 背景与调研结论

本 spec 基于两类事实：

1. **NarraFork 7778 调研结论**：NarraFork 没有把 provider 当作简单的 API Key 表单，而是把 provider、模型、账号、默认模型、子代理模型、推理强度、上下文策略、错误重试、模型聚合统一视为 Agent 运行时资源调度系统。它这么做的原因是：上层 Agent 需要稳定、任务导向的模型能力；底层 provider 则是异构、不稳定、受账号/配额/协议/代理影响的资源。
2. **NovelFork 当前问题调研结论**：NovelFork 已有 provider 后端基础和部分设置页，但仍存在两个体验债：
   - 大量按钮因后端未接入而 disabled 或显示“后续接入”，用户感知为无法操作。
   - 多处前端直接显示英文技术字段、raw enum、组件名或配置路径，例如 `completions`、`openai-compatible`、`BibleCategoryView`、`OutlineEditor`、`agent.status`、`runtimeControls.defaultPermissionMode`、`Base URL`、`Max Tokens`。

本 spec 的目标不是照搬 NarraFork 的编程 Agent 设置，而是吸收其分层思想，并改造成适合 NovelFork 中文网文创作管线的 provider/runtime 控制平面。

## 当前事实依据

### 已有能力

- `packages/studio/src/api/routes/providers.ts` 已支持 provider 列表、状态、模型池、创建、更新、刷新模型、测试模型、模型 patch、启停、删除。
- `packages/studio/src/api/lib/provider-runtime-store.ts` 已有 `RuntimeProviderRecord`、`RuntimeModelRecord`、`RuntimePlatformAccountRecord` 等基础存储结构。
- `packages/studio/src/api/routes/platform-integrations.ts` 已支持平台集成目录、平台账号 JSON 导入、导入后激活平台模型。
- `packages/studio/src/app-next/settings/ProviderSettingsPage.tsx` 已把平台集成和 API key provider 分区展示。
- `packages/studio/src/app-next/settings/panels/RuntimeControlPanel.tsx` 已有默认模型、摘要模型、子代理模型池、推理强度、重试、上下文、调试开关等初版运行控制。

### 已确认缺口

- provider 页面仍以“接入管理”为中心，没有形成“模型库存 -> 虚拟模型 -> 写作任务绑定 -> 运行策略”的完整链路。
- 平台账号操作缺少真实后端 adapter：平台启停、切换账号、刷新配额、删除账号、账号管理仍是禁用或计划态。
- 模型设置仍沿用了编程 Agent 视角的 `默认会话模型`、`子代理模型池`，没有 NovelFork 专属的“大纲/正文/审稿/修订/连续性审计/风格仿写/去 AI 味/摘要”等任务模型绑定。
- 前端没有统一的字段呈现字典，raw enum、raw status、raw source、技术组件名容易漏到用户界面。
- disabled 按钮缺少统一的 UX 规则：有些按钮是合法的表单校验禁用，有些是后端未接入，有些是计划功能，用户无法区分。

## 产品原则

1. **Provider 是资源池，不是配置表**：provider 的职责是提供可调度资源，而不是只保存 API Key。
2. **模型是任务能力，不是 endpoint**：用户配置的是“正文模型”“审稿模型”“摘要模型”，系统负责映射到具体 provider/model。
3. **设置是调度策略，不是表单集合**：运行时必须能根据健康状态、配额、错误、上下文窗口、任务类型做选择。
4. **NovelFork 优先中文创作任务**：不得原样照搬 NarraFork 的 explore/plan/general 作为主模型心智；这些可作为内部 agent 类型，但 UI 主轴必须是小说创作环节。
5. **不制造假交互**：凡是显示为可点击的主操作，都必须有真实后端路径或明确的本地状态效果；不能用 noop、假 provider、假 adapter、假 routes 让按钮“看起来可用”。
6. **不保留可见未接实现**：本轮交付后，用户主界面不得存在“后续接入”“即将推出”“未接入真实后端”的可见入口；无法实现的能力必须从主 UI 和支持能力列表中移除，不得展示为按钮、开关或可选项。
7. **用户界面不暴露内部字段名**：除代码块、模型 ID、文件路径、API URL 等必要技术值外，用户可见标签、状态、策略来源、能力名必须使用中文业务语言。

## Requirements

### Requirement 1: 统一 Provider Runtime 分层模型

**User Story:** 作为创作者，我希望系统把供应商、模型、账号和运行策略分层管理，这样我不需要理解每个底层 API 的差异也能稳定使用 AI 写作能力。

#### Acceptance Criteria

1. WHEN 系统展示 provider 设置 THEN 它 SHALL 明确区分至少五层概念：物理供应商、物理模型、虚拟模型、写作任务模型绑定、运行策略。
2. WHEN 用户查看物理供应商 THEN 系统 SHALL 展示连接信息、协议/兼容性、启用状态、健康状态、模型数量和最近检测结果。
3. WHEN 用户查看物理模型 THEN 系统 SHALL 展示模型所属 provider、上下文窗口、最大输出、能力标签、刷新时间、测试状态、延迟、启用状态。
4. WHEN 用户查看虚拟模型 THEN 系统 SHALL 展示该虚拟模型聚合了哪些 provider/model、路由模式、优先级和 fallback 关系。
5. WHEN 用户查看写作任务模型绑定 THEN 系统 SHALL 使用“大纲、正文、审稿、修订、连续性审计、风格仿写、去 AI 味、摘要、世界观分析、人物分析”等 NovelFork 创作任务语言。
6. IF 某层数据为空 THEN 系统 SHALL 显示可操作的空态修复路径；不得显示“尚未接入”或无效空按钮。

### Requirement 2: Provider 高级配置与能力建模

**User Story:** 作为高级用户，我希望能为不同 provider 配置协议、传输、推理、代理和默认模型，这样系统可以正确调用不同类型的模型来源。

#### Acceptance Criteria

1. WHEN 创建或编辑 API key provider THEN 系统 SHALL 支持保存 `name`、`prefix`、`baseUrl`、API Key、兼容协议、API 模式、启用状态。
2. WHEN provider 支持高级字段 THEN 系统 SHALL 支持 defaultModel、reasoning strength、transport/websocket、proxy、TLS 校验开关、超时、重试建议、禁用原因等扩展字段。
3. WHEN provider 字段展示给用户 THEN 系统 SHALL 使用中文标签和帮助文案解释用途，不能只展示内部字段名。
4. WHEN API Key 已保存 THEN 系统 SHALL 只显示脱敏状态，例如“已配置，留空不变”，不得回传或渲染明文密钥。
5. WHEN provider 连接测试失败 THEN 系统 SHALL 记录失败类型、错误摘要、最近失败时间，并给出是否可重试/是否需重新配置的中文说明。
6. IF provider 类型当前没有真实 adapter THEN 系统 SHALL 不在可选 provider 类型中展示它；已存在的历史记录仅允许作为只读迁移警告显示，并提供删除或转换入口。

### Requirement 3: 模型库存与分组模型池

**User Story:** 作为创作者，我希望看到所有可用模型按供应商分组，并能理解每个模型适合做什么，这样我可以配置写作任务而不是猜模型 ID。

#### Acceptance Criteria

1. WHEN 模型刷新完成 THEN 系统 SHALL 将模型写入 provider 下的物理模型库存，并保留 source、lastRefreshedAt、lastTestStatus。
2. WHEN 展示模型库存 THEN 系统 SHALL 按 provider 分组展示，且每组显示 provider 健康状态和账号/配额摘要。
3. WHEN 模型能力可推断 THEN 系统 SHALL 展示能力标签，例如“大上下文”“长输出”“工具调用”“流式”“低成本”“审稿推荐”“正文推荐”。
4. WHEN 模型能力未知 THEN 系统 SHALL 显示“能力待确认”，并允许用户手动修正上下文窗口、最大输出和推荐用途。
5. WHEN 模型被禁用 THEN 系统 SHALL 将其从默认选择和自动路由候选中排除，但仍保留历史测试记录。
6. WHEN 模型 ID 是英文或技术 ID THEN 系统 SHALL 保留技术 ID，但同时提供中文显示名或用途说明。

### Requirement 4: 虚拟模型聚合

**User Story:** 作为创作者，我希望配置“强力正文模型”“便宜摘要模型”“审稿模型”等虚拟模型，而不是每次选择具体 provider 下的模型。

#### Acceptance Criteria

1. WHEN 用户创建虚拟模型 THEN 系统 SHALL 允许设置中文名称、用途说明、候选 provider/model 列表、优先级和启用状态。
2. WHEN 多个 provider 提供同一类能力 THEN 系统 SHALL 支持把它们聚合到同一个虚拟模型中。
3. WHEN 虚拟模型执行调用 THEN 系统 SHALL 根据 routingMode 在候选模型间选择，routingMode 至少包括 manual、priority、fallback。
4. WHEN 首选模型失败且 fallback 启用 THEN 系统 SHALL 尝试下一个候选，并记录 fallback 原因。
5. WHEN 虚拟模型无可用候选 THEN 系统 SHALL 在配置页和调用入口显示中文错误，提示用户补充候选或启用 provider。
6. WHEN 系统展示 routingMode 选项 THEN 所有可选策略 SHALL 有真实路由实现；未实现的策略不得出现在选择器中。

### Requirement 5: NovelFork 写作任务模型绑定

**User Story:** 作为网文作者，我希望为不同创作环节指定不同模型，这样系统可以在生成正文、审稿、修订和分析时自动使用合适的模型。

#### Acceptance Criteria

1. WHEN 用户打开模型设置 THEN 系统 SHALL 展示 NovelFork 专属任务模型绑定，而不是只展示编程 Agent 术语。
2. WHEN 配置任务模型 THEN 系统 SHALL 至少支持：大纲规划、正文生成、续写、连续性审计、人物一致性、世界观分析、风格仿写、去 AI 味、摘要入库、标题/简介生成。
3. WHEN 某任务没有单独配置模型 THEN 系统 SHALL 使用清晰的继承规则，例如“继承默认正文模型”或“继承默认分析模型”。
4. WHEN 某任务绑定的虚拟模型失效 THEN 系统 SHALL 显示失效原因，并提供跳转到虚拟模型/供应商修复入口。
5. WHEN 系统内部仍需要 explore/plan/general 子代理模型 THEN UI SHALL 将其归入“高级 Agent 模型”区域，不能作为 NovelFork 主心智。
6. WHEN 用户保存任务模型配置 THEN 系统 SHALL 校验所有引用的虚拟模型或物理模型存在且可用。

### Requirement 6: 运行策略与自愈能力

**User Story:** 作为长篇创作工作流用户，我希望模型调用失败时系统能自动重试、降级或给出明确原因，这样长任务不会因为一次 provider 抖动就中断。

#### Acceptance Criteria

1. WHEN provider 返回可恢复错误 THEN 系统 SHALL 按运行策略执行重试，并记录重试次数、退避时间和最终结果。
2. WHEN 错误命中自定义可重试规则 THEN 系统 SHALL 标记来源规则，并显示中文说明。
3. WHEN 上下文达到阈值 THEN 系统 SHALL 按配置执行裁剪或摘要压缩，并说明触发原因。
4. WHEN 输出疑似中断 THEN 系统 SHALL 根据策略判断是否自动续写或提示用户确认。
5. WHEN provider 配额不足或账号异常 THEN 系统 SHALL 将该来源临时降权或排除，并尝试 fallback 候选。
6. WHEN 系统展示运行策略配置 THEN 该策略 SHALL 已接入调用链或前端行为；未接入调用链的策略不得出现在主 UI。

### Requirement 7: 平台账号真实操作闭环

**User Story:** 作为使用平台账号的用户，我希望导入账号后能刷新配额、切换账号、停用账号和查看调用统计，这样平台账号不会只是静态表格。

#### Acceptance Criteria

1. WHEN 平台账号已导入 THEN 系统 SHALL 展示账号名称、email、accountId、认证方式、套餐、状态、优先级、成功/失败次数、配额、最后使用时间。
2. WHEN 平台支持刷新配额 THEN 系统 SHALL 提供真实“刷新配额”按钮，并调用对应 adapter 更新账号 quota。
3. WHEN 平台支持切换当前账号 THEN 系统 SHALL 提供真实“设为当前账号/自动轮换”操作，并保证同平台只有一个手动当前账号或明确使用自动模式。
4. WHEN 平台支持停用/删除账号 THEN 系统 SHALL 提供确认流程，并确保凭据从 runtime store 中移除或停用。
5. WHEN 系统展示平台账号操作 THEN 刷新配额、切换当前账号、停用/删除 SHALL 都有真实 store 更新和调用统计记录；无法真实执行的平台能力不得出现在 UI。
6. WHEN 平台账号进入 error/expired 状态 THEN 系统 SHALL 在模型路由中排除该账号，并在总览中提示修复。

### Requirement 8: 交互可用性治理

**User Story:** 作为用户，我希望页面上的按钮要么能操作，要么明确告诉我为什么不能操作，这样我不会反复点击无效入口。

#### Acceptance Criteria

1. WHEN 按钮因为表单校验、加载中或资源未选择而 disabled THEN 系统 SHALL 提供明确的 label、title 或旁路文案说明如何解锁。
2. WHEN 功能没有真实后端或本地状态实现 THEN 系统 SHALL 从主 UI 中移除该操作；不得以 disabled、UnsupportedCapability 或“后续接入”形式保留为用户可见入口。
3. WHEN 功能是未来规划 THEN 系统 SHALL 仅记录在 spec/tasks 或开发文档中，不得出现在当前交付的用户主界面。
4. WHEN 用户看到主操作按钮 THEN 该按钮 SHALL 有真实 onClick 效果，并能通过测试覆盖成功/失败路径。
5. WHEN 入口被禁用超过一个版本周期 THEN spec/task SHALL 要求二选一：接入真实实现，或从主操作区移到说明区。
6. WHEN 新增前端页面 THEN 测试 SHALL 覆盖“没有死按钮/无说明 disabled 主按钮”的交互审计。

### Requirement 9: 中文呈现与字段名治理

**User Story:** 作为中文网文工作台用户，我希望界面使用中文业务语言，而不是看到代码里的字段名、枚举值或组件名。

#### Acceptance Criteria

1. WHEN UI 展示 enum/status/source/policy/capability THEN 系统 SHALL 通过统一 label registry 翻译为中文说明。
2. WHEN UI 必须展示技术 ID、模型 ID、文件名、API URL 或配置路径 THEN 系统 SHALL 用辅助样式展示，并配中文上下文说明。
3. WHEN UI 展示 provider `apiMode`、`compatibility`、`lastTestStatus`、账号 `authMode/status`、工作流 `status/strategy` THEN 系统 SHALL 显示中文 label，而不是 raw value。
4. WHEN UI 展示内部组件名或 viewer/editor 名称 THEN 系统 SHALL 改为用户可理解的业务名称，例如“大纲编辑器”“经纬条目”“发布报告”。
5. WHEN 错误原因来自 runtime source，例如 `runtimeControls.defaultPermissionMode` THEN 系统 SHALL 展示中文来源说明，并可折叠显示技术路径用于调试。
6. WHEN 新增用户可见字符串 THEN 测试或静态审计 SHALL 覆盖常见 raw field 泄漏：camelCase、snake_case、`runtimeControls.*`、`*View`、`*Editor`、裸英文状态值。

### Requirement 10: Provider 总览与健康诊断

**User Story:** 作为维护者，我希望一眼看到所有供应来源是否健康、可用模型多少、默认路由是否正常，这样我能快速定位 AI 调用问题。

#### Acceptance Criteria

1. WHEN 打开 AI 供应商总览 THEN 系统 SHALL 显示 provider 数、启用 provider 数、可用物理模型数、虚拟模型数、异常来源数。
2. WHEN 某 provider 异常 THEN 系统 SHALL 展示最近错误、是否影响默认任务模型、建议修复动作。
3. WHEN 某写作任务没有可用模型 THEN 系统 SHALL 在总览中标红并提供跳转到任务模型绑定。
4. WHEN 模型池为空 THEN 系统 SHALL 提供最短修复路径：添加 provider、刷新模型、创建虚拟模型、绑定任务模型。
5. WHEN provider 配置变更 THEN 系统 SHALL 更新相关虚拟模型和任务绑定的校验状态。

### Requirement 11: 数据迁移与兼容

**User Story:** 作为已有用户，我希望升级后原来的 provider、模型和默认设置不会丢失，并且能逐步迁移到新的虚拟模型体系。

#### Acceptance Criteria

1. WHEN 用户已有 provider runtime state THEN 系统 SHALL 保留现有 provider、models、platformAccounts 数据。
2. WHEN 首次启用虚拟模型体系 THEN 系统 SHALL 从现有 enabled provider models 生成可编辑的默认虚拟模型草稿。
3. WHEN 原有 `modelDefaults.defaultSessionModel` 或 `summaryModel` 指向物理模型 THEN 系统 SHALL 自动映射到对应虚拟模型，或标记为需要用户确认。
4. WHEN 迁移无法自动完成 THEN 系统 SHALL 显示中文迁移提示，不得静默丢弃配置。
5. WHEN 旧字段仍被调用链读取 THEN 系统 SHALL 保持兼容读取，直到新调用链完全切换并有迁移测试覆盖。

### Requirement 12: 测试与验收

**User Story:** 作为开发者，我希望 provider runtime 控制平面有明确测试，避免再次出现“按钮看起来有但不可用”和“英文内部字段漏出”。

#### Acceptance Criteria

1. WHEN 实现 provider runtime 控制平面 THEN 单元测试 SHALL 覆盖 provider CRUD、模型刷新、模型测试、虚拟模型解析、任务绑定校验、fallback 路由选择。
2. WHEN 实现平台账号操作 THEN 测试 SHALL 覆盖导入、刷新配额、切换当前账号、停用/删除、异常账号排除。
3. WHEN 实现 UI 页面 THEN 测试 SHALL 覆盖无可用模型、provider 异常、虚拟模型无候选、任务绑定失效、保存失败等状态。
4. WHEN 新增用户可见状态/字段 THEN 测试 SHALL 验证中文 label 显示，并避免 raw enum/字段名出现在主 UI。
5. WHEN 当前交付扫描用户主界面 THEN 测试 SHALL 验证不存在“后续接入”“即将推出”“暂未接入”“UnsupportedCapability”作为可见主功能入口。
6. WHEN 声称完成本 spec THEN 必须运行 provider/settings 相关测试，并记录未覆盖项。

## 非目标

- 本 spec 不要求把所有编程 Agent 设置原样搬入 NovelFork 主 UI。
- 本 spec 不要求展示当前无法真实执行的外部平台能力；凡未实现的 OAuth/device-code 或平台专有能力必须从当前 UI 能力列表中移除。
- 本 spec 不允许为了让旧入口看起来可用而新增 fake provider、noop adapter、空 routes 或假成功状态。
- 本 spec 不处理小说内容生成质量本身，只处理模型资源、路由、运行策略和 UI 可用性。