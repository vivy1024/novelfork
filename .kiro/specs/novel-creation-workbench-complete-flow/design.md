# Novel Creation Workbench Complete Flow Design

**版本**: v1.0.0
**创建日期**: 2026-04-28
**更新日期**: 2026-04-28
**状态**: 📋 规划中

---

## 设计目标

本设计把小说创作工作台拆成六条可验证主线：

1. 文档事实源：已实现能力先沉淀到 docs，未完成能力明确透明化。
2. 视觉系统：Tailwind theme token 与 Button/Badge/Card 语义一致。
3. 资源管理器：左侧小说资源树成为查看小说的主入口。
4. 创作编辑闭环：章节、候选稿、草稿、写作模式和 AI 动作走非破坏性写入。
5. 经纬与分析：经纬资料、hook、健康检查、节奏/对话分析进入同一工作台语境。
6. 验收体系：单测、route 测试、UI 测试、浏览器实测和 docs 一致性共同证明真实可用。

## 总体架构

```text
Studio Next App
├── Dashboard
│   ├── Book create/import
│   └── Book list / daily stats
├── Workspace
│   ├── Resource Explorer
│   │   ├── Chapters
│   │   ├── Candidates
│   │   ├── Drafts
│   │   ├── Outline
│   │   ├── Bible / 经纬
│   │   ├── Story files
│   │   ├── Truth files
│   │   └── Materials / Publish reports
│   ├── Main Editor / Viewer Registry
│   │   ├── ChapterEditor
│   │   ├── CandidateEditor
│   │   ├── DraftEditor
│   │   ├── MarkdownViewer
│   │   ├── BibleEntryEditor
│   │   ├── OutlineEditor
│   │   ├── ExportPanel
│   │   └── UnsupportedCapability
│   └── Assistant Panel
│       ├── AI actions
│       ├── Bible Panel
│       ├── Writing Modes
│       └── Writing Tools
├── Settings
│   └── Runtime model/provider config
└── Docs / Test Reports
```

后端事实源：

```text
Studio API / Hono Routes
├── books / chapters routes
├── candidate routes
├── draft routes
├── bible routes
├── writing-modes routes
├── writing-tools routes
├── providers/runtime-model routes
├── export routes
└── docs/test audit helpers

Core / Storage
├── Book repository
├── Chapter storage/index
├── Candidate storage
├── Draft storage
├── Bible repositories
├── KV/config repositories
└── File-backed story/truth/material readers
```

## Phase 0：文档事实源设计

### 文档新增

新增当前能力文档：

```text
docs/02-核心架构/02-Studio工作台/01-Studio功能现状总览.md
docs/02-核心架构/02-Studio工作台/02-小说创作流程总览.md
docs/05-API文档/02-创作工作台接口.md
docs/07-测试报告/03-真实运行时与Mock清理验收报告.md
```

### 文档内容模型

每个功能条目使用统一字段：

```text
- 功能名称
- 用户入口
- API / 组件入口
- 数据来源
- 持久化状态
- 当前状态：真实可用 / 透明过渡 / 内部示例 / 待迁移
- 已知限制
- 验证命令或测试文件
```

### 文档一致性

文档不成为独立事实源，而是对齐以下来源：

- `.kiro/specs/project-wide-real-runtime-cleanup/`
- `packages/studio/src/api/lib/mock-debt-ledger.ts`
- 当前 route/UI 测试
- 浏览器审计发现
- 当前 API 实现

重复 API 总览合并为一个当前文档。保留文件应在 README 中作为入口；被替代文件应删除或移入历史归档，避免两个“当前口径”。

过时文档不允许继续作为当前入口保留。Phase 0 必须审计 docs 中仍引用旧前端主线、旧 provider/mock 口径、旧 Bible 用户命名、旧路线图或已被新 spec 替代的内容；处理方式只能是更新为当前事实、明确标注历史归档，或迁入 `docs/07-测试报告/02-历史归档/`。

## Phase 1：UI/UX 主题设计

### Tailwind theme token

`packages/studio/tailwind.config.js` 扩展 colors，将 `index.css` 的 CSS variables 映射为 Tailwind token：

```js
colors: {
  background: "var(--background)",
  foreground: "var(--foreground)",
  card: "var(--card)",
  "card-foreground": "var(--card-foreground)",
  popover: "var(--popover)",
  "popover-foreground": "var(--popover-foreground)",
  primary: "var(--primary)",
  "primary-foreground": "var(--primary-foreground)",
  secondary: "var(--secondary)",
  "secondary-foreground": "var(--secondary-foreground)",
  muted: "var(--muted)",
  "muted-foreground": "var(--muted-foreground)",
  accent: "var(--accent)",
  "accent-foreground": "var(--accent-foreground)",
  destructive: "var(--destructive)",
  "destructive-foreground": "var(--destructive-foreground)",
  border: "var(--border)",
  input: "var(--input)",
  ring: "var(--ring)"
}
```

保留现有 light/dark CSS variables，Tailwind 只负责生成类，主题切换仍由 CSS variables 驱动。

### 组件语义

优先使用已有 UI primitives：

- `Button`
- `Badge`
- `Card`
- `Input`
- `Textarea`
- `Select`
- `UnsupportedCapability`

裸 `<button>` 允许短期保留，但高频区域必须先迁移：

1. Workspace 顶部操作。
2. Resource tree action。
3. Chapter/Candidate editor 操作。
4. Writing Modes tabs/actions。
5. Writing Tools tabs/actions。
6. Dashboard create/import。

### 视觉分层

| 意图 | 组件语义 | 说明 |
|---|---|---|
| 主操作 | `Button default` | 创建、保存、导出、确认生成 |
| 次操作 | `Button outline` | 导入、刷新、查看详情 |
| 中性切换 | `Button ghost/outline` | tab、section、resource node |
| 危险操作 | `Button destructive` | 放弃候选、删除、归档 |
| 未接入 | disabled + reason | 显示 title/说明，不假装可点击 |
| 透明占位 | `UnsupportedCapability` | dashed card + capability id |

### 浏览器验收脚本

通过浏览器 evaluate 验证：

- CSSOM 中存在主题类。
- 关键按钮 computed style group 大于当前异常值。
- 启用、禁用、主操作、active tab 至少有不同 background/color/opacity/border。

## Phase 2：资源管理器设计

### ResourceNode 数据模型

扩展 `StudioResourceNode`，保持前端树结构清晰：

```ts
type StudioResourceKind =
  | "book"
  | "volume"
  | "chapter"
  | "generated-chapter"
  | "draft"
  | "outline"
  | "bible"
  | "bible-category"
  | "bible-entry"
  | "story-file"
  | "truth-file"
  | "material"
  | "publish-report"
  | "group";

interface StudioResourceNode {
  id: string;
  kind: StudioResourceKind;
  title: string;
  subtitle?: string;
  status?: string;
  badge?: string;
  count?: number;
  metadata?: Record<string, unknown>;
  emptyState?: StudioResourceEmptyState;
  unsupported?: UnsupportedCapabilityDescriptor;
  children?: readonly StudioResourceNode[];
}
```

`metadata` 只存路由和显示所需最小信息，例如 `bookId`、`chapterNumber`、`candidateId`、`filePath`、`category`、`entryId`。

### Resource tree 输入

`buildStudioResourceTree()` 的输入从当前章节/candidate 扩展为聚合响应：

```ts
interface WorkspaceResourceSnapshot {
  book: BookDetail;
  chapters: ChapterSummary[];
  candidates: CandidateSummary[];
  drafts: DraftSummary[];
  outline?: OutlineSummary;
  bible: BibleCategorySummary[];
  storyFiles: TextFileSummary[];
  truthFiles: TextFileSummary[];
  materials: MaterialSummary[];
  publishReports: PublishReportSummary[];
}
```

首版可以由前端并行请求多个现有 API 聚合；后续可新增 `/books/:id/resources` 作为单一快照接口。为了减少 UI 闪烁，设计上推荐新增聚合 route，但实施可分两步。

### Editor / Viewer Registry

在 Workspace 中引入 registry：

```ts
function renderResourceNode(node: StudioResourceNode) {
  switch (node.kind) {
    case "chapter": return <ChapterEditor />;
    case "generated-chapter": return <CandidateEditor />;
    case "draft": return <DraftEditor />;
    case "outline": return <OutlineEditor />;
    case "bible-category": return <BibleCategoryView />;
    case "bible-entry": return <BibleEntryEditor />;
    case "story-file": return <MarkdownViewer />;
    case "truth-file": return <MarkdownViewer />;
    case "material": return <MaterialViewer />;
    case "publish-report": return <PublishReportViewer />;
    default: return <UnsupportedCapability />;
  }
}
```

每个节点必须命中 registry 中的一种结果，禁止静默 no-op。

### 新建章节

新增 route 或复用现有 storage route：

```text
POST /books/:bookId/chapters
body: { title?: string, afterChapterNumber?: number }
response: { chapter: ChapterSummary }
```

行为：

1. 读取 `nextChapter` 或章节索引最大值 + 1。
2. 创建章节文件/记录。
3. 更新章节索引。
4. 返回新章节 summary。
5. 前端刷新资源树并自动选中新章节。

### 草稿

设计草稿 API：

```text
GET /books/:bookId/drafts
GET /books/:bookId/drafts/:draftId
POST /books/:bookId/drafts
PUT /books/:bookId/drafts/:draftId
POST /books/:bookId/candidates/:candidateId/accept { action: "draft" }
```

首版实现可使用现有候选稿 `draft` action 的存储结果，但必须在资源树中可见并可打开。

### Story / Truth 文件 viewer

新增只读或可编辑文本 viewer：

```text
GET /books/:bookId/story-files
GET /books/:bookId/story-files/:fileName
GET /books/:bookId/truth-files
GET /books/:bookId/truth-files/:fileName
```

首版支持 Markdown/Text viewer。写入能力可按文件类型逐步开放。

## Phase 3：创作闭环设计

### 非破坏性 AI 写入原则

所有 AI 结果进入三类安全容器之一：

1. Preview：临时预览，不保存。
2. Candidate：可审阅候选稿。
3. Draft：保存但不影响正式章节。

正式章节写入必须用户确认。

### AI Action Router

统一 Workspace Assistant action：

```ts
type WorkspaceAssistantActionId =
  | "write-next"
  | "continue"
  | "audit"
  | "rewrite"
  | "de-ai"
  | "continuity";
```

每个 action 映射到 route：

| Action | Route | Result |
|---|---|---|
| write-next | `POST /books/:id/write-next` | candidate |
| continue | writing mode apply route | preview/candidate |
| audit | chapter audit route | report |
| rewrite | rewrite route | preview/candidate |
| de-ai | anti-AI route | report/preview |
| continuity | continuity route | report |

未接 route 的 action 返回 unsupported，并在 UI 显示 `UnsupportedCapability` 风格错误。

### Writing Modes Apply Pipeline

当前 writing modes route 主要返回 prompt-preview。升级路径：

```text
request mode
→ build prompt / call LLM if configured
→ return preview result
→ user chooses target
→ POST apply
→ write draft/candidate/chapter after confirmation
```

建议新增统一应用端点：

```text
POST /books/:bookId/writing-modes/apply
body: {
  mode: string,
  source: "preview" | "prompt" | "llm-result",
  resultText: string,
  target: {
    type: "candidate" | "draft" | "chapter-insert" | "chapter-replace",
    chapterNumber?: number,
    range?: { from: number, to: number }
  }
}
```

正式章节 insert/replace 首版可以先转成 candidate，避免编辑器 range 安全问题。

### Candidate 生命周期

```text
candidate
├── accept: merge -> accepted + chapter updated
├── accept: replace -> accepted + chapter updated
├── accept: draft -> accepted/archived + draft created
└── reject -> rejected
```

每次状态变化写入存储，并刷新资源树。

## Phase 4：经纬、大纲、发布与导出设计

### 经纬 Workspace 集成

复用已有 Bible/经纬 repository 和 routes，但把 Workspace 中的分类壳子换成真实视图。

组件：

- `BibleCategoryView`
- `BibleEntryEditor`
- `BibleEntryForm`
- `ContextPreviewModal` 可作为后续入口

数据：

```text
GET /api/books/:bookId/bible/:category
POST /api/books/:bookId/bible/:category
PUT /api/books/:bookId/bible/:category/:entryId
```

如果现有 route 路径不同，实施阶段以当前 `bible.ts` 为准，避免重复 API。

### 大纲

首版把大纲作为可查看/编辑的结构化或 Markdown 资源：

- 若已有 outline truth/story 文件，作为 OutlineEditor 数据源。
- 若不存在，创建默认大纲文件或结构化记录。
- outline branch 生成结果进入 preview/candidate，不直接覆盖。

### 发布检查

发布检查读取真实数据：

- 章节数量。
- 字数。
- 敏感词扫描。
- AI 味报告。
- 连续性指标；没有事实源则 unknown。
- 缺失项列表。

### 导出

新增 export route：

```text
POST /books/:bookId/export
body: { format: "markdown" | "txt", scope: "book" | "volume" | "chapter", chapterNumber?: number }
response: { fileName, contentType, content } 或下载响应
```

首版至少支持全书 Markdown 和 TXT。导出内容来自已保存章节，不从编辑器未保存态直接导出。

## Phase 5：状态一致性设计

### 状态定义

作品：

```ts
type BookStatus = "idea" | "outlining" | "drafting" | "revising" | "reviewing" | "publishing" | "archived";
```

章节：

```ts
type ChapterStatus = "draft" | "writing" | "ready-for-review" | "approved" | "published";
```

候选稿：

```ts
type CandidateStatus = "candidate" | "accepted" | "rejected" | "archived";
```

经纬条目：

```ts
type BibleEntryStatus = "active" | "unresolved" | "resolved" | "deprecated";
```

### 状态来源

所有状态来自 API/repository。前端只负责展示和请求状态变化，不在本地伪造业务状态。

### 统计来源

- 作品统计来自 book detail 或 resource snapshot。
- 章节字数来自保存后的章节内容。
- 今日字数来自 writing log/progress store。
- health unknown 指标保持 unknown，不转成 100 或成功。

## 测试设计

### 单元测试

- `resource-adapter.test.ts`：所有节点类型、empty state、metadata。
- Tailwind token generation check：确认生成主题类。
- 状态转换 helper。

### Route 测试

- 新建章节。
- 章节保存。
- drafts list/read/write。
- candidate accept/reject/draft。
- story/truth file list/read。
- bible category list/create/update。
- writing modes apply。
- export markdown/txt。
- unsupported paths。

### UI 测试

- Workspace resource tree 点击所有主要节点。
- ChapterEditor save failure 不丢内容。
- CandidateEditor 展示真实正文和确认步骤。
- DraftEditor 打开/保存。
- Bible category/list/editor。
- MarkdownViewer 查看 `pending_hooks.md`。
- Button variant/disabled/active state。

### 浏览器实测

通过 Vite 启动 `/app-next`，执行：

1. CSSOM 检查主题类存在。
2. computed style 检查按钮分层。
3. 创建作品。
4. 新建章节。
5. 写正文并保存。
6. 刷新后重新打开章节。
7. 生成候选稿。
8. 另存草稿。
9. 合并/替换候选稿。
10. 查看 story/truth 文件。
11. 运行健康检查。
12. 导出 Markdown/TXT。

### 文档一致性测试

新增轻量脚本或测试，检查 docs 中的状态词和 ledger/spec 对齐：

- `process-memory` 必须同时出现“临时”或“不持久化”。
- `prompt-preview` 必须同时出现“预览”或“未写入”。
- `unsupported` 必须不被描述为“已完成”。
- mock cleanup 报告中的 scan 摘要必须与当前测试期望一致。

## 实施顺序建议

```text
0. docs 现状总览和 API/测试报告
1. Tailwind theme token + UI 可辨识修复
2. Resource snapshot / resource adapter 扩展
3. 新建章节 + story/truth viewer
4. 草稿和候选稿正文做实
5. 经纬 Workspace 真实列表/编辑
6. Writing modes apply 安全路径
7. AI actions unsupported/route 补齐
8. 大纲/发布检查/导出
9. 状态一致性与统计收敛
10. 浏览器 E2E 和最终验收报告
```

## 风险与约束

1. 本 spec 范围大，tasks 必须按阶段拆分，每阶段都要可独立验收。
2. 不能把 docs 当成替代实现；docs 只能说明真实状态。
3. 不能为追求“大而全”恢复假成功。未接能力必须 transparent unsupported。
4. 资源管理器不做任意文件系统浏览，避免权限与误编辑风险。
5. 正式章节写入必须非破坏性，AI 输出默认进候选/草稿。
6. Typecheck 既有失败项会影响最终验收，必须纳入任务。

## 完成定义

本 spec 完成时必须满足：

1. docs 已准确记录当前真实能力和边界。
2. 浏览器实测 UI 主题和按钮分层生效。
3. 资源管理器可查看小说主要资源。
4. 用户可完成创建作品、新建章节、编辑保存、生成候选、草稿/候选处理、健康检查、导出。
5. 所有仍未接能力都以 unsupported 或透明过渡显示。
6. 单元、route、UI、浏览器验收、mock scan 和 typecheck 均有明确结果。
7. 最终报告列出剩余透明过渡项，不把它们称为完成。
