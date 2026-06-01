# Agent 写作管线

**版本**: v1.1.1
**创建日期**: 2026-05-10
**更新日期**: 2026-05-31
**状态**: ✅ 当前有效
**文档类型**: current

---

## 架构总览

所有写作能力通过 **Agent 工具层**（`session-tool-executor.ts`）统一执行。PipelineRunner 已删除，不再有独立的 CLI 或 scheduler/daemon。

```
用户对话 → 叙述者会话 → session-tool-executor.ts → Agent 类
```

核心入口：`packages/studio/src/api/lib/session-tool-executor.ts`

---

## 核心写作工具

| 工具 | 功能 |
|---|---|
| `pipeline.generate_chapter` | 完整写作管线：Planner→Composer→Writer→Auditor→Reviser |
| `pipeline.write` | v2 约束驱动写作（SceneSpec→Writer→AuditRevise） |
| `pipeline.revise` | 修订章节（5 种模式：polish/rewrite/rework/spot-fix/anti-detect） |
| `pipeline.import_chapters` | 整书导入（分章+基础设定+文风+经纬） |
| `rewrite.segment` | 选区改写（续写/扩写/桥接） |
| `rewrite.apply` | 改写结果写回章节文件 |
| `style.import` | 从参考文本提取文风档案 |
| `style.get_profile` | 获取当前书籍文风特征 |

---

## Agent 类

工具层直接实例化并调用底层 Agent 类，无中间编排器。

| Agent | 类 | 职责 |
|---|---|---|
| Planner | `PlannerAgent` | 根据大纲和当前状态规划下一章的目标、冲突、伏笔 |
| Composer | `ComposerAgent` | 组装写作上下文包（规则栈+上下文源+章节意图） |
| Writer | `WriterAgent` | 根据上下文包生成章节正文（双阶段：creative + settle） |
| Architect | `ArchitectAgent` | 生成作品整体架构（卷/幕/节奏） |
| Auditor | `ContinuityAuditor` | 连续性审计（37 维度检查） |
| Reviser | `ReviserAgent` | 根据审计结果修订（5 种模式） |
| StateValidator | `StateValidatorAgent` | 经纬一致性校验（diff + LLM 验证） |
| LengthNormalizer | `LengthNormalizerAgent` | 字数规范化（compress/expand） |
| ChapterAnalyzer | `ChapterAnalyzerAgent` | 章节分析（导入时逐章提取经纬） |
| StyleAnalyzer | `style-analyzer.ts` | 文风统计分析（纯文本，无 LLM） |
| InlineWriter | `inline-writer.ts` | 选区变换写作（续写/扩写/桥接） |
| DialogueGenerator | `dialogue-generator.ts` | 多角色对话生成 |
| VariantGenerator | `variant-generator.ts` | 多版本改写 |
| OutlineBrancher | `outline-brancher.ts` | 大纲分支生成 |
| Detector | `detector.ts` | AI 味检测（外部 API 调用） |

---

## pipeline.generate_chapter 流程

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

候选稿 accept 后，如果 metadata 中包含 `jingweiDelta`，经纬条目会自动更新。

---

## v2 约束驱动管线（pipeline.write）

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

---

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

---

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

---

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

---

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

---

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

---

## AI 选区变换

对选中文本执行的 AI 操作：

| 操作 | 说明 |
|---|---|
| polish | 润色：改善文笔但保持原意 |
| condense | 精简：压缩篇幅 |
| expand | 扩写：增加细节 |
| audit | 审计：检查选区内的连续性问题 |

---

## 连续性审计

`ContinuityAuditor` 执行 37 维度的检查：

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

---

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

---

## 设计决策

1. **Agent 工具层为唯一执行层**：所有写作能力通过 `session-tool-executor.ts` 调用底层 Agent 类，无中间编排器。

2. **候选稿机制**：所有 AI 生成的内容先进入候选稿，用户审阅后才写入正式章节。避免 AI 直接修改用户作品。

3. **outputBoundary 分类**：每个写作动作声明其输出边界，前端据此决定后续 UI 流程。

4. **AI 味检测不用 LLM**：纯规则分析，零成本、零延迟、可离线运行。

5. **多模型支持**：通过 modelOverrides 为不同 Agent 指定不同模型，平衡质量和成本。
