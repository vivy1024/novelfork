---
title: Agent 写作管线
summary: cockpit.snapshot、lore.read、memory.read、PGI、scene.spec、pipeline.write 的完整工具链
tags: [Agent, Pipeline, 工具层, 写作, 正式章节, 叙事记忆]
routes:
  - /next/narrators/:id
---

# Agent 写作管线

> NovelFork 的写作不是一个隐藏黑盒，而是 Agent 按固定工具链逐步完成：先调查上下文，再追问，再生成蓝图，最后写正式章节结果。

## 权威链路（v3.0.0）

```
用户请求写下一章
  → cockpit.snapshot
  → lore.read(scope=brief)
  → memory.read(purpose=write)
  → pgi.ask
  → AskUserQuestion
  → scene.spec
  → lore.read(scope=category) + memory.read
  → pipeline.write(sceneSpec)
  → 正式章节结果
  → memory.events（章节后动态事实待确认）
```

**核心原则**：

- Agent 本身就是调度器；工具链顺序由系统提示词约束。
- 写作结果进入正式章节结果，不创建 candidate/draft 主对象。
- 静态设定从 `lore.*` 读取；动态事实从 `memory.*` 读取。
- 写后变化先进入 `memory.events` pending 队列，由用户确认，避免 AI 自动污染 canon。

## 可用写作工具

| 工具 | 用途 | 风险等级 |
|------|------|---------|
| `cockpit.snapshot` | 获取当前书籍、章节和资源状态快照 | read |
| `lore.read` | 读取作者确认的静态 Lore（brief/category/search） | read |
| `memory.read` | 读取动态叙事记忆 ContextCard | read |
| `pgi.ask` | 生成写前追问，补齐本章意图 | read |
| `scene.spec` | 生成结构化写作蓝图 | read |
| `pipeline.write` | 按 sceneSpec 生成正式章节结果并进行质量机制处理 | draft-write |
| `memory.events` | 写后整理章节摘要、关系变化、伏笔推进为 pending 事件 | draft-write |
| `pipeline.revise` | 修订已有章节（polish/rewrite/rework/spot-fix/anti-detect） | draft-write |
| `rewrite.segment` | 对选中段落执行续写/扩写/去 AI 味/风格改写 | read/write |

## `pipeline.write` 内部做什么？

对外看是一次工具调用，内部会执行：

1. 组装 ContextCard：整合 sceneSpec、Lore、动态记忆、前文、风格/节拍等。
2. WriterAgent 三段式生成：creative → observer → settler。
3. 质量检查：长度治理、动态词频提示、AI 痕迹规则维度。
4. ContinuityAuditor / adversarial audit：连续性、叙事、文本多视角审查。
5. Severity Gate：S1 阻断、S2 修订、S3/S4 警告。
6. 生成正式章节 artifact，供前端画布审阅。

## 正式章节结果机制

```
pipeline.write → chapterId → 画布展示 → 正式章节继续编辑
```

- 正式章节结果附带 artifact，可在写作画布直接打开审阅。
- 正式章节写入由用户裁决，不由 AI 自动覆盖。

## 上下文组装优先级

1. Scene Spec 蓝图（本章目标与硬约束）
2. Lore / 经纬静态设定（canon/rules/reference）
3. Narrative Memory 动态 ContextCard（facts/timeline/hooks/state/style/semantic）
4. 前文摘要与驾驶舱快照
5. PGI 用户回答与作者指示
6. 低优先级风格/预设/节拍提示

## 错误处理

| 错误码 | 含义 | 处理 |
|--------|------|------|
| `book-not-found` | 书籍 ID 无效 | 检查 bookId |
| `llm-config-missing` | API Key 未配置 | 前往设置配置供应商 |
| `generation-failed` | LLM 调用失败 | 检查模型、fallback 与重试规则 |
| `timeout` | 生成超时 | 降低字数要求或换模型 |
| `spec-invalid` | Scene Spec 格式错误 | 补齐角色、地点、冲突、结果等字段 |

## 常见坑

- **跳过 `lore.read` / `memory.read`** → 容易丢静态设定或动态事实。
- **把写后事实写进 Lore** → 错误。章节摘要、关系变化、伏笔推进默认走 `memory.events`。
- **PGI 无问题就停住** → 错误。应记录 `skippedReason=no-questions` 并继续 scene.spec。

## Agent 查阅提示

- 权威入口：对话中的工具链，不存在旧 `guided.*` 独立计划层。
- 管线入口：`pipeline.write(sceneSpec)`。
- 上下文入口：`lore.read + memory.read`。
- 写后入口：`memory.events`。
- 安全原则：正式章节结果边界、用户确认、canon evidence 门禁。

## 可跳转功能入口

- 叙述者对话：工具调用、PGI 追问、scene.spec 审阅和章节结果查看都在对话/工作台中完成。 (/next/narrators/:id)
