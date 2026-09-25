# 贡献指南

感谢你对 **NovelFork** 的关注。

---

## 项目背景

**NovelFork** 是独立的中文网文 AI 辅助创作工作台。

- 早期参考了 InkOS 的 CLI 写作引擎架构，现已完全独立演进
- 当前方向：Agent-native 本地 Web 工作台 + 插件化架构

---

## 从源码运行

完整步骤见 [README「源码开发」](README.md#option-2-源码开发维护者)，要点：

1. 需要私有仓库 `NarraFork/novelfork-runtime-private` 的读权限（找维护者开通）。
2. Runtime 不随本仓库提供：按 `packages/narrafork-runtime-private/UPSTREAM.lock.json` 的 `branch` / `commit`，从 fork 分支 `git archive` 导出到 `packages/narrafork-runtime-private/`，再在该目录执行 `bun install --frozen-lockfile`。
3. 根目录 `pnpm install`，然后 `pnpm typecheck` 确认五个包（core / bridge / novel-plugin / studio / product-runtime）全部 Done。

> 根工作区依赖仅使用 PNPM 10.24.0 安装；Bun 保留为 Runtime 执行器和产品单文件编译器，不要在根目录执行 `bun install`（Runtime 目录内的 `bun install` 除外，它不在 pnpm 工作区里）。

Runtime 目录与 fork 相关的硬约束（不得提交 Runtime 源码、Runtime 改动先进 fork 分支等）见 [CLAUDE.md](CLAUDE.md)。

---

## 项目结构

```text
packages/
  core/                       # 通用基础设施：模型、存储、迁移、插件契约
  studio/                     # 产品前端与工作台外壳
  novel-plugin/               # 小说领域：写作、章节、经纬、叙事记忆、工作台 UI
  novelfork-product-runtime/  # 产品 Runtime 适配、书籍绑定、产品路由
  narrafork-runtime-bridge/   # 与 Runtime 之间的窄契约（仅类型与受控入口）
  fitness-plugin/             # 示例 / 扩展插件
  narrafork-runtime-private/  # Runtime 物化树（Git 忽略，本地导出；仅 UPSTREAM.lock.json 被跟踪）
```

---

## 开发流程

日常小改动使用增量验证，避免每次触发私有 Runtime 全量测试：

```bash
pnpm dev
pnpm verify:changed          # 改动包测试 + 改动包及下游类型检查
pnpm verify:changed --build  # 另加产品前端构建
```

以下场景才运行全量门禁：

```bash
pnpm test                    # 公开包 + 私有 Runtime 全量测试
pnpm typecheck               # 公开包 + 私有 Runtime 全量类型检查
```

`verify:changed` 会在根配置、依赖锁、TypeScript 配置、Runtime/overlay、测试/编译基础设施或启动入口变更时自动回退全量；可用 `pnpm verify:changed --dry-run` 只查看将执行的范围。

如果你在做当前架构或文档相关工作，请优先阅读：
- `docs/README.md`
- `docs/01-codewiki/README.md`
- `docs/04-架构与设计/README.md`

---

## 提交规范

遵循：

```text
type(scope): description
```

示例：
- `feat(core): add chapter truth validation`
- `fix(studio): repair runtime config reload`
- `docs(docs): reorganize documentation structure`

---

## PR 检查清单

- [ ] `pnpm build` 通过
- [ ] `pnpm test` 通过，或说明未通过原因
- [ ] `pnpm typecheck` 通过
- [ ] 改动范围聚焦，无无关清理
- [ ] 文档已同步更新（如适用）

---

## 报告问题

- Bug：使用 `Bug Report`
- 功能建议：使用 `Feature Request`
- 使用问题：使用 `Question`

---

## 许可证

贡献代码默认采用 [MIT License](LICENSE)。
