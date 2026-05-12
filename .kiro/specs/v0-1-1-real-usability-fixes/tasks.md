# v0.1.1 真实可用性修复 — 任务清单

## Phase 1：核心可用性（P0）

### 1. 侧边栏书籍下 5 个 Agent 可见

- [ ] 1.1 验证后端创建书籍时 session 的 projectId 是否正确存储
  - 启动服务器，创建书籍，检查 `/api/sessions?sort=recent&status=active` 返回的 sessions 中 book-bound 的 projectId 是否等于 bookId
  - 如果 projectId 为空或不匹配，排查 `session-service.ts` 的 `createSession` 和 SQLite 存储
- [ ] 1.2 验证前端 ShellSidebar 的 sessions prop 包含 book-bound sessions
  - 在 `useShellData.ts` 的 `mapShellSessions` 中确认 projectId 被正确映射
  - 在 `ShellSidebar.tsx` 第 151 行确认 `sessions.filter(s => s.projectId === bookId)` 能匹配
- [ ] 1.3 浏览器验证：点击书籍 → 展开显示 5 个 Agent 入口
- [ ] 1.4 浏览器验证：点击 Agent 入口 → 进入对应对话页

### 2. Context Ring 默认显示 + 阈值联动

- [ ] 2.1 修复 Context Ring 在 maxTokens=0 时也显示（显示 "—" 或 0%）
  - `NarratorStatusBar.tsx` 的 `ContextRing` 组件已处理 `!hasMax` 情况
  - 确认 `toConversationStatus` 中 `contextUsage.maxTokens` 在无 contextWindow 时设为 0
- [ ] 2.2 设置中修改压缩阈值后 Context Ring 联动
  - 确认 `runtimeControls.compactThreshold` 从用户配置读取并传入 `toConversationStatus`
  - 修改阈值后需要刷新 status（通过 session config 更新或 shell data 刷新）
- [ ] 2.3 浏览器验证：新建会话 → Context Ring 可见 → 发消息后百分比增长

### 3. 经纬资源树按文件夹分组

- [ ] 3.1 排查 `resource-tree-adapter.ts` 是否按子目录分组
  - 检查 `jingwei/` 下的子目录（角色/势力/设定/伏笔/大纲/状态/规则）是否作为树节点返回
- [ ] 3.2 如果资源树是平铺的，修改为按子目录分组
  - 读取 `jingwei/` 目录结构，为每个子目录创建分组节点
- [ ] 3.3 浏览器验证：打开书籍工作台 → 资源树显示分组

## Phase 2：流程完善（P1）

### 4. 大纲 Agent 触发流程

- [ ] 4.1 确认 Agent session 的 worktree 指向正确的书籍目录
- [ ] 4.2 确认 Agent 的 system prompt 包含书籍上下文（buildAgentContext）
- [ ] 4.3 浏览器验证：点击"📋大纲与经纬" → Agent 知道当前书籍 → 能读写经纬文件

### 5. 外观与界面（主题切换）

- [ ] 5.1 实现主题切换（亮色/暗色/跟随系统）
  - 使用 Tailwind dark mode class 策略
  - 存储到 localStorage + 用户配置
- [ ] 5.2 实现字体大小调节（小/中/大）
- [ ] 5.3 浏览器验证：设置 → 外观 → 切换暗色 → UI 变暗

### 6. 使用历史

- [ ] 6.1 后端：创建 `llm_usage_log` SQLite 表
- [ ] 6.2 后端：每次 LLM generate 调用后记录到表
- [ ] 6.3 后端：`GET /api/usage/summary` + `GET /api/usage/history` API
- [ ] 6.4 前端：替换空的"用量监控"页面为统计卡片 + 历史表格
- [ ] 6.5 浏览器验证：发消息 → 设置 → 使用历史 → 看到记录
