# 统一写作管线 - 技术设计

---

## 架构概览

```
对话面板
  │
  ├─ writer agent prompt（改造后）
  │     │
  │     ├─ 1. cockpit.get_snapshot
  │     ├─ 2. jingwei.read_context
  │     ├─ 3. pgi.generate_questions → AskUserQuestion
  │     ├─ 4. 用户回答
  │     ├─ 5. pipeline.generate_chapter  ← 新工具
  │     │        │
  │     │        ├─ Composer.composeChapter()
  │     │        ├─ Writer.writeChapter()  (creative + settle)
  │     │        ├─ Auditor.auditChapter()
  │     │        ├─ Reviser.reviseChapter()  (if needed)
  │     │        └─ StateValidator.validate()
  │     │        │
  │     │        └─→ 返回 content + auditResult + jingweiDelta + artifact
  │     │
  │     └─ 6. 呈现结果给用户
  │
  └─ CandidateActionsBar
        │
        └─ accept → 自动执行 jingweiDelta
```

---

## 1. `pipeline.generate_chapter` 工具实现

### 位置

`packages/novel-plugin/src/handlers/pipeline-generate-service.ts`（新文件）

### 核心逻辑

```typescript
export interface PipelineGenerateInput {
  readonly bookId: string;
  readonly chapterIntent: string;
  readonly userDirectives?: string;
  readonly wordCount?: number;
  readonly autoRevise?: boolean;
}

export interface PipelineGenerateOutput {
  readonly ok: true;
  readonly content: string;
  readonly title: string;
  readonly wordCount: number;
  readonly chapterNumber: number;
  readonly auditResult: AuditResult;
  readonly revised: boolean;
  readonly jingweiDelta: JingweiDelta;
  readonly candidateId: string;
  readonly artifact: CanvasArtifact;
}

export interface JingweiDelta {
  readonly updated: Array<{ entryId: string; title: string; category: string; contentMd: string }>;
  readonly created: Array<{ title: string; category: string; contentMd: string }>;
  readonly warnings: string[];
}
```

### 执行流程

```typescript
async function executePipelineGenerate(
  input: PipelineGenerateInput,
  options: { root: string; onStream?: (chunk: string) => void }
): Promise<PipelineGenerateOutput | PipelineGenerateError> {

  // 1. 加载 book config + 确定 chapterNumber
  const book = await state.loadBookConfig(input.bookId);
  const chapterNumber = await state.getNextChapterNumber(input.bookId);
  const bookDir = state.bookDir(input.bookId);

  // 2. 构建 LLM client（从 session 的 provider 配置）
  const client = createLLMClient(providerConfig);

  // 3. Composer 组装上下文
  const composer = new ComposerAgent(agentCtx);
  const composed = await composer.composeChapter({
    book, bookDir, chapterNumber,
    plannerOutput: { intent: input.chapterIntent, ... },
    externalContext: input.userDirectives,
  });

  // 4. Writer 生成（流式）
  const writer = new WriterAgent(agentCtx);
  const writeOutput = await writer.writeChapter({
    book, bookDir, chapterNumber,
    chapterIntent: input.chapterIntent,
    contextPackage: composed.contextPackage,
    ruleStack: composed.ruleStack,
    lengthSpec: buildLengthSpec(input.wordCount ?? book.chapterWordCount),
    onStreamProgress: options.onStream,
  });

  // 5. Auditor 审计
  const auditor = new ContinuityAuditor(agentCtx);
  let auditResult = await auditor.auditChapter(
    bookDir, writeOutput.content, chapterNumber, book.genre
  );

  // 6. 自动修订（如果需要）
  let finalContent = writeOutput.content;
  let revised = false;
  if (!auditResult.passed && input.autoRevise !== false) {
    const criticalIssues = auditResult.issues.filter(i => i.severity === "critical");
    if (criticalIssues.length > 0) {
      const reviser = new ReviserAgent(agentCtx);
      const reviseOutput = await reviser.reviseChapter(
        bookDir, finalContent, chapterNumber, criticalIssues, "spot-fix", book.genre
      );
      finalContent = reviseOutput.revisedContent;
      revised = true;
      // 重新审计
      auditResult = await auditor.auditChapter(bookDir, finalContent, chapterNumber, book.genre);
    }
  }

  // 7. StateValidator
  const validator = new StateValidatorAgent(agentCtx);
  const validationResult = await validator.validate(
    finalContent, chapterNumber,
    writeOutput.oldState, writeOutput.updatedState,
    writeOutput.oldHooks, writeOutput.updatedHooks,
  );

  // 8. 构建 jingweiDelta
  const jingweiDelta = buildJingweiDelta(writeOutput);

  // 9. 保存为候选稿
  const candidateId = saveCandidateResource(input.bookId, chapterNumber, writeOutput.title, finalContent);

  // 10. 构建 artifact
  const artifact = buildCandidateArtifact(candidateId, writeOutput.title, finalContent);

  return {
    ok: true,
    content: finalContent,
    title: writeOutput.title,
    wordCount: countWords(finalContent),
    chapterNumber,
    auditResult,
    revised,
    jingweiDelta,
    candidateId,
    artifact,
  };
}
```

---

## 2. 工具注册

### 位置

`packages/novel-plugin/src/handlers/tool-registry.ts` 新增：

```typescript
sessionTool({
  name: "pipeline.generate_chapter",
  description: "调用完整写作管线生成章节：上下文组装→正文生成→审计→修订→经纬同步。返回候选稿+审计报告。",
  inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["pipeline.generate_chapter"]),
  risk: "draft-write",
  renderer: "pipeline.chapter-result",
  enabledForModes: WRITE_SESSION_PERMISSION_MODES,
  scope: "novel",
}),
```

### 工具执行器

`packages/studio/src/api/lib/session-tool-executor.ts` 新增 case：

```typescript
case "pipeline.generate_chapter":
  return async ({ input, definition }) => {
    const result = await executePipelineGenerate(
      { bookId, chapterIntent, userDirectives, wordCount, autoRevise },
      { root, onStream: onToolOutputStream }
    );
    if (!result.ok) return { ok: false, ... };
    return {
      ok: true,
      renderer: definition.renderer,
      summary: `第${result.chapterNumber}章「${result.title}」生成完成（${result.wordCount}字）。审计：${result.auditResult.passed ? "通过" : "未通过"}。`,
      data: result,
      artifact: result.artifact,
    };
  };
```

---

## 3. Writer Agent Prompt 改造

修改 `AGENT_SYSTEM_PROMPTS.writer` 中第 5 步：

```diff
- 5. 收集到用户回答后，先由你自己直接生成完整章节正文，再调用 candidate.create_chapter 保存候选稿。
+ 5. 收集到用户回答后，调用 pipeline.generate_chapter 工具生成章节。
+    该工具会自动完成：上下文组装→正文生成→审计→修订→经纬同步。
+    你只需传入 bookId、chapterIntent（基于用户回答组装的写作意图）、userDirectives（PGI 格式化的指示）。
+    工具返回后，将审计结果和经纬变更摘要告知用户，等待用户决策。
```

---

## 4. candidate.accept 经纬同步

### 位置

`packages/novel-plugin/src/engine/writing-resource/service.ts` 的 `acceptResource` 函数

### 改造

在 accept 成功后，检查候选稿 metadata 中是否有 `jingweiDelta`：

```typescript
// accept 成功后
if (resource.metadata?.jingweiDelta) {
  const delta = resource.metadata.jingweiDelta as JingweiDelta;
  await applyJingweiDelta(resource.bookId, delta);
}
```

`applyJingweiDelta` 调用 `createStoryJingweiEntryRepository` 批量 upsert。

---

## 5. 流式输出

`pipeline.generate_chapter` 的 Writer 阶段支持流式输出：

- `session-tool-executor` 传入 `onToolOutputStream` 回调
- Writer 的 `onStreamProgress` 将 chunk 推送到该回调
- 前端通过 `session:tool-stream` envelope 实时接收

---

## 6. 前端审计报告渲染

新增 renderer `pipeline.chapter-result`：

- 在对话面板中渲染结构化卡片
- 显示：章节标题 / 字数 / 审计状态 / issues 列表 / 经纬变更摘要
- 提供操作按钮：在画布中打开 / 接受 / 重新生成

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `novel-plugin/src/handlers/pipeline-generate-service.ts` | 新增 | 核心执行逻辑 |
| `novel-plugin/src/handlers/tool-registry.ts` | 修改 | 注册 `pipeline.generate_chapter` |
| `novel-plugin/src/tool-schemas.ts` | 修改 | 添加 input schema |
| `studio/src/api/lib/session-tool-executor.ts` | 修改 | 添加 case handler |
| `novel-plugin/src/engine/pipeline/agent-prompts.ts` | 修改 | writer prompt 第 5 步改为调用 pipeline 工具 |
| `novel-plugin/src/engine/writing-resource/service.ts` | 修改 | accept 后自动应用 jingweiDelta |
| `novel-plugin/src/pages/writing-workbench/` | 修改 | 新增 pipeline.chapter-result renderer |

---

## 依赖

- `context-and-presets-overhaul` P0（经纬注入）必须先完成
- Pipeline Agent class 不做任何修改，直接复用
- LLM provider 配置从 session config 获取

---

## 7. 架构优化：消除双轨制

### 当前架构问题

```
                    ┌─────────────────────────────────┐
                    │         novel-plugin             │
                    ├─────────────────────────────────┤
                    │                                 │
                    │  engine/pipeline/runner.ts       │  ← Pipeline 体系
                    │  engine/agents/ (17 个 class)    │     PipelineRunner 编排
                    │       │                         │     CLI / 异步 API 调用
                    │       │ 零交集                   │
                    │       │                         │
                    │  engine/pipeline/agent-prompts.ts│  ← 对话体系
                    │  handlers/tool-registry.ts       │     8 个 prompt 角色
                    │  handlers/*-service.ts           │     28 个 session 工具
                    │                                 │
                    └─────────────────────────────────┘

问题：两套体系名字相似但代码零交集，Pipeline 没人用，对话模式无质量保障。
```

### 目标架构

```
                    ┌─────────────────────────────────┐
                    │         novel-plugin             │
                    ├─────────────────────────────────┤
                    │                                 │
                    │  engine/pipeline/               │  ← 核心能力层（不变）
                    │    runner.ts                    │     Composer/Writer/Auditor/
                    │    agent-prompts.ts             │     Reviser/StateValidator
                    │  engine/agents/ (17 个 class)   │
                    │       │                         │
                    │       │ 被调用                   │
                    │       ▼                         │
                    │  handlers/                      │  ← 接入层
                    │    pipeline-generate-service.ts │     封装 Pipeline 为 session tool
                    │    tool-registry.ts             │     注册 pipeline.generate_chapter
                    │    *-service.ts                 │     其他 28 个工具不变
                    │                                 │
                    └────────────────┬────────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                ▼                │
                    │  调用入口                        │
                    │                                 │
                    │  1. 对话模式（主路径）            │
                    │     writer agent prompt          │
                    │     → pipeline.generate_chapter  │
                    │                                 │
                    │  2. CLI（保留）                   │
                    │     novelfork write              │
                    │     → PipelineRunner 直接调用    │
                    │                                 │
                    │  3. 异步 API（保留）              │
                    │     POST /api/books/:id/write-next│
                    │     → PipelineRunner 直接调用    │
                    │                                 │
                    └─────────────────────────────────┘
```

### 关键变化

| 层 | 变化 |
|---|---|
| **engine/agents/** | 不变。17 个 class 继续作为核心能力 |
| **engine/pipeline/runner.ts** | 不变。CLI 和异步 API 继续直接调用 |
| **engine/pipeline/agent-prompts.ts** | 修改 writer prompt：从裸写改为调用 pipeline 工具 |
| **handlers/pipeline-generate-service.ts** | 新增。封装 Pipeline 能力为 session tool 可调用的函数 |
| **handlers/tool-registry.ts** | 新增一个工具注册 |
| **对话 8 个 Agent 角色** | 保留。writer 行为变化，其余不变 |

### 消除的冗余

| 之前 | 之后 |
|---|---|
| Pipeline 17 个 class 是死代码 | 通过 `pipeline.generate_chapter` 被对话模式调用 |
| 对话模式 LLM 裸写无保障 | 走 Pipeline 的 Auditor/Reviser/StateValidator |
| 经纬同步靠 LLM 自觉 | accept 后自动应用 jingweiDelta |
| 两套体系各自维护 | 一套核心能力，多个调用入口 |

### 不删除的代码

- `PipelineRunner` 类和所有公开方法 — CLI 和异步 API 仍需要
- 异步 API 路由 `POST /api/books/:id/write-next` — 批量生成场景仍需要
- 8 个对话 Agent prompt — 角色分工仍有价值（writer/planner/auditor/architect/explorer/hooks/chapter-hooks/outline）
- `candidate.create_chapter` 工具 — 非 pipeline 场景（用户手动粘贴正文）仍需要

### 长期演进方向

1. **其他对话 Agent 也接入 Pipeline 能力**：
   - auditor agent → 调用 `ContinuityAuditor.auditChapter()` 而非 LLM 自由发挥
   - hooks agent → 调用 Planner 的伏笔提取逻辑而非 LLM 猜测

2. **Pipeline 工具族扩展**：
   - `pipeline.audit_chapter` — 封装 Auditor
   - `pipeline.revise_chapter` — 封装 Reviser
   - `pipeline.generate_outline` — 封装 Architect

3. **对话 Agent 角色精简**：
   - 当 Pipeline 工具足够丰富时，8 个角色可能合并为 3-4 个（writer / manager / explorer）
   - 但这是后续优化，不在本 spec 范围内
