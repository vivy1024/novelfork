# Git 工作流

## Remote 配置

| Remote | URL | 用途 |
|--------|-----|------|
| origin | `vivy1024/novelfork` | 本项目推送目标 |
| upstream | `Narcooo/inkos` | 上游 InkOS 源 |

注意：本项目主仓库地址已是 `vivy1024/novelfork`；上游仍是 `Narcooo/inkos`。GitHub CLI 可能因 fork/upstream 关系误判默认仓库，release / issue / PR / api 命令必须显式带 `--repo vivy1024/novelfork`。

---

## 分支策略

- `master` — 主分支，保持可用
- `feat/<name>` — 功能分支
- `fix/<name>` — 修复分支
- `chapter/<id>` — 写作实验分支

---

## 与上游同步

**选择性合并**，不自动 merge upstream：

```bash
git fetch upstream
git log upstream/master --oneline -20  # 看有什么新的
git cherry-pick <commit>               # 选择性拿
```

上游的通用改进可以拿，但涉及以下的跳过：
- 英文专属逻辑
- 与本项目已改造部分冲突的
- 实验性 feature 分支

---

## 版本与发布

- 任何版本号变动必须同步更新 release 资料：`package.json`、`packages/*/package.json`、`CLAUDE.md`、`AGENTS.md`、`CHANGELOG.md`。
- 用户要求提交、验收完成或明确要求收尾时，视为授权执行相关验证、Git 提交与 `git push origin <branch>`；不得只停留本地提交。
- 代码、配置、流程、测试数量、构建命令、产物路径、发布状态任一变化，必须同步相关 README、`docs/`、包级 README、`CLAUDE.md`、`AGENTS.md`，并记录到 `CHANGELOG.md` Unreleased。
- 正式发版必须在同一发布流程中完成：迁移已验证的 Unreleased 内容 → typecheck/test/compile/smoke → release commit → `git tag vX.Y.Z` → `git push origin <branch>` → `git push origin vX.Y.Z` → 上传 GitHub Release 产物。
- GitHub Release 是正式分发源；必须上传 `dist/novelfork-vX.Y.Z-windows-x64.exe` 与 SHA256；本地 dist 或本地 tag 不等于已发布。
- 发版前不得虚构 changelog 条目；只迁移已经验证的 Unreleased 内容。

---

## 提交规范

```
type(scope): description
```

| type | 场景 |
|------|------|
| feat | 新功能 |
| fix | 修复 |
| refactor | 重构（不改行为） |
| docs | 文档 |
| test | 测试 |
| chore | 构建/工具/依赖 |

scope 可选：`core`、`cli`、`studio`、`pipeline`、`agents`、`docs`、`release`

---

## 操作红线

- ❌ 不 force push master
- ❌ 不把 `.env` / API Key 提交
- ❌ 不在 master 上直接做大改动（开分支）
- 回滚用 `git revert`，不用 `git reset --hard` + force push
