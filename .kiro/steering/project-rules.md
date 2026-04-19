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
| 语言 | TypeScript 5.x |
| CLI | Commander.js |
| Web 工作台 | Vue 3 + Vite |
| 数据库 | SQLite（本地） |
| AI Provider | OpenAI / Anthropic / Custom（兼容 OpenAI 格式） |

---

## 仓库结构

```
novelfork/
├── packages/
│   ├── cli/          # CLI 工具（novelfork 命令）
│   ├── studio/       # Web 工作台（Vue 3）
│   ├── core/         # 核心写作引擎
│   └── agents/       # AI Agent 协作管线
├── CLAUDE.md         # Claude Code 配置
├── .kiro/steering/   # 项目规则与指南
└── OPS_RUNTIME_STATE.md  # 运维状态
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
