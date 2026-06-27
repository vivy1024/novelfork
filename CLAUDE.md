# NovelFork Studio

**v3.0.0** | 2026-06-25 | 始终使用中文回复

**项目**: NovelFork — 网文小说 AI 辅助创作工作台（TypeScript + Bun + React 19 + Hono + SQLite + AI Agents）
**开发者**: 薛小川 | GitHub `vivy1024` — ❌ 禁止虚构
**仓库**: `vivy1024/novelfork`

---

## 工作流程（必须遵守）

### 遇到 Bug / 错误

```
1. 调查（不猜）
   - 读报错信息 → 读相关源码 → curl/日志实测复现
   - 确认根因后才动手修
   
2. 修复
   - 一次修对，不让用户当测试员
   - 修完用 Browser/curl 验证，不是 typecheck 通过就算完
   
3. 验证
   - 前端：Browser 截图
   - 后端：curl 实测
   - 编译产物：启动 exe 验证
```

### 实现新功能

```
1. 先读现有代码（不猜架构）
   - 读相关文件，理解当前实现
   - 找到正确的改动点
   
2. 实现
   - 用 subagent 执行具体编码
   - 主上下文负责规划和审查
   
3. 验证
   - 编译通过 + 实际运行验证
   - 前端改动必须 Browser 截图
```

### 发版

```
验证通过 → bump 版本 → 更新 CHANGELOG → commit → tag → push → compile → GitHub Release
```

---

## 铁律（违反 = 任务未完成）

1. **不猜。** 信息不足时读代码/文档/日志，不靠假设写修复。
2. **不让用户当测试员。** 自己验证通过再交付。
3. **前端改动必须 Browser 截图。** typecheck ≠ 完成。
4. **一次修对。** 同一个 bug 不允许反复试错超过 2 次，第 2 次失败必须停下来彻底调查。
5. **停下来问。** 遇到不确定的，问用户，不要猜着做。
6. **求是五步（思想底色）。** 任何任务默认遵循：先调查事实 → 找主要矛盾（先打最关键的）→ 集中力量打主攻（不分散）→ 实践检验（跑起来看，不靠推测）→ 完成后自我批评（诚实复盘，错了就改）。
7. **记录纪律。** 决策和踩坑通过 Engram MCP 持久化（`mem_save`），会话结束写 `mem_session_summary`。防失误靠纪律，不靠临时记忆。

---

## 版本管理

| 规则 | 说明 |
|------|------|
| 语义化版本 | 新功能 → minor；bugfix → patch；破坏性 → major |
| 即时发版 | 每完成一个用户可感知的功能/修复，立即发版 |
| 标记位置 | `CLAUDE.md`、`package.json`（根+各包）、`CHANGELOG.md`、Git tag |
| 发布产物 | `dist/novelfork-vX.Y.Z-windows-x64.exe` + SHA256 上传 GitHub Release |
| 提交格式 | `type(scope): description` |

---

## 仓库结构

| 目录 | 角色 |
|------|------|
| `packages/studio/` | 通用 Agent 工作台（React 19 + Hono + Vite） |
| `packages/core/` | 通用基础设施（storage/llm/state/hooks） |
| `packages/novel-plugin/` | 小说领域插件（engine/routes/handlers/pages） |
| `packages/cli/` | CLI 工具 |

**插件化边界**：小说功能只能在 `novel-plugin/` 中。`core/` 和 `studio/` 不允许出现小说领域代码。

---

## 功能地图（权威功能索引 — 看这里，别盲目 grep）

> 代码索引：`bun run codegraph` → `docs/codegraph/CODEMAP.md`（811文件/4006符号导航图）。
> 防漂移：`bun run docs:drift`（检查文档引用的文件/工具是否还存在）。
> **定位用法**：先查本表/CODEMAP 找"功能在哪个文件"，再 Read，不要从零 grep。

### 写作主链路（权威流程）
```
cockpit.snapshot → lore.read(scope=brief) → memory.read(purpose=write) → pgi.ask → AskUserQuestion
  → scene.spec → lore.read(scope=category) + memory.read → pipeline.write → 候选稿 → memory.events
```
编排入口：`novel-plugin/src/handlers/pipeline-write-service.ts`（executePipelineWrite）。

### 写作 Agent（继承 engine/agents/base.ts）
| Agent | 职责 | 文件 |
|------|------|------|
| WriterAgent | 章节正文生成（含 creative→observer→settler 三段 + 动态词频提示 + 写后校验） | engine/agents/writer.ts |
| ContinuityAuditor | 37 维一致性审查（输出 critical/warning/info） | engine/agents/continuity.ts |
| ReviserAgent | 按审计 issue 定点修订（spot-fix） | engine/agents/reviser.ts |
| ArchitectAgent/PlannerAgent/ComposerAgent | 架构/章节意图/上下文包（v1 旧管线 + 导入用） | engine/agents/{architect,planner,composer}.ts |
| LengthNormalizerAgent/StateValidatorAgent/RadarAgent | 长度归一化/状态校验/选题雷达 | engine/agents/ |
> 已删 4 个死 agent：chapter-analyzer/foundation-reviewer/consolidator/fanfic-canon-importer。

### Agent 工具（★=NOVEL_CORE_TOOLS 常驻；注册 session-tool-registry.ts，schema tool-schemas.ts）
★lore.read(scope=brief/category/search) · ★lore.write · ★memory.read · ★memory.graph · ★memory.events · ★cockpit.snapshot · ★chapter.read · ★pipeline.write · ★scene.spec · ★pgi.ask · ★resource.manage
其余按需：jingwei.read/write(兼容别名) · chapter.audit/list · candidate.create_chapter(纯保存) · pipeline.revise/import_chapters · rewrite.segment/apply · style.import · outline.suggest_next · character.check_consistency · hooks.manage · presets.read/write/check_compliance · beat.read/write
> 已弃用(默认隐藏 DEPRECATED_V1_TOOLS)：guided.* / questionnaire.* / pgi.generate_questions / jingwei.read_brief 等 v1 工具。

### 质量机制（v1.9.0 novel-quality-hardening）
| 机制 | 文件 |
|------|------|
| 对抗式审查（3视角A连续性/B叙事/C文本，独立跑+纯函数合成） | engine/agents/adversarial-audit.ts |
| 严重度门禁 S1-S4（S1阻断/S2修订/S3-4警告） | engine/agents/severity-gate.ts |
| 资源账本验算/知识边界/时间线（applyRuntimeStateDelta + findKnowledgeViolations/findTimelineConflicts） | core/src/state/state-reducer.ts |
| 长度治理（归一化+warning不阻断） | handlers/pipeline-write-service.ts + engine/agents/length-normalizer.ts |
| 动态词频/规则版AI痕迹(dim20-23) | engine/agents/writer.ts、ai-tells.ts |

### Lore / 经纬系统（静态设定库，engine/jingwei/）
经纬只承担作者显式维护的静态 Lore：人物、地点、势力、规则、物品、术语、作者备注。`jingwei.read/write` 保留为 `lore.read/write` 兼容别名；动态关系、时间线、角色弧线、伏笔状态、召回 diagnostics 属于 Narrative Memory。

### Narrative Memory（动态叙事记忆，engine/narrative-memory/）
`memory.read` 负责写作/修订/审计前的动态 ContextCard 召回；`memory.graph` 读取关系图、时间线、角色弧线、伏笔网络、矛盾地图；`memory.events` 管理 Pending NarrativeEvents。

### HTTP 路由（功能面）
- **小说域** `novel-plugin/src/routes/`：ai(审计/修订/检测/大纲) · bible(角色/事件/设定/弧/核心转折) · jingwei(分区/条目/关系图/上下文预览) · writing-modes(行内/对话/变体/分支/导入) · writing-tools(伏笔/POV/节奏/健康/冲突图) · writing-resource(资源账本) · pipeline(管线状态) · compliance(合规) · filter(朱雀过滤) · context-manager(上下文用量)
- **通用** `studio/src/api/routes/`：session(对话/fork/compact/回滚) · storage(书籍/章节/驾驶舱) · chapter-candidates(候选稿) · providers/aggregations/proxy(模型) · mcp · git/worktree/workbench/terminals/exec · routines(hooks/skills/commands) · presets/lorebook/snapshots/search · settings(含更新检查) · admin/auth

### 前端 UI
- **通用框架** `studio/src/app-next/`：AgentShell/Sidebar 外壳 · agent-conversation 叙述者对话(Composer/工具结果卡/权限/计划模式/Git/终端/Artifact) · settings/panels 设置 · routines 标签页 · sessions/books/dashboard/search/learn/workflow/chapter-graph
- **小说工作台** `novel-plugin/src/pages/writing-workbench/`（38组件）：WorkbenchCanvas/CockpitWorkspace/ResourceTree 容器 · InlineWritePanel/VariantsPanel/PresetsPanel/BeatProgressBar/StyleDriftPanel/AiTasteReport 写作 · JingweiGraphWorkspace/JingweiEntryEditor 经纬 · BookHealthSummary/CharacterArcsPanel/CompliancePanel 质量 · ChapterActionsBar/CandidateActionsBar/ExportPanel 操作

### core 基础设施（core/src/）
存储 storage/{db,schema,migrations-runner,embedded-migrations} · LLM llm/provider.ts(LLMClient/chatCompletion/chatWithTools) · 状态机 state/{manager,state-reducer,runtime-state-store} · 记忆 state/{memory-db,lorebook-retriever,bloat-guardian} · 模型 models/runtime-state.ts(hooks/resource/knowledge/timeline schema)

### studio 运行时三角（每次 AI 对话的执行中枢）
```
session-chat-service.ts (2846行) — WebSocket 传输 + 运行时状态 + 编排回合 + 持久化 + 广播(流式/错误/compact/安全暂停)
  └→ agent-turn-runtime.ts (1107行) — 回合循环：generate → tool_use → tool_result → 重复；appendSystemPrompt/budget pressure/file dedup/对抗审查接入
      └→ session-tool-executor.ts (4857行) — 90-case 工具分发中枢
           入口校验 → policy解析(denied/permission/dirty-resource) → YOLO决策(auto-approve/reflect安全反思/ask-user) → handler
```
权限/安全：permission-pipeline.ts(validateToolPermission)、yolo-mode.ts(getYoloDecision/performSafetyReflection)、session-tool-policy.ts。
注：executor 有模块级 Map(browserSessions/sessionPipelines/backgroundAgents)按 id 隔离——改并发逻辑时注意。

---

## 编译与运行

```bash
# 开发
bun run dev

# 编译 exe
cd packages/studio && bun run compile

# 产物
dist/novelfork-vX.Y.Z-windows-x64.exe
```

---

## Skill 体系（三层）

**总原则**：求是是底色（怎么想），工作流是主干（怎么做），专项能力按需调用（产出什么）。
匹配到场景就调用，不需要用户打 `/命令`。

### 第一层：求是（思想底色，不调用，已内化为铁律）

求是体系不是可调用工具，而是分析问题的默认方式，已写进上方「铁律」。
做任何事都遵循：**先调查事实 → 找主要矛盾 → 集中力量打主攻 → 实践检验 → 完成后自我批评**。
唯一保留可显式调用的是 `investigation-first`——当问题复杂、需要正式走调查流程时。

### 第二层：工作流主干（spec 驱动，你设计的核心路径）

这是 1645 个 commit 走出来的真实路径，照走：

```
brainstorming（探需求）
  → spec 三件套（requirements / design / tasks）
  → executing-plans / kiro-spec-adapter（执行）
  → subagent-driven-development / dispatching-parallel-agents（并行）
  → requesting-code-review（审查）→ receiving-code-review（改）
  → verification-before-completion（验证）
  → /ship（发版）
```

| 场景 | 调用 |
|------|------|
| 新功能探索需求 | `brainstorming` |
| 有 spec 三件套要执行 | `executing-plans` / `kiro-spec-adapter` |
| 写 tasks.md | `writing-plans` |
| 多个独立任务可并行 | `subagent-driven-development` / `dispatching-parallel-agents` |
| 代码写完要审查 | `requesting-code-review` |
| 收到 review 反馈 | `receiving-code-review` |
| Bug 调查（复杂时走流程） | `systematic-debugging` / `investigation-first` |
| 功能做完要验收 | `feature-closure-gate` / `verification-before-completion` |

### 第三层：专项能力（按需调用）

**设计物料**：`canvas-design`（封面、宣传图、工作室 VI）

> 出实现方案前（ExitPlanMode 前）默认先跑 `brainstorming`；代码写完默认 `requesting-code-review`；发版默认 `finishing-a-development-branch`。

### 记录纪律（防失误的根本 —— 定义"何时记"）

通过 Engram MCP 持久化记忆，跨会话自动召回。

| 时机 | 动作 |
|------|------|
| 会话开始 | `mem_session_start` → `mem_context(project="novelfork")` → 告诉用户上次进度 |
| 选了方案 A 不选 B | `mem_save(project="novelfork", type="decision", ...)` |
| 踩坑 / bug 根因 / 某方法失败 | `mem_save(project="novelfork", type="bugfix", ...)` |
| 每个 spec / 批次完成 | 强制自检（criticism-self-criticism 精神）+ `/review` |
| 会话结束 | `mem_session_summary` → `mem_session_end(id="novelfork-session")` |

### 不用 skill 的场景

- 简单问答（直接回答）
- 单文件小改动（直接改）
- 读代码/解释代码（直接读）

---

## 当前状态

| 指标 | 值 |
|------|----|
| 版本 | v3.0.0 |
| 模型 | DeepSeek v4-pro（Anthropic 协议，thinking disabled）、Claude Opus 4.6 |
| 已知问题 | 图片发送待验证；清空上下文会删聊天记录（待改为标记式） |

---

## 按需加载参考

| 场景 | 文件 |
|------|------|
| 项目事实与完成标准 | `.kiro/steering/project-profile.md` |
| 系统架构 | `docs/04-架构与设计/README.md` |
| Agent 写作管线 | `docs/01-codewiki/modules/pipeline-write.md` |
| 存储层开发 | `docs/01-codewiki/modules/chapter-storage.md` |
| 小说创作流程 | `docs/03-产品与流程/01-小说创作流程.md` |
| NarraFork 参考 | `.narrafork-reference/` |

---

## 兄弟项目

| 项目 | 路径 | 何时看 |
|------|------|--------|
| Sub2API | `D:\DESKTOP\sub2api` | API 报错、代理问题 |
| 文字修仙 | `D:\DESKTOP\文字修仙` | 修仙世界观、Electron 桌面壳 |
| OpenClaw | `D:\DESKTOP\openclaw` | 小说原文、GraphRAG、agent 架构参考 |

---

## MCP 工具使用指南

本工作区连接了 3 个 MCP 服务，以下是使用规范。

### 1. Engram（持久化记忆）

**用途**：跨会话记住决策、bug 根因、架构变更，下次开会话自动召回。

**项目名**：统一使用 `novelfork`（Engram 识别 `D:\DESKTOP\novelfork` 为 git root）。所有调用都必须显式传 `project="novelfork"`。

**常用操作**：

```
# 会话开始（每次新对话第一件事）
mem_session_start(id="novelfork-session", directory="D:\\DESKTOP\\novelfork")
mem_context(project="novelfork")

# 保存记忆（踩坑/决策/发现时立即调用）
mem_save(
  project="novelfork",
  session_id="novelfork-session",
  title="简短可搜标题",
  type="bugfix|decision|architecture|pattern|discovery",
  content="**What**: ...\n**Why**: ...\n**Where**: ...\n**Learned**: ..."
)

# 搜索历史记忆
mem_search(project="novelfork", query="关键词")

# 会话结束
mem_session_summary(session_id="novelfork-session", content="## Goal\n...")
mem_session_end(id="novelfork-session", summary="一句话总结")
```

**注意事项**：
- `mem_save` 的 content 用 `**What/Why/Where/Learned**` 结构化格式
- 重要 bug 修复和架构决策**必须**存，不是可选的

### 2. Codebase Memory（代码知识图谱）

**用途**：代码结构分析、调用链追踪、影响范围评估。比 grep 更智能。

**项目名**：`D-DESKTOP-novelfork`（已索引 11k+ 节点）

**常用操作**：

```
# 搜索函数/类（替代 grep 找定义）
search_graph(project="D-DESKTOP-novelfork", query="pipeline write")

# 调用链追踪（找谁调用了某函数 / 某函数调用了谁）
trace_paths(project="D-DESKTOP-novelfork", function_name="executePipelineWrite", direction="inbound", depth=3)

# 架构概览
get_architecture(project="D-DESKTOP-novelfork")

# 变更影响分析（改了代码后看影响范围）
detect_changes(project="D-DESKTOP-novelfork", since="HEAD~5")

# 带图谱增强的 grep
enhanced_grep(project="D-DESKTOP-novelfork", pattern="jingwei", mode="compact")

# Cypher 复杂查询
cypher_query(project="D-DESKTOP-novelfork", query="MATCH (f:Function) WHERE f.complexity > 15 RETURN f.qualified_name")
```

**何时用 Codebase Memory vs 普通 Grep**：
- 找定义、找调用者、追踪数据流 → Codebase Memory
- 找字符串出现位置、简单文本匹配 → 普通 Grep
- 理解模块边界、架构全貌 → `get_architecture`

**重新索引**：代码大改后需要更新索引：
```
index_repository(repo_path="D:/DESKTOP/novelfork", mode="fast")
```

### 3. GitHub MCP

**用途**：直接操作 GitHub 仓库，不需要走 `gh` CLI。

**常用操作**：

```
# 查看 issues
list_issues(owner="vivy1024", repo="novelfork", state="open")

# 创建 PR
create_pull_request(owner="vivy1024", repo="novelfork", title="...", head="feature-branch", base="master")

# 查看 PR 状态
get_pull_request(owner="vivy1024", repo="novelfork", pull_number=N)

# 发版仍用 gh CLI（GitHub MCP 没有 release API）：
# gh release create vX.Y.Z --title "..." --notes "..."
```

---

## MCP 使用时机速查

| 场景 | 用什么 |
|------|--------|
| 新会话开始 | Engram: `mem_session_start` → `mem_context(project="novelfork")` |
| 修完 bug | Engram: `mem_save(project="novelfork", type="bugfix")` |
| 做了架构决策 | Engram: `mem_save(project="novelfork", type="decision")` |
| 找函数定义 | Codebase Memory: `search_graph` |
| 找谁调用了某方法 | Codebase Memory: `trace_paths(direction="inbound")` |
| 改完代码看影响 | Codebase Memory: `detect_changes` |
| 代码大改后 | Codebase Memory: `index_repository(mode="fast")` |
| 查 GitHub issues | GitHub MCP: `list_issues` |
| 发版 | `gh` CLI（GitHub MCP 不支持 release）|
| 会话结束 | Engram: `mem_session_summary` → `mem_session_end` |

---

## 风险分级

| 风险 | 示例 | 处理 |
|------|------|------|
| 🟢 | 读文件、搜索、跑测试 | 直接执行 |
| 🟡 | 编辑代码、装依赖 | 执行后报告 |
| 🔴 | 删文件、push、改 CI | **先确认** |

---

## 严格禁止

- ❌ 虚构结果
- ❌ force push 到 master
- ❌ 密码/Token 入仓库
- ❌ mock/假数据冒充真实功能
- ❌ 创建临时文档代替修复问题
