# 贡献指南

感谢你对 **NovelFork** 的关注。

---

## 项目背景

**NovelFork** 是独立的中文网文 AI 辅助创作工作台。

- 早期参考了 InkOS 的 CLI 写作引擎架构，现已完全独立演进
- 当前方向：Agent-native 本地 Web 工作台 + 插件化架构

---

## 从源码运行（过渡方式）

```bash
git clone https://github.com/vivy1024/novelfork.git novelfork
cd novelfork
pnpm install
pnpm build
pnpm test
```

> 这是当前源码运行方式，不代表最终产品形态。

---

## 项目结构

```text
packages/
  core/     # 写作引擎、状态、审计、LLM 适配
  cli/      # 过渡期命令入口
  studio/   # React + Hono 工作台
  desktop/  # 历史 Tauri 壳（非当前主路线）
```

---

## 开发流程

```bash
pnpm dev
pnpm build
pnpm test
pnpm typecheck
```

如果你在做平台回正相关工作，请优先阅读：
- `docs/02-核心架构/01-系统架构/03-平台纠偏说明.md`
- `docs/04-开发指南/05-调研规划/01-平台迁移方案.md`

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
