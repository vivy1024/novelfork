# 工作台缺口收敛 v1 — Design

**版本**: v1.0.0
**创建日期**: 2026-05-01
**状态**: 待审批

---

## 设计定位

本 spec 不引入新的架构方向。所有改动都在已有系统的边界内：
- 复用已有 API routes（writing-modes、writing-tools、audit、detect、bible、jingwei、storage）
- 复用已有 UI 组件（InlineWritePanel、DialogueGenerator、VariantCompare、OutlineBrancher、BiblePanel、SettingsView）
- 复用已有 provider runtime store 和 AI gate

改动范围：
- 补接 API（已有后端但前端没接）
- 补 UI（已有骨架但缺删除/映射）
- 补测试（已有功能但缺自动化验证）
- 不新增数据库表、不新增核心引擎

---

## 1. 写作模式真实生成

### 1.1 当前状态

6 个写作模式端点返回 `mode: "prompt-preview"` + `promptPreview`，不调用 LLM：
- `POST /api/books/:bookId/inline-write`（续写/扩写/补写）
- `POST /api/books/:bookId/dialogue/generate`（对话生成）
- `POST /api/books/:bookId/variants/generate`（多版本）
- `POST /api/books/:bookId/outline/branch`（大纲分支）

### 1.2 设计方案

最小改动方案：在现有 prompt 构建逻辑之后，增加 LLM 调用环节。

```typescript
// 当前（prompt-preview 路径）
buildPrompt(input) → { mode: "prompt-preview", promptPreview }

// 目标（真实生成路径）
buildPrompt(input) → chatCompletion(prompt) → { mode: "generated", content, metadata }
```

**复用清单**：
- `packages/core/src/pipeline/runner.ts` → `PipelineRunner`（已有 chatCompletion 调用能力）
- `packages/studio/src/api/routes/writing-modes.ts` → 已有 `ctx.buildPipelineConfig` 和 `ctx.getSessionLlm`
- `packages/studio/src/api/lib/ai-gate.ts` → `requireModelForAiAction` 已处理模型 gate

**改动点**：
- 在 writing-modes.ts 的每个 handler 中，prompt 构建后增加 `chatCompletion` 调用
- 调用 `ctx.buildPipelineConfig` 获取 LLM client 配置
- 失败时仍回退到 prompt-preview + 错误信息（不假成功）
- 生成成功时返回 `mode: "generated"`、`content`、`usage` metadata

**不改变的部分**：
- prompt 构建逻辑（`buildContinuationPrompt`、`buildExpansionPrompt` 等）不变
- `POST /writing-modes/apply` route 不变
- 前端 apply 流程（预览→目标选择→确认→写入）不变

### 1.3 前端改动

- InlineWritePanel、DialogueGenerator 等组件：当返回 `mode: "generated"` 时展示真实内容；当返回 `prompt-preview` 时保持现有行为（兼容降级）
- 展示 AI metadata（provider、model、token usage）

---

## 2. 三个 AI 动作接真实 route

### 2.1 动作到 route 映射

| 动作 | 已有 route | 当前状态 | 改为 |
|------|-----------|---------|------|
| 审校当前章 | `POST /api/books/:id/audit/:chapter` | unsupported | 调用真实 route |
| 去 AI 味 | `POST /api/books/:id/detect/:chapter` | unsupported | 调用真实 route |
| 连续性检查 | `POST /api/books/:id/audit/:chapter`（复用审校 route 的连续性部分）| unsupported | 调用真实 route |

### 2.2 实现方案

- 在 `WorkspacePage.tsx` 的 `ASSISTANT_ACTIONS` 中，将这三个 action 的 handler 从返回 unsupported/error 改为调用真实 API
- 复用已有 `fetchJson` / `postApi` 调用
- 结果展示在当前 AI 面板或弹出面板中

---

## 3. Truth/Story 文件名中文化

### 3.1 映射位置选择

**方案**：在 `storage.ts` 的 `listStoryFiles()` 和 `listTruthFiles()` 中增加 name → label 映射。

**理由**：
- 单一改动点，前端无需修改
- API 响应增加 `label` 字段（向后兼容，不删除 `name`）
- 前端 resource-adapter 优先使用 `label`，fallback 到 `name`

### 3.2 API 改动

```typescript
// storage.ts 新增常量
const TRUTH_FILE_LABELS: Record<string, string> = {
  "story_bible.md": "故事经纬",
  "volume_outline.md": "卷大纲",
  // ... 全部 18 个映射
};

// listTruthFiles 返回值增加 label
interface TruthFileItem {
  name: string;        // 原始文件名（不变）
  label: string;       // 用户可见标题（新增）
  size: number;
  preview: string;
}
```

### 3.3 前端改动

- `resource-adapter.ts`：`toStoryFileNode()` 和 `toTruthFileNode()` 使用 `file.label ?? file.name` 作为 `title`
- WorkspacePage.tsx 中对应数据结构也增加 `label` 字段

### 3.4 资源树分组标题

- `resource-adapter.ts` 第 176 行 "Story 文件" → "故事文件"
- `resource-adapter.ts` 第 182 行 "Truth 文件" → "真相文件"

---

## 4. 删除功能

### 4.1 新增 API

| 方法 | 路径 | 作用 |
|------|------|------|
| `DELETE` | `/api/books/:id/chapters/:num` | 删除单章（删除文件 + 从索引移除 + 重新编号后续章节） |
| `DELETE` | `/api/books/:id/drafts/:draftId` | 删除草稿（删除文件） |
| `DELETE` | `/api/books/:id/candidates/:candidateId` | 删除候选稿（物理删除文件，区别于 reject 只标记状态） |
| `DELETE` | `/api/books/:id/truth-files/:file` | 删除 truth 文件 |
| `DELETE` | `/api/books/:id/story-files/:file` | 删除 story 文件 |

已有可复用：
- `DELETE /api/books/:bookId/jingwei/entries/:entryId` — 软删除，已存在，只需前端接入
- `DELETE /api/books/:id` — 整书删除，已存在

### 4.2 实现方案

- 在 `storage.ts` 中新增上述 route handler
- 章节删除后重新编号：`chapter_index.json` 中移除该条目，章节号不变，但续写时下一章号自动填充
- 所有删除操作不可逆，前端必须有确认对话框
- 确认对话框使用 `window.confirm` 或自定义 Dialog 组件

### 4.3 前端改动

- WorkspacePage.tsx：资源树节点增加右键菜单或操作按钮，包含"删除"选项
- 候选稿编辑器（CandidateEditor）：在"放弃"按钮旁增加"删除"按钮
- 经纬分类视图（BibleCategoryView）：条目前增加删除按钮（复用现有软删除 API）
- 所有删除操作触发确认对话框 → 调用 API → 刷新资源树

---

## 5. 设置页空壳分区

### 5.1 现状

SettingsSectionContent.tsx 已有左侧导航 + 右侧详情框架。当前分区状态：

| 分区 | 状态 | 改动 |
|------|------|------|
| 个人资料 | 骨架存在 | 复用 RuntimeControlPanel 已有能力 |
| AI 供应商 | ✅ 完整（ProviderSettingsPage） | 不改 |
| 模型 | 空壳 | 整合 RuntimeControlPanel 中的模型默认值 + 模型池 |
| AI 代理 | 空壳 | 整合 RuntimeControlPanel 中的代理配置 |
| 项目配置 | 有 ProjectConfigSection | 不改 |
| 关于 | 空壳 | 展示 ReleaseOverview 版本信息 |
| 其他分区 | 空壳 | 显示"此功能尚未开放"明确文案 |

### 5.2 实现方案

- 将 RuntimeControlPanel 中的模型配置和代理配置拆分/复用为两个独立 Section
- 关于页直接复用 ReleaseOverview 组件
- 剩余空壳分区统一使用 EmptyState + 说明文案

---

## 6. 首用引导回归测试

### 6.1 测试范围

- FirstRunDialog：渲染三个入口卡片、关闭按钮、跳过持久化
- GettingStartedChecklist：7 个任务项的初始状态、模型配置后的状态更新、全部完成状态
- 模型未配置时建书降级：不弹出硬阻断错误，允许建书并显示提醒

### 6.2 实现方案

- 新增或扩展 `onboarding.test.tsx`（如已存在则扩展）
- 使用 vitest + @testing-library/react
- 覆盖：有模型/无模型/部分任务完成/全部任务完成 四种状态

---

## 7. 文件结构

无新目录。所有改动在已有文件中：

```
packages/studio/src/
├── api/
│   ├── routes/
│   │   ├── writing-modes.ts          # [改] 增加 LLM 调用
│   │   └── storage.ts                # [改] 增加删除 route + truth label
│   └── lib/
│       └── (无新文件)
├── app-next/
│   ├── workspace/
│   │   ├── WorkspacePage.tsx          # [改] 三个 AI action 接真实 route + 删除 UI
│   │   ├── resource-adapter.ts        # [改] 使用 label + 分组标题中文化
│   │   ├── BiblePanel.tsx             # [改] 增加删除按钮
│   │   └── CandidateEditor (内联)     # [改] 增加删除按钮
│   ├── lib/
│   │   └── display-labels.ts          # [改] (如需要)
│   ├── components/
│   │   └── onboarding/
│   │       └── FirstRunDialog.test.tsx # [扩] 补充回归测试
│   └── settings/
│       ├── SettingsSectionContent.tsx  # [改] 填补空壳分区
│       └── panels/
│           └── RuntimeControlPanel.tsx # [复用] 拆分模型/代理配置
└── components/
    └── writing-modes/
        ├── InlineWritePanel.tsx        # [改] 展示真实生成结果
        ├── DialogueGenerator.tsx       # [改] 同上
        ├── VariantCompare.tsx          # [改] 同上
        └── OutlineBrancher.tsx         # [改] 同上
```

---

## 8. 约束与边界

- 不引入新的 API 架构模式（继续使用 Hono router）
- 不改变现有数据模型（不新增 SQLite 表）
- AI 生成结果不得绕过候选稿/草稿安全机制
- 删除操作不可逆，但不需要实现"撤销删除"或"回收站"
- Prompt-preview 作为 LLM 失败时的降级路径保留
- 不引入新的第三方依赖
