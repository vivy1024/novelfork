# NovelFork

> AI 辅助中文网文创作工作台 — 本地优先、Agent 驱动、引导式生成

**v0.6.0** | TypeScript + Bun + React 19 + Hono + SQLite

[![Release](https://img.shields.io/github/v/release/vivy1024/novelfork)](https://github.com/vivy1024/novelfork/releases/latest)

---

## 项目简介

NovelFork 是一个专注中文网文创作的本地 AI 工作台。作者可以：

- 在浏览器中管理作品、章节和世界设定（故事经纬）
- 使用 5 个专属 Agent 协作写作（写书/伏笔/章末钩子/审校/大纲与经纬）
- 通过引导式生成（PGI 追问 + Guided Plan）让 AI 理解你的创作意图
- 让 Agent 自动探索→规划→写作→审校，每步可见可控
- 检测 AI 痕迹、连续性矛盾、文风漂移
- 导出 TXT/Word/ePub 发布到起点/番茄等平台

**完全本地运行，数据不出本机。**

---

## 快速开始

### 方式一：下载 exe（推荐）

从 [GitHub Release](https://github.com/vivy1024/novelfork/releases/latest) 下载 `novelfork-v0.6.0-windows-x64.exe`，双击运行。

### 方式二：从源码构建

```bash
git clone https://github.com/vivy1024/novelfork.git
cd novelfork
bun install

# 开发模式
cd packages/studio
bun run dev          # Vite 前端 http://localhost:4567

# 编译单文件 exe
pnpm --dir packages/studio compile   # → dist/novelfork-v0.6.0-windows-x64.exe
```

首次打开会显示欢迎引导，建议先配置 AI 供应商（设置 → AI 供应商）。新建书籍后自动进入引导向导，帮助 AI 理解你的创作意图。

---

## 功能概览

### 写作工作台

```
┌──────────────┬──────────────────────────┬────────────────┐
│ 左侧边栏       │ 中间画布                  │ 右侧叙述者会话    │
│ 书籍 + Agent   │ 编辑器 / 驾驶舱 / 经纬     │ 对话 / 工具链     │
│ 独立叙述者      │ 资源树（按类别分组）        │ 模型 / 权限       │
└──────────────┴──────────────────────────┴────────────────┘
```

### 5 Agent 写作管线

| Agent | 职责 |
|-------|------|
| 📝 写书 | 引导式生成下一章（PGI 追问 → 计划确认 → 候选稿） |
| 🎣 伏笔 | 伏笔管理、建议回收时机、埋设新伏笔 |
| 🪝 章末钩子 | 生成 3-5 个章末悬念方案 |
| 🔍 审校 | 连续性审计、矛盾检测、人设一致性 |
| 📋 大纲与经纬 | 生成大纲、维护经纬、添加角色/设定/势力 |

### 48 个 Agent 工具

文件操作（Bash/Read/Write/Edit/Glob/Grep）· Worktree 管理 · 用户交互（AskUserQuestion/PlanMode/TaskCreate）· 网络（WebSearch/WebFetch/Browser）· 子代理（Agent/Await/Send/ForkNarrator）· 终端 · 分享 · 对话历史搜索 · 管道模式 · 学习中心 · 技能 · 目标管理 · 驾驶舱 · 问卷 · PGI · 引导式生成 · 候选稿 · 叙事线 · 章节/经纬/健康度读取

### 引导式生成

写新章前，AI 会：
1. 生成 2-5 个追问（"主角这章的情绪基调？""玉佩伏笔要回收吗？"）
2. 用户回答后生成写作计划
3. 用户批准计划后才生成候选稿
4. 候选稿进入候选区，用户确认后才合并到正式章节

### 经纬资料（按类别分组）

```
jingwei/
├── 角色/     ← 人物设定
├── 势力/     ← 组织/门派
├── 设定/     ← 世界观/体系
├── 伏笔/     ← 待回收线索
├── 大纲/     ← 卷/章大纲
├── 状态/     ← 当前进度
└── 规则/     ← 写作规则
```

### 写作工具

AI 味检测（12 规则）· 章节健康度 · 段落节奏 · 对话比例 · 文风漂移 · 角色弧线 · 平台合规（5 平台）· 导出（TXT/MD/HTML）· 写作预设（26 流派）· 日更进度 · 节拍表 · 模板市场 · Checkpoint/Rewind

### 依赖前提

所有 AI 功能需要配置 AI 供应商（设置 → AI 供应商 → 填入 API Key）。支持 OpenAI / Anthropic / DeepSeek / 任何 OpenAI 兼容 API。未配置时仍可创建作品、编辑章节、整理经纬。

### 叙述者对话

- 模型切换（按 provider 分组）、推理强度、权限模式
- Slash 命令：`/help` `/model` `/permission` `/compact` `/fork`
- 会话恢复、fork、归档
- 工具调用渲染、确认门
- **v0.4.0** 并行工具执行（只读工具自动并行）
- **v0.4.0** 消息多选批量操作（Ctrl+Click / Shift 范围选）
- **v0.4.0** 文件修改面板（追踪 + diff + 单文件恢复）
- **v0.4.0** WebSocket 自动重连 + 断点续传

### 运行时健壮性（v0.4.0）

- 上下文溢出自动恢复（紧急截断 + 重试）
- 缓冲消息队列（Agent 工作中消息不丢失）
- 智能重试（429/502/503 指数退避）
- 命令/目录白黑名单（安全防护）
- YOLO 安全反思（高风险操作 LLM 评估）
- 子代理 Detach/Attach + 后台任务持久化
- 模型聚合（多供应商同模型自动路由/故障切换）

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
