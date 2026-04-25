# NovelFork（中文说明）

> AI 辅助中文网文创作工作台 — 本地优先、作者驱动、平台合规

详细说明见 [README.md](./README.md)（中文内容）。

---

## 一句话

NovelFork 让网文作者在一个本地软件里完成 **构思 → 大纲 → 写作 → 审计 → 去 AI 味 → 上架**，AI 做副驾，作者握方向盘。

---

## 核心能力

| 能力 | 说明 |
|---|---|
| **Novel Bible** | 结构化管理角色 / 事件 / 设定 / 矛盾 / 世界模型 / 故事基线 / 角色弧线，AI 按可见性规则精准注入上下文 |
| **AI 味过滤** | 12 本地规则 + 朱雀 API 双检 + 7 招消 AI 味，写作管线强制必经（起点 / 晋江 / 番茄合规） |
| **引导式创作** | 问卷引导建书 → CoreShift 管理设定变更 → PGI 每章生成前作者意图显性化 |
| **多 Agent 管线** | 规划 → 编排 → 写作 → 审计 → 修订，自动连续性检查与文风迁移 |
| **本地单文件** | SQLite 存储 + Bun 运行时 + `bun compile` 单可执行文件分发 |

---

## 快速开始

```bash
git clone https://github.com/vivy1024/novelfork.git
cd novelfork
pnpm install
pnpm dev          # 开发模式
pnpm bun:compile  # 编译为单可执行文件
```

---

## 文档

- [README.md](./README.md) — 完整说明（技术栈 / 仓库结构 / 开发状态 / Spec 进度）
- [docs/README.md](./docs/README.md) — 文档中心
- [.kiro/specs/](./.kiro/specs/) — Kiro-style 需求 / 设计 / 任务 spec
