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
pnpm --dir packages/studio exec vitest run  # 148 files / 848 tests

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
│   ├── specs/         # 开发规格 (已全部归档)
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

### 创作工作台
- 章节资源树（已有章节 / 候选稿 / 草稿 / 大纲 / 经纬 / 故事文件 / 真相文件）
- TipTap 富文本编辑器
- 写作模式：续写、扩写、补写、对话生成、多版本对比、大纲分支
- AI 动作：生成下一章、审校、去 AI 味、连续性检查
- 删除/保存/导出 Markdown & TXT

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

### 驾驶舱
- 右侧面板默认 Tab：总览 / 伏笔 / 设定 / AI
- 日更进度、当前焦点、最近章节摘要
- 伏笔聚合（bible events + pending_hooks.md）
- AI 模型状态 + 候选稿追踪

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
3. 不恢复 mock/fake/noop 假成功
4. 未接入能力标记 unsupported，不伪造

## License

MIT
