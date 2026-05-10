# Requirements — NarraFork UI 对标

## 背景

基于 NarraFork 0.4.2 的完整前端爬取（API/DOM/i18n/组件结构），NovelFork 需要在以下维度对标：

1. **对话窗口嵌入 react-flow 图节点**（当前是独立路由页面）
2. **Composer 极简化**（📎 + textarea + 按钮），模型/权限/推理控件在状态指示器行
3. **状态指示器行**用 ActionIcon + 弹出 Menu 切换模型/权限/推理/Fast Mode
4. **提供商三种 API 模式**（Completions/Responses/Codex）+ Codex 多账号额度
5. **消息右键菜单**（回退/分叉/压缩/编辑重生成）
6. **文件修改追踪**（按消息查看 diff、回退文件）
7. **章节系统**（fork/merge/exploration 图）

## 核心原则

1. 使用 shadcn/ui 组件库（已有），不引入 Mantine
2. 对标 NarraFork 的交互模式，但用 NovelFork 自己的视觉语言
3. 浏览器截图验证，不只靠 Vitest
4. 每个 Phase 独立可交付，不阻塞后续

---

## Phase 1：对话窗口核心体验

### Requirement 1：Composer 修正为 NarraFork 模式

NarraFork Composer 结构：`📎附件 + textarea + 单按钮（继续/中断）`。模型/权限/推理不在 Composer 里。

验收标准：
- Composer 只有：附件按钮 + textarea + 主按钮
- 主按钮三态：运行中→"中断"(红) / 有输入→"发送" / 空闲无输入→"继续"(蓝)
- 移除 Composer 中的 model select 和 permission select

### Requirement 2：状态指示器行（Composer 上方）

NarraFork 在 Composer 上方有一行状态指示器，包含所有运行时控件。

验收标准：
- 左侧：状态圆点(颜色) + 状态文案("空闲"/"工作中") + 耗时("· 上轮耗时 1:05")
- 右侧控件（ActionIcon + 弹出 Menu）：
  - 上下文环形图（SVG，显示使用百分比）
  - 模型按钮（显示首字母，点击弹出模型选择 Menu 带搜索过滤）
  - 推理强度按钮（显示首字母 N/L/M/H/X，点击弹出选择 Menu）
  - Fast Mode ⚡ toggle
  - 权限模式按钮（shield 图标，点击弹出权限 Menu）

### Requirement 3：消息右键上下文菜单

NarraFork 消息支持右键菜单操作。

验收标准：
- 右键消息弹出菜单：回退到此处 / 从此处分叉 / 压缩到此消息前 / 编辑并重新生成 / 删除
- 回退显示预览（将删除多少消息/块）
- 分叉创建新叙述者并继承到此消息的历史
- 编辑重生成：修改用户消息内容后重新发送

### Requirement 4：文件修改追踪

NarraFork 可以按消息查看修改了哪些文件，并查看 diff。

验收标准：
- 对话顶部工具栏有"文件修改"按钮
- 点击显示当前会话修改的文件列表
- 每个文件可查看 diff
- 支持回退单个文件或全部回退

---

## Phase 2：提供商与设置

### Requirement 5：提供商三种 API 模式

验收标准：
- OpenAI 兼容供应商配置时可选 API 模式：Completions / Responses / Codex
- 模式说明：Completions=GPT-4及更老/国产模型，Responses=GPT-4o+，Codex=反代
- Codex 模式显示额外配置：推理强度、Fast Mode、WebSocket、Account ID
- API 模式影响实际请求格式

### Requirement 6：Codex 多账号与额度

验收标准：
- 支持多 Codex 凭据管理（导入 refresh_token）
- 显示 tier（Free/Plus/Pro/Team）和用量
- 额度总览 + 负载均衡模式（Priority/Balanced/Tier Balanced）
- Codex 推理强度覆盖全局默认
- Fast Mode（service_tier: priority）

### Requirement 7：设置→对话数据流

设置页的配置必须正确流入对话界面的状态指示器行。

验收标准：
- /settings/models 的默认模型 → 新建叙述者继承 → 对话界面模型按钮显示
- /settings/models 的推理强度 → 新建叙述者继承 → 对话界面推理按钮显示
- /settings/agent 的权限模式 → 新建叙述者继承 → 对话界面权限按钮显示
- 对话界面修改的是当前叙述者设置，不影响全局
- 优先级：叙述者设置 > 供应商设置 > 全局默认

---

## Phase 3：章节与图

### Requirement 8：对话窗口嵌入 react-flow

NarraFork 的对话窗口不是独立页面，而是 react-flow 图中的可拖拽节点。

验收标准：
- 项目页使用 react-flow 渲染章节图
- 每个章节节点内嵌完整对话窗口（工具栏 + 消息列表 + 状态栏 + Composer）
- 节点可拖拽、可调整大小
- 节点间有边（fork/merge/dependency）

### Requirement 9：章节操作

验收标准：
- 章节状态：active / dormant / merged / abandoned / frozen
- 章节操作：fork / merge / 新建
- 章节标题编辑 + AI 生成标题
- Git 状态栏显示分支名 + 变更数

---

## Phase 4：验证

### Requirement 10：浏览器截图验证

验收标准：
- 对话页 Composer（极简：📎 + textarea + 按钮）截图
- 状态指示器行（模型/权限/推理 ActionIcon Menu）截图
- 消息右键菜单截图
- 提供商 API 模式选择截图
- react-flow 章节图截图
- 对比 NarraFork 7778 同页面截图
