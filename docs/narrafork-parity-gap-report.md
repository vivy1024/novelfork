# NovelFork 全面对标差距报告

> 生成日期：2026-05-08
> 对标对象：Claude Code CLI / Codex CLI / NarraFork
> 分析范围：代码层 Agent 能力 + 前端渲染性能 + UI 功能完整度

---

## 一、Claude Code CLI Agent 能力对标

### 已完整实现（无显著差距）

| 能力 | 关键文件 | 说明 |
|------|---------|------|
| 工具注册表 | `core/registry/tool-registry.ts` | 18 个内置工具，builtin/mcp/plugin 三种来源 |
| Agent 执行循环 | `pipeline/agent.ts` + `agent-turn-runtime.ts` | 双层：Core CLI loop + Studio 事件驱动 turn |
| 权限确认门 | `session-types.ts` + `agent-native-workspace.ts` | 5 种模式 + 4 级风险 + 多源决策（超越 Claude） |
| 上下文压缩 | `context-compaction.ts` | 常量对齐：BUFFER=13000, THRESHOLD=90% |
| 流式输出 | `session-chat-service.ts` | WebSocket session:stream envelope |
| 子代理派发 | `subagent-runtime.ts` | AsyncGenerator + transcript + abort + fork |
| 会话恢复 | `session-runtime/recovery.ts` | seq-based 断点续传 + 6 状态 + 7 原因 |
| 计划模式 | `session-types.ts` | plan 模式阻止写操作 |

### 存在差距

| 能力 | 状态 | 差距描述 |
|------|------|---------|
| Git worktree 隔离 | 字段预留 | `worktree` 字段存在但无实际隔离逻辑，Claude 的 subagent 在独立 worktree 中执行 |
| Token 精确计数 | 估算 | tiktoken 可选，默认 CJK 1.5 + EN 0.25 估算；Claude 用精确计数 |
| 文件系统工具 | 设计差异 | 面向写作（write_draft/audit_chapter），非通用 Read/Write/Glob/Grep |
| 多模型自动路由 | 部分 | 有 model-pool 但无 haiku/sonnet/opus 自动路由策略 |
| Pre-commit hook | 无 | 不涉及 git 操作（设计决策） |
| TodoWrite 任务追踪 | 无 | 通过 guided generation 部分替代 |

### 超越 Claude Code CLI 的能力

| 能力 | 说明 |
|------|------|
| Guided Generation | planning → questions → answers → plan → approve → execute |
| Tool Confirmation Audit | 完整审计链（checkpoint/source/decision） |
| Narrative Line Graph | 叙事线图谱（nodes/edges/beats/conflicts/foreshadows） |
| PGI 主动引导 | 基于启发式触发的主动问答 |
| Canvas Context | 画布上下文感知（activeTab/selection/openTabs） |
| 重复工具调用检测 | 同轮次重复调用自动拦截 |
| 会话级 Token 累计统计 | SessionCumulativeUsage |

---

## 二、Codex CLI Agent 能力对标

### 已实现

| 能力 | 关键文件 | 说明 |
|------|---------|------|
| 平台账号管理 | `platform-integrations.ts` | JSON 导入/配额/切换/删除 API |
| 模型注册 | 同上 | 4 个模型：gpt-5-codex/5.1/5.1-codex/5.1-codex-mini |
| 推理强度 | `settings.ts` | codexReasoningEffort 专属字段，默认 high |
| API 传输层 | `provider-catalog.ts` | apiMode/apiFormat: "codex" |
| Parity 守护 | `parity-matrix.ts` | 11 项对标矩阵 + SettingsTruthModel |
| Headless exec | `exec.ts` | 参考 Codex exec 设计的 POST /api/exec |
| 能力状态模型 | `codex-runtime-status.ts` | 5 项能力追踪 |

### 关键缺失

| 能力 | 状态 | 说明 |
|------|------|------|
| Platform Adapter | ❌ UnsupportedAdapter | `codex-platform` 适配器的 listModels/testModel/generate 全部返回 unsupported |
| OS Sandbox | ❌ 仅类型 | `normalizeCodexSandboxMode()` 永远返回 planned；Bash 传入 sandboxMode: undefined |
| Approval Policy 完整模型 | ⚠️ partial | 无 untrusted/on-failure/on-request/never/granular |
| MCP Server 管理 | ❌ planned | 无 `codex mcp list/add/remove` |
| Image Input | ❌ planned | 对话 composer 无图片附件 |
| Code Review | ❌ planned | 无 review 子命令或 UI |
| Custom Agents TOML | ❌ 无 | 无 `.codex/agents/` TOML 格式支持 |
| exec JSONL Event | ⚠️ 不兼容 | NovelFork NDJSON 事件命名不兼容 Codex exec schema |
| codex-adapter 命令 | ❌ 仅类型 | RuntimeCommandSource 包含 "codex-adapter" 但无命令使用 |

### Codex vs Claude Code 在本项目中的实现差异

| 维度 | Claude Code CLI | Codex CLI |
|------|----------------|-----------|
| 适配器 | openai-compatible 完整实现（含流式） | UnsupportedAdapter 占位 |
| 命令来源 | 多个命令 source: "claude-adapter" | 无命令使用 "codex-adapter" |
| 权限管线 | 完整实现，注释对标 Claude | 仅类型定义 + planned |
| 子代理 | 完整 transcript/abort/fork | 仅 parity matrix 记录差距 |
| Parity 守护 | 5 项，多为 partial | 11 项，多为 planned |

---

## 三、前端渲染性能对标

### 数据流管线

```
WebSocket 消息到达
  → parseSessionServerEnvelope() — JSON 解析 + type 路由
  → useReducer(reduceSessionEnvelope) — 按 type 分支：
      session:snapshot → 全量替换 messages[]
      session:message → mergeSessionMessages（去重 + seq 排序）
      session:stream  → appendStreamChunk（追加到流式消息）
      session:error   → 设置 error + recovery
  → state.messages 更新 → React re-render
  → toConversationMessages() 映射 + isStreaming 标记
  → ConversationSurface → MessageStream
  → BidirectionalList (broad-infinite-list) 虚拟滚动
  → MessageItem 按 role 分支渲染：
      system → 居中小字
      user → 右对齐气泡
      assistant → ThinkingBlock[] + AnimatedMarkdown/MarkdownRenderer + ToolCallBlock[]
  → MarkdownRenderer → CodeBlock → shiki codeToHtml 异步高亮
```

### 已实现的优化

| 优化 | 说明 |
|------|------|
| 虚拟滚动 | broad-infinite-list, threshold=200px |
| 路由懒加载 | 3 个页面 React.lazy + Suspense |
| useCallback 稳定引用 | renderItem/itemKey/handleLoadMore |
| shiki 异步高亮 | useEffect + cancelled flag + fallback |
| KaTeX 懒加载 | 首次遇到数学公式才加载 CSS |
| 流式/静态双模式 | 流式用 flowtoken，结束切换 MarkdownRenderer |
| WebSocket 断线缓冲 | pendingClientEnvelopes + 重连 flush |
| 消息去重 + seq 排序 | mergeSessionMessages 用 Map 去重 |

### 缺失的优化（性能差距）

| 缺失项 | 影响 | 优先级 |
|--------|------|--------|
| MessageItem 无 React.memo | 长对话（100+消息）所有可见 item 重渲染 | 🔴 高 |
| shiki 无 highlighter 实例复用 | 每个 CodeBlock 独立调用 codeToHtml()，重复初始化 WASM | 🔴 高 |
| Markdown 渲染无缓存 | 相同 content 每次重新解析 AST + 重新渲染 | 🟡 中 |
| BidirectionalList 无 viewCount | 依赖库默认值，未针对消息场景调优 | 🟡 中 |
| 流式 chunk 触发全量数组重建 | appendStreamChunk 每次 .map() 整个 messages 数组 | 🟡 中 |
| 无 Web Worker 离线渲染 | Markdown 解析和 shiki 高亮都在主线程阻塞 | ⚪ 低 |

---

## 四、Claude Code CLI Web vs Codex CLI TUI 体验差异

| 维度 | NovelFork Studio (Web) | Codex CLI (TUI) |
|------|----------------------|-----------------|
| 渲染目标 | 浏览器 DOM（React 19 + Vite） | 终端 TUI（Ink/React 终端渲染） |
| 流式输出 | WebSocket + flowtoken 打字机动画 | stdout 逐字符输出 |
| 代码高亮 | shiki 异步（github-dark 主题） | 终端 ANSI 颜色 |
| 虚拟滚动 | broad-infinite-list（DOM 虚拟化） | 终端自带滚动缓冲区 |
| Markdown | react-markdown + GFM + KaTeX | marked-terminal 或类似 |
| 工具调用展示 | 可折叠卡片 + 状态徽章 + 重放按钮 | 内联文本 + spinner |
| 推理/思考 | 折叠块 + 摘要预览 | 终端折叠或隐藏 |
| 权限确认 | Sheet/Dialog 弹窗审批 | y/n 终端确认 |
| 会话管理 | 多会话列表 + fork/compact/restore | 单会话为主 |
| 上下文感知 | canvasContext（画布选中内容注入） | 工作目录 + 文件引用 |
| 性能瓶颈 | DOM 节点数 + Markdown 解析 + shiki 主线程 | 终端渲染帧率 + stdout 缓冲 |
| 离线体验 | pendingEnvelopes + recovery 状态机 | 无网络依赖（本地或失败即停） |
| 优势 | 富交互（搜索/右键/重放/画布） | 启动速度快、资源占用少 |

---

## 五、与 NarraFork 前端功能对标

### 已对齐（无差距）

| 功能 | 实现 |
|------|------|
| 虚拟滚动 | broad-infinite-list ✅ |
| 流式动画 | flowtoken AnimatedMarkdown ✅ |
| 代码高亮 | shiki ✅ |
| 消息右键菜单 | shadcn ContextMenu ✅ |
| 工具栏 Tooltip | shadcn Tooltip ✅ |
| 状态栏下拉 | shadcn DropdownMenu ✅ |
| sidebar 折叠 | ✅ 展开/折叠 + 图标模式 |
| 路由懒加载 | React.lazy + Suspense ✅ |
| 拖拽排序 | @dnd-kit sortable ✅ |
| Sheet 面板 | shadcn Sheet（文件修改/会话信息） ✅ |
| Git 状态栏 | 章节名·分支·变更数 ✅ |
| 搜索过滤 | 已加载消息内搜索 ✅ |
| 推理折叠 | ThinkingBlock 折叠/展开 ✅ |
| 工具调用卡片 | ToolCallBlock 完整实现 ✅ |

### 存在差距

| 功能 | NovelFork | NarraFork | 差距级别 |
|------|-----------|-----------|---------|
| 路由系统 | 手写 pushState + React.lazy | TanStack Router（类型安全 + 懒加载） | 🟡 中 |
| 终端嵌入 | 无 | @xterm/xterm + bun-pty | 🔴 功能缺失 |
| IM 集成 | 无 | Slack/Discord/Telegram/飞书 | 🟡 非核心 |
| 国际化 | 无（纯中文） | i18next 多语言 | ⚪ 非必需 |
| 消息组件 memo | ❌ 缺失 | ✅ memoized | 🔴 性能 |
| shiki 实例复用 | ❌ 缺失 | ✅ 共享 highlighter | 🔴 性能 |
| 对话嵌入章节图 | 占位 UI + 操作按钮 | 完整 ConversationSurface 嵌入 | 🟡 架构级 |
| 多窗口/多标签 | 无 | 支持多标签对话 | 🟡 体验 |
| 历史消息分页 cursor | 无（全量加载） | 分页 cursor + 加载状态 | 🟡 性能 |
| 流式结束平滑过渡 | 直接切换 | 动画过渡到静态 | ⚪ 体验 |

---

## 六、优先修复路线图

### P0 — 性能关键（立即修）

1. **MessageItem 添加 React.memo** — 避免长对话重渲染
2. **shiki highlighter 实例复用** — 创建全局 singleton，避免重复 WASM 初始化

### P1 — 功能关键（短期）

3. **Codex platform adapter 实现** — 从 UnsupportedAdapter 升级为真实 API 调用
4. **Git worktree 隔离** — subagent 在独立 worktree 中执行
5. **终端嵌入** — @xterm/xterm + bun-pty

### P2 — 体验增强（中期）

6. **TanStack Router** — 替换手写 pushState，获得类型安全路由
7. **历史消息分页 cursor** — 避免全量加载，支持大量历史消息
8. **流式 chunk 优化** — 避免 appendStreamChunk 全量 .map()
9. **对话嵌入章节图** — ChapterNode 内嵌完整 ConversationSurface

### P3 — 锦上添花（长期）

10. **IM 集成** — Slack/Discord/飞书通知
11. **国际化** — i18next（如果需要英文用户）
12. **Web Worker 渲染** — Markdown + shiki 离线到 Worker
13. **多标签对话** — 同时打开多个叙述者

---

## 七、总结

| 对标对象 | 完成度 | 核心差距 |
|---------|--------|---------|
| Claude Code CLI Agent | **~95%** | ~~worktree 隔离~~ ✅ 已实现 + token 精确计数（估算） |
| Codex CLI Agent | **~60%** | ~~platform adapter 空壳~~ ✅ 已实现 + sandbox 未实现 |
| NarraFork 前端 | **~92%** | ~~性能优化~~ ✅ + ~~终端嵌入~~ ✅ + TanStack Router（P2） |
| NarraFork Agent | **~95%** | 与 Claude Code 对标一致 |

**已修复的风险**：
- ✅ MessageItem React.memo — 长对话性能
- ✅ shiki highlighter 实例复用 — 代码高亮性能
- ✅ 流式 chunk 优化 — 避免全量 .map()

**已修复的功能缺口**：
- ✅ Codex platform adapter — 完整 listModels/testModel/generate 实现
- ✅ 终端嵌入 — @xterm/xterm + FitAddon + WebLinksAddon
- ✅ Git worktree 隔离 — WorktreeManager + SubagentConfig.worktree

**剩余 P2 项（中期）**：
- TanStack Router 替换手写 pushState（类型安全路由）
- 历史消息分页 cursor（大量历史消息性能）
