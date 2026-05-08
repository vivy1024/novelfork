# Claude/Codex Novel Agent v1 Requirements

**版本**: v1.0.0  
**创建日期**: 2026-05-07  
**状态**: approved  
**文档类型**: Kiro requirements

---

## 1. 背景

NovelFork 当前已经积累了大量写作核心能力、Studio API、会话 runtime、资源合同、设置页、套路页、工具、经纬、候选稿和发布前验证资产。但近期复核 `.kiro/specs` 后确认：许多已勾选完成的任务实际是为了靠近功能所做的合同、重构、壳层、接线、退役和守卫，并不等同于用户可见端到端功能已经完成。

用户的最终目标不是普通小说 CRUD 工作台，也不是只参考 Claude Code CLI / Codex CLI 的页面壳。NovelFork 的关键目标是：

> NovelFork 必须对标 Claude Code CLI 与 Codex CLI 的 Agent 产品能力，并在此基础上提供小说创作端到端工作流。

因此，本 spec 作为纠偏主线，停止把 v0.1.0 发布准备作为当前唯一主线，重新收束为：

```text
NovelFork = ClaudeCodeCLI / CodexCLI 级 Agent Runtime + Studio/CLI/Headless 统一入口 + 小说创作领域工具包
```

本 spec 不推翻当前已经思考过的前端产品结构。NovelFork Studio 的叙事线、创作画布、叙述者、设置与套路控制台都是有效产品面。本 spec 的目标是把这些面接入真实 Agent runtime，使它们从页面壳变成完整可控的创作系统。

---

## 2. 范围

### 2.1 In Scope

- 对标 Claude Code CLI 的会话、命令、权限、工具、transcript、resume、fork、compact、headless 和 usage/result 能力。
- 对标 Codex CLI 的 exec、stream-json/JSONL event、approval、sandbox 语义、profile/config、MCP、review/image input 能力边界。
- 保留并强化当前 Studio 前端结构：叙事线 / 资源面、创作画布、叙述者、设置与套路控制台。
- 将设置页接入真实 Agent runtime 配置，作为模型、权限、工具策略、上下文、MCP、sandbox、subagent 和运行策略控制中心。
- 将套路页接入真实 Agent 能力包，作为 slash commands、tools、skills、hooks、subagents、MCP、prompt fragments、workflow recipes、novel templates 和写作流程配置台。
- 将小说创作能力作为第一等 slash commands、tools、agents 和 workflows 接入统一 runtime。
- 重新兑现 archive specs 中的核心端到端功能：建书、经纬、问卷、PGI、Guided Plan、写下一章、候选稿、确认入库、审校、去 AI 味、风格、健康、发布检查、继续下一章。
- 统一 Studio、CLI、headless 的 runtime 行为和验收标准。
- 建立以端到端创作流程为准的验收体系，不再以 API/组件/单测存在代替功能完成。

### 2.2 Out of Scope

- 不推翻当前叙事线 / 叙述者 / 创作画布 / 设置 / 套路页面结构。
- 不恢复旧三栏、旧 ChatWindow、windowStore 或退役的旧前端。
- 不照抄 NarraFork、LegnaCode、Claude Code CLI 或 Codex CLI 的视觉实现。
- 不要求 v1 一次性达到 Claude Code CLI / Codex CLI 的全部实现深度；但必须把差距列为真实 backlog，不得降级成“参考后已完成”。
- 不允许把未实现项写成 current，不允许 mock/fake/noop 假成功。
- 不允许 AI 直接覆盖正式正文；正式资源写入必须经过候选稿、草稿、确认门或 checkpoint 保护。

---

## 3. 产品原则

1. **Agent-first**：叙述者是主操作面，不是普通聊天框。
2. **Studio 是 runtime 可视化**：左侧叙事线/资源、中间画布、右侧叙述者、设置与套路控制台共同展示同一 runtime 的状态。
3. **CLI 与 Web 同源**：Studio、`novelfork chat`、`novelfork exec`、headless API 必须复用同一会话、工具、权限、模型和事件系统。
4. **设置与套路是控制面**：设置页控制 runtime 行为，套路页控制 Agent 能力包，二者不是静态展示页。
5. **小说能力是第一等工具包**：小说命令、工具、agents、workflows 使用同一套 command/tool/runtime 协议，不是页面按钮的旁路 API。
6. **端到端优先**：功能完成必须由真实用户路径证明，包括真实 Studio 路径、CLI/headless 路径、transcript、候选稿、确认和持久化结果。

---

## 4. 需求

### Requirement 1：NovelFork 必须具备 ClaudeCodeCLI 级会话基础能力

**User Story:** 作为高级作者，我希望 NovelFork 像 Claude Code CLI 一样拥有可恢复、可继续、可 fork、可 compact、可记录 transcript 的会话系统，这样长篇创作不会因为窗口、刷新或上下文过长而丢失。

#### Acceptance Criteria

1. WHEN 用户在 Studio、CLI 或 headless 中创建会话 THEN 系统 SHALL 创建同一套持久化 session record 和 message transcript。
2. WHEN 用户执行 continue/resume THEN 系统 SHALL 能恢复最近会话或指定会话，包括消息、工具调用、确认门、checkpoint 和 recovery 状态。
3. WHEN 用户 fork 会话 THEN 系统 SHALL 创建新 sessionId，继承必要配置、绑定、上下文摘要和来源说明，不复用源 sessionId。
4. WHEN 用户 compact 会话 THEN 系统 SHALL 生成可审计 compact summary、保留 recent messages，并在后续 turn 中实际使用。
5. WHEN 会话生成 usage/result THEN 系统 SHALL 记录当前 turn、累计 usage、duration、stop reason、permission denials、unknown cost，不虚构成本。
6. WHEN 会话失败 THEN 系统 SHALL 记录结构化 failure，并在 Studio/CLI/headless 中提供一致恢复说明。

### Requirement 2：NovelFork 必须具备 ClaudeCodeCLI 级命令与权限能力

**User Story:** 作为用户，我希望能通过 slash commands、权限模式和工具 allow/deny/ask 策略直接控制 Agent 行为，而不是只能依赖隐藏按钮和后端默认值。

#### Acceptance Criteria

1. WHEN 用户在叙述者输入 `/` THEN 系统 SHALL 显示真实 command registry 中的可用命令，而不是硬编码演示项。
2. WHEN 用户执行 `/help`、`/status`、`/model`、`/permission`、`/tools`、`/mcp`、`/agents`、`/compact`、`/resume`、`/fork` THEN 系统 SHALL 执行真实 runtime 行为或显示明确 unsupported/planned 原因。
3. WHEN 用户配置 permission mode THEN 系统 SHALL 影响模型可见工具、工具执行器、确认门和 UI 控件状态。
4. WHEN 用户配置 allowed/disallowed tools 或 allow/deny/ask 策略 THEN 系统 SHALL 同步影响 Studio、CLI 和 headless 工具 schema 与执行结果。
5. WHEN 工具需要确认 THEN 系统 SHALL 显示目标、风险、来源、diff/checkpoint、approve/reject，并把决策写入 transcript。
6. WHEN 命令或权限能力仅为 planned/reference-only THEN 系统 SHALL 不允许执行，并解释缺口。

### Requirement 3：NovelFork 必须具备 CodexCLI 级 headless / exec / stream-json 能力

**User Story:** 作为自动化用户，我希望能像 Codex CLI 一样用非交互命令执行写作、审校、检查和批处理任务，并获得结构化事件流。

#### Acceptance Criteria

1. WHEN 用户运行 `novelfork -p <prompt>` 或等价入口 THEN 系统 SHALL 执行一次非交互 Agent turn，并输出最终结果或结构化错误。
2. WHEN 用户运行 `novelfork exec <task>` THEN 系统 SHALL 复用同一 AgentTurnRuntime、工具、权限、模型、会话和候选稿边界。
3. WHEN 用户使用 `--output-format stream-json` THEN 系统 SHALL 输出稳定 JSONL/NDJSON event，包括 user_message、assistant_delta、assistant_message、tool_use、tool_result、permission_request、checkpoint、error、result。
4. WHEN 非交互执行遇到确认门 THEN 系统 SHALL 停止并返回 pending/exit code 2，不自动批准。
5. WHEN 用户传入 `--book`、`--session`、`--model`、`--permission-mode`、`--cwd/root` THEN 系统 SHALL 与 Studio 使用同一配置和会话事实。
6. WHEN Codex sandbox、review、image input、MCP server 能力未实现 THEN 系统 SHALL 明确标记 planned/reference-only，不宣传为 current。

### Requirement 4：设置页必须成为真实 Agent Runtime Control Center

**User Story:** 作为用户，我希望设置页能真实控制模型、权限、工具、MCP、sandbox、上下文和子代理，这样我可以完全掌控 Agent 行为。

#### Acceptance Criteria

1. WHEN 用户配置 provider/model/default model THEN 系统 SHALL 保存到真实 runtime store，并影响新建 Studio session、CLI 和 headless。
2. WHEN 用户配置默认权限模式、上下文预算、max turns、tool policy、allow/blocklist THEN 系统 SHALL 回读真实 settings，并影响后续工具调用。
3. WHEN 用户配置 subagent 模型和工具权限 THEN 系统 SHALL 影响 Planner/Writer/Auditor/Explorer 等子代理执行。
4. WHEN 用户配置 MCP server THEN 系统 SHALL 更新真实 MCP registry、工具列表和权限策略。
5. WHEN 用户配置 sandbox/approval 相关项 THEN 系统 SHALL 明确哪些是 current、partial、planned、reference-only，并阻止未实现项伪执行。
6. WHEN 设置保存失败 THEN 系统 SHALL 保留用户输入并展示真实错误；不得写入半成功状态。
7. WHEN 设置保存成功 THEN 系统 SHALL 从 API 回读最终状态，并让现有 session 或新 session 可见该变化。

### Requirement 5：套路页必须成为真实 Agent Capability Workbench

**User Story:** 作为高级用户，我希望套路页集中管理命令、工具、技能、子代理、MCP、hooks 和小说工作流，这样我能便捷地配置完整 Agent 能力。

#### Acceptance Criteria

1. WHEN 用户打开套路页 THEN 系统 SHALL 展示真实 slash commands、tools、skills、hooks、subagents、MCP servers、prompt fragments、workflow recipes 和 novel templates。
2. WHEN 用户启用/禁用 command 或 tool THEN 系统 SHALL 影响叙述者、CLI 和 headless 的可用能力。
3. WHEN 用户配置 `/novel:write-next` 工作流 THEN 系统 SHALL 能指定 Writer/Planner/Auditor、PGI、Guided Plan、candidate tools、确认门和入库策略。
4. WHEN 用户配置 tool 权限 THEN 系统 SHALL 与设置页 tool policy 合并并在执行时生效。
5. WHEN 用户配置 hook THEN 系统 SHALL 在对应生命周期执行或明确 planned/unsupported。
6. WHEN 用户配置 MCP server 或 skill THEN 系统 SHALL 真实更新 runtime registry，错误可见且可恢复。
7. WHEN 套路项只是文档参考或 planned THEN 系统 SHALL 不允许作为 current 执行。

### Requirement 6：叙述者必须成为小说 Agent 主操作面

**User Story:** 作为作者，我希望在叙述者里直接用自然语言或 `/novel:*` 命令驱动创作，而不是在多个页面之间手工拼接流程。

#### Acceptance Criteria

1. WHEN 用户在叙述者输入自然语言写作任务 THEN 系统 SHALL 将其转换为可审计 Agent plan 或直接执行的 tool workflow。
2. WHEN 用户输入 `/novel:init` THEN 系统 SHALL 创建或初始化小说项目、经纬、基础文件和默认叙述者会话。
3. WHEN 用户输入 `/novel:outline` THEN 系统 SHALL 读取经纬、叙事线和当前大纲，生成候选大纲或分支，不覆盖正式大纲。
4. WHEN 用户输入 `/novel:write-next` THEN 系统 SHALL 执行 cockpit/context → PGI → Guided Plan → approve → candidate.create_chapter 的可视工具链。
5. WHEN 用户输入 `/novel:audit`、`/novel:revise`、`/novel:de-ai`、`/novel:style-transfer`、`/novel:publish-check` THEN 系统 SHALL 调用真实小说工具或显示明确缺口。
6. WHEN 工具链完成 THEN 系统 SHALL 在叙述者消息流、创作画布、资源树和 transcript 中展示同一结果。

### Requirement 7：叙事线必须成为 Agent 的剧情上下文面

**User Story:** 作为长篇作者，我希望叙事线不仅是展示图，而是 Agent 理解剧情、伏笔、矛盾、角色弧线和下一章方向的核心上下文。

#### Acceptance Criteria

1. WHEN Agent 执行写作任务 THEN 系统 SHALL 读取当前叙事线、故事经纬、章节摘要、伏笔、矛盾、角色弧线和当前状态。
2. WHEN Agent 发现叙事线缺失或不一致 THEN 系统 SHALL 以问题、warning、PGI 或 Guided Plan 的形式反馈给用户。
3. WHEN 新章节候选稿生成 THEN 系统 SHALL 标注它预计推进的叙事线节点、伏笔、矛盾和角色弧线。
4. WHEN 用户确认章节入库 THEN 系统 SHALL 更新章节摘要、当前状态、候选伏笔、叙事线草案或要求用户确认变更。
5. WHEN 叙事线变更会影响已有章节 THEN 系统 SHALL 通过 CoreShift/checkpoint/review 提示风险。

### Requirement 8：故事经纬必须成为动态创作认知层

**User Story:** 作为作者，我希望故事经纬能通过问卷、条目、栏目、CoreShift 和 PGI 支撑长期创作，而不是固定 CRUD 表。

#### Acceptance Criteria

1. WHEN 用户创建作品 THEN 系统 SHALL 支持本地建书，并提供可跳过的 Tier 1 问卷引导。
2. WHEN 用户填写问卷 THEN 系统 SHALL 将答案事务性写入 Premise、Conflict、WorldModel、CharacterArc 或自定义经纬栏目，并保留原始回答。
3. WHEN 用户管理经纬 THEN 系统 SHALL 支持栏目、条目、字段、可见性、排序、启用/禁用和 AI 上下文预览。
4. WHEN 用户修改核心设定 THEN 系统 SHALL 生成 CoreShift 提案、diff、影响分析、accept/reject，不直接静默改历史事实。
5. WHEN 用户写新章前存在不确定点 THEN 系统 SHALL 通过 PGI 生成 2-5 个精准问题，答案注入写作 prompt 和 transcript。
6. WHEN 经纬能力只存在底层 API 而未接入当前主流程 THEN 系统 SHALL 标记为未兑现，不得写成完整功能完成。

### Requirement 9：创作画布必须承载章节、候选稿、计划、diff 和工具结果

**User Story:** 作为作者，我希望中间画布能承载实际写作产物和工具结果，让我能编辑、比较、确认和回滚，而不是只看资源摘要。

#### Acceptance Criteria

1. WHEN 用户打开章节 THEN 系统 SHALL 显示可编辑正文、保存状态、dirty guard、真实路径和读写能力。
2. WHEN Agent 生成候选稿 THEN 系统 SHALL 在画布打开候选稿，展示来源模型、工具链、PGI/plan metadata 和安全边界。
3. WHEN 用户处理候选稿 THEN 系统 SHALL 支持合并、替换、另存草稿、放弃，并在正式写入前创建 checkpoint 或确认门。
4. WHEN Agent 生成 Guided Plan THEN 系统 SHALL 在画布展示目标、上下文来源、关键判断、风险、确认项和批准/拒绝入口。
5. WHEN 用户查看 rewind/checkpoint THEN 系统 SHALL 在画布展示 diff、hash、风险、受影响资源和恢复结果。
6. WHEN 工具结果是分析或报告 THEN 系统 SHALL 在画布提供可读视图，并支持跳转相关资源。

### Requirement 10：写作模式与写作工具必须回到当前工作台主流程

**User Story:** 作为作者，我希望选段续写、扩写、补写、对话生成、多版本对比、节奏、POV、健康、矛盾和角色弧线这些能力能在当前写作上下文中使用。

#### Acceptance Criteria

1. WHEN 用户在章节编辑器选中文本 THEN 系统 SHALL 提供续写、扩写、多版本、对话生成或补写入口。
2. WHEN 写作模式生成结果 THEN 系统 SHALL 展示预览、差异、接受、编辑后接受、丢弃和写入边界。
3. WHEN 用户打开健康/工具视图 THEN 系统 SHALL 展示真实 POV、日更、节奏、对话、AI 味、敏感词、伏笔、矛盾、角色弧线和文风偏离数据。
4. WHEN 工具缺少数据 THEN 系统 SHALL 说明缺失事实源，而不是返回假分数。
5. WHEN 用户选择章节钩子或工具建议 THEN 系统 SHALL 能更新候选稿、草稿、pending hooks 或经纬，且正式写入受确认门保护。
6. WHEN 这些能力仅存在 core/API/component 但没有当前工作台入口 THEN 系统 SHALL 视为未完成当前产品功能。

### Requirement 11：Agent 写作管线必须成为可见的多 Agent 执行链

**User Story:** 作为作者，我希望看到 Explorer、Planner、Writer、Auditor 等子代理如何协作，而不是只得到一个最终文本。

#### Acceptance Criteria

1. WHEN 用户执行复杂写作任务 THEN 系统 SHALL 展示各子代理步骤、输入上下文、工具调用、产出和失败状态。
2. WHEN Planner 生成计划 THEN 系统 SHALL 等待用户确认或允许用户修改。
3. WHEN Writer 生成正文 THEN 系统 SHALL 默认写入候选稿，不直接覆盖正式章节。
4. WHEN Auditor 审校 THEN 系统 SHALL 生成可读审计报告，并可转为修订任务。
5. WHEN 用户在设置/套路页调整子代理模型或工具权限 THEN 系统 SHALL 改变下一次执行链。
6. WHEN 子代理能力缺失 THEN 系统 SHALL 明确失败阶段和恢复路径。

### Requirement 12：MCP、skills、hooks、subagents 必须进入统一 runtime 治理

**User Story:** 作为高级用户，我希望 MCP、skills、hooks 和 subagents 不只是配置清单，而是实际参与 Agent 能力扩展和权限治理。

#### Acceptance Criteria

1. WHEN 用户添加 MCP server THEN 系统 SHALL 真实连接、列出工具、展示状态、允许配置权限，并在 Agent tool loop 中可调用。
2. WHEN 用户添加 skill 或 prompt fragment THEN 系统 SHALL 能被 command/workflow 引用，并记录来源。
3. WHEN 用户配置 hook THEN 系统 SHALL 在对应生命周期触发，失败可见且不会静默破坏正文。
4. WHEN 用户配置 subagent THEN 系统 SHALL 指定 system prompt、模型、工具权限和上下文范围。
5. WHEN MCP/skill/hook/subagent 调用产生结果 THEN 系统 SHALL 写入 transcript 和必要 audit。
6. WHEN 某扩展能力未实现 THEN 系统 SHALL 显示 planned/unsupported，不允许“启用”后没有效果。

### Requirement 13：正式验收必须以端到端用户路径为准

**User Story:** 作为维护者，我希望重新验收所有原始功能设计，确保不会再把重构、合同、组件或单测当成功能完成。

#### Acceptance Criteria

1. WHEN 声明功能完成 THEN 系统 SHALL 提供 Studio 或 CLI/headless 的端到端证据。
2. WHEN 证据来自 API/组件/unit test THEN 系统 SHALL 只能证明底座完成，不能单独证明用户功能完成。
3. WHEN archive spec 中的功能在当前主路径不可用 THEN 系统 SHALL 在新矩阵中标记为 not-wired、partial、planned 或 unsupported。
4. WHEN 功能涉及小说正文写入 THEN 系统 SHALL 证明候选稿/草稿/确认/checkpoint 边界有效。
5. WHEN 功能涉及 Claude/Codex 对标 THEN 系统 SHALL 对照真实源码/官方行为/可运行 CLI，不得用 partial matrix 冒充完成。
6. WHEN 最终验收输出 THEN 系统 SHALL 列出已兑现端到端能力、底层资产但未产品化能力、明确不做能力和下一阶段 backlog。

---

## 5. 成功标准

本 spec 完成时，NovelFork 应至少能真实完成以下主路径：

1. 用户通过 Studio 创建作品，填写或跳过问卷，进入当前前端结构。
2. 用户在叙述者执行 `/novel:write-next`。
3. Runtime 读取叙事线、经纬、章节、当前状态和设置/套路策略。
4. Runtime 生成 PGI 和 Guided Plan，等待用户批准。
5. 批准后 Writer/Agent 工具链生成候选稿。
6. 画布打开候选稿，资源树刷新，transcript 记录工具链。
7. 用户确认合并/替换/另存，正式写入前有 checkpoint 或确认门。
8. 入库后章节摘要、当前状态、叙事线草案或经纬变更得到更新或等待确认。
9. 同一流程可通过 `novelfork exec --output-format stream-json --book <book>` 以 headless 方式执行，遇确认门停止。
10. 设置页和套路页的模型、权限、工具、MCP、subagent、workflow 配置能真实影响上述流程。

---

## 6. 风险

- 范围大，必须分阶段执行，不能一次性重写所有前端和 runtime。
- Claude/Codex 对标容易再次变成文档矩阵，必须绑定真实运行路径。
- 当前许多 archive tasks 已勾选完成，重新验收可能暴露大量“底座完成但产品未完成”的缺口。
- 设置与套路页接实后会影响 runtime 全局行为，需要防止配置误伤现有会话。
- MCP、sandbox、approval、headless、小说写作工具链都有安全边界，必须保持非破坏性写入纪律。

---

## 7. 与现有 specs 的关系

- `v0-1-0-release-readiness`：发布继续暂停；其 Task21-23 不再作为当前唯一优先级，必须等待本 spec 重新定义 v0.1.0 完成标准后再决定是否恢复。
- `conversation-parity-v1`：作为已完成的局部资产复用，但不再代表 ClaudeCodeCLI 完整对标。
- `web-agent-runtime-v1`：作为 runtime 基础资产复用，但需要扩展到 Claude/Codex-class 产品级验收。
- `agent-native-workspace-v1`：作为当前叙事线/画布/叙述者结构的基础资产复用，不推翻。
- `novel-creation-workbench-complete-flow`、`novel-bible-v1`、`writing-modes-v1`、`writing-tools-v1`、`agent-writing-pipeline-v1`、`longform-cockpit-v1`：作为原始功能承诺重新纳入端到端验收，不再只按 archive checkbox 视为完成。
