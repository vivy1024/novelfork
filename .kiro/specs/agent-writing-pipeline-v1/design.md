# Agent 写作管线 v1 — Design

**版本**: v2.0.0
**创建日期**: 2026-05-01
**修订日期**: 2026-05-01
**状态**: 待审批

---

## 设计定位

本 spec 打通 NovelFork 已有的三层 Agent 系统，让它们真正协同工作。不新建 Agent 类（13 个够用）、不新建工具（Core 18 + NarraFork 22 = 40 个够用）、不新建 Agent 循环。只做「打通」和「补缺」。

---

## 1. 工具默认开关（R1）

### 1.1 设计思路

不是新建工具配置系统，而是利用已有的 `ToolsTab.AVAILABLE_TOOLS` + `/api/routines` 持久化。默认开关在 `AVAILABLE_TOOLS` 数组的 `enabled` 字段中定义，作者可在套路页手动调整。

### 1.2 推荐的工具分配

```typescript
// ToolsTab.tsx 中修改 AVAILABLE_TOOLS 的默认 enabled 值

// Writer Agent 推荐
{ name: "Bash", enabled: true }       // 需审批 — 执行 gen 脚本等
{ name: "Read", enabled: true }        // 只读
{ name: "Write", enabled: true }       // 需审批 — 写候选稿
{ name: "Edit", enabled: true }        // 需审批
{ name: "Grep", enabled: true }        // 只读
{ name: "Glob", enabled: true }        // 只读
{ name: "EnterWorktree", enabled: true }
{ name: "ExitWorktree", enabled: true }
{ name: "TodoWrite", enabled: true }

// 以下默认关闭（Writer 不需要）
{ name: "Terminal", enabled: false }
{ name: "Browser", enabled: false }
{ name: "ForkNarrator", enabled: false }
{ name: "NarraForkAdmin", enabled: false }
{ name: "Recall", enabled: false }
{ name: "ShareFile", enabled: false }
{ name: "WebSearch", enabled: false }
{ name: "WebFetch", enabled: false }
```

工具开关是全局的，但权限模式（allow/ask/deny）已在 PermissionsTab 中可按工具粒度和 Agent 角色细化。不新增按 Agent 角色独立的工具开关——保持现有架构。

---

## 2. Agent System Prompt 差异化（R2）

### 2.1 设计思路

当前 `runAgentLoop` 在 `pipeline/agent.ts` 中硬编码 system prompt（L321-384）。需要：

1. 将 system prompt 从函数体内提取到独立文件 `agent-prompts.ts`
2. `runAgentLoop` 新增 `agentId` 参数
3. 根据 agentId 选择对应的 system prompt 模板
4. 注入作品上下文（R3）到 system prompt 末尾

### 2.2 agent-prompts.ts 结构

```typescript
// packages/core/src/pipeline/agent-prompts.ts

export const AGENT_SYSTEM_PROMPTS: Record<string, string> = {
  writer: `你是 NovelFork 的小说写作 Agent。
    [领域知识] 你熟悉仙侠/玄幻/都市/科幻的写作范式...
    [工具使用] 用 read_truth_files 获取上下文，用 write_draft 续写...
    [输出规范] 直接输出正文，不要复述提示词...
    [安全约束] 生成结果只写入候选稿，不直接覆盖正式章节...`,
  
  planner: `你是 NovelFork 的小说规划 Agent。
    [领域知识] 你擅长章节大纲设计、情节点编排、伏笔部署、节奏控制...
    [工具使用] 用 plan_chapter 制定大纲，用 get_book_status 了解进度...
    [输出规范] 输出结构化的大纲，包含场景/情节点/伏笔节点/情绪曲线...`,
  
  auditor: `你是 NovelFork 的小说审计 Agent。
    [领域知识] 你擅长人物设定一致性检查、伏笔回收跟踪、AI痕迹识别...
    [工具使用] 用 audit_chapter 审查章节，用 read_truth_files 对照设定...
    [输出规范] 输出结构化的审计报告...`,
  
  architect: `你是 NovelFork 的小说世界观架构 Agent。
    [领域知识] 你擅长构建完整的世界观体系...
    [工具使用] 用 write_truth_file 写入设定，用 import_canon 导入原著...
    [输出规范] 输出结构化的世界观文档...`,
  
  explorer: `你是 NovelFork 的小说探索 Agent。你是只读角色，不执行任何写入操作。
    [领域知识] 你擅长分析当前创作状态，识别优先需要关注的问题...
    [工具使用] 只用读取类工具：read_truth_files, get_book_status, Read, Grep, Glob...
    [输出规范] 输出当前状态摘要 + 下一章方向建议 + 待回收伏笔 + 角色变化提示...`,
};

export function getAgentSystemPrompt(agentId: string): string {
  // 优先匹配精确 ID
  for (const [key, prompt] of Object.entries(AGENT_SYSTEM_PROMPTS)) {
    if (agentId.includes(key)) return prompt;
  }
  // fallback: 通用写作 Agent prompt
  return DEFAULT_SYSTEM_PROMPT;
}
```

### 2.3 用户自定义 SubAgent prompt 优先

当 session 关联的 SubAgent 配置中有 `systemPrompt` 字段且非空时，优先使用用户定义的 prompt，不覆盖。

```typescript
// session-chat-service 中
const subAgent = await getSubAgentConfig(agentId);
const basePrompt = subAgent?.systemPrompt 
  || getAgentSystemPrompt(agentId);
const finalPrompt = basePrompt + buildBookContext(bookId);
```

### 2.4 runAgentLoop 改动

```typescript
// 修改前
export async function runAgentLoop(config, instruction, options?)

// 修改后
export async function runAgentLoop(config, instruction, options?) {
  const { agentId, ...rest } = options ?? {};
  const systemPrompt = agentId 
    ? getUserOrSystemPrompt(agentId) 
    : DEFAULT_SYSTEM_PROMPT;
  // ... 后续不变
}
```

---

## 3. 上下文自动注入（R3）

### 3.1 注入时机

当 session 创建或恢复时，检查 `session.projectId`：
- 如果值匹配已知 bookId → 注入作品上下文
- 如果值不存在或不匹配 → 不注入，Agent 使用通用 system prompt

### 3.2 注入内容

```typescript
// packages/studio/src/api/lib/agent-context.ts

async function buildBookContext(bookId: string): Promise<string> {
  const [book, summaries, hooks, focus] = await Promise.all([
    getBookDetail(bookId),           // GET /books/:id
    getChapterSummaries(bookId),     // bible chapter-summaries
    getPendingHooks(bookId),         // story-files/pending_hooks.md
    getCurrentFocus(bookId),         // truth-files/current_focus.md
  ]);

  return `
## 当前作品上下文
- 作品：${book.title}
- 题材：${book.genre}
- 章节：${book.chapterCount}/${book.targetChapters} 章
- 当前焦点：${focus ?? '未设置'}

## 最近章节摘要
${summaries.slice(-3).map(s => `- 第${s.number}章: ${s.summary}`).join('\n')}

## 待回收伏笔
${hooks.map(h => `- ${h.id}: ${h.text}（来源第${h.sourceChapter}章，状态：${h.status}）`).join('\n')}
`.trim();
}
```

### 3.3 注入位置

在 session-chat-service 构建 message list 时，将上下文字符串追加到第一条 system message 的末尾。

---

## 4. Explorer Agent（R4）

### 4.1 设计

Explorer 不新建 Core Agent 类——它只是一个专用的 system prompt + 严格的工具限制。

- `agentId`: `explorer`
- System prompt: 只读分析指导（见 2.2）
- 工具限制: Read, Grep, Glob, Recall, read_truth_files, get_book_status
- 权限模式: `read`（全部只读，不可写入）
- 在 ChatWindow 预设列表中新增一条

### 4.2 实现路径

1. 在 `agent-prompts.ts` 中添加 `explorer` 的 system prompt
2. 在 `ChatWindow.tsx` 的 `SESSION_PRESETS` 中新增 explorer 预设
3. Explorer 的工具集在 SubAgent 配置中定义（重用现有机制）

---

## 5. 编排函数（R5）

### 5.1 设计

```typescript
// packages/core/src/pipeline/agent-pipeline.ts

export interface PipelineStep {
  agentId: string;
  instruction: string;
}

export interface PipelineResult {
  exploration?: string;
  plan?: string;
  draft?: string;
  audit?: { issues: string[]; suggestions: string[] };
  metadata: { bookId: string; model: string; duration: number };
}

export async function runWritingPipeline(
  bookId: string,
  userIntent: string,
  config: PipelineConfig,
): Promise<PipelineResult> {
  const started = Date.now();
  
  // Step 1: 探索
  const exploration = await runAgentLoop(config,
    `分析书籍 ${bookId} 的当前状态。用户意图：${userIntent}`,
    { agentId: "explorer", maxTurns: 5 });
  
  // Step 2: 规划
  const plan = await runAgentLoop(config,
    `根据以下探索结果制定下一章大纲：\n${exploration}\n用户意图：${userIntent}`,
    { agentId: "planner", maxTurns: 5 });
  
  // Step 3: 写作
  const draft = await runAgentLoop(config,
    `根据以下大纲生成章节正文：\n${plan}`,
    { agentId: "writer", maxTurns: 5 });
  
  // Step 4: 审计
  const audit = await runAgentLoop(config,
    `审计以下章节正文：\n${draft}`,
    { agentId: "auditor", maxTurns: 5 });
  
  return {
    exploration,
    plan,
    draft,
    audit: parseAuditResult(audit),
    metadata: { bookId, model: config.model, duration: Date.now() - started },
  };
}
```

### 5.2 编排是前端驱动还是后端驱动

编排函数运行在 Studio 后端（`chatCompletion` 调用 LLM）。ChatWindow 中的 Agent 按钮触发编排函数，结果通过 WebSocket 推送给前端。

---

## 6. Workspace 入口（R6）

在 WorkspacePage 右侧面板新增「Agent 写作」入口：

```
右侧面板 > 写作 Tab
  ├─ AI 动作按钮（生成下一章/审校/去AI味/连续性 — 已有）
  ├─ 写作模式（已有）
  ├─ 写作工具（已有）
  └─ 【Agent 写作】← 新增
        ├─ 输入框：写下一章，回收玉佩伏笔，保持林月冷峻性格
        └─ 点击后 → 启动 runWritingPipeline → 结果展示在 ChatWindow
```

点击后：
1. 自动创建或复用当前 book 关联的 Writer session
2. 发送 `runWritingPipeline(bookId, intent)` 调用
3. 结果通过 ChatWindow 中的结构化消息展示：正文 + 审计报告 + 动作按钮

---

## 7. 文件结构

```
packages/core/src/pipeline/
├── agent.ts              # [改] agentId 参数 + system prompt 选择
├── agent-prompts.ts      # [新] 5 种 Agent 的专属 system prompt
└── agent-pipeline.ts     # [新] 编排函数

packages/studio/src/api/lib/
├── agent-context.ts      # [新] buildBookContext(bookId)
└── agent-pipeline.test.ts # [新] 编排函数测试

packages/studio/src/session-chat-service.ts  # [改] 上下文注入

packages/studio/src/components/
├── Routines/ToolsTab.tsx    # [改] 默认开关调整
├── ChatWindow.tsx           # [改] SESSION_PRESETS 加 explorer
└── sessions/NewSessionDialog.tsx # [改] 预设更新

packages/studio/src/app-next/workspace/
└── WorkspacePage.tsx        # [改] Agent 写作入口
```

---

## 8. 约束与边界

- 不新建设计系统的架构层
- Agent 生成结果只进候选区，不直接覆盖正文
- 编排函数串行执行（v1 不做并行）
- 上下文数据只来自已有 API，不新增后端聚合端点
- 无新增 mock/fake/noop
