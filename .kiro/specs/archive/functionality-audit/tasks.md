# NovelFork 功能真实性审计与补全 — 任务清单

> 生成日期：2026-05-09
> 基于：归档 spec 调研 + 实际截图验证 + 代码审计 + NarraFork 源码参考（.narrafork-reference/）
> 状态：待执行

---

## 一、对话界面问题

### 1.1 NarratorStatusBar 控件空壳（🔴 最紧急）

**参考**：`.narrafork-reference/UI-COMPONENTS.md` L72-148

NarraFork 的状态指示器行有真实可交互的控件，修改的是**当前叙述者**的 sessionConfig，不影响全局。

| 控件 | NarraFork 行为 | NovelFork 当前 | 修复 |
|------|---------------|---------------|------|
| 模型按钮 "D" | 弹出 Menu（搜索+分组）→ 选择后 PUT session | UI 完整但 `onUpdateModel` 未传递 | 接通回调 |
| 推理强度 "M" | **Codex 专属**：弹出 Menu → PUT session | UI 完整但回调未传递 | 接通回调 + 非 Codex 时隐藏 |
| Fast Mode ⚡ | **Codex 专属**：toggle service_tier → PUT session | UI 完整但回调未传递 | 接通回调 + 非 Codex 时隐藏 |
| 权限模式 🛡️ | 弹出 Menu（7 种模式）→ PUT session | UI 完整但 `onUpdatePermissionMode` 未传递 | 接通回调 |

**重要**：推理强度和 Fast Mode 是 Codex 请求格式特有的参数（`reasoning_effort` + `service_tier: priority`）。OpenAI Completions 模式和 Anthropic 模式没有这两个参数。NarratorStatusBar 应根据当前模型的提供商 API 模式决定是否显示这两个控件。

**根因**：`ConversationSurface.tsx:316` 只传了 `status`，没传任何回调 prop。

**修复路径**：
1. `ConversationSurface` 接收 `onUpdateModel`/`onUpdateReasoningEffort`/`onUpdatePermissionMode`/`onToggleFastMode` props 并传给 `NarratorStatusBar`
2. `ConversationRoute` 透传这些 props
3. `ConversationRouteLive` 实现回调：调用 `updateSessionConfig({ providerId, modelId })` / `updateSessionConfig({ reasoningEffort })` / `updateSessionConfig({ permissionMode })`

### 1.2 顶部工具栏按钮空壳

| 按钮 | 当前实现 | 应该做什么 |
|------|---------|-----------|
| 编辑标题 ✏️ | `prompt()` 弹窗 | inline 编辑（点击标题变为 Input） |
| 生成标题 ✨ | 写死日期字符串 | 调用后端 `generateSessionTitle()`（已有实现：`session-auto-title.ts:32-84`） |
| 文件修改 📄 | Sheet 硬编码"暂无" | 从 session messages 中提取 toolCalls 涉及的文件路径 |
| 会话信息 ℹ️ | 只显示基础字段 | 显示 compact 历史、token 用量、recovery 状态、worktree |
| 归档 📦 | 只改 status 不导航 | 确认对话框 + 归档后 `navigate({ to: "/next/sessions" })` |

### 1.3 Slash Command 审计结果

| 命令 | 真实性 | 问题 |
|------|--------|------|
| `/compact` | ✅ 真实 | 完整调用 `POST /api/sessions/:id/compact` |
| `/model provider:model` | ✅ 真实 | 返回 patch → `onUpdateSessionConfig` → PUT API |
| `/permission mode` | ✅ 真实 | 同上 |
| `/help` | ✅ 真实 | 返回帮助文本 |
| `/status` | ✅ 真实 | 返回会话状态 |
| `/fork` | ⚠️ 半成品 | 后端 API 完整，但前端不处理 `fork-session` 结果（不导航） |
| `/resume` | ⚠️ 半成品 | 同上 |
| `/tools` | ❌ 空壳 | status=planned，executor 返回"尚不可执行" |
| `/mcp` | ❌ 空壳 | 同上 |
| `/agents` | ❌ 空壳 | 同上 |
| `/novel:*` | ❌ 空壳 | 所有 novel 命令都是 planned |

### 1.4 套路配置→对话传递审计结果

| 功能 | 状态 | 说明 |
|------|------|------|
| routines.tools → session tools | ❌ 未连接 | `getEnabledSessionTools` 不读取 routines 配置 |
| routines.permissions → session policy | ❌ 未连接 | 权限规则不从 routines 读取 |
| routines.mcpTools → session tools | ❌ 未注册 | mcpTools 配置无消费者 |
| routines.disabledCommands → executor | ✅ 生效 | 通过 `commandEnabledRegistry` |
| sessionConfig.toolPolicy → agent turn | ✅ 生效 | 真实过滤工具列表 |

**设计原则**（参考 NarraFork）：套路配置在**新建叙述者时继承**到 sessionConfig，运行时通过 sessionConfig 生效。不是每次 turn 都重新读取 routines。

### 1.5 对话中模型切换审计结果

| 功能 | 状态 | 说明 |
|------|------|------|
| 切换模型后下一条用新模型 | ✅ 真实 | 每次 generate 从 DB 读最新 sessionConfig |
| 切换推理强度 | ⚠️ Codex 专属 | 只对 Codex apiMode 生效，Completions/Anthropic 无此参数 |
| 切换权限模式 | ✅ 真实（API 层） | 但 NarratorStatusBar 控件是死的 |
| Fast Mode | ⚠️ Codex 专属 | `service_tier: priority`，只对 Codex 生效 |

**关键认知**：
- 推理强度（`reasoning_effort`）= Codex 请求格式特有
- Fast Mode（`service_tier: priority`）= Codex 请求格式特有
- OpenAI Completions 模式（DeepSeek 等）和 Anthropic 模式没有这两个参数
- NarraFork 的做法：根据当前提供商的 apiMode 决定是否显示推理强度/FastMode 控件

### 1.6 对话数据流审计结果

**全链路真实实现**：
```
用户输入 → Composer → WebSocket → session-chat-service → agent-turn-runtime
  → LlmRuntimeService.generate() → 适配器 → LLM API
  → 工具调用 → 权限检查 → 确认门 → 工具执行 → 结果返回 LLM
  → 流式推送 → 前端 reducer → MessageItem → ToolCallBlock 渲染
```

**无致命断点**。工具调用的 input/result/status/duration 完整传递到前端。ToolCallBlock 有 400+ 行完整渲染逻辑。

---

## 二、叙事线/写作工作台问题

### 2.1 资源树问题

| 问题 | 说明 | spec 参考 |
|------|------|-----------|
| Story/Truth 文件名英文 | `pending_hooks.md` 应显示"待处理伏笔" | workspace-gap-closure Req3 |
| Story 和 Truth 分组重复 | Truth 是 InkOS 旧命名，应统一 | workspace-gap-closure Req3 |
| Badge 视觉噪音 | "只读/可删除/可编辑" 应隐藏 | novel-creation-workbench Req3 |
| JSON 文件直接展示 | 经纬资料应有结构化视图 | novel-creation-workbench Req8 |
| 资源树不反映变化 | 新建/删除后不刷新 | novel-creation-workbench Req3.10 |

### 2.2 章节功能缺失

| 功能 | spec 要求 | 当前状态 | spec 参考 |
|------|----------|---------|-----------|
| 新建章节 | 创建记录 + 文件 + 自动打开编辑器 | ❌ 无 | novel-creation-workbench Req4 |
| 章节编辑 | 可编辑正文 + 保存状态 | ⚠️ 有 Canvas | novel-creation-workbench Req4 |
| 章节保存 | 6 种状态展示 | ⚠️ 未验证 | novel-creation-workbench Req4.4 |
| 导入章节 | 文本导入 + 进入资源树 | ❌ 无 | novel-creation-workbench Req4.6 |

### 2.3 AI 候选稿管理缺失

| 功能 | spec 参考 |
|------|-----------|
| 候选稿列表 | novel-creation-workbench Req5 |
| 合并/替换/另存/放弃 | novel-creation-workbench Req5.3-5.7 |
| AI 失败不生成假候选 | novel-creation-workbench Req5.8 |

### 2.4 写作模式缺失

| 模式 | spec 参考 |
|------|-----------|
| 续写/扩写/对话/多版本/大纲分支 | workspace-gap-closure Req1 |
| 生成→预览→选择位置→确认→写入 | novel-creation-workbench Req6.3 |
| 未接入的模式 disabled + 说明原因 | novel-creation-workbench Req6.6 |

### 2.5 驾驶舱缺失

| 功能 | spec 参考 |
|------|-----------|
| 驾驶舱为默认 Tab | longform-cockpit Req1 |
| 总览回答"下一章该怎么写" | longform-cockpit Req2 |
| 写作 Tab（AI 动作+写作模式+工具） | longform-cockpit 创作流程 |

---

## 三、Agent 写作管线问题

### 3.1 Agent 角色专属配置

| 功能 | spec 参考 |
|------|-----------|
| 角色专属 system prompt | agent-writing-pipeline Req2 |
| 角色专属工具开关 | agent-writing-pipeline Req1 |
| 上下文自动注入（章节摘要/设定/伏笔） | agent-writing-pipeline Req3 |

### 3.2 AI 动作真实性

| 动作 | 后端路由 | spec 参考 |
|------|---------|-----------|
| 生成下一章 | `POST /api/books/:id/candidates` | novel-creation-workbench Req7.1 |
| 审校当前章 | `POST /api/books/:id/audit/:chapter` | workspace-gap-closure Req2.1 |
| 去 AI 味 | `POST /api/books/:id/detect/:chapter` | workspace-gap-closure Req2.2 |
| 连续性检查 | 复用 audit route | workspace-gap-closure Req2.3 |

---

## 四、NarraFork 对比缺失功能（来自 .narrafork-reference/GAPS.md）

### 4.1 高优先级（影响核心体验）

| # | 功能 | NarraFork 实现 | NovelFork 状态 |
|---|------|---------------|---------------|
| 1 | 消息右键菜单 | 回退/分叉/压缩/编辑重生成 | ✅ 有 shadcn ContextMenu（但 handler 未验证） |
| 2 | 文件修改追踪 | 按消息查看修改了哪些文件 + diff | ❌ Sheet 空壳 |
| 3 | Context Ring | SVG 圆环显示上下文使用百分比 | ❌ 只有数字 |
| 4 | 段落压缩 UI | 选择消息范围压缩 | ❌ 只有 /compact 命令 |
| 5 | /fork 前端导航 | fork 后自动打开新会话 | ❌ 前端不处理结果 |

### 4.2 中优先级（功能完整性）

| # | 功能 | NarraFork 实现 | NovelFork 状态 |
|---|------|---------------|---------------|
| 6 | 终端多标签 | xterm.js 多终端管理 | ⚠️ 有 EmbeddedTerminal 组件但无标签管理 |
| 7 | 权限细节 | 白名单/黑名单目录 per-narrator | ❌ 只有全局 |
| 8 | 危险反思 | 全部允许模式下高风险额外检查 | ❌ 无 |
| 9 | Codex 额度可视化 | 柱状图 + 预测 | ❌ 无 |
| 10 | Git 面板 | stage/commit/diff/stash | ❌ 只有状态栏 |

### 4.3 低优先级（锦上添花）

| # | 功能 |
|---|------|
| 11 | IM 网关（钉钉/飞书/微信/QQ） |
| 12 | 通知声音自定义 |
| 13 | 容器管理（Podman） |
| 14 | 多叙述者工作区 |
| 15 | 浏览器会话管理 |

---

## 五、脏数据清理

| 问题 | 说明 |
|------|------|
| Headless Chat 会话 | 测试产生的大量无用会话，需要批量删除 |
| e2e 测试工作区 | `.novelfork/e2e-workspace-flow-*` 目录残留 |
| 旧 provider ID | ✅ 已清理（deepseek-1778245457279 → deepseek） |

---

## 六、优先级排序

### P0 — 对话界面控件接通（立即修）

1. **NarratorStatusBar 回调接通** — 模型/推理/权限/FastMode 控件从死的变为活的
2. **生成标题调用 LLM** — 使用已有的 `session-auto-title.ts`
3. **/fork 前端导航** — 处理 `fork-session` 结果，创建新会话并导航
4. **归档后导航** — 归档成功后 `navigate({ to: "/next/sessions" })`

### P1 — 套路→对话传递 + 叙事线基础

5. **新建叙述者时继承 routines 配置** — 工具开关/权限规则写入 sessionConfig
6. **Truth/Story 文件名中文化** — 18 个英文文件名映射为中文
7. **资源树优化** — 合并 Story/Truth、隐藏 Badge、缩窄宽度
8. **章节编辑/保存闭环验证**

### P2 — AI 写作管线

9. **写作模式真实生成** — 从 prompt-preview 升级为调用 LLM
10. **AI 动作接通真实路由** — 审校/去AI味/连续性检查
11. **候选稿管理前端** — 列表/合并/替换/另存/放弃
12. **Agent 角色专属工具开关**

### P3 — 驾驶舱 + NarraFork 高级功能

13. **驾驶舱总览 Tab** — 今日字数/焦点/摘要/风险
14. **文件修改追踪** — 按消息查看 diff
15. **Context Ring** — SVG 圆环
16. **段落压缩 UI** — 选择消息范围
17. **经纬资料编辑** — 人物/地点/势力 CRUD
