# NarraFork vs InkOS UI/UX 深度对比分析

**分析日期**: 2026-04-18  
**NarraFork 版本**: v0.1.17  
**InkOS 版本**: v2.0.0 (开发中)

---

## 核心架构差异

**NarraFork**: Git Worktree 驱动的多线并行协作系统  
**InkOS**: 单线 IDE + 10 Agent 写作管线

---

## 一、整体布局对比

### NarraFork 布局（Git Worktree 多线并行）

**三栏结构**：
- **左侧栏**（固定宽度 ~200px）：
  - 顶部：仪表盘、监察者开关（interrupted 状态）
  - 叙事线（项目列表）：可拖拽排序，主线 + Fork 分支
  - 叙述者（会话列表）：可拖拽排序，多个独立对话窗口
  - 底部：**管理**、**套路**、**设置**、退出登录
  
- **中央区域**（主工作区，支持多窗口卡片）：
  - 项目标题栏 + 操作按钮：
    - 删除叙事线、清理、批量合并
    - 命令、技能、套路、设置
    - 新建章节
  - **多窗口卡片系统**：
    - 每个卡片独立对话流
    - 卡片可缩小、拖拽、排列
    - 点击任意消息可编辑
  - 对话流（消息列表）：
    - 用户消息 + AI 回复
    - 代码块可展开/折叠
    - 工具调用显示（Shell、Read、Explore 等）
    - 错误提示
  - **实时上下文管理**：
    - 上下文圆圈显示（Context: 13.7%）
    - 点击可压缩/裁剪/清空
    - 自动压缩开关
  - **双 Git 按钮**：
    - Git 日志按钮：查看变更、暂存
    - Fork/合并按钮：创建 worktree、合并分支
  - 底部输入框 + 继续按钮

- **右侧栏**（可能存在）：
  - 文件树或上下文面板

**核心特性**：
- ✅ Git Worktree 多线并行（主线 + Fork 分支）
- ✅ 多窗口卡片系统（可拖拽、缩小）
- ✅ 对话式交互为主（类似 ChatGPT）
- ✅ 工具调用可视化（显示命令、耗时、输出）
- ✅ 实时上下文管理（圆圈显示 + 压缩）
- ✅ 消息编辑（点击任意消息编辑）
- ✅ 项目/会话可拖拽排序
- ✅ 监察者（守护进程）开关
- ✅ 顶部搜索框（搜索章节与消息）
- ✅ 双 Git 按钮（日志 + Fork/合并）
- ✅ 全供应商模型选择（计划模式、编辑权限、全部允许）

### NarraFork 三大配置系统

#### 1. 设置（Settings）- 8 个可展开部分

| 部分 | 内容 |
|------|------|
| **个人资料** | Git 用户名、邮箱配置 |
| **模型** | 全供应商模型选择、计划模式、编辑权限 |
| **AI 代理** | 代理配置与管理 |
| **章节与容器** | 章节管理、容器配置 |
| **通知** | 通知设置 |
| **外观与界面** | 主题、布局、字体等 |
| **服务器与系统** | 服务器配置、系统设置 |
| **关于** | 版本信息（v0.1.17, commit 268ccab） |

**特点**：
- 可展开/折叠的手风琴式布局
- 每个部分独立配置
- 实时保存
- 版本信息可追溯

#### 2. 套路（Routines）- 9 个标签页

| 标签 | 功能 |
|------|------|
| **命令** | 自定义命令配置 |
| **可选工具** | 工具启用/禁用 |
| **工具权限** | 工具权限管理 |
| **全局技能** | 全局 Skills 配置 |
| **项目技能** | 项目级 Skills 配置 |
| **自定义子代理** | 自定义 Sub-agents |
| **全局提示词** | 全局 Prompts |
| **系统提示词** | 系统级 Prompts |
| **MCP 工具** | MCP 工具集成 |

**特点**：
- 标签页式布局
- 全局/项目两级配置
- 支持自定义扩展
- 工具权限细粒度控制

#### 3. 管理（Admin）- 7 个管理模块

| 模块 | 功能 |
|------|------|
| **用户** | 用户管理（当前 2 个用户） |
| **供应商** | API 供应商管理（当前 5 个） |
| **终端** | 终端进程管理（当前 0 个） |
| **容器** | 容器管理（未就绪） |
| **储存空间** | 存储空间监控 |
| **运行资源** | CPU/内存/网络监控 |
| **请求历史** | API 请求日志 |

**特点**：
- 实时状态显示
- 资源监控
- 多用户管理
- 请求历史追溯

### InkOS 当前布局

**三栏结构**（已实现）：
- **左侧栏**（可调整宽度 200-400px）：
  - 项目导航（章节列表）
  - 设定集分簇
  - 结构卡片

- **中央区域**：
  - 多标签编辑器（TabBar）
  - 富文本编辑器（TipTap）
  - Markdown 编辑器
  - 结构化视图

- **底部面板**（可调整高度 120-400px，可折叠）：
  - Tab 1: Lorebook（实体识别 + 关键参数）
  - Tab 2: HookCountdown（伏笔倒计时）
  - Tab 3: RhythmChart（节奏波形图）
  - Tab 4: WorldDimensions（世界观维度）

**特点**：
- ✅ IDE 式编辑器为主（类似 VS Code）
- ✅ 多标签页管理
- ✅ 底部上下文面板（4 个 Tab）
- ✅ 可调整布局（拖拽分隔线）
- ❌ 缺少对话式交互界面
- ❌ 缺少工具调用可视化

---

## 二、核心功能对比

| 功能 | NarraFork | InkOS | 差距 |
|------|-----------|-------|------|
| **Git Worktree 多线并行** | ✅ 主线 + Fork 分支 | ❌ 无 | 🔴 InkOS 缺失 |
| **多窗口卡片系统** | ✅ 可拖拽、缩小 | ❌ 无 | 🔴 InkOS 缺失 |
| **对话式交互** | ✅ 主界面 | ❌ 无 | 🔴 InkOS 缺失 |
| **工具调用可视化** | ✅ Shell/Read/Explore 显示 | ❌ 无 | 🔴 InkOS 缺失 |
| **实时上下文管理** | ✅ 圆圈显示 + 压缩 | ❌ 无 | 🔴 InkOS 缺失 |
| **消息编辑** | ✅ 点击任意消息编辑 | ❌ 无 | 🔴 InkOS 缺失 |
| **双 Git 按钮** | ✅ 日志 + Fork/合并 | ❌ 无 | 🔴 InkOS 缺失 |
| **全供应商模型选择** | ✅ 计划模式、编辑权限 | ❌ 无 | 🔴 InkOS 缺失 |
| **设置页面** | ✅ 8 个可展开部分 | ❌ 无 | 🔴 InkOS 缺失 |
| **套路系统** | ✅ 9 个标签页 | ❌ 无 | 🔴 InkOS 缺失 |
| **管理面板** | ✅ 7 个管理模块 | ❌ 无 | 🔴 InkOS 缺失 |
| **多标签编辑器** | ⚠️ 可能有（未完全显示） | ✅ 已实现 | 🟢 InkOS 领先 |
| **富文本编辑器** | ⚠️ 未知 | ✅ TipTap 2.27 | 🟢 InkOS 领先 |
| **底部上下文面板** | ❌ 无 | ✅ 4 个 Tab | 🟢 InkOS 领先 |
| **项目/会话拖拽排序** | ✅ 已实现 | ❌ 无 | 🔴 InkOS 缺失 |
| **监察者（守护进程）** | ✅ 开关 + 状态显示 | ❌ 无 | 🔴 InkOS 缺失 |
| **搜索功能** | ✅ 顶部搜索框 | ❌ 无 | 🔴 InkOS 缺失 |
| **PWA 安装** | ✅ 已实现 | ✅ 已实现 | 🟢 平手 |
| **节奏控制** | ❌ 无 | ✅ 已实现 | 🟢 InkOS 领先 |
| **黄金三章检测** | ❌ 无 | ✅ 已实现 | 🟢 InkOS 领先 |
| **伏笔倒计时** | ❌ 无 | ✅ 已实现 | 🟢 InkOS 领先 |
| **毒点检测** | ❌ 无 | ✅ 已实现 | 🟢 InkOS 领先 |
| **Lorebook RAG** | ❌ 无 | ✅ 已实现 | 🟢 InkOS 领先 |

---

## 三、UI/UX 设计对比

### NarraFork 设计特点

**优点**：
1. **Git Worktree 多线并行**：主线 + Fork 分支，可独立开发后合并
2. **多窗口卡片系统**：多个对话窗口同时运行，可拖拽、缩小
3. **对话式交互自然**：类似 ChatGPT，用户习惯
4. **工具调用透明**：显示命令、耗时、输出，便于调试
5. **实时上下文管理**：圆圈显示上下文占用，可压缩/裁剪/清空
6. **消息编辑灵活**：点击任意消息即可编辑
7. **双 Git 按钮**：日志查看 + Fork/合并操作分离
8. **全供应商模型选择**：支持所有供应商，计划模式、编辑权限可配置
9. **三大配置系统**：设置（8 部分）、套路（9 标签）、管理（7 模块）
10. **项目切换便捷**：左侧栏可拖拽排序，快速切换
11. **监察者可视化**：守护进程状态一目了然
12. **搜索功能强大**：顶部搜索框可搜索章节与消息
13. **错误提示清晰**：API 错误、超时等显示明确

**缺点**：
1. **缺少网文行业功能**：无节奏控制、黄金三章、毒点检测
2. **缺少上下文面板**：无法查看 Lorebook、伏笔、节奏等
3. **缺少富文本编辑器**：无法直接编辑章节内容（可能有但未显示）

### InkOS 设计特点

**优点**：
1. **IDE 式编辑器**：多标签页、富文本、Markdown 支持
2. **底部上下文面板**：Lorebook、伏笔、节奏、世界观一目了然
3. **网文行业功能完整**：节奏控制、黄金三章、伏笔倒计时、毒点检测
4. **可调整布局**：拖拽分隔线调整宽度/高度
5. **PWA 离线能力**：Service Worker 缓存

**缺点**：
1. **缺少 Git Worktree 多线并行**：无法 Fork 章节线独立开发
2. **缺少多窗口卡片系统**：无法同时运行多个对话窗口
3. **缺少对话式交互**：无法像 ChatGPT 一样对话
4. **缺少工具调用可视化**：无法看到 Agent 执行的命令
5. **缺少实时上下文管理**：无法查看上下文占用、压缩/裁剪
6. **缺少消息编辑**：无法编辑历史消息
7. **缺少双 Git 按钮**：无法快速查看日志、Fork/合并
8. **缺少全供应商模型选择**：无法选择不同供应商模型
9. **缺少设置页面**：无法配置个人资料、模型、代理等
10. **缺少套路系统**：无法配置命令、工具、技能、子代理
11. **缺少管理面板**：无法管理用户、供应商、终端、容器
12. **缺少项目拖拽排序**：项目切换不够便捷
13. **缺少监察者可视化**：守护进程状态不可见
14. **缺少搜索功能**：无法快速搜索章节或消息

---

## 四、InkOS 应补齐的功能

### P0（必须补齐 - 核心交互）

| 功能 | 描述 | 参考 NarraFork | 工时估算 |
|------|------|----------------|---------|
| **Git Worktree 多线并行** | 主线 + Fork 分支，可独立开发后合并 | 叙事线 + Fork 按钮 | 24h |
| **多窗口卡片系统** | 多个对话窗口同时运行，可拖拽、缩小 | 中央区域多窗口卡片 | 20h |
| **对话式交互界面** | 类似 ChatGPT 的对话流，显示用户消息 + AI 回复 | 中央区域对话流 | 16h |
| **工具调用可视化** | 显示 Agent 执行的命令、耗时、输出 | Shell/Read/Explore 显示 | 12h |
| **实时上下文管理** | 圆圈显示上下文占用，可压缩/裁剪/清空 | 上下文圆圈 + 压缩按钮 | 10h |
| **消息编辑** | 点击任意消息即可编辑 | 消息点击编辑 | 8h |
| **双 Git 按钮** | 日志查看 + Fork/合并操作分离 | 双 Git 按钮 | 8h |

### P1（重要补齐 - 配置系统）

| 功能 | 描述 | 参考 NarraFork | 工时估算 |
|------|------|----------------|---------|
| **设置页面** | 8 个可展开部分：个人资料、模型、AI 代理、章节与容器、通知、外观与界面、服务器与系统、关于 | Settings 页面 | 16h |
| **套路系统** | 9 个标签页：命令、可选工具、工具权限、全局技能、项目技能、自定义子代理、全局提示词、系统提示词、MCP 工具 | Routines 页面 | 20h |
| **管理面板** | 7 个管理模块：用户、供应商、终端、容器、储存空间、运行资源、请求历史 | Admin 页面 | 18h |
| **全供应商模型选择** | 支持所有供应商，计划模式、编辑权限可配置 | 模型选择下拉框 | 10h |
| **全局搜索功能** | 顶部搜索框，搜索章节、消息、设定 | 顶部搜索框 | 8h |

### P2（可选补齐 - 体验优化）

| 功能 | 描述 | 参考 NarraFork | 工时估算 |
|------|------|----------------|---------|
| **项目拖拽排序** | 左侧栏项目列表可拖拽排序 | 叙事线拖拽 | 6h |
| **监察者可视化** | 守护进程状态显示 + 开关 | 监察者开关 | 8h |
| **会话管理** | 多会话切换 + 拖拽排序 | 叙述者列表 | 10h |
| **错误提示优化** | API 错误、超时等显示更清晰 | 错误提示 | 4h |
| **代码块展开/折叠** | 长代码块可折叠 | 代码块展开/折叠 | 4h |
| **工具调用筛选** | 按工具类型筛选（Shell/Read/Explore） | - | 6h |

---

## 五、技术实现建议

### 1. Git Worktree 多线并行

**技术方案**：
- 使用 Git Worktree API 创建独立工作树
- 主线（master）+ Fork 分支（feature/*）
- 每个 worktree 独立运行 Agent 进程
- 支持合并回主线（git merge）

**API 设计**：
```typescript
POST /api/worktree/:bookId/fork
POST /api/worktree/:bookId/merge
GET /api/worktree/:bookId/list
DELETE /api/worktree/:bookId/:branchName
```

### 2. 多窗口卡片系统

**技术方案**：
- 使用 `react-grid-layout` 实现拖拽布局
- 每个卡片独立 WebSocket 连接
- 卡片状态（最小化/最大化/关闭）持久化
- 支持多个 Agent 进程同时运行

**数据结构**：
```typescript
interface ChatWindow {
  id: string;
  title: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  minimized: boolean;
  agentId: string;
  messages: Message[];
}
```

### 3. 对话式交互界面

**技术方案**：
- 新增 `ChatPanel.tsx` 组件（类似 NarraFork 的对话流）
- 使用 SSE（Server-Sent Events）实时推送 AI 回复
- 消息列表虚拟滚动（react-window）
- 支持 Markdown 渲染（react-markdown）

**API 设计**：
```typescript
POST /api/chat/:bookId/send
GET /api/chat/:bookId/messages (SSE)
```

### 4. 工具调用可视化

**技术方案**：
- 在对话流中显示工具调用卡片
- 显示命令、耗时、输出、错误
- 支持展开/折叠长输出
- 支持复制命令

**数据结构**：
```typescript
interface ToolCall {
  id: string;
  tool: 'shell' | 'read' | 'explore' | 'write' | 'edit';
  command: string;
  duration: number;
  output: string;
  error?: string;
}
```

### 5. 实时上下文管理

**技术方案**：
- 实时计算上下文 token 占用
- 圆圈进度条显示（0-100%）
- 支持压缩（summarize）、裁剪（truncate）、清空（clear）
- 自动压缩开关（超过 80% 自动触发）

**API 设计**：
```typescript
GET /api/context/:bookId/usage
POST /api/context/:bookId/compress
POST /api/context/:bookId/truncate
POST /api/context/:bookId/clear
```

### 6. 消息编辑

**技术方案**：
- 点击消息进入编辑模式
- 支持 Markdown 编辑
- 编辑后重新生成后续消息
- 保留编辑历史

**API 设计**：
```typescript
PUT /api/chat/:bookId/message/:messageId
GET /api/chat/:bookId/message/:messageId/history
```

### 7. 双 Git 按钮

**技术方案**：
- 按钮 1：Git 日志查看器（git log + git diff）
- 按钮 2：Fork/合并操作（git worktree + git merge）
- 使用 `simple-git` 库操作 Git
- 支持暂存（git add）、提交（git commit）

**API 设计**：
```typescript
GET /api/git/:bookId/log
GET /api/git/:bookId/diff
POST /api/git/:bookId/stage
POST /api/git/:bookId/commit
```

### 8. 设置页面

**技术方案**：
- 手风琴式布局（Accordion）
- 8 个可展开部分
- 实时保存（debounce 500ms）
- 使用 IndexedDB 持久化

**数据结构**：
```typescript
interface Settings {
  profile: { username: string; email: string };
  models: { provider: string; model: string; planMode: boolean };
  agents: { enabled: string[]; config: Record<string, any> };
  chapters: { autoSave: boolean; autoBackup: boolean };
  notifications: { enabled: boolean; sound: boolean };
  appearance: { theme: 'light' | 'dark'; fontSize: number };
  server: { host: string; port: number };
  about: { version: string; commit: string };
}
```

### 9. 套路系统

**技术方案**：
- 标签页式布局（Tabs）
- 9 个标签页
- 支持全局/项目两级配置
- 支持自定义扩展

**数据结构**：
```typescript
interface Routines {
  commands: Command[];
  tools: { name: string; enabled: boolean }[];
  permissions: { tool: string; permission: 'allow' | 'deny' }[];
  globalSkills: Skill[];
  projectSkills: Skill[];
  subAgents: SubAgent[];
  globalPrompts: Prompt[];
  systemPrompts: Prompt[];
  mcpTools: MCPTool[];
}
```

### 10. 管理面板

**技术方案**：
- 7 个管理模块
- 实时状态显示（WebSocket）
- 资源监控（CPU/内存/网络）
- 请求历史追溯

**API 设计**：
```typescript
GET /api/admin/users
GET /api/admin/providers
GET /api/admin/terminals
GET /api/admin/containers
GET /api/admin/storage
GET /api/admin/resources (WebSocket)
GET /api/admin/requests
```

### 11. 全局搜索功能

**技术方案**：
- 顶部搜索框（Cmd+K 快捷键）
- 搜索章节标题、内容、设定、消息
- 使用 SQLite FTS5 全文搜索
- 搜索结果高亮显示

**API 设计**：
```typescript
GET /api/search?q=关键词&type=chapter|setting|message
```

### 12. 项目拖拽排序

**技术方案**：
- 使用 `@dnd-kit/core` 实现拖拽
- 拖拽后更新项目顺序（IndexedDB 持久化）
- 支持拖拽到分组

### 13. 监察者可视化

**技术方案**：
- 左侧栏顶部显示监察者状态（running/stopped/interrupted）
- 开关按钮（启动/停止守护进程）
- 显示当前任务（正在写第 X 章）
- 显示错误日志

**API 设计**：
```typescript
GET /api/daemon/status
POST /api/daemon/start
POST /api/daemon/stop
POST /api/daemon/interrupt
```

---

## 六、总结

### InkOS 的优势

1. **网文行业功能完整**：节奏控制、黄金三章、伏笔倒计时、毒点检测、Lorebook RAG
2. **IDE 式编辑器**：多标签页、富文本、Markdown 支持
3. **底部上下文面板**：4 个 Tab 显示关键信息
4. **可调整布局**：拖拽分隔线调整宽度/高度

### InkOS 的不足

1. **缺少 Git Worktree 多线并行**：无法 Fork 章节线独立开发
2. **缺少多窗口卡片系统**：无法同时运行多个对话窗口
3. **缺少对话式交互**：无法像 ChatGPT 一样对话
4. **缺少工具调用可视化**：无法看到 Agent 执行的命令
5. **缺少实时上下文管理**：无法查看上下文占用、压缩/裁剪
6. **缺少消息编辑**：无法编辑历史消息
7. **缺少双 Git 按钮**：无法快速查看日志、Fork/合并
8. **缺少全供应商模型选择**：无法选择不同供应商模型
9. **缺少三大配置系统**：设置（8 部分）、套路（9 标签）、管理（7 模块）
10. **缺少全局搜索**：无法快速搜索章节或消息
11. **缺少项目拖拽排序**：项目切换不够便捷
12. **缺少监察者可视化**：守护进程状态不可见

### 建议优先级

**Phase 4（对话式交互 + Git Worktree + 配置系统）**：

**P0 - 核心交互（98h）**：
1. Git Worktree 多线并行（24h）
2. 多窗口卡片系统（20h）
3. 对话式交互界面（16h）
4. 工具调用可视化（12h）
5. 实时上下文管理（10h）
6. 消息编辑（8h）
7. 双 Git 按钮（8h）

**P1 - 配置系统（72h）**：
1. 套路系统（20h）
2. 管理面板（18h）
3. 设置页面（16h）
4. 全供应商模型选择（10h）
5. 全局搜索功能（8h）

**P2 - 体验优化（38h）**：
1. 会话管理（10h）
2. 监察者可视化（8h）
3. 项目拖拽排序（6h）
4. 工具调用筛选（6h）
5. 代码块展开/折叠（4h）
6. 错误提示优化（4h）

**总工时**: 208h（约 5-6 周，2 人并行约 3 周）

### Phase 4 实施建议

**Week 1-2（P0 核心交互）**：
- 开发者 A：Git Worktree + 多窗口卡片系统（44h）
- 开发者 B：对话式交互 + 工具调用可视化（28h）
- 并行开发：实时上下文管理 + 消息编辑 + 双 Git 按钮（26h）

**Week 3-4（P1 配置系统）**：
- 开发者 A：套路系统 + 管理面板（38h）
- 开发者 B：设置页面 + 全供应商模型选择 + 全局搜索（34h）

**Week 5-6（P2 体验优化 + 测试）**：
- 开发者 A：会话管理 + 监察者可视化 + 项目拖拽排序（24h）
- 开发者 B：工具调用筛选 + 代码块展开/折叠 + 错误提示优化（14h）
- 并行测试：集成测试 + E2E 测试 + 性能优化（20h）

### 关键技术挑战

1. **Git Worktree 多线并行**：需要深入理解 Git Worktree API，处理并发冲突
2. **多窗口卡片系统**：需要管理多个 Agent 进程，处理 WebSocket 连接
3. **实时上下文管理**：需要实时计算 token 占用，实现压缩/裁剪算法
4. **套路系统**：需要设计灵活的配置系统，支持全局/项目两级配置
5. **管理面板**：需要实时监控资源占用，处理大量请求历史数据

### 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| Git Worktree 并发冲突 | 使用锁机制，限制同时运行的 worktree 数量 |
| 多窗口性能问题 | 使用虚拟滚动，限制同时打开的窗口数量 |
| 上下文管理复杂度 | 使用成熟的 token 计算库（tiktoken） |
| 配置系统扩展性 | 使用 JSON Schema 验证，支持插件化扩展 |
| 资源监控性能开销 | 使用采样监控，降低监控频率 |

---

**文档结束**
