# 设计方案

## 架构变更

### 1. 启动时统一注册

在 `packages/studio/src/api/lib/startup-orchestrator.ts`（或等效启动入口）中：

```typescript
// 启动阶段：注册内置预设 + 从 DB 恢复自定义预设/节拍
import { registerBuiltinPresets, registerPreset, registerBeatTemplate } from "@vivy1024/novelfork-novel-plugin/engine";
import { getStorageDatabase, createUserTemplateRepository } from "@vivy1024/novelfork-core";

function initPresetSystem() {
  // 1. 注册内置
  registerBuiltinPresets();

  // 2. 从 user_template 表恢复自定义
  const storage = getStorageDatabase();
  const repo = createUserTemplateRepository(storage);
  const templates = repo.list(); // 所有未删除的

  for (const t of templates) {
    const bundle = JSON.parse(t.bundleJson);
    if (bundle.type === "preset") {
      registerPreset({
        id: t.id,
        name: t.name,
        category: bundle.category ?? "custom",
        promptInjection: bundle.promptInjection ?? "",
        description: t.description ?? "",
      });
    } else if (bundle.type === "beat-template") {
      registerBeatTemplate({
        id: t.id,
        name: bundle.name ?? t.name,
        description: bundle.description ?? "",
        beats: bundle.beats ?? [],
      });
    }
  }
}
```

### 2. 对话 Session 经纬注入改造

修改 `packages/studio/src/api/lib/agent-context.ts` 的 `buildAgentContext()`：

```typescript
// 替代粗暴 SQL，调用完整的经纬上下文构建
import { buildJingweiContext } from "@vivy1024/novelfork-novel-plugin/engine";
import { buildChapterBriefing } from "@vivy1024/novelfork-novel-plugin/engine";
import { buildRecursiveSummaryContext } from "@vivy1024/novelfork-novel-plugin/engine";

// 在 buildAgentContext 中：
const jingweiResult = await buildJingweiContext({
  bookId: params.bookId,
  currentChapter: book.currentChapter ?? book.chapterCount,
  sceneText: params.sceneText, // 最近用户消息
  mode: "auto",
  tokenBudget: params.tokenBudget ?? 15000,
});

const briefing = await buildChapterBriefing(params.bookId, book.currentChapter ?? book.chapterCount);
const summaries = await buildRecursiveSummaryContext(params.bookId, book.currentChapter ?? book.chapterCount);
```

### 3. 对话 Session 预设注入

修改 `packages/studio/src/api/lib/session-chat-service.ts` 中构建 context 的位置：

```typescript
// 在 createRuntimeContext 或等效位置
import { buildPresetInjections, getPreset } from "@vivy1024/novelfork-novel-plugin/engine";

// 读取 book 的 enabledPresetIds
const enabledPresets = (book.enabledPresetIds ?? [])
  .map(id => getPreset(id))
  .filter(Boolean);
const presetBlock = buildPresetInjections(enabledPresets);
// 拼入 context
```

### 4. beat.get_current 修复

```typescript
// 修改 session-tool-executor.ts 第 1211-1213 行
const activeTemplate = selectedTemplateId
  ? getBeatTemplate(selectedTemplateId) ?? allTemplates.find((t) => t.id === selectedTemplateId)
  : undefined; // 不再 fallback 到 allTemplates[0]

if (!activeTemplate) {
  return {
    ok: true,
    renderer: definition.renderer,
    summary: "当前未选择节拍模板。可用模板：" + allTemplates.map(t => `${t.id}（${t.name}）`).join("、"),
    data: { bookId, template: null, beats: [], available: allTemplates.map(t => ({ id: t.id, name: t.name })) },
  };
}
```

### 5. BeatPanel 改造

去掉 localStorage 作为主存储，改为：
- 初始化时 `GET /api/books/:id` 读取 `beatTemplateId`
- 选择时 `PUT /api/books/:id/beat-template` 写入
- localStorage 仅作为 optimistic cache（可选，非必须）

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `studio/src/api/lib/startup-orchestrator.ts` | 修改 | 添加 `initPresetSystem()` 调用 |
| `studio/src/api/lib/agent-context.ts` | 重写 | 删除粗暴 SQL，接入 `buildJingweiContext` + briefing + summaries |
| `studio/src/api/lib/session-chat-service.ts` | 修改 | context 构建中加入预设注入 |
| `studio/src/api/lib/session-tool-executor.ts` | 修改 | 修复 beat fallback + 删除防御性重注册 |
| `studio/src/api/routes/presets.ts` | 修改 | 删除防御性重注册 |
| `novel-plugin/src/pages/writing-workbench/panels/BeatPanel.tsx` | 重写 | 去掉 localStorage 主存储 |
| `novel-plugin/src/pages/writing-workbench/StatusBar.tsx` | 修改 | 去掉 localStorage 监听 |

---

## 风险

| 风险 | 缓解 |
|------|------|
| `buildJingweiContext` 在对话模式下性能 | 已有 token budget 控制，且是 SQLite 本地查询 |
| 预设注入增加 token 消耗 | 预设 promptInjection 通常较短（几百字），影响可控 |
| 前端去掉 localStorage 后首屏加载变慢 | 可保留 localStorage 作为 cache，但真相源改为 API |
