# 代码规范

## 技术栈

| 层 | 技术 |
|----|------|
| 运行时 | Bun（推荐）/ Node.js >= 22.5.0 |
| 语言 | TypeScript 5.x strict |
| 包管理 | pnpm workspace |
| 测试 | Vitest |
| CLI | Commander.js |
| Web | React 19 + Vite + Tailwind + shadcn |
| 后端 | Hono |
| 分发 | Bun compile 单文件（Tauri 旧线已退役） |
| 数据库 | SQLite（本地） |

---

## 包依赖方向

```
cli → studio → core
studio → core
```

单向依赖，core 不依赖任何上层包。

workspace 引用格式：`"@vivy1024/novelfork-core": "workspace:*"`

---

## TypeScript 风格

- 所有 interface 字段用 `readonly`
- 优先 `type` 而非 `interface`（除非需要 extends）
- Zod schema 命名：`type Xxx` 对应 `XxxSchema`
- 导出集中在 `index.ts`，内部模块用 `.js` 后缀引用
- 不用 `enum`，用 `as const` 对象或 union type
- 不用 `class` 做数据容器，只用于有行为的 Agent/Manager

---

## Agent 编写规范

```typescript
export class XxxAgent extends BaseAgent {
  get name(): string {
    return "xxx"; // 用于 modelOverrides 匹配
  }

  async doSomething(input: XxxInput): Promise<XxxOutput> {
    const response = await this.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);
    // parse response...
  }
}
```

- 继承 `BaseAgent`，通过 `this.chat()` / `this.chatWithTools()` 调用 LLM
- 输入输出用 readonly interface 定义
- prompt 复杂时抽到独立文件（如 `writer-prompts.ts`、`settler-prompts.ts`）
- parser 独立文件（如 `writer-parser.ts`）

---

## 测试规范

- 测试可与被测模块同目录放置，或放入 `src/__tests__/`
- 用 `pnpm --dir packages/studio exec vitest run` / `vitest run`（不用 watch 模式）
- mock LLM 调用，不在单元测试中真实请求
- 核心管线逻辑需集成测试

---

## 文件组织

```
packages/core/src/
├── agents/        # Agent 实现
├── hooks/         # Hook 系统
├── llm/           # LLM provider 抽象
├── mcp/           # MCP client
├── models/        # Zod schema + types
├── notify/        # 通知渠道
├── pipeline/      # 管线编排
├── registry/      # 工具注册
├── relay/         # 事件中继
├── state/         # 状态管理
├── storage/       # 持久化
└── utils/         # 工具函数
```

---

## 构建

```bash
pnpm build                                      # 全量构建
pnpm typecheck                                  # 类型检查
pnpm --dir packages/studio exec vitest run      # Studio 全量测试
pnpm --dir packages/studio compile              # 单文件与版本化 release 产物
```

单包开发：
```bash
pnpm --dir packages/core build
pnpm --dir packages/studio dev  # Vite dev server :4567
```
