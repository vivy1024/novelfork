# 05 - 开发者指南

NovelFork 开发环境与贡献指南。

## 环境准备

| 依赖 | 版本 | 说明 |
|------|------|------|
| Bun | 1.2+ | 运行时 + 包管理 + 编译 |
| Git | 2.x | 版本控制 |
| Node.js | 18+（可选） | 部分工具链兼容 |

```bash
# 安装依赖
bun install

# 验证环境
bun --version
bunx tsc --noEmit
```

## 构建命令

| 命令 | 作用 |
|------|------|
| `bun run dev` | 启动开发服务器（热重载） |
| `bun run typecheck` | TypeScript 类型检查 |
| `bun run compile` | 编译为 Windows x64 exe |
| `bun run codegraph` | 生成代码导航索引 |
| `bun run docs:drift` | 检查文档引用漂移 |

### 编译产物

```bash
cd packages/studio
bun run compile
# 输出: dist/novelfork-vX.Y.Z-windows-x64.exe
```

## 如何添加新工具

### 1. 定义 Schema

在 `packages/studio/src/api/agent-runtime/tool-schemas.ts` 添加：

```typescript
export const myToolSchema: ToolSchema = {
  name: 'my_tool.action',
  description: '工具描述',
  input_schema: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: '参数说明' }
    },
    required: ['param1']
  }
};
```

### 2. 注册工具

在 `session-tool-registry.ts` 注册到对应分组（NOVEL_CORE_TOOLS / 按需工具）。

### 3. 实现 Handler

在 `session-tool-executor.ts` 的 switch 中添加 case：

```typescript
case 'my_tool.action': {
  const { param1 } = input as MyToolInput;
  // 实现逻辑
  return { success: true, data: result };
}
```

### 4. 添加权限规则（如需）

在 `session-tool-policy.ts` 配置工具的默认策略。

## 如何添加新 Provider 适配器

1. 在 `core/src/llm/` 创建适配器文件
2. 实现 `LLMClient` 接口：
   - `chatCompletion(messages, options)`
   - `chatWithTools(messages, tools, options)`
   - `streamChat(messages, options, onChunk)`
3. 在 `provider-router.ts` 注册新适配器类型
4. 前端设置页添加对应的配置表单

## 如何添加新安全规则

安全层位于 `session-tool-executor.ts` 内：

| 扩展点 | 说明 |
|--------|------|
| `DANGEROUS_PATTERNS` | 正则匹配危险命令模式 |
| `commandBlocklist` | 完全禁止的命令列表 |
| `pathSandbox` | 路径白名单/黑名单 |
| `secretDetector` | 敏感文件模式匹配 |

添加规则后需在 `08-测试与质量` 中记录。

## 发布流程

```bash
# 1. 更新版本号（根 package.json + 各包 + CLAUDE.md）
bun run version:bump minor  # 或 patch / major

# 2. 更新 CHANGELOG.md
# 记录本版本所有变更

# 3. 提交
git add -A
git commit -m "chore: bump v1.X.Y"

# 4. 打标签
git tag v1.X.Y

# 5. 推送
git push origin master --tags

# 6. 编译
cd packages/studio && bun run compile

# 7. 发布 GitHub Release
gh release create v1.X.Y dist/novelfork-v1.X.Y-windows-x64.exe \
  --title "v1.X.Y" --notes "变更说明"
```

## 调试工具

### PROMPT_DUMP

导出完整的系统提示词和消息：

```bash
# 设置环境变量
PROMPT_DUMP=true
PROMPT_DUMP_DIR=./debug-prompts/
```

每次 LLM 调用会将完整 payload 写入指定目录。

### Turn Profiler

`turn-profiler.ts` 记录每回合耗时：
- LLM 调用时间
- 工具执行时间
- 上下文组装时间
- Token 用量

### 结构化日志

日志格式：
```json
{"ts": "2025-01-01T00:00:00Z", "level": "info", "msg": "...", "sessionId": "...", "toolName": "..."}
```

## 代码规范

| 规范 | 说明 |
|------|------|
| 严格 TypeScript | `strict: true`，不允许 `any` |
| 提交格式 | `type(scope): description` |
| 插件边界 | 小说代码只在 novel-plugin |
| 测试 | 关键路径需有集成测试 |
