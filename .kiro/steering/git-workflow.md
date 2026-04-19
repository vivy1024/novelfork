# Git 工作流

## Remote 配置

| Remote | URL | 用途 |
|--------|-----|------|
| origin | `vivy1024/inkos` | 本项目推送目标 |
| upstream | `Narcooo/inkos` | 上游 InkOS 源 |

注意：GitHub 仓库名仍为 `inkos`，未来可能 rename 为 `novelfork`。

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

scope 可选：`core`、`cli`、`studio`、`desktop`、`pipeline`、`agents`

---

## 操作红线

- ❌ 不 force push master
- ❌ 不把 `.env` / API Key 提交
- ❌ 不在 master 上直接做大改动（开分支）
- 回滚用 `git revert`，不用 `git reset --hard` + force push
