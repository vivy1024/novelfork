# v0.1.1 真实可用性修复

## 来源

2026-05-11 用户实际操作 exe 产物后发现的功能断裂。这些不是 typecheck 能发现的问题，是"打开软件用不了"级别的缺陷。

---

## P0：侧边栏书籍下 5 个 Agent 不可见

### 现状

创建书籍时后端确实创建了 5 个 session（writer/hooks/chapter-hooks/auditor/outline），但侧边栏叙事线区域看不到它们。

### 根因排查方向

`ShellSidebar.tsx` 中有代码在 active book 下显示 `bookAgents`，但条件是 `sessions.filter(s => s.projectId === bookId)`。可能：
1. `projectId` 存的是书名（如"验证工作空间"）而不是 bookId
2. 侧边栏的 `sessions` 数据没有包含这些 Agent session
3. `route.kind === "book"` 时 `isActive` 判断不正确

### 验证标准

打开软件 → 侧边栏点击书籍 → 书籍下方展开显示 5 个 Agent 入口（📝写书/🎣伏笔/🪝章末钩子/🔍审校/📋大纲与经纬）→ 点击任一入口进入对应对话页。

---

## P0：Context Ring 不默认显示 + 设置阈值不联动

### 现状

1. Context Ring 只在 `maxTokens > 0` 时显示，但新会话的模型 contextWindow 可能为 0（API 没返回）
2. 设置中修改"上下文压缩阈值"后，Context Ring 的压缩线不跟着变
3. NarraFork 的 Context Ring 始终可见（即使 0%），点击弹出菜单（压缩/清空/查看阈值）

### NarraFork 参考行为

- Context Ring 始终显示在状态栏
- 环形进度条：绿色（<60%）→ 黄色（60-80%）→ 红色（>80%）
- 点击弹出下拉菜单：当前使用量、压缩阈值、"立即压缩"按钮、"清空上下文"按钮
- 自动压缩触发时状态栏显示"正在压缩..."

### 验证标准

新建会话 → Context Ring 可见（0%）→ 发几条消息后百分比增长 → 设置中改阈值 → Context Ring 压缩线位置跟着变 → 超过阈值时自动压缩。

---

## P0：经纬资源树还是平铺单文件

### 现状

虽然 `novel-init-handler.ts` 改了创建子目录（角色/势力/设定/伏笔/大纲/状态/规则），但：
1. 旧书的经纬文件还在 `story/` 或 `jingwei/` 根目录平铺
2. 资源树 `resource-tree-adapter.ts` 没有按子目录分组显示
3. 用户看到的还是一堆 `.md` 文件列表，不是按类别分组的树

### 验证标准

打开书籍工作台 → 资源树"经纬资料"分组下显示子分组（角色/势力/设定/伏笔/大纲/状态/规则）→ 每个子分组下显示对应的 `.md` 文件 → 可以在子分组中新建文件。

---

## P1：大纲 Agent 触发流程不明确

### 现状

用户不知道怎么调出大纲 Agent、世界观怎么创建。5 个 Agent 创建了但：
1. 侧边栏看不到（P0 问题）
2. 即使看到了，点进去后 Agent 不知道当前书籍的上下文
3. 没有引导用户"先用大纲 Agent 规划，再用写书 Agent 写作"的流程

### 验证标准

侧边栏点击"📋大纲与经纬" → 进入对话 → Agent 自动知道当前书籍信息 → 用户说"帮我规划第一卷大纲" → Agent 读取经纬文件并生成大纲 → 大纲写入 `jingwei/大纲/` 目录。

---

## P1：设置页"外观与界面"无功能

### 现状

设置页有"外观与界面"入口但点进去是空的。

### NarraFork 参考

- 主题切换（亮色/暗色/跟随系统）
- 字体大小调节
- 代码字体选择
- 侧边栏宽度
- 消息气泡样式

### 最小实现

- 主题切换（亮色/暗色/跟随系统）— 已有 Tailwind dark mode 支持
- 字体大小（小/中/大）

### 验证标准

设置 → 外观与界面 → 切换暗色主题 → 整个 UI 变暗 → 切回亮色 → 恢复。

---

## P1："用量监控"改造为"使用历史"

### 现状

设置页有"用量监控"入口但没有任何功能。

### NarraFork 参考（/settings/usage）

**统计卡片**：
- 请求数（精确值）
- 总 Tokens（输入 + 输出分开）
- 平均 TTFT（首 token 时间）
- 平均耗时
- 总成本
- 推理 Tokens
- 缓存读取/写入

**趋势图**：
- 按小时/天/月切换
- X轴时间，Y轴 Tokens 量

**请求历史表格**：
- 列：时间 | 叙述者 | 类型 | 提供商 | 模型 | Tokens | TTFT | 耗时 | 成本
- 支持筛选（提供商、模型、日期范围）
- 分页

### 实现方案

1. **后端**：每次 LLM generate 调用后，记录到 SQLite 表 `llm_usage_log`（timestamp, session_id, provider_id, model_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, latency_ms, ttft_ms, cost, error）
2. **API**：`GET /api/usage/summary`（统计卡片）、`GET /api/usage/history`（分页历史）、`GET /api/usage/trend`（趋势数据）
3. **前端**：替换空的"用量监控"页面为统计卡片 + 趋势图 + 历史表格

### 验证标准

发几条消息 → 设置 → 使用历史 → 看到请求记录（时间、模型、Tokens、耗时）→ 统计卡片显示总量。

---

## 执行顺序

```
Phase 1 — 核心可用性（P0）
  1. 侧边栏 5 Agent 可见 + 可点击进入对话
  2. Context Ring 默认显示 + 阈值联动 + 点击菜单
  3. 经纬资源树按文件夹分组

Phase 2 — 流程完善（P1）
  4. 大纲 Agent 触发流程（上下文自动加载 + 写入经纬目录）
  5. 外观与界面（主题切换）
  6. 使用历史（后端记录 + 前端展示）
```

---

## 前置条件

- v0-1-0-experience-and-pipeline-fix 中的工具调用已验证通过
- 供应商配置可用（Sub2API + OpenAI 兼容模式）
