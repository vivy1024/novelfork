# Claude Code P2 体验优化与剩余功能学习

**分析日期**: 2026-04-18  
**目标**: 为 InkOS Phase 4 P2 功能和后续开发提供实现参考

---

## 一、P2 体验优化功能

### 1. 消息编辑（Message Editing）

**核心设计**：
```typescript
// 点击任意消息进入编辑模式
<MessageRow
  message={msg}
  onClick={() => setEditingMessageId(msg.id)}
/>

// 编辑后重新生成后续消息
function onMessageEdit(messageId: string, newContent: string) {
  // 1. 更新消息内容
  updateMessage(messageId, newContent)
  
  // 2. 删除该消息之后的所有消息
  deleteMessagesAfter(messageId)
  
  // 3. 重新发送请求生成新回复
  regenerateFromMessage(messageId)
}
```

**编辑历史**：
```typescript
interface MessageHistory {
  messageId: string
  versions: Array<{
    content: string
    timestamp: Date
    editedBy: 'user' | 'assistant'
  }>
  currentVersion: number
}

// 支持撤销/重做
function undoEdit(messageId: string) {
  const history = getMessageHistory(messageId)
  if (history.currentVersion > 0) {
    history.currentVersion--
    applyVersion(history.versions[history.currentVersion])
  }
}
```

**学习要点**：
- ✅ 点击消息进入编辑模式
- ✅ 支持 Markdown 编辑
- ✅ 编辑后重新生成后续消息
- ✅ 保留编辑历史（可选）

---

### 2. 双 Git 按钮（Dual Git Buttons）

**设计理念**：
- **按钮 1**：Git 日志查看器（只读操作）
- **按钮 2**：Fork/合并操作（写操作）

**实现方案**：
```typescript
// 按钮 1: Git 日志
<GitLogButton onClick={() => {
  const log = await execGit(['log', '--oneline', '-n', '20'])
  const diff = await execGit(['diff', 'HEAD'])
  const status = await execGit(['status', '--short'])
  
  showGitLogDialog({ log, diff, status })
}} />

// 按钮 2: Fork/合并
<GitForkButton onClick={() => {
  showGitForkDialog({
    onFork: (branchName) => createWorktree(branchName),
    onMerge: (sourceBranch) => mergeBranch(sourceBranch)
  })
}} />
```

**Git 日志对话框**：
```typescript
<GitLogDialog>
  <Tabs>
    <Tab title="Log">
      <CommitList commits={commits} />
    </Tab>
    <Tab title="Diff">
      <DiffViewer diff={diff} />
    </Tab>
    <Tab title="Status">
      <StatusList files={files} />
    </Tab>
  </Tabs>
  
  <Actions>
    <Button onClick={stage}>Stage</Button>
    <Button onClick={commit}>Commit</Button>
  </Actions>
</GitLogDialog>
```

**学习要点**：
- ✅ 分离只读和写操作
- ✅ Git 日志支持暂存和提交
- ✅ Fork 操作集成 Worktree
- ✅ 合并操作检测冲突

---

### 3. 工具调用可视化（Tool Call Visualization）

**显示内容**：
```typescript
interface ToolCallDisplay {
  toolName: string
  command: string
  duration: number
  output: string
  error?: string
  exitCode?: number
}

// 示例显示
<ToolCallCard>
  <Header>
    <ToolIcon name="Bash" />
    <ToolName>Bash</ToolName>
    <Duration>1.2s</Duration>
  </Header>
  
  <Command>git status --short</Command>
  
  <Output collapsed={output.length > 500}>
    {output}
  </Output>
  
  {error && <Error>{error}</Error>}
  
  <Actions>
    <Button onClick={copyCommand}>Copy</Button>
    <Button onClick={rerun}>Re-run</Button>
  </Actions>
</ToolCallCard>
```

**折叠长输出**：
```typescript
function ToolCallOutput({ output }: { output: string }) {
  const [collapsed, setCollapsed] = useState(output.length > 500)
  
  return (
    <div>
      {collapsed ? (
        <>
          <pre>{output.slice(0, 500)}...</pre>
          <Button onClick={() => setCollapsed(false)}>
            Show {output.length - 500} more characters
          </Button>
        </>
      ) : (
        <pre>{output}</pre>
      )}
    </div>
  )
}
```

**学习要点**：
- ✅ 显示工具名、命令、耗时
- ✅ 长输出自动折叠
- ✅ 支持复制命令
- ✅ 支持重新运行

---

### 4. 会话管理（Session Management）

**会话列表**：
```typescript
interface Session {
  id: string
  title: string
  createdAt: Date
  lastModified: Date
  messageCount: number
  model: string
  worktree?: string
}

<SessionList>
  {sessions.map(session => (
    <SessionCard
      key={session.id}
      session={session}
      onClick={() => loadSession(session.id)}
      onDelete={() => deleteSession(session.id)}
      onRename={() => renameSession(session.id)}
    />
  ))}
</SessionList>
```

**会话拖拽排序**：
```typescript
import { DndContext, closestCenter } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'

<DndContext onDragEnd={handleDragEnd}>
  <SortableContext items={sessions} strategy={verticalListSortingStrategy}>
    {sessions.map(session => (
      <SortableSessionCard key={session.id} session={session} />
    ))}
  </SortableContext>
</DndContext>
```

**学习要点**：
- ✅ 会话列表显示
- ✅ 拖拽排序（使用 @dnd-kit）
- ✅ 会话重命名
- ✅ 会话删除（带确认）

---

### 5. 监察者可视化（Monitor Visualization）

**监察者状态**：
```typescript
type MonitorStatus = 'running' | 'stopped' | 'interrupted' | 'error'

interface MonitorState {
  status: MonitorStatus
  currentTask?: string
  progress?: number
  error?: string
  logs: string[]
}

<MonitorWidget>
  <StatusBadge status={state.status} />
  
  {state.currentTask && (
    <CurrentTask>{state.currentTask}</CurrentTask>
  )}
  
  {state.progress !== undefined && (
    <ProgressBar value={state.progress} />
  )}
  
  <Actions>
    <Button onClick={start} disabled={state.status === 'running'}>
      Start
    </Button>
    <Button onClick={stop} disabled={state.status === 'stopped'}>
      Stop
    </Button>
    <Button onClick={interrupt}>
      Interrupt
    </Button>
  </Actions>
  
  <LogViewer logs={state.logs} />
</MonitorWidget>
```

**实时日志流**：
```typescript
// 使用 WebSocket 实时推送日志
const ws = new WebSocket('/api/monitor/logs')

ws.onmessage = (event) => {
  const log = JSON.parse(event.data)
  appendLog(log)
}
```

**学习要点**：
- ✅ 状态徽章（running/stopped/interrupted）
- ✅ 当前任务显示
- ✅ 进度条
- ✅ 实时日志流

---

### 6. 项目拖拽排序（Project Drag Sorting）

**实现方案**：
```typescript
import { DndContext } from '@dnd-kit/core'
import { SortableContext, arrayMove } from '@dnd-kit/sortable'

function ProjectList() {
  const [projects, setProjects] = useState(loadProjects())
  
  function handleDragEnd(event) {
    const { active, over } = event
    if (active.id !== over.id) {
      setProjects((items) => {
        const oldIndex = items.findIndex(i => i.id === active.id)
        const newIndex = items.findIndex(i => i.id === over.id)
        const newOrder = arrayMove(items, oldIndex, newIndex)
        saveProjectOrder(newOrder)
        return newOrder
      })
    }
  }
  
  return (
    <DndContext onDragEnd={handleDragEnd}>
      <SortableContext items={projects}>
        {projects.map(project => (
          <SortableProjectCard key={project.id} project={project} />
        ))}
      </SortableContext>
    </DndContext>
  )
}
```

**学习要点**：
- ✅ 使用 @dnd-kit/core
- ✅ 拖拽后保存顺序
- ✅ 支持分组（可选）

---

### 7. 错误提示优化（Error Prompt Optimization）

**错误分类**：
```typescript
type ErrorType = 
  | 'network'      // 网络错误
  | 'api'          // API 错误
  | 'timeout'      // 超时
  | 'permission'   // 权限错误
  | 'validation'   // 验证错误
  | 'unknown'      // 未知错误

interface ErrorInfo {
  type: ErrorType
  message: string
  details?: string
  suggestion?: string
  retryable: boolean
}
```

**错误提示组件**：
```typescript
<ErrorAlert error={error}>
  <ErrorIcon type={error.type} />
  
  <ErrorMessage>{error.message}</ErrorMessage>
  
  {error.details && (
    <ErrorDetails>{error.details}</ErrorDetails>
  )}
  
  {error.suggestion && (
    <Suggestion>{error.suggestion}</Suggestion>
  )}
  
  <Actions>
    {error.retryable && (
      <Button onClick={retry}>Retry</Button>
    )}
    <Button onClick={dismiss}>Dismiss</Button>
    <Button onClick={reportBug}>Report Bug</Button>
  </Actions>
</ErrorAlert>
```

**学习要点**：
- ✅ 错误分类（不同图标和颜色）
- ✅ 详细信息（可展开）
- ✅ 建议操作
- ✅ 重试按钮（如果可重试）

---

### 8. 代码块展开/折叠（Code Block Expand/Collapse）

**实现方案**：
```typescript
function CodeBlock({ code, language }: { code: string; language: string }) {
  const [collapsed, setCollapsed] = useState(code.split('\n').length > 20)
  const [copied, setCopied] = useState(false)
  
  const displayCode = collapsed 
    ? code.split('\n').slice(0, 20).join('\n') + '\n...'
    : code
  
  return (
    <div className="code-block">
      <Header>
        <Language>{language}</Language>
        <Actions>
          <Button onClick={() => copyToClipboard(code)}>
            {copied ? 'Copied!' : 'Copy'}
          </Button>
          {code.split('\n').length > 20 && (
            <Button onClick={() => setCollapsed(!collapsed)}>
              {collapsed ? 'Expand' : 'Collapse'}
            </Button>
          )}
        </Actions>
      </Header>
      
      <SyntaxHighlighter language={language}>
        {displayCode}
      </SyntaxHighlighter>
    </div>
  )
}
```

**学习要点**：
- ✅ 超过 20 行自动折叠
- ✅ 显示语言标签
- ✅ 复制按钮
- ✅ 展开/折叠按钮

---

## 二、剩余功能学习

### 1. 全局搜索（Global Search）

**搜索范围**：
- 章节标题和内容
- 设定集
- 消息历史
- 文件名

**实现方案**：
```typescript
// 使用 SQLite FTS5 全文搜索
CREATE VIRTUAL TABLE search_index USING fts5(
  type,        -- 'chapter' | 'setting' | 'message' | 'file'
  title,
  content,
  bookId,
  timestamp
);

// 搜索 API
async function search(query: string, type?: string) {
  const sql = `
    SELECT * FROM search_index
    WHERE search_index MATCH ?
    ${type ? 'AND type = ?' : ''}
    ORDER BY rank
    LIMIT 50
  `
  return db.all(sql, type ? [query, type] : [query])
}
```

**搜索 UI**：
```typescript
<SearchDialog>
  <SearchInput
    placeholder="Search chapters, settings, messages..."
    value={query}
    onChange={setQuery}
  />
  
  <Filters>
    <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>
      All
    </FilterButton>
    <FilterButton active={filter === 'chapter'} onClick={() => setFilter('chapter')}>
      Chapters
    </FilterButton>
    <FilterButton active={filter === 'setting'} onClick={() => setFilter('setting')}>
      Settings
    </FilterButton>
    <FilterButton active={filter === 'message'} onClick={() => setFilter('message')}>
      Messages
    </FilterButton>
  </Filters>
  
  <SearchResults>
    {results.map(result => (
      <SearchResultCard
        key={result.id}
        result={result}
        onClick={() => jumpTo(result)}
      />
    ))}
  </SearchResults>
</SearchDialog>
```

**学习要点**：
- ✅ 使用 SQLite FTS5 全文搜索
- ✅ 支持类型过滤
- ✅ 高亮匹配文本
- ✅ 快捷键（Cmd+K）

---

### 2. 全供应商模型选择（Multi-Provider Model Selection）

**供应商列表**：
```typescript
interface Provider {
  id: string
  name: string
  models: Model[]
  apiKeyRequired: boolean
  baseUrl?: string
}

const providers: Provider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: [
      { id: 'claude-opus-4-7', name: 'Claude Opus 4.7' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
    ],
    apiKeyRequired: true
  },
  {
    id: 'openai',
    name: 'OpenAI',
    models: [
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
      { id: 'gpt-4', name: 'GPT-4' },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
    ],
    apiKeyRequired: true
  },
  // ...
]
```

**模型选择器**：
```typescript
<ModelPicker>
  <ProviderSelect
    value={selectedProvider}
    onChange={setSelectedProvider}
  >
    {providers.map(provider => (
      <option key={provider.id} value={provider.id}>
        {provider.name}
      </option>
    ))}
  </ProviderSelect>
  
  <ModelSelect
    value={selectedModel}
    onChange={setSelectedModel}
  >
    {currentProvider.models.map(model => (
      <option key={model.id} value={model.id}>
        {model.name}
      </option>
    ))}
  </ModelSelect>
  
  {currentProvider.apiKeyRequired && !hasApiKey && (
    <ApiKeyInput
      placeholder="Enter API key..."
      value={apiKey}
      onChange={setApiKey}
    />
  )}
</ModelPicker>
```

**学习要点**：
- ✅ 支持多个供应商
- ✅ 动态加载模型列表
- ✅ API Key 管理
- ✅ 自定义 Base URL（可选）

---

## 三、总结与工时估算

### P2 功能工时（38h）

| 功能 | 工时 | 优先级 |
|------|------|--------|
| 会话管理 | 10h | P2 |
| 监察者可视化 | 8h | P2 |
| 项目拖拽排序 | 6h | P2 |
| 工具调用筛选 | 6h | P2 |
| 代码块展开/折叠 | 4h | P2 |
| 错误提示优化 | 4h | P2 |

### 剩余功能工时（18h）

| 功能 | 工时 | 优先级 |
|------|------|--------|
| 全局搜索 | 8h | P1 |
| 全供应商模型选择 | 10h | P1 |

### 总计

- **P0**: 98h（已完成）
- **P1**: 72h（配置系统）
- **P2**: 38h（体验优化）
- **剩余**: 18h（搜索+模型）
- **总计**: 226h（约 5-6 周，2 人并行约 3 周）

---

**文档结束**
