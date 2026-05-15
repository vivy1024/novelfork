# Coding Agent 质量提升 — 需求文档

## 背景

NovelFork 的 Agent 工具链已完整（48 个工具），运行时健壮性已解决（重试/恢复/队列/并行），UI 可见性已对齐 NarraFork。但 Agent 的**代码编写质量**和**自主决策能力**仍有差距——对比 Claude Code CLI / Codex CLI 的实际行为，缺少验证循环、结果截断、错误恢复策略、项目感知和累积信任。

本 spec 聚焦"让 Agent 写出更好的代码"而非"让 Agent 有更多工具"。

---

## Phase 1：工具结果截断（P0）

### 1.1 Grep/Glob 结果截断

**现状**: Grep 返回 500 行匹配时全量塞进上下文，浪费 token 且可能溢出
**目标**: 超过阈值时自动截断，附带"结果已截断，共 N 条匹配"提示

**实现方案**:
- `session-tool-executor.ts` 中 Grep/Glob handler 返回结果后检查长度
- 阈值：Grep 最多返回 50 条匹配（可配置），Glob 最多返回 200 个路径
- 截断时在 summary 中说明："显示前 50 条（共 327 条匹配）。用更精确的 pattern 或 path 缩小范围。"
- 保留 `data` 字段中的完整结果（前端展开时可看全部）

### 1.2 Read 结果截断

**现状**: Read 大文件时全量返回，可能一次消耗几万 token
**目标**: 超过 500 行时自动截断，提示用 offset/limit 分页

**实现方案**:
- `real-tool-handlers.ts` 中 `executeFileReadTool` 返回结果后检查行数
- 超过 500 行时截断，summary 追加："文件共 {N} 行，已显示前 500 行。用 offset/limit 参数读取后续内容。"

### 1.3 Bash 输出截断

**现状**: Bash 命令输出无限制，`npm install` 可能输出几千行
**目标**: 超过 200 行时截断，保留头尾各 50 行

**实现方案**:
- `real-tool-handlers.ts` 中 `executeBashTool` 返回结果后检查行数
- 超过 200 行时：保留前 50 行 + `\n... (省略 {N} 行) ...\n` + 后 50 行
- 完整输出保留在 `data.fullOutput` 中（前端展开可看）

---

## Phase 2：验证循环（P0）

### 2.1 Post-Edit 自动验证

**现状**: Agent 写入文件后不验证，错误要等用户发现
**目标**: Write/Edit 执行后自动运行项目验证命令，失败时将错误注入上下文

**实现方案**:
- 用户配置中添加 `verificationCommand`（如 `bunx tsc --noEmit`、`npm test`）
- `session-tool-executor.ts` 中 Write/Edit handler 成功后：
  1. 检查是否配置了 verificationCommand
  2. 如果有，自动执行（超时 30s）
  3. 失败时将错误输出追加到 tool_result 的 summary 中
  4. Agent 看到错误后会自动修复
- 可配置：`autoVerify: boolean`（默认 false，用户手动开启）
- 验证结果不阻塞工具返回——异步执行，结果作为下一条 system 消息注入

### 2.2 验证命令自动检测

**现状**: 用户需要手动配置验证命令
**目标**: 根据项目类型自动推断验证命令

**实现方案**:
- 启动时检测项目文件：
  - `tsconfig.json` → `bunx tsc --noEmit`
  - `package.json` 有 `test` script → `npm test`
  - `Cargo.toml` → `cargo check`
  - `pyproject.toml` → `python -m py_compile`
- 存入 session 配置，Agent 可通过 `cockpit.get_snapshot` 获取当前验证命令
- 用户可在设置中覆盖

---

## Phase 3：错误恢复策略（P1）

### 3.1 System Prompt 错误恢复指引

**现状**: Agent 遇到错误时没有系统级引导，可能无限重试同一方法
**目标**: 在 TOOL_USE_GUIDELINES 中添加错误恢复规则

**追加内容**:
```
<error_recovery>
错误恢复原则：
- 同一方法失败 2 次，必须换方案。不要第三次尝试相同的修改。
- 遇到 typecheck 错误：先读错误信息，定位到具体文件和行号，再修复。
- 遇到"文件不存在"：先用 Glob 确认正确路径，不要猜测。
- 遇到"权限拒绝"：停下来告诉用户，不要尝试绕过。
- 遇到"命令不存在"：检查是否需要先安装依赖。
- Edit 匹配失败：先 Read 文件确认当前内容，再用正确的 old_string 重试。
- 连续 3 次工具调用失败：停下来向用户说明情况和已尝试的方法。
</error_recovery>
```

### 3.2 失败计数器

**现状**: Agent 不知道自己已经失败了几次
**目标**: 在 tool_result 中注入失败计数，让 Agent 知道该换方案了

**实现方案**:
- `agent-turn-runtime.ts` 中跟踪连续失败次数（per tool name）
- 连续失败 2 次时，在 tool_result content 中追加："⚠️ 该工具已连续失败 2 次，请考虑换一种方法。"
- 连续失败 3 次时追加："❌ 该工具已连续失败 3 次，请停下来向用户说明情况。"

---

## Phase 4：项目启动探索（P1）

### 4.1 首次对话自动探索

**现状**: Agent 不了解项目结构，需要用户告诉它
**目标**: 首次对话时自动读取关键项目文件，建立上下文

**实现方案**:
- 会话首条消息处理前，自动注入项目上下文：
  1. 读 `package.json`（项目名、依赖、scripts）
  2. 读 `tsconfig.json`（编译配置）
  3. 执行 `Glob: { pattern: "*", path: "." }`（顶层目录结构）
  4. 读 `.gitignore`（知道哪些文件不该碰）
- 结果作为 system 消息注入（不占用户消息配额）
- 只在会话首条消息时执行（后续消息不重复）
- 可配置：`autoExploreOnFirstMessage: boolean`（默认 true）

### 4.2 项目规则文件支持

**现状**: 只有 `novelfork.json` 作为项目配置
**目标**: 支持 `AGENTS.md` / `CLAUDE.md` / `.cursorrules` 等项目规则文件

**实现方案**:
- 启动时按优先级查找：`AGENTS.md` > `CLAUDE.md` > `.cursorrules` > `.github/copilot-instructions.md`
- 找到后读取内容，注入到 Agent system prompt 中
- 这样用户可以在项目根目录放一个规则文件，所有会话自动继承

---

## Phase 5：累积信任（P1）

### 5.1 命令模式自动放行

**现状**: 用户每次都要确认相同类型的操作（如 `git status`、`npm test`）
**目标**: 用户批准过的命令模式自动放行（本次会话内）

**实现方案**:
- `session-tool-executor.ts` 中维护 per-session 的已批准模式列表
- 用户批准一个命令后，提取模式（如 `git *`、`npm test`）加入列表
- 后续相同模式的命令自动放行，不再弹确认
- 会话结束后清空（不跨会话持久化，安全优先）
- 前端确认门卡片添加"始终允许此类操作"选项

### 5.2 目录信任传播

**现状**: 用户批准了 `Read src/foo.ts` 后，`Read src/bar.ts` 仍需确认
**目标**: 批准一个目录下的文件操作后，同目录其他文件自动放行

**实现方案**:
- 用户批准 `Read /path/to/dir/file.ts` 后，将 `/path/to/dir/` 加入会话级信任目录
- 后续对该目录下文件的 Read 操作自动放行
- Write/Edit 仍需确认（只有 Read 传播信任）

---

## Phase 6：智能上下文管理（P2）

### 6.1 压缩时保留关键文件

**现状**: autoCompact 压缩时只保留最近 N 轮对话，可能丢失关键文件内容
**目标**: 压缩后自动恢复最近修改过的文件内容

**实现方案**:
- 对标 Claude Code 的 `postCompactCleanup`：
  - 压缩后检查最近 5 个被修改的文件
  - 自动 Read 这些文件的当前内容
  - 作为 system 消息注入，确保 Agent 知道文件当前状态
- 使用 `file-changes-tracker` 获取最近修改的文件列表

### 6.2 跨会话记忆

**现状**: 每次新会话从零开始，不知道上次做了什么
**目标**: 新会话开始时注入上次会话的摘要

**实现方案**:
- 会话结束时（归档/新建时），自动生成摘要存入 SQLite
- 新会话开始时，注入最近 3 个相关会话的摘要作为上下文
- 摘要格式："上次会话（5/13）：修改了 agent-turn-runtime.ts 的并行执行逻辑，添加了 tool_result 合并。"

---

## 实施顺序

```
Phase 1 — 工具结果截断（P0，防止上下文爆炸）
  1.1 Grep/Glob 截断
  1.2 Read 截断
  1.3 Bash 输出截断

Phase 2 — 验证循环（P0，让 Agent 自动修错）
  2.1 Post-Edit 自动验证
  2.2 验证命令自动检测

Phase 3 — 错误恢复策略（P1）
  3.1 System Prompt 错误恢复指引
  3.2 失败计数器

Phase 4 — 项目启动探索（P1）
  4.1 首次对话自动探索
  4.2 项目规则文件支持

Phase 5 — 累积信任（P1）
  5.1 命令模式自动放行
  5.2 目录信任传播

Phase 6 — 智能上下文管理（P2）
  6.1 压缩时保留关键文件
  6.2 跨会话记忆
```

---

## 验证标准

- Phase 1：Grep 返回 1000 条匹配时，上下文只消耗 50 条的 token
- Phase 2：Agent 写入有 typo 的代码后，自动检测到 typecheck 错误并修复
- Phase 3：Agent 连续失败 2 次后自动换方案
- Phase 4：新会话首条消息时，Agent 已知道项目结构和依赖
- Phase 5：用户批准 `git status` 后，`git log` 不再弹确认
- Phase 6：压缩后 Agent 仍知道最近修改的文件内容
