# UI 断裂修复 + 功能补全 — 需求文档

## 背景

代码审计发现多处"UI 存在但功能断裂"的问题。这些不是新功能，而是已有代码的接通问题。

---

## Phase 1：Critical 断裂修复（P0）

### 1.1 预设执行 400 错误

**现状**: 预设 Tab 的"执行"按钮发送 `mode: preset.category`（如 "genre"/"tone"）给 `/api/books/:id/inline-write`，但该 API 只接受 `continuation|expansion|bridge`
**修复**: 预设执行应该走不同路径——将 `promptInjection` 注入到一次性生成调用中，而非走 inline-write

### 1.2 预设启用/禁用 UI

**现状**: 后端有 `PUT /api/books/:id/presets`（设置 enabledPresetIds），但预设 Tab 没有启用/禁用开关
**修复**: 每个预设卡片添加 Switch 组件，切换时调用 API 更新 enabledPresetIds

### 1.3 章节图永远禁用

**现状**: `ChapterGraph` 组件完整，但 `StudioNextApp.tsx` 从不传 `chapters`/`chapterEdges` props
**修复**: 从书籍 API 获取章节列表，构建简单的线性图（chapter1 → chapter2 → ...），传给组件

---

## Phase 2：功能补全（P1）

### 2.1 节拍表真实进度追踪

**现状**: `currentBeatIndex = currentChapter - 1`（假的）
**修复**: 
- 添加 beat-chapter 映射存储（SQLite 或 book config）
- 用户可手动标记"当前章节对应哪个 beat"
- 或 AI 自动分析章节内容匹配 beat

### 2.2 叙事线前端交互

**现状**: 后端有完整 CRUD（propose/apply），前端只显示 JSON
**修复**: 用简单的节点列表 + "添加节点"/"编辑"按钮替代 JSON 显示

### 2.3 Slash 命令补全

**现状**: /tools /mcp /agents 返回"planned，尚不可执行"
**修复**:
- `/tools` — 列出当前会话可用工具
- `/mcp` — 列出已连接 MCP 服务器和工具
- `/agents` — 列出可用子代理类型

---

## Phase 3：套路页功能验证（P1）

### 3.1 套路页各 Tab 功能确认

需要验证的 Tab：
- 命令 Tab — 能否添加/编辑/删除自定义命令？
- 工具 Tab — 能否启用/禁用工具？
- 权限 Tab — 能否设置 allow/deny/ask 规则？
- 技能 Tab — 能否扫描/加载技能？
- 子代理 Tab — 能否创建自定义子代理？
- 提示词 Tab — 能否编辑全局/系统提示词？
- MCP 工具 Tab — 能否添加/连接 MCP 服务器？
- 钩子 Tab — 能否配置 Pre/Post/TurnComplete 钩子？

### 3.2 套路页保存是否生效

**关键问题**: 套路页的配置保存后，是否真的影响 Agent 行为？
- 权限规则 → 是否在 session-tool-executor 中被读取？
- 提示词 → 是否注入到 Agent system prompt？
- 工具启用/禁用 → 是否影响工具列表？

---

## 实施顺序

```
Phase 1 — Critical 断裂修复（P0）
  1.1 预设执行路径修复
  1.2 预设启用/禁用 UI
  1.3 章节图数据接通

Phase 2 — 功能补全（P1）
  2.1 节拍表进度追踪
  2.2 叙事线前端交互
  2.3 Slash 命令补全

Phase 3 — 套路页验证（P1）
  3.1 各 Tab 功能确认
  3.2 保存是否生效
```

---

## 验证标准

- Phase 1：预设执行不报 400；预设可启用/禁用；章节图显示线性章节关系
- Phase 2：节拍表显示真实进度；叙事线可交互编辑；/tools 返回工具列表
- Phase 3：套路页保存的权限规则在下次工具调用时生效
