# NovelFork

> AI 辅助中文网文创作工作台 — 本地优先、Agent 驱动、引导式生成

**TypeScript + Bun + React 19 + Hono + SQLite**

---

## 项目简介

NovelFork 是一个专注中文网文创作的本地 AI 工作台。作者可以：

- 在浏览器中管理作品、章节和世界设定（故事经纬）
- 使用 AI 辅助续写、扩写、对话生成、多版本对比
- 通过引导式生成（PGI 追问 + Guided Plan）让 AI 理解你的创作意图
- 让 Agent 自动探索→规划→写作→审校，每步可见可控
- 检测 AI 痕迹、连续性矛盾、文风漂移
- 导出 TXT/Word/ePub 发布到起点/番茄等平台

**完全本地运行，数据不出本机。**

---

## 快速开始

```bash
# 安装
git clone https://github.com/vivy1024/novelfork.git
cd novelfork
bun install

# 开发
cd packages/studio
bun run dev          # http://localhost:4567

# 编译
pnpm --dir packages/studio compile   # → dist/novelfork-v0.1.0-windows-x64.exe
```

首次打开会显示欢迎引导，建议先配置 AI 供应商（设置 → AI 供应商）。未配置模型时仍可创建作品、编辑章节、整理经纬。新建书籍后自动进入 11 题引导向导（可跳过），帮助 AI 理解你的创作意图。

---

## 功能状态总览

> 42 个开发 spec 已归档完成。以下是 spec 愿景与实际代码审计的对照。
>
> 审计方法：追踪每个功能从前端组件 → API 路由 → 核心引擎 → LLM 调用的完整链路。

### 小说写作核心

| 功能 | Spec 愿景 | 实际状态 | 说明 |
|------|-----------|----------|------|
| 写作模式 | 续写/扩写/补写/对话/变体/大纲分支 6 种模式 | **可用** | 完整 LLM 调用链，每种模式有独立 prompt 构建；无 LLM 配置时降级为 prompt-preview |
| AI 味检测 | 12 规则本地引擎 + 朱雀 API 双通道 | **可用** | Aho-Corasick 多模式匹配 + 密度阈值 + 句长方差；朱雀 API 需单独配置 |
| 平台合规 | 5 平台敏感词扫描 + AI 比例估算 + 发布就绪检查 | **可用** | 起点/晋江/番茄/七猫/通用词典，正则匹配返回位置和上下文 |
| 故事经纬 | 分区管理 + 可见性规则 + AI 上下文自动注入 | **可用** | SQLite 读取 → 可见性过滤 → token 裁剪 → 注入写作 prompt |
| 引导式生成 | PGI 追问 + Guided Plan 计划批准 + 候选稿确认 | **可用** | PGI 基于规则启发式生成问题（查询矛盾/伏笔状态），答案注入写作 prompt；计划由 PlannerAgent(LLM) 生成 |
| 选区变换 | 选中文本 → 续写/扩写/补写 | **可用** | 复用写作模式后端，前端 InlineWritePanel 提供选区操作 |
| 导出 | TXT / Word / ePub | **部分可用** | TXT/MD 完整；ePub 实际为单文件 HTML（非标准 .epub）；docx 未实现 |
| Checkpoint/Rewind | 资源快照 + 回滚 | **可用** | 双系统：MemoryDB 章节版本树 + 资源级 checkpoint/rewind（支持 diff 预览） |
| 模板市场 | 内置预设 + 用户自建 + 远程市场 | **可用** | 25+ 内置流派包 + SQLite 用户模板 + GitHub 远程仓库拉取 |
| 写作预设库 | 流派/文风/基底/逻辑规则/节拍模板 | **可用** | 26 流派配置，前端 PresetsPanel 可浏览应用 |
| 章节健康度 | 节奏/对话/句长直方图 + 全书健康仪表盘 | **可用** | ChapterHealthCard + BookHealthSummary 组件，后端计算真实统计 |
| 日更进度 | 日更目标追踪 + 节拍表 | **可用** | DailyProgressCard + BeatProgressBar，基于当日写作字数 |

### AI Agent 管线

| 功能 | Spec 愿景 | 实际状态 | 说明 |
|------|-----------|----------|------|
| 多 Agent 编排 | Planner→Composer→Writer→Auditor→Reviser 完整链 | **可用** | PipelineRunner 协调 9 个 Agent，每步调用 LLM，事件广播到前端 |
| 可见执行链 | WorkflowProgressCard 展示管线进度 | **可用** | SSE 事件流驱动前端进度卡片 |
| 确认门 | 写入正式资源前用户批准 | **可用** | ToolConfirmationRequest + ConfirmationGate 组件 |
| 写作动作自动触发 | 点击按钮 → 导航到会话 → 自动发送 slash command | **可用** | pending-action-store + ConversationRouteLive 自动发送 |
| Agent Runtime | 真实 provider/model 选择、工具循环、权限门 | **可用** | 对标 Claude Code 级 runtime，WebSocket 事件流 |

### 工作台 UI

| 功能 | Spec 愿景 | 实际状态 | 说明 |
|------|-----------|----------|------|
| 三栏布局 | 左资源树 / 中画布 / 右叙述者会话 | **可用** | AgentShell + WritingWorkbenchRoute + ConversationRoute |
| 书籍管理页 | 卡片网格 + 删除 + 新建 | **可用** | /next/books 路由，BookManagementPage |
| 新书引导向导 | 11 题三模式（预设/自定义/跳过） | **可用** | NewBookGuide 组件，完成后写入 4 个经纬文件 |
| 资源树 | 章节/候选稿/经纬分组，打开/编辑/保存 | **可用** | WorkbenchResourceTree + WorkbenchCanvas |
| 叙述者对话 | 模型切换、权限模式、slash command、fork | **可用** | ConversationSurface + Composer + NarratorStatusBar |
| 设置页 | Provider 配置、模型、外观、存储 | **可用** | SettingsLayout + 真实持久化 |
| 学习中心 | 9 篇功能教学 | **可用** | /next/learn 路由，docs/learning/ 内容 |
| 桌面应用 | 单 exe 启动 | **可用** | Bun compile → 单文件 exe，内嵌 HTTP 服务器 |

### 前端→后端断裂点（已知问题）

| 问题 | 状态 | 说明 |
|------|------|------|
| 写作动作按钮 → Agent 自动工作 | **刚修复** | 之前点击只导航不发消息，现已通过 pending-action-store 接通 |
| 引导完成 → 资源树刷新 | **刚修复** | 之前 onGuideComplete 回调链断裂，现已接通 reloadResources |
| 书籍删除 | **刚修复** | 之前依赖右键菜单（embedded Edge 不可用），现改为管理页面删除 |
| ePub 导出 | **降级** | 输出为单文件 HTML 而非标准 .epub 格式 |
| Word (docx) 导出 | **未实现** | 前端有按钮但后端无 docx 生成逻辑 |
| 行内续写 Tab 补全 | **未接通** | 后端能力存在，前端编辑器未绑定 Tab 快捷键触发 |
| 消息右键菜单 | **未实现** | 回退/分叉/压缩/编辑重生成的右键菜单未做 |
| Context Ring 可视化 | **未实现** | 上下文使用率环形图未做 |

### 依赖前提

所有 AI 功能依赖用户配置有效的 AI 供应商（设置 → AI 供应商 → 填入 API Key）。未配置时：
- 写作模式降级为 prompt-preview（只返回 prompt 文本，不调用 LLM）
- Agent 管线无法执行
- 这是设计行为，不是 bug

---

## 核心功能

### 写作工作台（三栏布局）

```
┌──────────────┬──────────────────────────┬────────────────┐
│ 左侧资源树     │ 中间画布                  │ 右侧叙述者会话    │
│ 章节/候选稿/   │ 编辑器 / 驾驶舱 / 经纬     │ 对话 / 工具链     │
│ 草稿/经纬/叙事线│                          │ 模型 / 权限       │
└──────────────┴──────────────────────────┴────────────────┘
```

### AI 写作

| 功能 | 说明 |
|------|------|
| 写作模式 | 续写、扩写、过渡、对话生成、变体对比、大纲分支 |
| AI 动作 | 写下一章、生成草稿、连续性审校、修订、重写、去 AI 味 |
| 选区变换 | 选中文本 → 润色/精简/扩写/审查 |
| 智能大纲 | 生成/检查/建议下一章方向 |

### 引导式生成（PGI + Guided Plan）

写新章前，AI 会：
1. 生成 2-5 个追问（"主角这章的情绪基调？""玉佩伏笔要回收吗？"）
2. 用户回答后生成写作计划
3. 用户批准计划后才生成候选稿
4. 候选稿进入候选区，用户确认后才合并到正式章节

### 故事经纬

- 分区管理（人物/地点/势力/物品/伏笔/世界规则）
- 条目编辑（Markdown + 标签 + 关联章节）
- 可见性规则（global/nested/tracked）
- AI 上下文自动注入（按 token 预算裁剪）
- 经纬模板（空白/基础/增强/按题材推荐）

### Agent 写作管线

- 9 个 Agent 角色：Planner / Composer / Writer / LengthNormalizer / ChapterAnalyzer / ContinuityAuditor / Reviser / StateValidator / Radar
- 完整编排：规划 → 编排 → 写作 → 审计 → 修订
- 可见执行链（WorkflowProgressCard + SSE 事件流）
- 确认门：写入正式资源前必须用户批准

### 写作工具

章末钩子生成 · 段落节奏分析 · 对话比例分析 · 全书健康仪表盘 · 角色弧线 · 文风漂移检测 · AI 味检测（12 规则 + 朱雀 API） · 写作预设（26 流派） · 日更进度追踪 · 节拍表 · 平台合规检查（5 平台） · 导出（TXT/MD/HTML） · 模板市场（内置 + 自建 + 远程）

### 叙述者对话

- 模型切换（按 provider 分组）、推理强度、权限模式
- Slash 命令：`/help` `/model` `/permission` `/compact` `/fork`
- 会话恢复、fork、归档
- 工具调用渲染、确认门

### 设置与套路

- AI 供应商配置（API Key / 平台集成）
- 套路系统：命令/工具/权限/技能/子代理/提示词/MCP
- 全局配置 vs 项目配置，新建会话时自动继承

---

## 仓库结构

```
novelfork/
├── packages/
│   ├── core/          # 核心写作引擎 + Agent 管线
│   ├── studio/        # Web 工作台 (React 19 + Hono + Vite)
│   └── cli/           # CLI 工具 (novelfork 命令)
├── docs/
│   ├── 02-用户指南/    # 安装、使用、配置
│   ├── 03-产品与流程/  # 创作流程、资源模型、候选稿
│   ├── 04-架构与设计/  # 系统架构、工作台、Agent 管线
│   └── learning/      # 学习中心（9 篇功能教学）
├── .kiro/specs/       # 开发规格
└── scripts/           # 工具脚本
```

---

## 文档

| 入口 | 说明 |
|------|------|
| [docs/learning/](docs/learning/) | **学习中心**（推荐新用户从这里开始） |
| [docs/02-用户指南/](docs/02-用户指南/) | 安装、小说管理、AI 写作、对话、设置 |
| [docs/03-产品与流程/](docs/03-产品与流程/) | 创作流程、资源管理器、候选稿、经纬 |
| [docs/04-架构与设计/](docs/04-架构与设计/) | 系统架构、工作台、Agent 管线、驾驶舱 |
| [docs/06-API与数据契约/](docs/06-API与数据契约/) | API 总览、数据表 |

Studio 内可通过 `/next/learn` 页面直接访问学习中心。

---

## 开发

```bash
# 类型检查
pnpm --dir packages/studio typecheck

# 测试
cd packages/studio && npx vitest run

# 编译单文件
pnpm --dir packages/studio compile
```

### 开发原则

1. AI 输出只进候选区，用户确认后才影响正文
2. 新功能先写 spec（requirements → design → tasks）
3. 前端访问后端走 Backend Contract，不散写 API
4. 未接入能力标记 unsupported，不伪造

---

## License

MIT
