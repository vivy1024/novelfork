# Agent 写作管线

**版本**: v1.1.0
**创建日期**: 2026-05-10
**更新日期**: 2026-05-29
**状态**: ✅ 当前有效
**文档类型**: current

---

## v2 约束驱动管线（推荐）

v1.1.0 引入精简管线，从 5 次 LLM 调用降到 2 次：

```
用户: "写下一章"
  │
  ├─ cockpit.snapshot        → 进度/伏笔/候选稿
  ├─ jingwei.read(brief)     → 经纬核心包 4000 tokens + 分类目录
  ├─ pgi.ask                 → 追问 + 用户确认方向
  │
  ▼ [Gate: H5 用户已确认]
  │
  ├─ scene.spec              → 结构化写作蓝图 (LLM call #1 或占位推断)
  │   输出: { chapter, title, wordTarget, scenes[], constraints[] }
  │   H4 校验: 每个 scene 必须有 characters/location/conflict/outcome
  │
  ▼ [Gate: H4 spec 完整]
  │
  ├─ jingwei.read(category)  → 按蓝图补读相关经纬
  ├─ pipeline.write          → Writer 生成正文 (LLM call #2)
  │                          → AuditRevise 审计+修订 (LLM call #3, 条件触发)
  │   H2 检查: Canon violation
  │   H7 检查: POV violation
  │   S1-S5: 软约束（字数/AI味/角色出场/节奏）
  │
  ▼ [Gate: H3 只进候选区]
  │
  └─ 候选稿保存 → 用户审核 → 合并到正式章节
```

核心文件：
- `packages/novel-plugin/src/handlers/pipeline-write-service.ts` — v2 管线入口
- `packages/novel-plugin/src/handlers/scene-spec-handler.ts` — Scene Spec 生成
- `packages/novel-plugin/src/handlers/chapter-audit-v2.ts` — 硬约束审计

## v1 完整管线（保留兼容）

以下是 v1 管线文档，通过 `pipeline.generate_chapter` 工具调用。

## PipelineRunner

核心写作引擎，位于 `packages/novel-plugin/src/engine/pipeline/runner.ts`。

### 主要方法

| 方法 | 功能 |
|---|---|
| `writeNextChapter` | 完整写作流程：规划→编排→写作→审计→修订 |
| `writeDraft` | 只生成草稿，不走审计修订 |
| `reviseDraft` | 对已有章节执行修订 |
| `resyncChapterArtifacts` | 重新同步章节产物（真相文件更新后） |
| `generateStyleGuide` | 生成文风指南 |
| `importChapters` | 导入已有章节 |
| `importCanon` | 导入同人原作设定 |
| `runRadar` | 运行市场雷达 |

### 配置

```typescript
export interface PipelineConfig {
  readonly client: LLMClient;
  readonly model: string;
  readonly projectRoot: string;
  readonly defaultLLMConfig?: LLMConfig;
  readonly notifyChannels?: ReadonlyArray<NotifyChannel>;
  readonly radarSources?: ReadonlyArray<RadarSource>;
  readonly externalContext?: string;
  readonly modelOverrides?: Record<string, string | AgentLLMOverride>;
  readonly inputGovernanceMode?: InputGovernanceMode;
  readonly logger?: Logger;
  readonly onStreamProgress?: OnStreamProgress;
  readonly storage?: StorageDatabase;
}
```

`modelOverrides` 允许为不同 Agent 角色指定不同模型（如 Writer 用大模型，Auditor 用小模型）。

## Agent 角色

```
┌─────────────────────────────────────────────────────────────┐
│                    writeNextChapter 流程                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ Planner  │───▶│ Composer │───▶│  Writer  │              │
│  │ 规划章节  │    │ 编排上下文│    │ 生成正文  │              │
│  └──────────┘    └──────────┘    └──────────┘              │
│                                       │                     │
│                                       ▼                     │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ Reviser  │◀───│ Auditor  │◀───│Analyzer  │              │
│  │ 修订正文  │    │ 连续性审计│    │ 章节分析  │              │
│  └──────────┘    └──────────┘    └──────────┘              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

| Agent | 类 | 职责 |
|---|---|---|
| Planner | `PlannerAgent` | 根据大纲和当前状态规划下一章的目标、冲突、伏笔 |
| Composer | `ComposerAgent` | 组装写作上下文包（规则栈+上下文源+章节意图） |
| Writer | `WriterAgent` | 根据上下文包生成章节正文（双阶段：creative + settle） |
| Architect | `ArchitectAgent` | 生成作品整体架构（卷/幕/节奏） |
| FoundationReviewer | `FoundationReviewerAgent` | 审查架构可行性（多维度评分） |
| Auditor | `ContinuityAuditor` | 连续性审计（37 维度检查） |
| Reviser | `ReviserAgent` | 根据审计结果修订（5 种模式） |
| StateValidator | `StateValidatorAgent` | 经纬一致性校验（diff + LLM 验证） |
| LengthNormalizer | `LengthNormalizerAgent` | 字数规范化（compress/expand） |
| ChapterAnalyzer | `ChapterAnalyzerAgent` | 章节分析（导入时逐章提取经纬） |
| Explorer | `RadarAgent` | 市场雷达，分析平台排行数据 |
| InlineWriter | `inline-writer.ts` | 选区变换写作（续写/扩写/桥接） |
| DialogueGenerator | `dialogue-generator.ts` | 多角色对话生成 |
| VariantGenerator | `variant-generator.ts` | 多版本改写 |
| OutlineBrancher | `outline-brancher.ts` | 大纲分支生成 |
| StyleAnalyzer | `style-analyzer.ts` | 文风统计分析（纯文本，无 LLM） |
| Detector | `detector.ts` | AI 味检测（外部 API 调用） |

## 工具链流程（Session-native 写作）

在叙述者会话中，写作通过工具链完成：

```
cockpit.get_snapshot
    │  获取驾驶舱快照（当前进度、伏笔、风险）
    ▼
pgi.generate_questions
    │  PGI 引擎生成引导问题（Plot Guidance Interface）
    ▼
guided.enter / guided.exit
    │  进入/退出引导模式，收集用户对章节方向的偏好
    ▼
candidate.create_chapter
    │  生成候选稿（不直接写入正式章节）
    ▼
[用户审阅候选稿]
    │
    ▼
candidate.accept / candidate.reject
    │  接受→写入正式章节（+ 经纬自动同步） / 拒绝→重新生成
```

## 统一写作管线工具（pipeline.generate_chapter）

v1.0.7 新增的核心工具，将 Pipeline Agent 能力封装为对话模式可调用的 session tool：

```
pipeline.generate_chapter
    │  输入：bookId + chapterIntent + userDirectives
    │
    ├─ 1. Planner — 规则引擎提取 intent/goal/conflicts
    ├─ 2. Composer — 组装完整上下文包（lorebook RAG + 规则栈）
    ├─ 3. Writer — 双阶段生成（creative + settle）
    ├─ 4. Auditor — 37 维度审计
    ├─ 5. Reviser — 自动修订 critical issues（可选）
    ├─ 6. StateValidator — 经纬一致性校验
    │
    └─→ 输出：候选稿 + 审计报告 + 经纬变更 delta（jingweiDelta）
```

与 `candidate.create_chapter` 的区别：
- `candidate.create_chapter`：纯存储工具，接收已生成的正文保存为候选稿
- `pipeline.generate_chapter`：完整管线，内部调用 Pipeline Agent class 生成+审计+修订

候选稿 accept 后，如果 metadata 中包含 `jingweiDelta`，经纬条目会自动更新（无需 LLM 手动调用 `jingwei.upsert_entry`）。

## 对话模式经纬上下文注入

对话模式通过 `buildAgentContext()` 自动注入经纬上下文：

```
session-chat-service
    │
    ├─ buildAgentContext({ bookId, sceneText })
    │     ├─ buildJingweiContext() — global/tracked/nested + 时间轴 + 优先级 + token 预算
    │     ├─ buildChapterBriefing() — 活跃角色/伏笔/硬约束
    │     ├─ buildRecursiveSummaryContext() — 卷摘要 + 近 5 章摘要
    │     └─ 大窗口模式（≥500K）：前一章全文 + full 模式注入
    │
    └─ 预设/节拍注入（enabledPresetIds + beatTemplateId）
```

这与 Pipeline 模式（通过 `buildBibleContext` + `pipeline-bridge.ts`）是两条独立路径。

## 确认门（ConfirmationGate）

写入正式资源前的审批机制。当 AI 工具需要执行破坏性操作时，暂停执行并向前端发送确认请求：

```typescript
export interface ToolConfirmationRequest {
  toolName: string;
  description: string;
  impact: "read" | "write" | "destructive";
  payload: unknown;
}

export type ToolConfirmationDecision =
  | { allowed: true }
  | { allowed: false; reason?: string };
```

前端 `ConfirmationGate` 组件展示待确认列表，用户逐个批准或拒绝。

## 写作动作适配器

`src/app-next/backend-contract/writing-action-adapter.ts` 定义了所有写作动作的描述符：

```typescript
export interface WritingActionDescriptor {
  id: string;                    // 动作唯一标识
  label: string;                 // UI 显示名称
  entry: string;                 // 入口（API 路径或工具链）
  outputBoundary: "candidate-artifact" | "async-start" | "draft-artifact"
                | "prompt-preview" | "analysis" | "gate";
  writesFormalChapter: boolean;  // 是否直接写入正式章节
  capability: BackendCapability; // 能力状态
  chain?: readonly string[];     // 工具链步骤（session-native 模式）
}
```

当前注册的写作动作：

| ID | 标签 | 输出边界 |
|---|---|---|
| `session-native.write-next` | Session-native 写下一章 | candidate-artifact |
| `ai.write-next.async` | 异步写下一章 | async-start |
| `ai.draft.async` | AI draft 异步动作 | async-start |
| `writing-modes.preview` | Writing modes 预览 | prompt-preview |
| `writing-modes.apply` | Writing modes 安全应用 | candidate-artifact |
| `hooks.generate` | 生成伏笔建议 | gate |
| `hooks.apply` | 应用伏笔到 pending_hooks.md | draft-artifact |
| `ai.audit` | 连续性审校 | analysis |
| `ai.detect` | AI 味检测 | analysis |

所有写作动作的结果通过 `normalizeWritingActionResult()` 统一归一化为 `NormalizedWritingActionResult`，前端根据 `kind` 字段决定展示方式。

## 写作模式路由

inline-write 模式（选区变换）：

| 模式 | 说明 |
|---|---|
| `continuation` | 续写：从选区末尾继续 |
| `expansion` | 扩写：展开选区内容 |
| `bridge` | 桥接：连接两段文本 |

对话生成：
- `dialogue/generate` — 根据角色和场景生成对话

变体生成：
- `variants/generate` — 生成多个候选版本

大纲分支：
- `outline/branch` — 从当前节点分叉出新的剧情走向

## AI 选区变换

对选中文本执行的 AI 操作：

| 操作 | 说明 |
|---|---|
| polish | 润色：改善文笔但保持原意 |
| condense | 精简：压缩篇幅 |
| expand | 扩写：增加细节 |
| audit | 审计：检查选区内的连续性问题 |

## 连续性审计

`ContinuityAuditor` 执行 17+ 维度的检查：

```typescript
export interface AuditResult {
  readonly passed: boolean;
  readonly issues: ReadonlyArray<AuditIssue>;
  readonly summary: string;
  readonly tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface AuditIssue {
  readonly severity: "critical" | "warning" | "info";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}
```

审计维度（部分）：

| 维度 | 检查内容 |
|---|---|
| OOC 检查 | 角色行为是否符合人设 |
| 时间线检查 | 时间逻辑是否自洽 |
| 设定冲突 | 是否违反已建立的世界观 |
| 战力崩坏 | 力量体系是否一致 |
| 数值检查 | 数字/数量是否前后矛盾 |
| 伏笔检查 | 伏笔是否被遗忘或矛盾回收 |
| 节奏检查 | 叙事节奏是否合理 |
| 文风检查 | 文风是否漂移 |
| 信息越界 | 角色是否知道不该知道的信息 |
| 词汇疲劳 | 是否过度重复用词 |
| 台词失真 | 对话是否符合角色身份 |
| 流水账 | 是否陷入流水账叙事 |

同人模式额外启用 `fanfic-dimensions`（OOC 检查加强等）。

## AI 味检测

`analyzeAITells` 是纯规则分析，不调用 LLM：

```typescript
export function analyzeAITells(content: string, language: "zh" | "en" = "zh"): AITellResult;
```

检测维度：
- **dim 20**：段落长度均匀度（低方差 → AI 痕迹）
- **dim 21**：填充词/对冲词密度（"似乎"、"可能"、"或许"等）
- **dim 22**：公式化转折模式（"然而"、"不过"、"与此同时"等）
- **dim 23**：列表结构（连续相同前缀句子）

## 上下文组装

写作前的上下文准备流程：

```
加载真相文件（current_state.md / pending_hooks.md / story_bible.md）
    │
    ▼
按章节号过滤（filterHooks / filterSummaries / filterSubplots）
    │
    ▼
POV 提取（extractPOVFromOutline → filterMatrixByPOV / filterHooksByPOV）
    │
    ▼
Bible 上下文构建（buildBibleContext → mergeBibleContextWithExternalContext）
    │
    ▼
Token 预算控制（token-budget.ts → 裁剪超出预算的上下文）
    │
    ▼
组装 ContextPackage + RuleStack → 传入 Writer
```

## SSE 事件广播

管线执行过程中通过 `pipelineEvents` 广播事件：

```typescript
export type PipelineEvent =
  | PipelineRunStart
  | PipelineStageUpdate
  | PipelineRunComplete;
```

前端通过 SSE 订阅这些事件，实时展示写作进度。事件类型包括：
- `write:start` / `write:complete` / `write:error`
- `audit:start` / `audit:complete` / `audit:error`
- `revise:start` / `revise:complete`
- `detect:start` / `detect:complete`

## 设计决策

1. **候选稿机制**：所有 AI 生成的内容先进入候选稿，用户审阅后才写入正式章节。避免 AI 直接修改用户作品。

2. **outputBoundary 分类**：每个写作动作声明其输出边界，前端据此决定后续 UI 流程（展示候选稿 vs 等待异步事件 vs 展示分析结果）。

3. **AI 味检测不用 LLM**：纯规则分析，零成本、零延迟、可离线运行。LLM 审计是另一个维度的检查。

4. **多模型支持**：通过 `modelOverrides` 为不同 Agent 指定不同模型，平衡质量和成本。Writer 可用大模型，Auditor 可用小模型。
