# NovelFork

> AI 辅助中文网文创作工作台 — 本地优先、Agent 驱动、平台合规

**Bun + React 19 + Hono + SQLite + 多 Agent 写作管线**

---

## 项目简介

NovelFork 是一个专注中文网文创作的本地 AI 工作台。作者可以：
- 在浏览器中打开工作台，管理章节和世界设定
- 使用 AI 辅助续写、扩写、对话生成
- 让 Agent 自动探索→规划→写作→审校
- 检测 AI 痕迹、敏感词、设定冲突
- 导出 Markdown/TXT 发布到起点/晋江等平台

**完全本地运行，数据不出本机。** `pnpm --dir packages/studio compile` 生成单可执行文件与版本化 release 产物。

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

# 测试
pnpm --dir packages/studio exec vitest run  # 156 files / 898 tests

# 编译
pnpm --dir packages/studio compile          # → dist/novelfork.exe + dist/novelfork-vX.Y.Z-windows-x64.exe (~117MB)
```

---

## 仓库结构

```
novelfork/
├── packages/
│   ├── core/          # 核心写作引擎 + Agent 管线
│   ├── studio/        # Web 工作台 (React 19 + Hono + Vite)
│   └── cli/           # CLI 工具 (novelfork 命令)
├── docs/              # 文档中心 (产品/架构/API/指南)
├── .kiro/
│   ├── specs/         # 开发规格（当前 active：backend-contract-v1 → frontend-refoundation-v1）
│   └── steering/      # 项目原则与约束
├── claude/            # Claude Code 源码参考
└── scripts/           # 工具脚本
```

| Package | 技术栈 | 说明 |
|---------|--------|------|
| `core` | TypeScript, 13 Agent 类, 18 内置工具 | 写作引擎，可独立使用 |
| `studio` | React 19, Hono, Vite, SQLite, PWA | 完整 Web 工作台 |
| `cli` | TypeScript, Commander | CLI 命令入口 |

---

## 核心能力

### Agent-native 创作工作台
- 当前重建主线：Backend Contract 与 Frontend Refoundation 已完成验收收口（12/12），`/next` 使用 Agent Shell 路由壳，Conversation runtime、单栏 surface、模型/权限状态栏动作、Tool Result Renderer Registry、Workbench 资源树、canvas/viewer 与写作动作入口已接入，主入口已切断旧三栏 WorkspacePage 默认依赖，失败三栏实验已从 Studio typecheck 构建路径正式退役，且已完成相关 Vitest、TypeScript、docs verify 与浏览器冒烟；后端整理已进入 `backend-core-refactor-v1`，已建立合同守护清单并补齐核心 contract regression tests
- 已有后端能力保留：叙述者会话、WebSocket、工具调用、确认门、权限模式、模型池、候选稿/草稿/经纬/叙事线等真实合同
- 新前端目标：左侧一级导航、单栏 Agent Conversation、独立 Writing Workbench；所有按钮、资源节点和写作动作必须来自 `packages/studio/src/app-next/backend-contract/` 中登记的真实后端合同
- 「写下一章」最小链路：驾驶舱快照 → PGI 生成前追问 → GuidedGenerationPlan → 用户批准 → 候选稿生成
- AI 输出默认进入候选区 / 草稿区；正式正文覆盖必须由用户确认

### 故事经纬（Bible/Jingwei）
- 人物/事件/设定/章节摘要 CRUD（SQLite 持久化）
- 三种可见性规则（tracked/global/nested）
- 时间线纪律（防剧透）
- 经纬模板应用
- 问卷系统 + AI 建议

### Agent 系统
- 5 种 Agent 角色：Writer / Planner / Auditor / Architect / Explorer
- 编排函数：Explorer → Planner → Writer → Auditor 串行
- 40 个工具（18 Core 写作 + 22 NarraFork 通用）
- agentId → 专属 system prompt 自动选择
- 上下文自动注入

### 工具化驾驶舱与叙事线
- 驾驶舱已降级为 `cockpit.*` 工具结果卡片和画布组件，不再是右侧主 Tab
- `cockpit.get_snapshot` 汇总日更进度、当前焦点、最近章节摘要、伏笔、风险和模型状态
- Narrative Line v1 可读取章节、经纬、伏笔、冲突和人物弧光，并在确认后写入叙事线变更
- 模型 / provider 不支持工具调用时返回 `unsupported-tools`，降级到只读解释或 prompt-preview，不伪造执行成功

### 合规与预设
- 敏感词扫描（起点/晋江/番茄/七猫/通用）
- AI 痕迹检测（12 规则本地 + 朱雀 API）
- 发布就绪检查
- 6 流派、5 文风、6 基底、8 逻辑规则预设

---

## 文档

| 文档 | 说明 |
|------|------|
| [docs/](docs/) | 文档中心入口 |
| [docs/01-当前状态/](docs/01-当前状态/) | 项目当前状态与能力矩阵 |
| [docs/02-用户指南/](docs/02-用户指南/) | 安装、启动、使用指南 |
| [docs/03-产品与流程/](docs/03-产品与流程/) | 创作流程、资源管理器模型 |
| [docs/04-架构与设计/](docs/04-架构与设计/) | 系统架构、工作台架构、Agent 管线 |
| [docs/06-API与数据契约/](docs/06-API与数据契约/) | API 总览、数据表 |
| [docs/90-参考资料/](docs/90-参考资料/) | AI 写作工具对比、NarraFork 参考 |

---

## 开发原则

1. 所有新功能必须先写 spec（requirements → design → tasks）
2. AI 输出只进候选区，用户确认后才影响正文
3. app-next 访问后端必须走 Backend Contract client / adapter，不在组件内散写未登记 API
4. 不恢复 mock/fake/noop 假成功
5. 未接入能力标记 unsupported，不伪造

## License

MIT
