# NovelFork 项目规则

## 项目定位

NovelFork 是从 InkOS fork 出来的项目，专注于中文网文小说创作的 AI 辅助工作台。

**核心差异**：
- 上游 InkOS：通用小说创作工具
- NovelFork：专注中文网文（玄幻、仙侠、都市、科幻等题材）

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Bun（推荐）/ Node.js >= 22.5.0 |
| 包管理 | pnpm workspace |
| 语言 | TypeScript 5.x |
| CLI | Commander.js |
| Web 工作台 | React 19 + Hono + Vite |
| 数据库 | SQLite（本地） |
| AI Provider | OpenAI / Anthropic / Custom（兼容 OpenAI 格式） |
| 分发 | Bun compile 单文件 + GitHub Release 版本化产物 |

---

## 仓库结构

```
novelfork/
├── packages/
│   ├── cli/          # CLI 工具（novelfork 命令）
│   ├── studio/       # Web 工作台（React 19 + Hono + Vite + Bun compile）
│   └── core/         # 核心写作引擎 + Agent 管线（src/agents/）
├── CLAUDE.md         # Claude Code 配置
├── AGENTS.md         # 代理执行规则
├── .kiro/steering/   # 项目规则与指南
└── docs/             # 文档中心
```

---

## 开发规范

### 代码风格

- TypeScript 严格模式
- ESLint + Prettier
- 函数式编程优先（不可变数据）
- 小文件原则（<800 行）

### 提交规范

```
type(scope): description

feat: 新功能
fix: 修复
refactor: 重构
docs: 文档
test: 测试
chore: 构建/工具
```

### 测试要求

- 单元测试覆盖率 >= 80%
- 核心 Agent 管线必须有集成测试
- 使用 Vitest
- 当前 Studio 回归口径以 `CLAUDE.md` / `AGENTS.md` 的“构建与测试”段为准

---

## 文档纪律

- 修改代码、配置、流程后必须同步受影响文档与 `CHANGELOG.md`
- 更新测试数量、构建命令、产物名称、端口、运行方式、发布状态时，必须全仓搜索旧口径并更新当前文档
- 删除或迁移 `.md` 前必须读取、提取有效信息并整合到目标文档；禁止一次性“完成报告/修复说明/实施总结”类临时文档

---

## AI Agent 管线

NovelFork 的核心是多 Agent 协作写作管线：

```
规划 Agent → 编排 Agent → 写作 Agent → 审计 Agent → 修订 Agent
```

每个 Agent 职责单一，通过消息传递协作。

---

## 与上游 InkOS 的关系

- **同步策略**: 选择性合并上游更新（不自动同步）
- **差异化**: 专注中文网文场景，增强连续性审计、文风仿写
- **贡献**: 通用改进可提 PR 回馈上游

---

## 禁止事项

- ❌ 不要引用上游 InkOS 已废弃的 API
- ❌ 不要硬编码 API Key
- ❌ 不要破坏 Agent 管线的单一职责原则
- ❌ 不要在没有测试的情况下修改核心引擎
- ❌ 不要为了兼容废弃前端、Tauri 旧线或历史 Provider 新增 shim/noop/fake 层
