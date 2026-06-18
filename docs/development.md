# 开发者指南

## 前提

- **Bun** >= 1.1（运行时 + 打包 + 测试）
- **Node.js** >= 20（部分工具链依赖）
- **Git**

## 项目结构

```
packages/
├── core/           通用基础设施（storage/llm/state/hooks）
├── studio/         Agent 工作台（后端 API + 前端 React 19）
├── novel-plugin/   小说领域插件
└── cli/            CLI 工具
```

## 常用命令

```bash
# 安装依赖
bun install

# 开发模式（前后端 + HMR）
bun run dev

# 类型检查
bun run typecheck

# 运行测试
bun test

# 编译 Windows exe
cd packages/studio && bun run compile

# 产物路径
dist/novelfork-v1.11.0-windows-x64.exe

# 生成代码导航图
bun run codegraph

# 检查文档漂移
bun run docs:drift
```

## 添加新工具

1. 在 `packages/novel-plugin/src/engine/tools/` 下创建工具模块
2. 在 `tool-schemas.ts` 中定义 JSON Schema
3. 在 `session-tool-registry.ts` 中注册工具名称和分组
4. 在 `session-tool-executor.ts` 中添加 case 分支处理执行逻辑
5. 如需常驻，加入 `NOVEL_CORE_TOOLS` 集合

工具执行结果格式：

```typescript
interface SessionToolExecutionResult {
  ok: boolean;
  summary: string;         // 给模型看的简短摘要
  data?: unknown;          // 结构化数据
  confirmation?: object;   // 需要用户确认时设置
}
```

## 添加新 Provider 适配器

1. 在 `packages/studio/src/api/lib/provider-adapters/` 下创建适配器文件
2. 实现 `RuntimeAdapter` 接口：

```typescript
interface RuntimeAdapter {
  generate(input: RuntimeAdapterInput): Promise<RuntimeAdapterResult>;
}
```

3. 在 `registry.ts` 中注册协议 → 适配器映射
4. 在 `shared/provider-catalog.ts` 的 `inferProtocol()` 中添加识别规则

## 调试工具

### PROMPT_DUMP

设置环境变量 `PROMPT_DUMP=1` 启动，每次 LLM 调用时将完整 prompt 写入 `.narrafork/prompt-dumps/`：

```bash
PROMPT_DUMP=1 bun run dev
```

### Turn Profiler

`turn-profiler.ts` 记录每个回合的：
- generate 耗时 / TTFT（首 token 时间）
- 工具执行耗时
- token 消耗
- 缓存命中率

数据通过 `request-observability.ts` 的 `logRequest()` 持久化。

### 结构化日志

`logger.ts` 提供分级日志：

```typescript
import { log } from "./logger.js";

log.info("Message", { key: "value" });
log.warn("Warning", { code: "xxx" });
log.error("Error", { error: err });
```

## 发布流程

```bash
# 1. 更新版本号（根 package.json + 各子包 + CLAUDE.md）
# 2. 更新 CHANGELOG.md
# 3. 提交
git commit -m "chore: bump v1.11.0"

# 4. 打 tag
git tag v1.11.0

# 5. 推送
git push && git push --tags

# 6. 编译
cd packages/studio && bun run compile

# 7. 计算 SHA256
sha256sum dist/novelfork-v1.11.0-windows-x64.exe

# 8. 创建 GitHub Release
gh release create v1.11.0 dist/novelfork-v1.11.0-windows-x64.exe \
  --title "v1.11.0" \
  --notes "Release notes here"
```

## 插件化边界

- `core/` 和 `studio/` **不允许**出现小说领域代码
- 小说功能只能在 `novel-plugin/` 中
- 插件通过 `core/src/plugins/plugin-manager.ts` 注册
- 工具通过 `session-tool-registry.ts` 的分组机制按需加载
