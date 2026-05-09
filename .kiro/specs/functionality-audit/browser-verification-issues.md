# 浏览器验证问题清单与修复计划

> 日期：2026-05-10
> 来源：v0.1.0 编译产物实际打开后的用户反馈

---

## 已修复（de3a2d79）

| # | 问题 | 根因 | 修复 |
|---|------|------|------|
| 1 | Anthropic 硬编码 3 个模型 | `AnthropicCompatibleAdapter.listModels()` 不调 API | 改为调用 `/v1/models`，失败降级 |
| 2 | 虚拟滚动不工作 | 消息流容器 div 不是 flex 容器，高度链断裂 | 加 `flex flex-col` |
| 3 | 欢迎弹窗不显示 | `DialogContent` 的 `sm:max-w-sm` 覆盖 `max-w-2xl` | 传入 `sm:max-w-2xl` |
| 4 | 供应商无法删除 | 后端有 DELETE API，前端未接入 | 详情页加删除按钮 |
| 5 | 模型库存无意义 | 与卡片列表重复，只读无操作 | 移除渲染 |

---

## 待修复

### P0 — 供应商体验

| # | 问题 | 说明 | 修复方向 |
|---|------|------|---------|
| 6 | 供应商卡片无删除入口 | 必须进详情才能删除，不方便 | 卡片右上角加 ⋮ 菜单（删除/禁用） |
| 7 | 添加供应商流程不合理 | 先在列表页填完 apiKey+baseUrl 才能保存 | 改为：点击"添加"直接进入详情页编辑 |
| 8 | Sub2API Anthropic 格式问题 | Sub2API 的 Anthropic 端点需要 Anthropic 原生请求格式 | 确认 `AnthropicCompatibleAdapter.generate()` 使用 `/v1/messages` + `x-api-key` header（已正确） |

### P1 — 对话渲染改造

| # | 问题 | NarraFork 做法 | 修复方向 |
|---|------|---------------|---------|
| 9 | 工具调用渲染简陋 | 工具图标按类型着色 + 描述 + 耗时 + 上下文占用 | ToolCallCard 增强：按工具类型分配图标/颜色 |
| 10 | Bash 工具无终端风格 | `$ command` 格式 + 输出用 Code 组件 | Bash/Shell 工具特殊渲染 |
| 11 | 子代理调用无渲染 | 嵌套展示子代理名称 + 工具数 + 耗时 | Agent/Task 工具特殊渲染（嵌套卡片） |
| 12 | 展开内容原始 JSON | NarraFork 按工具类型格式化展示 | 按 toolName 分类渲染（file path / command / code） |
| 13 | 无上下文占用显示 | 每个工具调用显示 token 占用 | 从 result metadata 提取 token 信息 |

### P2 — 对话顶部工具栏

| # | 问题 | 说明 | 修复方向 |
|---|------|------|---------|
| 14 | 归档无确认 | 点击直接归档，无确认对话框 | 加 confirm() 或 Dialog |
| 15 | 会话信息面板简陋 | 只有基础字段 | 加 token 用量、创建时间、worktree、recovery 状态 |
| 16 | 生成标题用日期 | 应调用 LLM 生成 | 调用 `session-auto-title.ts` |
| 17 | 文件修改面板空 | 需要真实 toolCalls 数据 | 已实现 FileChangesPanel，需验证数据流 |

### P3 — 供应商高级功能

| # | 问题 | 说明 | 修复方向 |
|---|------|------|---------|
| 18 | 无模型启用/禁用 | 刷新出的模型全部启用 | 模型列表加 toggle |
| 19 | 无连接测试反馈 | 测试模型后无明显成功/失败提示 | 加 toast 或 inline 状态 |
| 20 | 无供应商健康状态 | 卡片上看不出供应商是否可用 | 加健康指示器（绿/黄/红） |

---

## 优先级排序

```
P0（立即）: #6 卡片删除 → #7 添加流程 → #8 Sub2API 验证
P1（核心）: #9-#13 对话渲染改造（最大用户体验差距）
P2（完善）: #14-#17 工具栏功能
P3（增强）: #18-#20 供应商高级功能
```

---

## NarraFork 对话渲染参考

### 工具调用块结构
```
Button(unstyled, 可点击展开/折叠)
├── ThemeIcon — 工具图标（颜色按状态：green=成功, blue=运行中, red=失败）
├── Text: "Bash" — 工具名
├── Text: "查看工作树状态" — 描述摘要
└── Group:
    ├── Text: "881ms" — 耗时
    └── span: "/ 2m" — 上下文占用

展开内容:
├── pre: "$ git status --short" — 命令（终端风格）
├── Text: "输出"
└── pre: "M packages/..." — 输出内容
```

### 工具类型图标映射
```
Bash/Shell/Execute → 终端图标, 蓝色
Read/Glob/Find → 搜索图标, 灰色
Write/Edit → 文件图标, 绿色
WebSearch → 地球图标, 紫色
Agent/Task → 机器人图标, 橙色
AskUserQuestion → 问号图标, 蓝色
```

### 子代理渲染
```
Agent 工具调用:
├── 机器人图标 + "explore" + 描述
├── "17 calls · 1m34s" — 调用数 + 总耗时
└── 展开后显示子代理的工具调用列表（嵌套）
```
