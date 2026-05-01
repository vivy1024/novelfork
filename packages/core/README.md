# @vivy1024/novelfork-core

核心写作引擎 + Agent 管线。可独立使用，也可被 `@vivy1024/novelfork-studio` 引用。

---

## 目录结构

```
src/
├── agents/          # 13 个专业 Agent 类
│   ├── architect.ts      # 世界观架构
│   ├── planner.ts        # 章节规划
│   ├── composer.ts       # 大纲→正文
│   ├── writer.ts         # 续写
│   ├── continuity.ts     # 连续性审计
│   ├── reviser.ts        # 修订
│   ├── radar.ts          # 市场扫描
│   ├── consolidator.ts   # 全书整理
│   ├── chapter-analyzer.ts # 单章分析
│   ├── foundation-reviewer.ts # 基础设定审查
│   ├── length-normalizer.ts # 字数治理
│   ├── state-validator.ts    # 状态验证
│   └── fanfic-canon-importer.ts # 同人设定导入
│
├── pipeline/        # Agent 管线
│   ├── agent.ts          # Agent 循环 (runAgentLoop)
│   ├── agent-prompts.ts  # 5 种 Agent 专属 system prompt
│   ├── agent-pipeline.ts # 多 Agent 编排
│   └── runner.ts         # 管线执行器
│
├── registry/        # 工具注册表
│   ├── tool-registry.ts  # ToolRegistry + globalToolRegistry
│   └── builtin-tools.ts  # 18 个内置工具
│
├── llm/             # LLM 抽象层
│   └── provider.ts       # LLMClient 接口 + chatCompletion
│
├── storage/         # 存储层
│   ├── db.ts             # SQLite (bun:sqlite)
│   ├── migrations-runner.ts # 迁移执行
│   └── migrations/       # SQL 迁移文件
│
├── models/          # 数据模型
├── state/           # 状态管理
├── compliance/      # 合规检查
├── tools/           # 写作工具 (hooks/POV/节奏/对话/健康)
├── genres/          # 题材规则
└── __tests__/       # 测试
```

---

## 核心概念

### Agent

每个 Agent 类 extends `BaseAgent`，有独立的 `name` 和领域知识。Agent 通过 `PipelineRunner` 执行写作任务。

### 工具

18 个内置工具注册到 `globalToolRegistry`：
- 创作：`plan_chapter`, `compose_chapter`, `write_draft`, `write_full_pipeline`
- 审校：`audit_chapter`, `revise_chapter`
- 知识：`read_truth_files`, `write_truth_file`, `update_author_intent`, `update_current_focus`
- 管理：`create_book`, `get_book_status`, `list_books`, `import_chapters`
- 辅助：`scan_market`, `web_fetch`, `import_style`, `import_canon`

### Agent 循环

`runAgentLoop(config, instruction, options?)` — 完整的 tool-calling 循环，最多 20 轮。支持 `agentId` 参数选择专属 system prompt。

### 编排

`runWritingPipeline(config, bookId, intent)` — 串行执行 Explorer → Planner → Writer → Auditor。

---

## 使用

```typescript
import { runAgentLoop, runWritingPipeline, getAgentSystemPrompt } from "@vivy1024/novelfork-core";

const result = await runAgentLoop(pipelineConfig, "写下一章", {
  agentId: "writer",
  maxTurns: 5,
});
```

---

## 构建

```bash
bun run build    # tsc → dist/
bun test         # vitest
```
