# Claude Code P1 配置系统学习

**分析日期**: 2026-04-18  
**目标**: 为 InkOS Phase 4 P1 功能提供实现参考

---

## 一、Settings 架构总览

### 1. 三层 Tab 结构

```typescript
// Settings.tsx - 主容器
<Tabs>
  <Tab title="Status">   // 状态信息
  <Tab title="Config">   // 配置项（1821 行）
  <Tab title="Usage">    // 使用统计
</Tabs>
```

**特点**：
- ✅ 固定高度（`contentHeight`）避免切换 Tab 时布局抖动
- ✅ 使用 `Suspense` 延迟加载 Config（性能优化）
- ✅ Esc 键处理分层（Tab header / Config search / Settings close）

### 2. Config.tsx 核心设计（1821 行）

**数据结构**：
```typescript
type Setting = 
  | { type: 'boolean'; value: boolean; onChange(v: boolean): void }
  | { type: 'enum'; value: string; options: string[]; onChange(v: string): void }
  | { type: 'managedEnum'; value: string; onChange(v: string): void }
```

**关键特性**：
1. **搜索模式**（Search Mode）
   - 实时过滤配置项
   - 支持模糊匹配
   - Esc 退出搜索

2. **子菜单系统**（SubMenu）
   - Theme Picker
   - Model Picker
   - Output Style Picker
   - Language Picker
   - 等等

3. **变更追踪**（Change Tracking）
   - 记录所有修改
   - Esc 回滚所有变更
   - 实时保存到配置文件

---

## 二、权限系统（Permission System）

### 1. 权限规则（Permission Rules）

**来源优先级**（从高到低）：
```typescript
const PERMISSION_RULE_SOURCES = [
  'managedSettings',  // 管理员配置（最高优先级）
  'projectSettings',  // 项目配置
  'userSettings',     // 用户配置
  'localSettings',    // 本地配置
  'cliArg',          // 命令行参数
  'command',         // 命令级别
  'session',         // 会话级别
]
```

**规则行为**：
```typescript
type PermissionBehavior = 
  | 'allow'      // 自动允许
  | 'deny'       // 自动拒绝
  | 'ask'        // 询问用户
  | 'passthrough' // 传递给下一层
```

### 2. 权限决策流程

```
1. 检查 alwaysAllowRules（各来源）
   ↓ 未匹配
2. 检查 Hook（PreToolUse）
   ↓ 未拦截
3. 检查 Classifier（AI 分类器）
   ↓ 未拦截
4. 检查 Permission Mode（auto/plan/default）
   ↓
5. 最终决策（allow/deny/ask）
```

### 3. 权限提示消息

```typescript
function createPermissionRequestMessage(
  toolName: string,
  decisionReason?: PermissionDecisionReason
): string {
  // 根据不同原因生成不同提示
  switch (decisionReason.type) {
    case 'classifier':
      return `Classifier '${name}' requires approval: ${reason}`
    case 'hook':
      return `Hook '${hookName}' blocked: ${reason}`
    case 'rule':
      return `Permission rule '${rule}' from ${source} requires approval`
    case 'mode':
      return `Current permission mode (${mode}) requires approval`
    // ...
  }
}
```

---

## 三、MCP 工具集成

### 1. MCP Server 管理

**核心概念**：
- MCP (Model Context Protocol) 是外部工具协议
- 每个 MCP Server 提供一组工具
- 工具名格式：`mcp__<server-name>__<tool-name>`

**示例**：
```typescript
// MCP 工具名解析
function mcpInfoFromString(toolName: string) {
  // "mcp__chrome-devtools__take_screenshot"
  // → { serverName: "chrome-devtools", toolName: "take_screenshot" }
}
```

### 2. MCP Server 审批流程

```typescript
// 首次使用 MCP Server 时需要审批
<MCPServerApprovalDialog
  serverName="chrome-devtools"
  tools={['take_screenshot', 'navigate_page', ...]}
  onApprove={() => { /* 保存到配置 */ }}
  onDeny={() => { /* 拒绝使用 */ }}
/>
```

---

## 四、Skills 系统

### 1. Skill 定义

**Skill 是预定义的工作流**：
```markdown
---
name: commit
description: Create a git commit
---

# Instructions
1. Run git status
2. Stage relevant files
3. Create commit with message
```

### 2. Skill 类型

| 类型 | 位置 | 优先级 |
|------|------|--------|
| **Built-in Skills** | 内置 | 最低 |
| **Plugin Skills** | 插件提供 | 低 |
| **User Skills** | `~/.claude/skills/` | 中 |
| **Project Skills** | `.claude/skills/` | 高 |
| **Managed Skills** | 管理员配置 | 最高 |

### 3. Skill 调用

```typescript
// 用户输入：/commit
// → 触发 Skill tool
Skill({ skill: "commit", args: "..." })
```

---

## 五、Routines 系统（套路）

### 1. Routines 是什么？

**Routines = 可配置的行为模式**：
- Commands（自定义命令）
- Tool Permissions（工具权限）
- Skills（技能）
- Sub-agents（子代理）
- Prompts（提示词）
- MCP Tools（MCP 工具）

### 2. Routines 配置结构

```typescript
interface Routines {
  commands: Command[]
  tools: { name: string; enabled: boolean }[]
  permissions: { tool: string; permission: 'allow' | 'deny' }[]
  globalSkills: Skill[]
  projectSkills: Skill[]
  subAgents: SubAgent[]
  globalPrompts: Prompt[]
  systemPrompts: Prompt[]
  mcpTools: MCPTool[]
}
```

---

## 六、Admin 管理面板

### 1. 管理模块

| 模块 | 功能 | 实现方式 |
|------|------|---------|
| **Users** | 用户管理 | 多用户支持 |
| **Providers** | API 供应商管理 | API Key 配置 |
| **Terminals** | 终端进程管理 | 进程监控 |
| **Containers** | 容器管理 | Docker 集成 |
| **Storage** | 存储空间监控 | 磁盘占用 |
| **Resources** | 运行资源监控 | CPU/内存/网络 |
| **Requests** | API 请求历史 | 日志追溯 |

### 2. 资源监控

```typescript
// 实时监控（WebSocket）
interface ResourceStats {
  cpu: { usage: number; cores: number }
  memory: { used: number; total: number }
  network: { sent: number; received: number }
}

// 每秒更新
ws.on('resource-stats', (stats: ResourceStats) => {
  updateUI(stats)
})
```

---

## 七、对 InkOS 的具体建议

### Agent 5: 设置页面 Agent（16h）

**必须实现**：
1. ✅ 三层 Tab 结构（Status/Config/Usage）
2. ✅ 搜索模式（实时过滤配置项）
3. ✅ 变更追踪（Esc 回滚）
4. ✅ 子菜单系统（Theme/Model/Language）

**数据结构**：
```typescript
// 配置项定义
const settings: Setting[] = [
  {
    id: 'autoSave',
    label: '自动保存',
    type: 'boolean',
    value: true,
    onChange: (v) => updateSettings({ autoSave: v })
  },
  {
    id: 'theme',
    label: '主题',
    type: 'enum',
    value: 'dark',
    options: ['light', 'dark', 'auto'],
    onChange: (v) => updateSettings({ theme: v })
  }
]
```

**参考文件**：
- `src/components/Settings/Settings.tsx` (137 行)
- `src/components/Settings/Config.tsx` (1821 行)

---

### Agent 6: 套路系统 Agent（20h）

**必须实现**：
1. ✅ 9 个标签页（Commands/Tools/Permissions/Skills/...）
2. ✅ 全局/项目两级配置
3. ✅ 工具权限细粒度控制
4. ✅ 自定义扩展支持

**数据结构**：
```typescript
interface ToolPermission {
  tool: string
  permission: 'allow' | 'deny' | 'ask'
  pattern?: string  // 匹配模式（如 "git *"）
  source: 'user' | 'project' | 'managed'
}
```

**参考设计**：
- 权限规则优先级（managed > project > user）
- 模式匹配（支持通配符）
- 实时生效（无需重启）

---

### Agent 7: 管理面板 Agent（18h）

**必须实现**：
1. ✅ 用户管理（多用户支持）
2. ✅ API 供应商管理（Key 配置）
3. ✅ 资源监控（CPU/内存/网络）
4. ✅ 请求历史（日志追溯）

**可选实现**：
- ⚠️ 终端进程管理
- ⚠️ 容器管理（Docker）
- ⚠️ 存储空间监控

**技术方案**：
```typescript
// WebSocket 实时监控
const ws = new WebSocket('/api/admin/resources')
ws.onmessage = (event) => {
  const stats = JSON.parse(event.data)
  updateResourceChart(stats)
}
```

---

## 八、关键设计模式

### 1. 配置来源分层

```
Managed Settings (管理员)
    ↓ 覆盖
Project Settings (项目)
    ↓ 覆盖
User Settings (用户)
    ↓ 覆盖
Local Settings (本地)
    ↓ 覆盖
Default Settings (默认)
```

### 2. 变更追踪与回滚

```typescript
// 保存初始状态
const [initialState] = useState(() => getSettings())

// 追踪变更
const [changes, setChanges] = useState<Record<string, any>>({})

// Esc 回滚
function revertChanges() {
  applySettings(initialState)
  setChanges({})
}
```

### 3. 权限决策缓存

```typescript
// 避免重复计算
const permissionCache = new Map<string, PermissionDecision>()

function checkPermission(tool: string, args: any): PermissionDecision {
  const key = `${tool}:${JSON.stringify(args)}`
  if (permissionCache.has(key)) {
    return permissionCache.get(key)!
  }
  const decision = computePermission(tool, args)
  permissionCache.set(key, decision)
  return decision
}
```

---

## 九、性能优化技巧

### 1. 延迟加载

```typescript
// Config 组件很大（1821 行），使用 Suspense 延迟加载
<Suspense fallback={<Spinner />}>
  <Config />
</Suspense>
```

### 2. 搜索防抖

```typescript
// 搜索输入防抖（避免每次按键都过滤）
const debouncedSearch = useMemo(
  () => debounce((query: string) => {
    setFilteredSettings(filterSettings(query))
  }, 300),
  []
)
```

### 3. 虚拟滚动

```typescript
// 配置项很多时使用虚拟滚动
<VirtualList
  items={filteredSettings}
  itemHeight={40}
  renderItem={(setting) => <SettingRow setting={setting} />}
/>
```

---

## 十、安全最佳实践

### 1. 权限规则验证

```typescript
// 验证权限规则格式
function validatePermissionRule(rule: string): boolean {
  // 防止注入攻击
  if (rule.includes('..') || rule.includes('~')) {
    return false
  }
  // 验证通配符格式
  if (rule.includes('*') && !isValidGlob(rule)) {
    return false
  }
  return true
}
```

### 2. API Key 加密存储

```typescript
// 不要明文存储 API Key
function saveApiKey(key: string) {
  const encrypted = encrypt(key, getUserSecret())
  saveToConfig({ apiKey: encrypted })
}
```

### 3. 权限提升审计

```typescript
// 记录所有权限变更
function updatePermission(tool: string, permission: Permission) {
  logAudit({
    action: 'permission_changed',
    tool,
    from: getCurrentPermission(tool),
    to: permission,
    timestamp: Date.now(),
    user: getCurrentUser()
  })
  applyPermission(tool, permission)
}
```

---

**文档结束**
