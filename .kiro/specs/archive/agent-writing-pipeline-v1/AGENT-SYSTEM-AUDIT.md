# NovelFork Agent 体系全景 v2

**编写日期**: 2026-05-01
**目的**: 为新 spec 提供完整的事实基础，包含 NarraFork 工具体系的完整映射

---

## 一、工具全景（分层）

### 1.1 NovelFork 写作工具（Core 层，18 个）

注册到 `globalToolRegistry`，Agent 可通过 tool-calling 调用。

```
创作：plan_chapter / compose_chapter / write_draft / write_full_pipeline
审校：audit_chapter / revise_chapter
知识：read_truth_files / write_truth_file / update_author_intent / update_current_focus
       import_style / import_canon
管理：create_book / get_book_status / list_books / import_chapters
辅助：scan_market / web_fetch
```

### 1.2 NarraFork 通用工具（ToolsTab，22 个）

所有工具都在 `AVAILABLE_TOOLS` 中定义，作者在套路页→工具 Tab 中可开关。

#### 创作核心（建议默认开启）

| 工具 | `/load` | 当前默认 | 建议默认 | 说明 |
|------|---------|---------|---------|------|
| **Bash** | `/load bash` | ✅ 开启 | ✅ 开启 | 执行 Shell 命令（需审批） |
| **Read** | `/load read` | ✅ 开启 | ✅ 开启 | 读取文件（只读） |
| **Write** | `/load write` | ✅ 开启 | ✅ 开启 | 写入文件（需审批） |
| **Edit** | `/load edit` | ✅ 开启 | ✅ 开启 | 精确编辑文件（需审批） |
| **Grep** | `/load grep` | ✅ 开启 | ✅ 开启 | 搜索文件内容（只读） |
| **Glob** | `/load glob` | ✅ 开启 | ✅ 开启 | 文件名模式匹配（只读） |

#### 联网工具（建议默认关闭，按需开启）

| 工具 | `/load` | 当前默认 | 建议默认 | 说明 |
|------|---------|---------|---------|------|
| **WebSearch** | `/load web_search` | ❌ 关闭 | ❌ 关闭 | 网络搜索 |
| **WebFetch** | `/load web_fetch` | ❌ 关闭 | ❌ 关闭 | 网页内容抓取 |

#### NarraFork 运维工具（建议默认关闭，按需开启）

| 工具 | `/load` | 当前默认 | 建议默认 | 说明 |
|------|---------|---------|---------|------|
| **Terminal** | `/load terminal` | ❌ 关闭 | ❌ 关闭 | 交互式终端 PTY |
| **Recall** | `/load recall` | ❌ 关闭 | ❌ 关闭 | 检索历史对话 |
| **Browser** | `/load browser` | ❌ 关闭 | ❌ 关闭 | 浏览器自动化 |
| **ShareFile** | `/load share_file` | ❌ 关闭 | ❌ 关闭 | 生成临时下载链接 |
| **ForkNarrator** | `/load fork_narrator` | ❌ 关闭 | ❌ 关闭 | 分叉叙述者会话 |
| **NarraForkAdmin** | `/load narrafork_admin` | ❌ 关闭 | ❌ 关闭 | 管理服务器设置 |

#### 团队协作工具（建议默认关闭）

| 工具 | `/load` | 当前默认 | 建议默认 | 说明 |
|------|---------|---------|---------|------|
| TeamCreate | — | ❌ 关闭 | ❌ 关闭 | 创建 Agent 团队 |
| TeamDelete | — | ❌ 关闭 | ❌ 关闭 | 删除 Agent 团队 |
| SendMessage | — | ❌ 关闭 | ❌ 关闭 | 发送消息 |
| PushNotification | — | ❌ 关闭 | ❌ 关闭 | 推送通知 |

#### Git/工作区工具（建议默认开启）

| 工具 | `/load` | 当前默认 | 建议默认 | 说明 |
|------|---------|---------|---------|------|
| **EnterWorktree** | `/load enter_worktree` | ❌ 关闭 | ✅ 开启 | 进入 Git worktree |
| **ExitWorktree** | `/load exit_worktree` | ❌ 关闭 | ✅ 开启 | 退出 Git worktree |

#### 管理工具（建议默认开启）

| 工具 | `/load` | 当前默认 | 建议默认 | 说明 |
|------|---------|---------|---------|------|
| **TodoWrite** | `/load todo_write` | ❌ 关闭 | ✅ 开启 | 写入待办列表 |
| Monitor | — | ❌ 关闭 | ❌ 关闭 | 进程监控 |

---

## 二、Agent 全景

### 2.1 Core 层 Agent 类（13 个）

```
创作链（顺序执行）：
  Planner → Composer/Writer → ContinuityAuditor → Reviser

世界观/设定：
  Architect / FoundationReviewer / FanficCanonImporter

分析/治理：
  ChapterAnalyzer / Consolidator / LengthNormalizer

运行时：
  Radar / StateValidator
```

### 2.2 UI 预设（4 个，ChatWindow 可选）

| 预设 ID | 标签 | 权限 | 适合什么 |
|---------|------|------|---------|
| `writer` | 写作 Writer | edit | 日常续写 |
| `planner` | 规划 Planner | plan | 大纲规划 |
| `auditor` | 审计 Auditor | read | 质量审校 |
| `architect` | 设定 Architect | ask | 世界观构建 |

### 2.3 需要补的 Agent

| 新增 | 职责 | 工具权限 |
|------|------|---------|
| **Explorer** | 只读分析：读取状态、聚合信息、给出建议。不做任何写入 | Read, Grep, Glob, read_truth_files, get_book_status |
| **Pipeline Orchestrator** | 串联探索→规划→写作→审计的流程编排函数 | 编排函数只调度，不直接调工具 |

---

## 三、Agent 角色分配

### 创作主循环

```
作者说「写下一章，回收第3章玉佩伏笔」

Explorer      → 读取状态、伏笔、角色出场、设定 → «当前应关注...»
   ↓
Planner       → 根据探索结果制定大纲 → «第N章大纲：场景/情节点/伏笔回收节点»
   ↓
Writer        → 根据大纲生成正文 → 候选区
   ↓
Auditor       → 审计连续性和AI味 → «审计报告：3个问题，2个建议»
   ↓ (需要时)
Reviser       → 修订问题章节
```

### 其他场景

| 场景 | Agent 链 |
|------|---------|
| 新建书籍 | Architect → Planner → Writer |
| 日更续写 | Explorer → Writer → Auditor |
| 大修 | Explorer → Auditor → Reviser → Auditor |
| 全书整理 | Consolidator → FoundationReviewer |

---

## 四、驾驶舱与 Agent 的关系

驾驶舱 = Agent 的仪表盘 + 作者的快速状态视图。

| 驾驶舱 Tab | 数据来源 | Agent 如何消费 |
|-----------|---------|---------------|
| 总览 → 日更进度 | `/progress` | Explorer 判断节奏 |
| 总览 → 当前焦点 | `current_focus.md` | Planner 规划方向 |
| 总览 → 最近摘要 | bible summaries | Explorer 了解前文 |
| 总览 → 风险卡片 | auditIssues + hook status | Explorer 优先关注 |
| 伏笔 Tab | bible events + pending_hooks.md | Planner 部署回收 |
| 设定 Tab | bible settings + book_rules + ledger | Writer 保持一致 |
| AI Tab | providers/status + candidates | 作者了解 Agent 状态 |

驾驶舱不新增 API，全部数据来自已有接口。

---

## 五、需要做的事情（修正后的 spec）

### 不做
- ❌ 不新建 Agent 类（13 个够了）
- ❌ 不新建 Core 工具（18 个够了）
- ❌ 不新建通用工具（ToolsTab 22 个全了）
- ❌ 不新建 Agent 循环（`runAgentLoop` 存在）

### 要做（6 件）

| # | 做什么 | 影响范围 |
|---|--------|---------|
| 1 | **调整默认工具开关**：Writer/Planner/Auditor Agent 默认开启对应的 NarraFork 工具，创作不需要的工具（Browser/Terminal/ForkNarrator 等）默认关 | ToolsTab `AVAILABLE_TOOLS` 的 `enabled` 字段 |
| 2 | **agentId → 不同 system prompt**：`runAgentLoop` 根据 agentId（writer/planner/auditor/architect/explorer）加载不同的 system prompt | `pipeline/agent.ts` + `agent-prompts.ts` |
| 3 | **SubAgent 配置生效**：SubAgentsTab 里定义的 systemPrompt 和 toolPermissions 真正传给 `runAgentLoop` | `session-chat-service.ts` → `agent.ts` |
| 4 | **补 Explorer Agent**：只读探索角色，聚合状态、分析上下文、给出建议 | `agents/explorer.ts` + system prompt |
| 5 | **补编排函数**：`runWritingPipeline(bookId, intent)` 串行调用 Explorer→Planner→Writer→Auditor | `pipeline/agent-pipeline.ts` |
| 6 | **session 绑定 bookId → 自动注入上下文** | `session-chat-service.ts` |
