# Agent 写作管线 v1 — Design

**版本**: v1.0.0
**创建日期**: 2026-05-01
**状态**: 待审批

---

## 设计定位

本 spec 将 NovelFork 从「按钮驱动的工具集」推进到「Agent 驱动的创作工作台」。核心改动：

1. **工具层**：将已有的写作 API 暴露为 Agent 可调用的工具
2. **Agent 层**：创建小说创作专用 Agent 角色
3. **上下文层**：Agent 自动获取当前作品上下文
4. **编排层**：多 Agent 串行协作完成完整写作流程

不新建 UI、不新建后端架构、不复写 LLM 调用逻辑。全部复用现有基础设施。

---

## 1. 工具注册

### 1.1 工具定义

在 `packages/studio/src/api/lib/tools/novel-tools.ts` 中定义：

```typescript
export const NOVEL_TOOLS: ToolDefinition[] = [
  // 读取类
  { name: "read_chapter", description: "读取指定章节的正文内容", parameters: { bookId: "string", chapterNumber: "number" } },
  { name: "read_truth_file", description: "读取真相文件", parameters: { bookId: "string", fileName: "string" } },
  // ... 等 16 个工具
];
```

每个工具的 `execute` 函数直接调用已有的 API handler 或 storage 函数，不重复实现业务逻辑。

### 1.2 注册到 Agent 系统

工具通过 `globalToolRegistry.register()` 注册，与现有 ChatWindow 的 tool-calling 机制一致。

```typescript
// 在 server 启动时调用
import { registerNovelTools } from "./lib/tools/novel-tools.js";
registerNovelTools();
```

Agent 在调用 LLM 时，工具列表包含通用工具（Bash/Read/Write/...）+ 小说专有工具。

---

## 2. Agent 角色设计

### 2.1 系统提示词结构

每个 Agent 的系统提示词分为三部分：

```
[角色定义] — 你是谁、擅长什么
[领域知识] — 网文创作的常识（题材特征、节奏、伏笔管理）
[作品上下文] — 当前书名、题材、章节数、最近摘要、待回收伏笔
[工具指导] — 什么场景该用什么工具
[输出规范] — 如何结构化输出、何时等待确认
```

### 2.2 三个 Agent 角色

**探索 Agent** (`novel-explorer`)

```
角色：你是 NovelFork 的小说创作探索 Agent。
     你的职责是分析当前作品状态，告诉作者下一章应该关注什么。

领域知识：你熟悉网文的节奏设计（3+1 模式）、伏笔管理（埋/长/收）、
         爽点类型（打脸/升级/奇遇/揭秘）、人物弧线。

工具使用：
- 首先用 read_chapter 读最近完成的章节
- 用 get_pending_hooks 找出需要回收的伏笔
- 用 get_bible_characters 了解当前出场角色
- 用 get_chapter_summaries 回顾前文

输出格式：
1. 一句话总结当前状态
2. 下一章的 3 个可能方向
3. 需要回收的伏笔清单
4. 需要注意的角色关系
```

**写作 Agent** (`novel-writer`)

```
角色：你是 NovelFork 的小说写作 Agent。
     你根据规划和上下文生成章节正文、对话或变体。

领域知识：你擅长仙侠/玄幻/都市/科幻的写法，能模仿冷峻质朴、
         古典意境、沙雕轻快等文风。注重画面感和节奏感。

工具使用：
- 生成前用 read_chapter 获取前后文
- 用 generate_continuation 续写段落
- 用 generate_dialogue 生成角色对话
- 用 generate_next_chapter 写完整一章
- 结果用 create_candidate 保存到候选区

输出格式：直接输出正文内容，前后标注工具调用来源。
         正式章节写入前必须等作者确认。
```

**审计 Agent** (`novel-auditor`)

```
角色：你是 NovelFork 的小说审计 Agent。
     你检查生成内容的连续性、设定一致性、AI 痕迹和字数合理性。

工具使用：
- 用 audit_chapter 运行连续性审计
- 用 detect_ai_taste 检查 AI 痕迹
- 用 read_truth_file 对照设定文件检查一致性
- 用 get_bible_characters 检查人物行为是否符合性格

输出格式：
1. 连续性检查结果（冲突项列表）
2. 设定一致性检查（与 truth 文件的差异）
3. AI 味评分及具体问题
4. 字数统计与目标对比
5. 是否需要修订的判断
```

### 2.3 Agent 持久化

Agent 预设通过 `POST /api/routines` 保存到子代理（subAgent）配置中。重用现有 `SubAgent` 类型：

```typescript
{
  id: "novel-writer-v1",
  name: "写作 Agent",
  description: "根据上下文生成章节正文、对话或变体",
  systemPrompt: "...",  // 完整的系统提示词
  allowedTools: ["read_chapter", "generate_*", "create_candidate"],
  enabled: true,
}
```

---

## 3. 上下文注入

### 3.1 触发时机

当 session 的 `projectId` 字段等于某个 bookId 时，session-chat-service 在构建 LLM 消息时自动注入作品上下文。

### 3.2 注入内容

```typescript
const contextBlock = `
## 当前作品上下文
- 书名：${book.title}
- 题材：${book.genre}
- 平台：${book.platform}
- 当前章节数：${book.chapterCount}
- 目标章节：${book.targetChapters}
- 最近章节摘要：
${summaries.map(s => `  - 第${s.chapter}章 ${s.title}: ${s.summary}`).join('\n')}
- 待回收伏笔：
${pendingHooks.map(h => `  - ${h.id}: ${h.text}（来源：第${h.sourceChapter}章，状态：${h.status}）`).join('\n')}
- 当前焦点：${currentFocus ?? '未设置'}
`;
```

注入到 system prompt 中（第一条 system message 的末尾或单独一条 system message）。

### 3.3 数据来源

所有数据来自已有 API 调用，不新增存储，不新增缓存。每次 Agent 启动对话时实时获取。

---

## 4. 多 Agent 编排

### 4.1 编排 Agent

新增「写作流程」Agent（`novel-pipeline`），它是一个编排者 Agent：

```
收到用户指令「写下一章」
  →
  [Step 1] 调用子 Agent: novel-explorer
    输入：bookId, 用户意图
    输出：当前状态分析 + 下一章方向建议
  →
  [Step 2] 调用子 Agent: novel-writer
    输入：探索结果 + 用户意图 + 上下文
    输出：生成的正文
  →
  [Step 3] 调用子 Agent: novel-auditor
    输入：生成的正文 + 上下文
    输出：审计报告
  →
  [展示] 正文 + 审计报告 + 动作按钮
```

### 4.2 实现方式

编排 Agent 不是一个真正独立的 Agent 进程，而是一个**编排函数**：

```typescript
async function runWritingPipeline(bookId: string, userIntent: string) {
  const context = await buildBookContext(bookId);
  
  // Step 1: 探索
  const exploration = await callAgent("novel-explorer", 
    `分析书籍 ${bookId} 的当前状态，用户意图：${userIntent}`, 
    context);
  
  // Step 2: 写作
  const draft = await callAgent("novel-writer",
    `根据以下分析生成内容：${exploration}`,
    context);
  
  // Step 3: 审计
  const audit = await callAgent("novel-auditor",
    `审计以下内容：${draft.content}`,
    context);
  
  return { draft, audit, exploration };
}
```

### 4.3 串行编排（v1 限制）

v1 中 Agent 串行执行。并行（探索和审计独立执行、多候选方案并行生成）留到 v2。

---

## 5. 复用现有基础设施

| 基础设施 | 用途 |
|---------|------|
| `session-chat-service.ts` | Agent 调用 LLM 的载体 |
| `ChatWindow` | Agent 对话 UI |
| Routines subAgent | Agent 角色持久化 |
| `globalToolRegistry` | 工具注册 |
| `api/routes/` 中已有 handlers | 工具执行逻辑 |
| `ProviderRuntimeStore` | 获取 LLM 配置 |

---

## 6. 文件结构

```
packages/studio/src/api/lib/tools/
├── novel-tools.ts          # 小说工具定义与注册（新）
└── novel-tools.test.ts     # 工具测试（新）

packages/studio/src/api/lib/
├── agent-context.ts        # 作品上下文构建（新）
└── agent-pipeline.ts       # 多 Agent 编排（新）

packages/studio/src/app-next/
├── (无新 UI，复用 ChatWindow)
```

---

## 7. 约束与边界

- 不新增 UI 页面
- 不新增 LLM 调用方式（复用 chatCompletion + session-chat-service）
- Agent 生成结果只写入候选稿/草稿，不直接覆盖正文
- 工具失败返回真实错误，不伪造成功
- v1 只做串行编排，不做并行
