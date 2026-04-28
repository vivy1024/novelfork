# Claude Code 源码学习：P0 功能实现参考

**版本**: v1.0.0
**创建日期**: 2026-04-28
**更新日期**: 2026-04-28
**状态**: 📚 参考资料
**文档类型**: reference

---

> 本文仅供设计和实现参考，不代表 NovelFork 当前已实现能力或产品承诺。

## 一、核心架构发现

### 1. 技术栈选择

Claude Code 使用的是 **Terminal UI (Ink.js)** 而非 Web UI：
- 基于 React + Ink.js（React for Terminal）
- 使用 `react/compiler-runtime` 优化性能
- 虚拟滚动通过自定义 `useVirtualScroll` hook 实现
- **不使用** `react-grid-layout` 或 `react-window`（这些是 Web 专用库）

**对 NovelFork 的启示**：
- ✅ 我们的 PWA 方案（React + Web）是正确的
- ✅ 可以直接使用 `react-window` 或 `react-virtualized`
- ✅ 可以使用 `react-grid-layout` 实现拖拽窗口

---

## 二、Git Worktree 实现（参考 `worktree.ts`）

### 核心设计模式

#### 1. **Slug 验证与路径安全**
```typescript
// 防止路径遍历攻击
const VALID_WORKTREE_SLUG_SEGMENT = /^[a-zA-Z0-9._-]+$/
const MAX_WORKTREE_SLUG_LENGTH = 64

function validateWorktreeSlug(slug: string): void {
  // 检查长度
  if (slug.length > MAX_WORKTREE_SLUG_LENGTH) throw new Error(...)
  
  // 检查每个 / 分隔的段
  for (const segment of slug.split('/')) {
    if (segment === '.' || segment === '..') throw new Error(...)
    if (!VALID_WORKTREE_SLUG_SEGMENT.test(segment)) throw new Error(...)
  }
}
```

**学习要点**：
- ✅ 严格验证用户输入的 slug
- ✅ 防止 `../../../` 路径遍历
- ✅ 支持嵌套 slug（如 `user/feature`）但扁平化存储（`user+feature`）

#### 2. **快速恢复路径（Fast Resume）**
```typescript
// 直接读取 .git 文件获取 HEAD SHA，避免 subprocess 开销
const existingHead = await readWorktreeHeadSha(worktreePath)
if (existingHead) {
  return { worktreePath, worktreeBranch, headCommit: existingHead, existed: true }
}
```

**学习要点**：
- ✅ 优先检查 worktree 是否已存在（避免重复 `git fetch`）
- ✅ 直接读取文件系统而非调用 `git` 命令（性能优化）
- ✅ 只在新建 worktree 时才执行 fetch

#### 3. **防止凭证提示挂起**
```typescript
const GIT_NO_PROMPT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '',
}

await execFileNoThrowWithCwd(
  gitExe(),
  ['fetch', 'origin', defaultBranch],
  { cwd: repoRoot, stdin: 'ignore', env: { ...process.env, ...GIT_NO_PROMPT_ENV } }
)
```

**学习要点**：
- ✅ 设置环境变量防止 Git 交互式提示
- ✅ 关闭 stdin 防止阻塞
- ✅ 使用 `execFileNoThrow` 而非 `exec`（防止命令注入）

#### 4. **Worktree 目录结构**
```
<repo-root>/.claude/worktrees/
  ├── feature-a/          # 主线 worktree
  ├── user+feature-b/     # 嵌套 slug 扁平化
  └── pr-123/             # PR worktree
```

**学习要点**：
- ✅ 统一存储在 `.claude/worktrees/` 目录
- ✅ 使用 `+` 替换 `/` 避免 D/F 冲突
- ✅ 支持 PR 号自动创建 worktree

#### 5. **自动清理机制**
```typescript
// 清理 30 天未使用的临时 worktree
const EPHEMERAL_WORKTREE_PATTERNS = [
  /^agent-a[0-9a-f]{7}$/,      // Agent worktree
  /^wf_[0-9a-f]{8}-[0-9a-f]{3}-\d+$/,  // Workflow worktree
  /^bridge-[A-Za-z0-9_]+(-[A-Za-z0-9_]+)*$/,  // Bridge worktree
]

async function cleanupStaleAgentWorktrees(cutoffDate: Date): Promise<number> {
  // 只清理匹配模式的临时 worktree
  // 检查是否有未提交变更或未推送提交
  // 安全删除
}
```

**学习要点**：
- ✅ 区分用户 worktree 和临时 worktree
- ✅ 定期清理避免磁盘占用
- ✅ 安全检查（未提交变更、未推送提交）

#### 6. **Worktree 退出对话框**
```typescript
// WorktreeExitDialog.tsx
// 检测变更和提交
const gitStatus = await execFileNoThrow('git', ['status', '--porcelain'])
const commitCount = await execFileNoThrow('git', ['rev-list', '--count', `${originalHead}..HEAD`])

// 提供选项：
// 1. Keep worktree (保留工作)
// 2. Remove worktree (删除)
// 3. Keep + kill tmux (保留但关闭 tmux)
```

**学习要点**：
- ✅ 退出前检测未提交变更
- ✅ 提供保留/删除选项
- ✅ 集成 tmux 会话管理

---

## 三、多窗口/多 Agent 协调（参考 `coordinatorMode.ts`）

### 核心设计模式

#### 1. **Coordinator 模式**
```typescript
// 主 Agent（Coordinator）负责：
// - 接收用户请求
// - 分发任务给 Worker Agent
// - 汇总结果
// - 与用户沟通

// Worker Agent 负责：
// - 执行具体任务
// - 返回结果给 Coordinator
// - 不直接与用户交互
```

**学习要点**：
- ✅ 清晰的角色分工（Coordinator vs Worker）
- ✅ Worker 结果通过 `<task-notification>` XML 返回
- ✅ Coordinator 不预测 Worker 结果（等待实际返回）

#### 2. **Worker 工具限制**
```typescript
const ASYNC_AGENT_ALLOWED_TOOLS = [
  'Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob',
  // ... 但不包括 TeamCreate, TeamDelete, SendMessage
]

const INTERNAL_WORKER_TOOLS = new Set([
  TEAM_CREATE_TOOL_NAME,
  TEAM_DELETE_TOOL_NAME,
  SEND_MESSAGE_TOOL_NAME,
  SYNTHETIC_OUTPUT_TOOL_NAME,
])
```

**学习要点**：
- ✅ Worker 不能创建新 Team（防止无限递归）
- ✅ Worker 不能直接发送消息给用户
- ✅ 工具权限分级管理

#### 3. **Agent 间通信**
```typescript
// Coordinator 发送任务
Agent({ 
  description: "Task description",
  prompt: "Detailed instructions...",
  subagent_type: "general-purpose"
})

// Worker 返回结果（通过 task-notification）
<task-notification>
  <task-id>{agentId}</task-id>
  <status>completed</status>
  <output>...</output>
</task-notification>
```

**学习要点**：
- ✅ 使用结构化 XML 传递结果
- ✅ 包含 task-id 用于匹配
- ✅ 状态字段（completed/failed/running）

---

## 四、上下文管理（参考 `ContextVisualization.tsx`）

### 核心设计模式

#### 1. **上下文折叠（Context Collapse）**
```typescript
// 自动压缩旧消息
const { getStats, isContextCollapseEnabled } = require("../services/contextCollapse/index.js")

const stats = getStats()
// stats.collapsedSpans - 已压缩的消息段数
// stats.collapsedMessages - 已压缩的消息数
// stats.stagedSpans - 待压缩的消息段数
```

**学习要点**：
- ✅ 自动检测上下文占用
- ✅ 分段压缩（span-based）
- ✅ 保留最近消息，压缩旧消息

#### 2. **上下文来源分组**
```typescript
// 按来源分组显示
const SOURCE_DISPLAY_ORDER = ['Project', 'User', 'Managed', 'Plugin', 'Built-in']

function groupBySource<T extends { source: SettingSource; tokens: number }>(items: T[]) {
  // 按来源分组
  // 每组内按 token 数降序排列
}
```

**学习要点**：
- ✅ 区分上下文来源（项目配置、用户配置、插件等）
- ✅ 按 token 占用排序
- ✅ 可视化显示各来源占比

#### 3. **Git 状态缓存**
```typescript
// context.ts
export const getGitStatus = memoize(async (): Promise<string | null> => {
  // 只在会话开始时获取一次
  // 缓存整个会话期间
  const [branch, mainBranch, status, log, userName] = await Promise.all([...])
  
  // 截断过长的 status（> 2000 字符）
  const truncatedStatus = status.length > MAX_STATUS_CHARS
    ? status.substring(0, MAX_STATUS_CHARS) + '\n... (truncated)'
    : status
})
```

**学习要点**：
- ✅ Git 状态只获取一次（会话开始时）
- ✅ 使用 `memoize` 缓存结果
- ✅ 截断过长输出防止上下文爆炸
- ✅ 并行获取多个 Git 信息（branch, status, log）

---

## 五、虚拟滚动（参考 `VirtualMessageList.tsx`）

### 核心设计模式

#### 1. **自定义虚拟滚动 Hook**
```typescript
// 使用自定义 useVirtualScroll hook
const { visibleItems, scrollTo, ... } = useVirtualScroll({
  items: messages,
  itemKey: (msg) => msg.id,
  estimatedItemHeight: 3,  // 估算高度
  overscan: 5,  // 预渲染行数
})
```

**学习要点**：
- ✅ 不依赖第三方库（react-window）
- ✅ 自定义实现更灵活
- ✅ 支持动态高度（通过 estimatedItemHeight）

#### 2. **搜索索引预热**
```typescript
// 预先提取所有消息的搜索文本
const fallbackLowerCache = new WeakMap<RenderableMessage, string>()

function defaultExtractSearchText(msg: RenderableMessage): string {
  const cached = fallbackLowerCache.get(msg)
  if (cached !== undefined) return cached
  
  const lowered = renderableSearchText(msg)
  fallbackLowerCache.set(msg, lowered)
  return lowered
}

// warmSearchIndex: 预热搜索索引
async warmSearchIndex(): Promise<number> {
  const start = Date.now()
  for (const msg of messages) {
    extractSearchText(msg)  // 提前计算并缓存
  }
  return Date.now() - start
}
```

**学习要点**：
- ✅ 使用 WeakMap 缓存搜索文本
- ✅ 预热索引避免搜索时卡顿
- ✅ 返回耗时供 UI 显示

#### 3. **Sticky Prompt（粘性提示）**
```typescript
// 长提示词在滚动时保持可见
type StickyPrompt = {
  text: string;
  scrollTo: () => void;
} | 'clicked';

const STICKY_TEXT_CAP = 500  // 限制显示长度
```

**学习要点**：
- ✅ 长提示词截断显示
- ✅ 点击可跳转到完整内容
- ✅ 滚动时保持在顶部

---

## 六、消息渲染优化（参考 `Messages.tsx`）

### 核心设计模式

#### 1. **Logo Header Memo**
```typescript
// 使用 React.memo 避免不必要的重渲染
const LogoHeader = React.memo(function LogoHeader({ agentDefinitions }) {
  return (
    <OffscreenFreeze>
      <Box flexDirection="column" gap={1}>
        <LogoV2 />
        <React.Suspense fallback={null}>
          <StatusNotices agentDefinitions={agentDefinitions} />
        </React.Suspense>
      </Box>
    </OffscreenFreeze>
  )
})
```

**学习要点**：
- ✅ 使用 `React.memo` 防止级联重渲染
- ✅ `OffscreenFreeze` 冻结离屏内容
- ✅ 在长会话中（2800+ 消息）避免 CPU 100%

#### 2. **消息折叠与分组**
```typescript
// 折叠相关消息
collapseBackgroundBashNotifications(messages)
collapseHookSummaries(messages)
collapseReadSearchGroups(messages)
collapseTeammateShutdowns(messages)

// 工具调用分组
applyGrouping(messages)
```

**学习要点**：
- ✅ 自动折叠后台任务通知
- ✅ 分组显示相关工具调用
- ✅ 减少视觉噪音

#### 3. **Brief-Only 模式**
```typescript
// 只显示 Brief 工具调用，隐藏其他内容
export function filterForBriefTool<T>(messages: T[]): T[] {
  // 保留：Brief tool_use、tool_result、用户输入
  // 移除：所有 assistant 文本
}
```

**学习要点**：
- ✅ 支持简洁模式（只看关键信息）
- ✅ 可配置显示内容
- ✅ 减少信息过载

---

## 七、对 InkOS 4 个 Agent 的具体建议

### Agent 1: Git Worktree Agent

**必须实现**：
1. ✅ Slug 验证（`validateWorktreeSlug`）
2. ✅ 快速恢复路径（检查 worktree 是否已存在）
3. ✅ 防止凭证提示挂起（`GIT_NO_PROMPT_ENV`）
4. ✅ 扁平化嵌套 slug（`user/feature` → `user+feature`）
5. ✅ 自动清理机制（30 天未使用）

**可选实现**：
- ⚠️ Sparse checkout（稀疏检出）
- ⚠️ Symlink directories（符号链接避免重复）
- ⚠️ .worktreeinclude 文件支持

**参考文件**：
- `src/utils/worktree.ts` (1520 行)
- `src/components/WorktreeExitDialog.tsx` (150 行)

---

### Agent 2: 多窗口卡片 Agent

**必须实现**：
1. ✅ 使用 `react-grid-layout` 实现拖拽
2. ✅ 每个窗口独立 WebSocket 连接
3. ✅ 状态持久化到 IndexedDB
4. ✅ 窗口控制（最小化/最大化/关闭）

**不要实现**：
- ❌ 不要自己实现虚拟滚动（直接用 `react-window`）
- ❌ 不要实现 Terminal UI（我们是 Web UI）

**参考设计**：
- Coordinator 模式（主窗口协调多个子窗口）
- Worker 窗口不直接与用户交互
- 结果通过结构化数据返回

---

### Agent 3: 对话式交互 Agent

**必须实现**：
1. ✅ 虚拟滚动（使用 `react-window`）
2. ✅ 搜索索引预热（WeakMap 缓存）
3. ✅ Markdown 渲染（`react-markdown`）
4. ✅ 代码高亮（`react-syntax-highlighter`）

**可选实现**：
- ⚠️ Sticky Prompt（长提示词粘性显示）
- ⚠️ 消息折叠与分组
- ⚠️ Brief-Only 模式

**参考文件**：
- `src/components/VirtualMessageList.tsx` (虚拟滚动)
- `src/components/Messages.tsx` (消息渲染)
- `src/components/Markdown.tsx` (Markdown 渲染)

---

### Agent 4: 上下文管理 Agent

**必须实现**：
1. ✅ Token 计算（使用 `tiktoken`）
2. ✅ 上下文来源分组（Project/User/Plugin）
3. ✅ 自动压缩机制（超过 80% 触发）
4. ✅ Git 状态缓存（只获取一次）

**可选实现**：
- ⚠️ 上下文折叠（Context Collapse）
- ⚠️ 分段压缩（span-based）

**参考文件**：
- `src/components/ContextVisualization.tsx` (上下文可视化)
- `src/context.ts` (上下文获取与缓存)
- `src/services/contextCollapse/` (上下文折叠服务)

---

## 八、关键性能优化技巧

### 1. **避免 subprocess 开销**
```typescript
// ❌ 慢：每次调用 git 命令
const head = await execFileNoThrow('git', ['rev-parse', 'HEAD'])

// ✅ 快：直接读取文件
const head = await readWorktreeHeadSha(worktreePath)
```

### 2. **并行执行 Git 命令**
```typescript
// ✅ 并行获取多个信息
const [branch, mainBranch, status, log, userName] = await Promise.all([
  getBranch(),
  getDefaultBranch(),
  execFileNoThrow(gitExe(), ['status', '--short']),
  execFileNoThrow(gitExe(), ['log', '--oneline', '-n', '5']),
  execFileNoThrow(gitExe(), ['config', 'user.name']),
])
```

### 3. **使用 WeakMap 缓存**
```typescript
// ✅ 自动垃圾回收
const cache = new WeakMap<Message, string>()
```

### 4. **React.memo 防止级联重渲染**
```typescript
// ✅ 只在 props 变化时重渲染
const Component = React.memo(function Component({ data }) {
  // ...
})
```

### 5. **截断过长输出**
```typescript
// ✅ 防止上下文爆炸
const MAX_STATUS_CHARS = 2000
const truncated = status.length > MAX_STATUS_CHARS
  ? status.substring(0, MAX_STATUS_CHARS) + '\n... (truncated)'
  : status
```

---

## 九、安全最佳实践

### 1. **防止路径遍历**
```typescript
// ✅ 验证 slug
if (slug.includes('..') || slug.startsWith('/')) {
  throw new Error('Invalid slug')
}
```

### 2. **防止命令注入**
```typescript
// ✅ 使用 execFile 而非 exec
await execFile('git', ['status'], { cwd: safePath })

// ❌ 不要用 exec
await exec(`git status`, { cwd: userInput })  // 危险！
```

### 3. **防止凭证泄露**
```typescript
// ✅ 设置环境变量防止交互式提示
const env = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '',
}
```

---

## 十、总结

### Claude Code 的核心优势

1. **成熟的 Git Worktree 实现**：
   - 完善的安全验证
   - 快速恢复路径
   - 自动清理机制
   - 支持 PR、嵌套 slug、sparse checkout

2. **高性能虚拟滚动**：
   - 自定义实现（不依赖第三方库）
   - 搜索索引预热
   - React.memo 优化

3. **清晰的多 Agent 协调**：
   - Coordinator/Worker 模式
   - 工具权限分级
   - 结构化通信

4. **智能上下文管理**：
   - 自动压缩
   - 来源分组
   - Git 状态缓存

### InkOS 应该借鉴的核心点

| 功能 | 借鉴要点 | 优先级 |
|------|---------|--------|
| **Git Worktree** | Slug 验证、快速恢复、防凭证挂起 | P0 |
| **多窗口** | react-grid-layout、独立 WebSocket、状态持久化 | P0 |
| **对话界面** | react-window、搜索预热、Markdown 渲染 | P0 |
| **上下文管理** | tiktoken、来源分组、自动压缩 | P0 |
| **性能优化** | 避免 subprocess、并行执行、WeakMap 缓存 | P1 |
| **安全实践** | 路径验证、防命令注入、防凭证泄露 | P1 |

---

**文档结束**
