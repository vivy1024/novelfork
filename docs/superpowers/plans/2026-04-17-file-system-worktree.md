# Implementation Plan: InkOS Studio AI 工具系统 + Git Worktree 多线并行

**创建日期**: 2026-04-17  
**修订日期**: 2026-04-17  
**状态**: 待实施  
**优先级**: P0（核心竞争力）  
**预计工时**: 49 小时

## 概述

为 InkOS Studio 添加 AI Agent 工具系统，参考 Claude Code 和 NarraFork 的架构：

1. **AI 工具系统**：让 LLM 通过工具调用操作文件（Read/Write/Glob/Grep/Bash）
2. **Git Worktree 多线并行**：基于 git worktree 实现多分支同时工作，完成后合并
3. **工具结果可视化**：在对话中显示工具调用和结果
4. **AI 提供商管理**：支持多个 AI 提供商（Anthropic、OpenAI、NKP、NUG、Cline），模型池管理，拖拽排序
5. **Agent 配置管理**：工作区限制、容器管理、资源监控、端口范围配置

**关键理解**：
- ❌ 不需要文件浏览器 UI（那是给用户的，不是给 AI 的）
- ✅ AI 通过工具调用（Tool Use）操作文件系统
- ✅ 工具结果显示在对话流中
- ✅ Worktree 管理有 UI（卡片式展示）

参考架构：
- Claude Code: 完整的工具系统实现
- NarraFork: Worktree 管理 UI 和文件监控

## 需求确认

### AI 工具系统需求（参考 Claude Code）
**核心工具**：
- `Read` - 读取文件内容（支持行范围、PDF、图片、Notebook）
- `Write` - 写入文件（创建新文件）
- `Edit` - 编辑文件（精确字符串替换）
- `Glob` - 文件名模式匹配（如 `**/*.ts`）
- `Grep` - 内容搜索（正则表达式）
- `Bash` - 执行 shell 命令

**工具特性**：
- 工具调用通过 LLM API 的 tool_use 机制
- 工具结果返回给 LLM 继续推理
- 前端显示工具调用卡片和结果
- 权限系统：用户批准/拒绝工具调用

### Worktree 需求（参考 NarraFork）
**核心功能**：
- `EnterWorktree` 工具 - AI 创建并进入 worktree
- `ExitWorktree` 工具 - AI 退出 worktree
- Worktree 管理 UI - 卡片式展示所有 worktree
- 文件监控 - 实时监控 worktree 文件变化
- Diff 可视化 - 显示文件修改
- 合并助手 - AI 辅助合并冲突

**UI 需求**：
- Worktree 卡片（显示路径、分支、状态）
- 文件修改面板（diff 查看）
- 创建 worktree 弹窗（简单表单）

### 约束
- 最小改动原则，不重构现有代码
- 工具系统是 Worktree 的前置依赖
- Windows 环境兼容（路径分隔符、Git 命令）
- Git 操作需要错误处理和状态验证
- 安全边界：禁止访问工作空间外的文件
- 工具调用需要权限验证

## 架构变更

### 后端新增文件（Hono 路由 + 工具实现）

**工具系统核心**：
- `packages/studio/src/api/lib/tools/` - 工具实现目录
  - `ReadTool.ts` - 读取文件工具
  - `WriteTool.ts` - 写入文件工具
  - `EditTool.ts` - 编辑文件工具
  - `GlobTool.ts` - 文件匹配工具
  - `GrepTool.ts` - 内容搜索工具
  - `BashTool.ts` - Shell 命令工具
  - `EnterWorktreeTool.ts` - 进入 worktree 工具
  - `ExitWorktreeTool.ts` - 退出 worktree 工具
  - `index.ts` - 工具注册和导出

**工具基础设施**：
- `packages/studio/src/api/lib/tool-executor.ts` - 工具执行器
- `packages/studio/src/api/lib/permission-manager.ts` - 权限管理器
- `packages/studio/src/api/lib/git-utils.ts` - Git 命令封装
- `packages/studio/src/api/lib/file-utils.ts` - 文件操作工具

**API 路由**：
- `packages/studio/src/api/routes/tools.ts` - 工具调用 API
- `packages/studio/src/api/routes/worktree.ts` - Worktree 管理 API

### 前端新增文件（React 组件）

**工具结果展示**：
- `packages/studio/src/components/ToolUseCard.tsx` - 工具调用卡片
- `packages/studio/src/components/ToolResultCard.tsx` - 工具结果卡片
- `packages/studio/src/components/PermissionPrompt.tsx` - 权限请求弹窗

**Worktree 管理**：
- `packages/studio/src/pages/WorktreeManager.tsx` - Worktree 管理器页面
- `packages/studio/src/components/WorktreeCard.tsx` - Worktree 卡片
- `packages/studio/src/components/FileModPanel.tsx` - 文件修改面板
- `packages/studio/src/components/DiffViewer.tsx` - Diff 可视化

**Hooks**：
- `packages/studio/src/hooks/use-tools.ts` - 工具调用 Hook
- `packages/studio/src/hooks/use-worktree.ts` - Worktree 状态管理
- `packages/studio/src/hooks/use-file-watcher.ts` - 文件监控 Hook

## 实施步骤

### Phase 1: 工具系统基础设施（3 文件，复杂度：中）

**1.1 创建工具执行器**（文件：`src/api/lib/tool-executor.ts`）
- Action: 实现工具注册、调用、结果处理
- Why: 统一工具执行流程，处理错误和权限
- Dependencies: 无
- Risk: 中 — 需要设计灵活的工具接口

**1.2 创建权限管理器**（文件：`src/api/lib/permission-manager.ts`）
- Action: 实现权限请求、批准/拒绝、规则匹配
- Why: 安全控制，防止 AI 执行危险操作
- Dependencies: 无
- Risk: 高 — 权限规则设计需要平衡安全和易用性

**1.3 创建文件操作工具库**（文件：`src/api/lib/file-utils.ts`）
- Action: 实现 `readFile`、`writeFile`、`editFile`、`validatePath`
- Why: 封装 Node.js fs 操作，统一错误处理和路径验证
- Dependencies: 无
- Risk: 高 — 路径遍历攻击风险，需严格验证路径在工作空间内

### Phase 2: 核心工具实现（6 文件，复杂度：中）

**2.1 实现 Read 工具**（文件：`src/api/lib/tools/ReadTool.ts`）
- Action: 读取文件内容，支持行范围、编码检测
- Why: AI 查看文件内容的基础能力
- Dependencies: 1.3
- Risk: 中 — 大文件性能问题，需要分页或限制

**2.2 实现 Write 工具**（文件：`src/api/lib/tools/WriteTool.ts`）
- Action: 创建新文件，覆盖写入
- Why: AI 创建文件的能力
- Dependencies: 1.3
- Risk: 中 — 覆盖现有文件需要警告

**2.3 实现 Edit 工具**（文件：`src/api/lib/tools/EditTool.ts`）
- Action: 精确字符串替换（old_string → new_string）
- Why: AI 修改文件的主要方式
- Dependencies: 1.3
- Risk: 高 — 字符串匹配失败处理，需要清晰的错误提示

**2.4 实现 Glob 工具**（文件：`src/api/lib/tools/GlobTool.ts`）
- Action: 文件名模式匹配（如 `**/*.ts`）
- Why: AI 查找文件
- Dependencies: 无
- Risk: 低 — 使用成熟的 glob 库

**2.5 实现 Grep 工具**（文件：`src/api/lib/tools/GrepTool.ts`）
- Action: 内容搜索（正则表达式）
- Why: AI 搜索代码
- Dependencies: 无
- Risk: 中 — 正则表达式性能问题

**2.6 实现 Bash 工具**（文件：`src/api/lib/tools/BashTool.ts`）
- Action: 执行 shell 命令，返回输出
- Why: AI 执行命令（如 npm install、git status）
- Dependencies: 无
- Risk: 高 — 命令注入风险，需要严格权限控制

### Phase 3: 工具 API 集成（2 文件，复杂度：低）

**3.1 创建工具路由**（文件：`src/api/routes/tools.ts`）
- Action: 实现 `POST /api/tools/execute` 端点
- Why: 前端调用工具的 API
- Dependencies: Phase 1, Phase 2
- Risk: 低

**3.2 集成到 server.ts**（文件：`src/api/server.ts`）
- Action: 挂载 `createToolsRouter()`
- Why: 注册路由到 Hono 应用
- Dependencies: 3.1
- Risk: 低

### Phase 4: 前端工具展示（3 文件，复杂度：中）

**4.1 创建工具调用卡片**（文件：`src/components/ToolUseCard.tsx`）
- Action: 显示工具名称、参数、状态（pending/success/error）
- Why: 用户看到 AI 正在做什么
- Dependencies: 无
- Risk: 低

**4.2 创建工具结果卡片**（文件：`src/components/ToolResultCard.tsx`）
- Action: 显示工具返回结果（文本/代码/diff）
- Why: 用户看到工具执行结果
- Dependencies: 无
- Risk: 低

**4.3 创建权限请求弹窗**（文件：`src/components/PermissionPrompt.tsx`）
- Action: 显示工具调用详情，批准/拒绝按钮
- Why: 用户控制 AI 行为
- Dependencies: 无
- Risk: 中 — 需要清晰的 UI 设计

### Phase 5: Git Worktree 后端（3 文件，复杂度：高）

**5.1 创建 Git 工具库**（文件：`src/api/lib/git-utils.ts`）
- Action: 封装 Git 命令
  - `execGit(args: string[], cwd: string)` — 执行 Git 命令
  - `listWorktrees(root: string)` — 解析 `git worktree list --porcelain`
  - `createWorktree(root, name, branch?)` — `git worktree add`
  - `removeWorktree(root, path)` — `git worktree remove`
  - `getWorktreeStatus(path)` — `git status --porcelain`
  - `getDiff(path, base, target)` — `git diff`
- Why: 统一 Git 操作，处理 Windows 路径和错误
- Dependencies: 无
- Risk: 高 — Git 命令失败处理、Windows 路径转义、并发安全

**5.2 实现 EnterWorktree 工具**（文件：`src/api/lib/tools/EnterWorktreeTool.ts`）
- Action: 创建 worktree，切换工作目录，返回路径和分支
- Why: AI 创建隔离的工作环境
- Dependencies: 5.1
- Risk: 高 — 需要管理会话状态，记录当前 worktree

**5.3 实现 ExitWorktree 工具**（文件：`src/api/lib/tools/ExitWorktreeTool.ts`）
- Action: 退出 worktree，可选删除或保留
- Why: AI 清理工作环境
- Dependencies: 5.1
- Risk: 中 — 需要检查未提交更改

### Phase 6: Worktree 管理 UI（4 文件，复杂度：高）

**6.1 创建 Worktree Hook**（文件：`src/hooks/use-worktree.ts`）
- Action: 管理 worktree 列表、创建/删除操作、轮询状态
- Why: 封装 API 调用和状态管理
- Dependencies: 无
- Risk: 低

**6.2 创建文件监控 Hook**（文件：`src/hooks/use-file-watcher.ts`）
- Action: WebSocket 监听文件变化事件
- Why: 实时显示文件修改
- Dependencies: 无
- Risk: 中 — WebSocket 连接管理

**6.3 创建 Worktree 卡片组件**（文件：`src/components/WorktreeCard.tsx`）
- Action: 显示单个 worktree 信息（分支、路径、状态、操作按钮）
- Why: 可复用的 UI 单元
- Dependencies: 无
- Risk: 低

**6.4 创建 Worktree 管理器页面**（文件：`src/pages/WorktreeManager.tsx`）
- Action: 列表展示所有 worktree，顶部创建按钮，卡片操作（删除）
- Why: Worktree 管理入口
- Dependencies: 6.1, 6.3
- Risk: 中 — 需要处理 worktree 状态同步

### Phase 7: 文件修改面板（2 文件，复杂度：中）

**7.1 创建 Diff 可视化组件**（文件：`src/components/DiffViewer.tsx`）
- Action: 显示文件 diff（行号、添加/删除高亮）
- Why: 可视化文件变化
- Dependencies: 无
- Risk: 中 — 需要解析 diff 格式

**7.2 创建文件修改面板**（文件：`src/components/FileModPanel.tsx`）
- Action: 列表显示修改的文件，点击查看 diff
- Why: 用户查看 AI 修改了什么
- Dependencies: 7.1
- Risk: 低

### Phase 8: 集成与测试（2 文件，复杂度：中）

**8.1 更新导航路由**（文件：`src/App.tsx`）
- Action: 添加 `/worktree` 路由
- Why: 使新页面可访问
- Dependencies: Phase 6
- Risk: 低

**8.2 编写集成测试**（文件：`src/api/__tests__/tools-worktree.test.ts`）
- Action: 测试工具调用 + worktree 创建/删除流程
- Why: 确保核心功能可靠
- Dependencies: Phase 1-7
- Risk: 中 — 需要 mock Git 环境

### Phase 9: AI 提供商与 Agent 配置管理（7 文件，复杂度：中）

**9.1 创建提供商管理服务**（文件：`src/api/lib/provider-manager.ts`）
- Action: 实现提供商 CRUD、排序、启用/禁用、模型池管理
  - `listProviders()` — 获取所有提供商及其模型
  - `updateProvider(id, config)` — 更新提供商配置
  - `toggleProvider(id, enabled)` — 启用/禁用提供商
  - `reorderProviders(ids)` — 拖拽排序
  - `getModelPool()` — 获取所有可用模型（跨提供商）
  - `testProviderConnection(id)` — 测试提供商连通性
- Why: 统一管理多个 AI 提供商（Anthropic、OpenAI 两种协议）
- Dependencies: 无
- Risk: 中 — 需要支持两种主流协议，API 密钥安全存储

**9.2 创建 Agent 配置服务**（文件：`src/api/lib/agent-config-service.ts`）
- Action: 实现 Agent 运行时配置管理
  - `getAgentConfig()` — 获取 Agent 配置
  - `updateAgentConfig(config)` — 更新配置
  - 配置项：
    - `maxActiveWorkspaces` — 最大活动工作区数量
    - `maxActiveContainers` — 最大活动容器数量
    - `workspaceSizeWarning` — 工作区大小警告阈值（MB）
    - `autoSaveOnSleep` — 休眠时自动保存
    - `portRangeStart` / `portRangeEnd` — 端口范围
- Why: 控制 Agent 资源使用，防止资源耗尽
- Dependencies: 无
- Risk: 中 — 需要验证配置合法性

**9.3 创建提供商管理 API**（文件：`src/api/routes/providers.ts`）
- Action: 实现提供商管理 REST API
  - `GET /api/providers` — 列出所有提供商
  - `PUT /api/providers/:id` — 更新提供商配置
  - `POST /api/providers/:id/toggle` — 启用/禁用
  - `POST /api/providers/reorder` — 拖拽排序
  - `GET /api/providers/models` — 获取模型池
  - `POST /api/providers/:id/test` — 测试连通性
- Why: 前端调用提供商管理功能
- Dependencies: 9.1
- Risk: 低

**9.4 创建 Agent 配置 API**（文件：`src/api/routes/agent-config.ts`）
- Action: 实现 Agent 配置 REST API
  - `GET /api/agent/config` — 获取配置
  - `PUT /api/agent/config` — 更新配置
- Why: 前端调用 Agent 配置功能
- Dependencies: 9.2
- Risk: 低

**9.5 创建提供商卡片组件**（文件：`src/components/ProviderCard.tsx`）
- Action: 显示单个提供商信息（名称、状态、模型数量、启用开关、配置按钮）
- Why: 可复用的提供商 UI 单元
- Dependencies: 无
- Risk: 低

**9.6 创建提供商管理页面**（文件：`src/pages/ProviderManager.tsx`）
- Action: 提供商管理主界面
  - 提供商列表（拖拽排序）
  - 启用/禁用开关
  - 配置弹窗（API 密钥、端点、超时、重试）
  - 模型池展示（59 个模型跨 7 个提供商）
  - 连通性测试按钮
- Why: 用户管理 AI 提供商的入口
- Dependencies: 9.5
- Risk: 中 — 拖拽排序需要处理状态同步

**9.7 创建 Agent 配置面板**（文件：`src/components/AgentConfigPanel.tsx`）
- Action: Agent 配置界面
  - 工作区限制（数量、大小警告）
  - 容器限制（数量）
  - 端口范围配置
  - 自动保存开关
  - 实时资源使用显示（当前活动工作区/容器数量）
- Why: 用户控制 Agent 资源使用
- Dependencies: 无
- Risk: 低

## 依赖关系图

```
Phase 1 (工具基础设施)
  └─> Phase 2 (核心工具实现)
        └─> Phase 3 (工具 API)
              └─> Phase 4 (前端展示)

Phase 5 (Worktree 后端)
  └─> Phase 6 (Worktree UI)
        └─> Phase 7 (文件修改面板)

Phase 9 (AI 提供商与 Agent 配置) 独立开发，不依赖其他 Phase

Phase 8 (集成测试) 依赖所有前面的 Phase

Phase 1-4、Phase 5-7、Phase 9 可并行开发
```

## 风险与缓解

### 风险 1：路径遍历攻击（高风险）
- **描述**：恶意路径参数（如 `../../etc/passwd`）访问工作空间外文件
- **缓解**：
  - 所有路径参数通过 `path.resolve` + `path.relative` 验证
  - 拒绝包含 `..` 的相对路径
  - 白名单验证：路径必须以 `root` 开头

### 风险 2：Git 命令注入（高风险）
- **描述**：用户输入的分支名包含特殊字符（如 `; rm -rf /`）
- **缓解**：
  - 使用 `child_process.execFile` 而非 `exec`（参数数组，不经过 shell）
  - 验证分支名格式（正则：`^[a-zA-Z0-9/_-]+$`）

### 风险 3：Worktree 路径冲突（中风险）
- **描述**：多个 worktree 使用相同路径或分支
- **缓解**：
  - 创建前检查路径是否已存在
  - 使用 `.inkos-worktrees/` 统一目录管理
  - 分支名自动加时间戳后缀（如 `feature-123-20260416`）

### 风险 4：合并冲突处理（高风险）
- **描述**：自动合并失败，用户不知如何解决
- **缓解**：
  - 合并前检查是否有未提交更改，强制要求 clean working tree
  - 冲突时返回详细错误信息和冲突文件列表
  - 提供"放弃合并"按钮（`git merge --abort`）
  - AI 辅助：分析冲突上下文，生成合并建议

### 风险 5：Windows 路径兼容性（中风险）
- **描述**：Windows 反斜杠路径导致 Git 命令失败
- **缓解**：
  - 统一使用 `path.posix.join` 生成 Git 路径
  - 执行 Git 命令前转换为正斜杠
  - 测试覆盖 Windows 环境

### 风险 6：大目录性能（中风险）
- **描述**：包含数千文件的目录导致前端卡顿
- **缓解**：
  - 后端分页返回（limit/offset）
  - 前端虚拟滚动（react-window）
  - 延迟加载子目录（点击展开时才请求）

### 风险 7：提供商 API 密钥安全（高风险）
- **描述**：API 密钥明文存储或传输导致泄露
- **缓解**：
  - 数据库加密存储（AES-256）
  - HTTPS 传输
  - 前端仅显示脱敏密钥（`sk-***abc`）
  - 密钥更新时强制重新输入完整密钥

### 风险 8：Agent 资源耗尽（高风险）
- **描述**：Agent 创建过多工作区/容器导致系统资源耗尽
- **缓解**：
  - 硬限制：最大工作区/容器数量（配置项）
  - 软警告：工作区大小超过阈值时提示
  - 自动清理：空闲超过 N 小时的工作区自动删除
  - 资源监控：实时显示当前资源使用情况

### 风险 9：提供商配置冲突（中风险）
- **描述**：多个提供商使用相同模型名称导致路由错误
- **缓解**：
  - 模型名称使用 `provider:model` 格式（如 `anthropic:claude-opus-4`）
  - 提供商优先级排序（拖拽调整）
  - 禁用的提供商不参与模型解析

## 成功标准

- [ ] AI 可以通过工具调用操作文件系统（Read/Write/Edit/Glob/Grep/Bash）
- [ ] AI 可以创建和管理 worktree（EnterWorktree/ExitWorktree）
- [ ] 用户可以在对话中看到工具调用和结果
- [ ] 用户可以批准/拒绝工具调用（权限系统）
- [ ] 用户可以创建 worktree（指定分支名）
- [ ] 用户可以在不同 worktree 间切换
- [ ] 用户可以删除 worktree
- [ ] 用户可以查看两个分支的 diff
- [ ] 用户可以合并分支（无冲突场景）
- [ ] 用户可以手动解决合并冲突
- [ ] AI 可以辅助生成合并建议
- [ ] 所有文件操作限制在工作空间内
- [ ] 所有 Git 操作有错误处理和回滚机制
- [ ] 用户可以管理多个 AI 提供商（Anthropic、OpenAI 两种协议）
- [ ] 用户可以启用/禁用提供商
- [ ] 用户可以拖拽排序提供商优先级
- [ ] 用户可以查看模型池（跨提供商）
- [ ] 用户可以配置 Agent 资源限制（工作区、容器、端口）
- [ ] 用户可以查看实时资源使用情况
- [ ] API 密钥加密存储，前端仅显示脱敏版本
- [ ] 单元测试覆盖率 ≥ 80%
- [ ] 在 Windows 环境下验证通过

## 复杂度估算

| Phase | 文件数 | 代码行数（估算） | 工时（小时） | 风险等级 |
|-------|--------|------------------|--------------|----------|
| Phase 1 | 3 | ~300 | 4 | 中 |
| Phase 2 | 6 | ~800 | 8 | 中 |
| Phase 3 | 2 | ~200 | 3 | 低 |
| Phase 4 | 3 | ~400 | 5 | 中 |
| Phase 5 | 3 | ~500 | 6 | 高 |
| Phase 6 | 4 | ~600 | 6 | 高 |
| Phase 7 | 2 | ~300 | 4 | 中 |
| Phase 8 | 2 | ~200 | 3 | 中 |
| Phase 9 | 7 | ~900 | 9 | 中 |
| **总计** | **32** | **~4200** | **48** | **高** |

## 实施顺序建议

**优先级 1**：Phase 1 → Phase 2 → Phase 3 → Phase 4（工具系统，独立可交付）
- 完成后 AI 可以操作文件系统
- 可以先测试工具调用流程

**优先级 2**：Phase 5 → Phase 6 → Phase 7（Worktree 系统，依赖工具系统）
- 完成后 AI 可以创建和管理 worktree
- 可以实现多线并行写作

**优先级 3**：Phase 9（AI 提供商与 Agent 配置，独立可交付）
- 完成后用户可以管理 AI 提供商（Anthropic、OpenAI 两种协议）
- 可以配置 Agent 资源限制
- 可以与 Phase 1-7 并行开发

**优先级 4**：Phase 8（集成测试）
- 确保整体功能可靠

每个 Phase 完成后立即测试，不等待全部完成。Phase 1-4 完成后即可交付工具系统，Phase 5-7 完成后交付 Worktree 功能，Phase 9 完成后交付提供商管理功能。

---

**计划状态**: Phase 1 和 Phase 9 已完成基础实现（2026-04-17）
- Phase 1: 工具执行器、权限管理器、文件操作工具库 ✅
- Phase 9: 提供商管理（Anthropic/OpenAI）、Agent 配置、前端组件 ✅
- 已简化为只支持 Anthropic 和 OpenAI 两种主流协议
