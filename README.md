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
| 行内续写 | Tab 补全，30-80 字流式续写 |
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
- AI 上下文自动注入
- 经纬模板（空白/基础/增强/按题材推荐）

### Agent 写作管线

- 5 种 Agent 角色：Writer / Planner / Auditor / Architect / Explorer
- 多 Agent 编排：Explorer → Planner → Writer → Auditor
- 可见执行链（WorkflowProgressCard）
- 确认门：写入正式资源前必须用户批准

### 写作工具

章末钩子生成 · 段落节奏分析 · 对话比例分析 · 全书健康仪表盘 · 矛盾地图 · 角色弧线 · 文风漂移检测 · AI 味检测 · 写作预设 · 日更进度追踪 · 节拍表 · 平台合规检查 · 导出（TXT/Word/ePub） · 模板市场

### 叙述者对话

- 模型切换（按 provider 分组）、推理强度、权限模式
- Context Ring（上下文使用率可视化）
- Slash 命令：`/help` `/model` `/permission` `/compact` `/fork`
- 消息右键菜单：回退/分叉/压缩/编辑重生成
- 文件修改追踪、会话恢复

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
