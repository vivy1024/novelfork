# Studio能力矩阵 v2.1

**版本**: v2.1.0
**创建日期**: 2026-04-28
**更新日期**: 2026-05-06
**状态**: ✅ 当前有效
**文档类型**: current

---

## 1. 文档目的

本文记录 NovelFork Studio 全部已交付能力的事实状态。覆盖已归档 spec、`agent-native-workspace-v1` 已完成任务与 `web-agent-runtime-v1` 已完成任务；当前主产品口径是 session-first 的 Agent-native 创作工作台 + Web Agent Runtime。

状态口径：
- **真实可用**：有真实 API、持久化或真实 runtime 调用，失败时返回真实错误。
- **透明过渡**：功能可用但仍是临时态、`process-memory`、`prompt-preview` 等，UI/API 明确标注。
- **需浏览器验活**：已有合同/组件回归，但尚未完成真实浏览器端到端路径，不能写成最终 UI 可用。
- **未接入**：标记为不支持，不伪造成功。

---

## 2. 事实来源

| 来源 | 任务数 | 状态 |
|------|--------|------|
| `novel-creation-workbench-complete-flow` | 53/53 | ✅ |
| `project-wide-real-runtime-cleanup` | 30/30 | ✅ |
| `writing-tools-v1` | 25/25 | ✅ |
| `ui-quality-cleanup` | 25/25 | ✅ |
| `novel-bible-v1` | 21/21 | ✅ |
| `onboarding-and-story-jingwei` | 18/20 | ⚠️ 缺回归测试 |
| `writing-modes-v1` | 17/17 | ✅ |
| `writing-presets-v1` | 16/16 | ✅ |
| `workspace-gap-closure-v1` | 25/25 | ✅ |
| `agent-writing-pipeline-v1` | 15/15 | ✅ |
| `longform-cockpit-v1` | 15/15 | ✅ |
| `narrafork-platform-upgrade` | 15/15 | ✅ |
| `studio-frontend-rewrite` | 14/14 | ✅ |
| `platform-compliance-v1` | 13/13 | ✅ |
| `novelfork-narrafork-closure` | 9/9 | ✅ |
| `ai-taste-filter-v1` | 7/7 | ✅ |
| `storage-migration` | 7/7 | ✅ |
| `old-frontend-decommission` | 5/9 | ⚠️ 旧代码未完全删除 |
| `web-agent-runtime-v1` | 16/16 | ✅ |
| **总计** | **~309** | — |

---

## 3. AI 写作能力

| 能力 | 状态 | 说明 |
|------|------|------|
| **续写/扩写/补写** | 真实可用 | LLM 真实生成，选中文本后触发 |
| **对话生成** | 真实可用 | 多角色、指定场景和目的 |
| **多版本对比** | 真实可用 | 2-5 个版本并排 |
| **大纲分支** | 真实可用 | 2-3 条走向建议 |
| **整章生成（write-next）** | 真实可用 | 右侧叙述者按 cockpit → PGI → guided plan → approve → candidate 工具链生成候选稿 |
| **审校当前章** | 真实可用 | 连续性、人设、文笔审查 |
| **去 AI 味检测** | 真实可用 | 12 特征规则 + 7 招消味建议 |
| **连续性检查** | 真实可用 | 人物/设定/伏笔冲突检测 |
| **章节钩子生成** | 真实可用 | 3-5 个备选方案 |
| **AI 味过滤** | 真实可用 | 本地 12 规则 + 可选朱雀 API |
| **文风仿写** | 真实可用 | 从参考文本导入 + style guide 注入 |
| **生成前追问（PGI）** | 真实可用 | 基于矛盾/伏笔/角色状态 |
| **核心设定变更（CoreShift）** | 真实可用 | 审计链：propose → accept/reject |
| **非破坏性写入** | 强制 | AI 结果只进候选区，确认后才影响正文 |

## 4. 章节与作品管理

| 能力 | 状态 |
|------|------|
| 创建/打开/切换作品 | ✅ |
| 创建/编辑/保存章节 | ✅ |
| 删除章节 | ✅ |
| 删除草稿/候选稿 | ✅ |
| 导入章节文本 | ✅ |
| AI 候选稿（查看/合并/替换/另存草稿/放弃） | ✅ |
| 草稿箱管理 | ✅ |
| 大纲编辑器（volume_outline.md） | ✅ |
| 导出 Markdown/TXT | ✅ |
| 删除整书 | ✅ |

## 5. 资源管理器

| 功能 | 状态 |
|------|------|
| 作品 → 已有章节 → 生成章节 → 草稿 → 大纲 | ✅ 中文标签 |
| 故事文件（pending_hooks/章节摘要等） | ✅ 18 个文件全部中文名 |
| 真相文件（book_rules/current_focus等） | ✅ 同上 |
| 经纬资料库（人物/事件/设定/摘要） | ✅ |
| 素材 / 发布报告 | ✅ |
| 章节编辑器（TipTap 富文本） | ✅ |
| Markdown/Text viewer | ✅ |
| Mutation 后资源树自动刷新 | ✅ |

## 6. 故事经纬（Bible/Jingwei）

| 能力 | 状态 |
|------|------|
| 人物 / 事件 / 设定 / 章节摘要 CRUD | ✅ SQLite 持久化 |
| 经纬模板应用（空白/基础/增强/题材推荐） | ✅ |
| 三种可见性规则（tracked/global/nested） | ✅ |
| 时间线纪律（visible_after_chapter） | ✅ |
| 双写作哲学模式（static/dynamic） | ✅ |
| 问答卷系统（模板 + AI 建议） | ✅ |
| 矛盾追踪（8 类矛盾 7 态状态链） | ✅ |
| 世界模型（5 维度） | ✅ |
| 核心设定变更协议 | ✅ |
| 经纬上下文装配（按 token 预算裁剪） | ✅ |

## 7. 写作工具

| 工具 | 状态 |
|------|------|
| 节奏分析（句长直方图） | ✅ |
| 对话占比分析 | ✅ |
| 钩子生成器 | ✅ |
| POV 视角管理 | ✅ |
| 日更进度追踪（streak/趋势） | ✅ |
| 全书健康仪表盘（6 指标） | ✅ |
| 冲突地图 | ✅ |
| 角色弧线追踪 | ✅ |
| 文风一致性检测 | ✅ |

## 8. Agent-native 工作台与工具化驾驶舱

| 能力 | 内容 | 状态 |
|-----|------|------|
| 左侧资源栏 | 全局导航 + 当前书籍资源树；章节、候选稿、草稿、经纬、Story/Truth、素材、发布报告 | ✅ |
| 中间画布 | 多资源 Tab、章节编辑、候选稿、经纬详情、工具产物、dirty 切换拦截；`ui-live-parity-hardening-v1` Task 2-4 已补资源详情 hydrate、保存控制器、dirty guard 与 Playwright 浏览器保存刷新读回 | ✅ 资源 hydrate/保存防覆盖/浏览器读回已验证；更广 E2E 仍随后续任务扩展 |
| 右侧叙述者会话 | 固定 Writer/Narrator 会话、模型/权限控件、工具调用流、恢复状态 | ✅ |
| cockpit 工具结果 | `cockpit.get_snapshot` / hooks / candidates 等通过工具卡片和画布组件展示 | ✅ |
| PGI + GuidedGenerationPlan | 生成前追问、计划卡片、批准/拒绝确认门 | ✅ |
| Narrative Line | 只读快照、mutation preview、approve 后写入审计 | ✅ |
| unsupported-tools 降级 | 模型或 provider 不支持工具循环时返回明确错误，降级只读解释 / prompt-preview | ✅ |
| OpenAI-compatible 工具名映射 | 内部点号 session tool 名映射为 provider-safe function name，并在返回 tool call 后还原内部工具名 | ✅ |

## 9. Agent 系统（新增）

| 能力 | 状态 |
|------|------|
| 5 种 Agent 角色（Writer/Planner/Auditor/Architect/Explorer） | ✅ |
| 每种 Agent 专属 system prompt（200+ 行领域知识） | ✅ |
| session-chat-service 自动注入 agent prompt | ✅ |
| Explorer Agent（只读探索，ConversationSurface 内联展示） | ✅ |
| 编排函数（Explorer→Planner→Writer→Auditor 串行） | ✅ |
| `/next/narrators/:sessionId` live 叙述者会话入口 | ✅ |
| 13 个 Core Agent 类 | ✅ |
| 18 个 Core 内置工具（plan/compose/write/audit/revise等） | ✅ |
| 22 个通用工具（ToolsTab，9 默认开/13 默认关） | ✅ |
| SubAgent 配置系统（systemPrompt + toolPermissions） | ✅ |

## 10. 设置与配置

| 功能 | 状态 |
|------|------|
| AI 供应商管理（API key 接入） | ✅ |
| 平台集成（Codex/Kiro JSON 账号导入） | ✅ |
| 模型池管理（刷新/测试/启用禁用） | ✅ |
| 真实 Provider/Model 管理（显式选择，无虚拟模型/自动 fallback） | ✅ |
| Runtime control panel（权限/上下文/工具策略） | ✅ Task 7：运行策略逐项经 `deriveAgentRuntimeSettingsFacts` 展示来源、状态、读写 API 与 planned 缺口 |
| 设置 Truth Model（来源/状态/API/未配置原因） | ✅ Task 6-7：模型页与 Agent runtime 可见 setting 通过 `SettingsFact` 展示真实来源、状态、读写 API；无 schema 来源项显示 planned/unsupported 或隐藏，空值显示“未配置” |
| 模型默认值/摘要模型/子代理配置 | ✅ 默认/摘要/Explore/Plan/General/Codex 推理强度均来自 user settings，不用模型池第一项冒充当前值；运行控制保存后回读 `/api/settings/user` |
| Agent runtime 来源事实 | ✅ 覆盖 default permission、max turns、retry/backoff、WebFetch proxy、上下文/大窗口阈值、debug、allowlist/blocklist、sendMode；first-token timeout 标记 planned |
| 设置分组 IA | ✅ 个人设置、实例管理、运行资源与审计、关于与项目；借鉴 NarraFork 分组但字段回到 NovelFork schema |
| 个人资料 | ✅ |
| 关于（版本/commit/Bun） | ✅ |
| 套路页（命令/工具/权限/技能/子代理/MCP/钩子） | ✅ |

## 11. 合规与发布

| 功能 | 状态 |
|------|------|
| 敏感词扫描（起点/晋江/番茄/七猫/通用） | ✅ |
| AI 比例估算 | ✅ |
| 发布就绪检查 | ✅ |
| AI 使用声明生成 | ✅ |
| 格式规范检查 | ✅ |

## 12. 写作预设

| 类别 | 数量 | 状态 |
|------|------|------|
| 流派配置（GenreProfile） | 6 个 | ✅ |
| 文风 tone | 5 类 | ✅ |
| 时代/社会基底（Setting Base） | 6 类 | ✅ |
| 逻辑风险自检（Logic Risk） | 8 类 | ✅ |
| 预设组合（Bundle） | 6 个 | ✅ |
| 叙事节拍模板 | 5 个 | ✅ |
| AI 味过滤预设 | 4 个 | ✅ |
| 文学技法预设 | 4 个 | ✅ |

## 13. Web Agent Runtime（新增）

| 能力 | 状态 | 说明 |
|------|------|------|
| **通用 Agent Turn Runtime** | 真实可用 | provider-agnostic 工具循环引擎，支持 message/tool_call/tool_result canonical items |
| **重复工具调用保护** | 真实可用 | 同一 turn 内相同 toolName+input 签名超阈值自动拦截 |
| **continuation 指令** | 真实可用 | 工具结果回灌时追加"总结已获信息、判断是否足够"指令 |
| **OpenAI-compatible 工具上下文** | 真实可用 | canonical items 转 assistant tool_calls + tool role message |
| **会话中心** | 真实可用 | 独立/书籍/章节绑定筛选、归档/恢复、模型/权限状态、继续最近会话、Fork 标题/继承说明 |
| **会话斜杠命令** | 真实可用 | Composer 输入 `/` 展示建议，`/help`、`/status`、`/model`、`/permission`、`/fork`、`/resume`、`/compact` 返回结构化命令结果；非法命令以 status 展示，不发送给模型 |
| **Session Compact** | 真实可用 | `/compact` 走 `POST /api/sessions/:id/compact` 与 session compact service，写入 `session-compact-summary`、保留 recent messages，并展示 compact summary/context budget |
| **Session Memory 边界** | 透明过渡 | `GET /api/sessions/:id/memory/status` 显示 writer 未接入时的只读状态；`POST /api/sessions/:id/memory` 通过 session memory boundary service 区分用户偏好、项目事实、临时剧情草稿，偏好/项目事实需要审计来源，临时剧情草稿不自动写长期 memory |
| **Session Tool Policy** | 真实可用 | `SessionConfig.toolPolicy` 支持 allow/deny/ask；工具执行合并 permissionMode、policy、resource risk 与 dirty canvasContext，返回 policy-denied / permission-required / policy-disabled |
| **Headless Chat stream-json API** | 真实可用 | `POST /api/sessions/headless-chat` 复用 AgentTurnRuntime/session tools，支持 text 与 stream-json input、NDJSON output、ephemeral/no-session-persistence、permission_request、max turns/budget stop result；result envelope 含 duration、stop_reason、usage、cost unknown 与 permission_denials |
| **高级工作台模式** | 真实可用 | workbenchMode=false 隐藏 Terminal/Browser/Bash/MCP/Admin 等高级工具 |
| **Headless Exec 服务** | 真实可用 | `POST /api/exec` 非交互执行，遇确认门停止返回 pending；保留兼容入口 |
| **资源 Checkpoint / Rewind** | 真实可用 | 正式章节、Truth/story 与 narrative apply 写入前保存 `.novelfork/checkpoints/<checkpointId>`，记录 session/message/toolUse、资源 path/hash/snapshotRef；`/rewind/preview` 返回 diff/hash/risk，`/rewind/apply` 必须经确认门并写入 safety checkpoint/audit；候选稿、草稿和提示词预览属于非正式资源边界 |
| **`novelfork chat` CLI** | 真实可用 | 通过 HTTP 调用 `/api/sessions/headless-chat`，支持 text/json/stream-json、`--session`、`--book`、`--model`、`--no-session-persistence`、max turns/budget 与 pending confirmation exit code=2 |
| **`novelfork exec` CLI** | 真实可用 | 保留旧 `/api/exec` 默认兼容；stream-json/ephemeral/max-turns/max-budget 模式复用 headless chat common parser 并支持真实 NDJSON 响应 |
| **真实 Provider/Model 选择** | 强制 | 无虚拟模型、无自动 fallback；未配置返回 model-unavailable |
| **Anthropic/Responses API adapter** | 未接入 | 预留转换接口，当前返回 unsupported |

## 14. 已知缺口

| 缺口 | 状态 |
|------|------|
| 章节拖拽排序/批量操作 | 未规划 |
| EPUB 导出 | 未规划 |
| 专注/全屏写作模式 | 未规划 |
| 世界设定关系图可视化 | 未规划 |
| 旧前端源码完全删除 | 5/9 完成 |
| 首次引导烟测 | 缺回归测试 |
| 引导式创作流程串联 | 已有 session-first 最小链路，完整体验仍需后续验活 |
| 能力矩阵文档 | ← 就是这一篇，刚更新 |
