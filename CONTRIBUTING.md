# 贡献指南 | Contributing Guide

感谢你对 InkOS 的关注！我们欢迎所有形式的贡献。

## 快速开始

```bash
git clone https://github.com/Narcooo/inkos.git
cd inkos
pnpm install
pnpm build
pnpm test
```

要求：Node ≥ 20, pnpm ≥ 9

## 项目结构

```
packages/
  core/    # Agents, pipeline, state management, LLM providers
  cli/     # Commander.js commands (22 commands)
  studio/  # Web UI (Vite + React + Hono)
```

Monorepo 使用 pnpm workspaces 管理。`cli` 通过 `workspace:*` 依赖 `core`。

## 开发流程

```bash
pnpm dev          # 监听模式（所有包）
pnpm build        # 构建一次
pnpm test         # 运行所有测试
pnpm typecheck    # 类型检查
```

## 提交规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <description>

[optional body]
```

**Type:**
- `feat`: 新功能
- `fix`: Bug 修复
- `refactor`: 重构（不改变功能）
- `docs`: 文档更新
- `test`: 测试相关
- `chore`: 构建/工具链相关
- `perf`: 性能优化
- `ci`: CI/CD 相关

**Scope（可选）:**
- `core`: 核心逻辑
- `cli`: 命令行接口
- `studio`: Web 工作台
- `agent`: Agent 相关
- `pipeline`: 写作管线

**示例:**
```
feat(agent): add new auditor dimension for plot consistency
fix(pipeline): resolve state validation failure on chapter rewrite
docs(readme): update installation instructions
```

保持提交原子化——一次提交只做一个逻辑改动。

## Pull Request 检查清单

- [ ] `pnpm build` 通过
- [ ] `pnpm test` 通过（包括新测试）
- [ ] `pnpm typecheck` 通过
- [ ] 新功能有对应测试
- [ ] 没有无关的格式化改动
- [ ] 提交信息符合规范
- [ ] 更新了相关文档

## 代码规范

- TypeScript strict 模式
- 2 空格缩进
- 不可变模式：`{ ...obj, key: value }` 而非直接修改
- 函数 < 50 行，文件 < 800 行
- 错误必须处理，不能静默吞掉（`catch { }` 需要注释说明）
- `workspace:*` 保留在源码 `package.json` 中（CI 发布时自动替换版本号）

## 添加 CLI 命令

1. 创建 `packages/cli/src/commands/<name>.ts`
2. 导出 `Command` 实例
3. 在 `packages/cli/src/index.ts` 中注册
4. 添加 `--json` 输出支持
5. 支持单书项目时自动检测 book-id

## 添加题材

1. 创建 `packages/core/genres/<id>.md`（YAML frontmatter）
2. 定义：`chapterTypes`, `fatigueWords`, `numericalSystem`, `powerScaling`, `pacingRule`, `satisfactionTypes`, `auditDimensions`, `language`
3. 编写题材正文（禁忌、语言规则、叙事指导）

## 测试

测试文件位于源码旁的 `__tests__/` 目录，使用 Vitest。

```bash
pnpm --filter @actalk/inkos-core test    # 只测试 core
pnpm --filter @actalk/inkos test         # 只测试 cli
```

涉及 LLM 管线的功能需要 mock LLM 调用——测试中不要发起真实 API 请求。

## 报告问题

- 使用 [Bug Report 模板](.github/ISSUE_TEMPLATE/bug_report.md)
- 使用 [Feature Request 模板](.github/ISSUE_TEMPLATE/feature_request.md)
- 使用 [Question 模板](.github/ISSUE_TEMPLATE/question.md)

## 需要帮助？

- 查看 [README](README.md)
- 查看已有 issues: https://github.com/Narcooo/inkos/issues
- 加入微信交流群（见 README）

## License

贡献的代码将采用 [MIT License](LICENSE)。
