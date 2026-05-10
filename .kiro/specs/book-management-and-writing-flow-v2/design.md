# 书籍管理与写作流程 v2 — 设计

## 架构

```
侧边栏"叙事线（书籍）"
    │ 点击标题
    ▼
/next/books 书籍管理页面
    │ 点击卡片
    ▼
/next/books/:bookId 工作台
    │ 新书：显示引导
    │ 引导完成：guided-setup API → 写入经纬文件 → 刷新资源树
    │
    │ 点击"生成下一章"
    ▼
ensureWorkbenchSession → 导航到 /next/narrators/:sessionId
    │ 携带 pendingAction
    ▼
ConversationSurface 检测 pendingAction → 自动发送 /novel:write-next
    │
    ▼
Agent 执行：cockpit.get_snapshot → pgi.generate_questions → guided.enter → candidate.create_chapter
    │
    ▼
候选稿写入 → 资源树"候选稿"分组显示
```

## FR-1: 书籍管理页面

### 路由注册

```typescript
// router.ts
const booksRoute = createRoute({
  getParentRoute: () => nextRoute,
  path: "/books",  // 注意：不是 /books/$bookId，那个已有
});
```

### 页面组件

```
BookManagementPage
├── 标题栏："我的作品" + "新建作品"按钮
└── 书籍卡片网格（CSS grid, 3 列）
    └── BookCard
        ├── 书名（粗体）
        ├── 题材 Badge
        ├── 进度：3/100 章 · 9000 字
        ├── 状态 Badge（活跃/已完成）
        └── 红色"删除"按钮（底部，带 confirm）
```

### 数据获取

```
GET /api/books → { books: [...] }
DELETE /api/books/:id → { ok: true }
```

## FR-2: 引导完成流程修复

### 回调链

```
NewBookGuide.handleSubmit()
  → postApi(`/books/${encodeURIComponent(bookId)}/guided-setup`, { answers })
  → onComplete()
    → localStorage.setItem(`novelfork:guide-completed:${bookId}`, "true")
    → CockpitOverview.onGuideComplete()
      → WritingWorkbenchRouteLive 重新加载资源树
```

### WritingWorkbenchRoute 传递 onGuideComplete

```typescript
<WorkbenchCanvas
  ...
  onGuideComplete={() => {
    // 重新加载资源树
    void loadResources();
  }}
/>
```

## FR-3: 写作动作自动触发

### 方案：URL 参数携带 action

导航时在 URL 中携带 action 信息：
```
/next/narrators/:sessionId?action=write-next
```

ConversationSurface 加载后检测 URL 参数，如果有 `action`：
1. 等待 WebSocket 连接就绪
2. 自动发送对应的 slash command 消息
3. 清除 URL 参数（避免刷新重复触发）

### Action → Command 映射

| Action ID | 自动发送的消息 |
|-----------|--------------|
| session-native.write-next | `/novel:write-next` |
| ai.draft.async | `/novel:draft` |
| ai.audit | `/novel:audit` |
| ai.detect | `/novel:detect` |
| hooks.generate | `/novel:hooks` |

## FR-4: 引导文件生成增强

### guided-setup API 增强

当前只写 `story_bible.md`。增强为根据回答内容生成多个文件：

```typescript
// 始终写入
await writeFile("story/story_bible.md", buildStoryBible(answers));
await writeFile("story/book_rules.md", buildBookRules(answers));

// 如果用户选择了"建筑师派"或回答了大纲相关问题
if (answers.writingPhilosophy?.value !== "花园派") {
  await writeFile("story/volume_outline.md", buildInitialOutline(answers));
}

// 始终写入初始状态
await writeFile("story/current_state.md", buildInitialState(answers));
```

## FR-5: 侧边栏修正

### 移除右键菜单

删除 `ShellSidebar.tsx` 中书籍项的 `ContextMenu` 包裹，改为：
- 点击书名 → 进入工作台（保持现有行为）
- "叙事线（书籍）"标题 → 点击进入 `/next/books` 管理页面

## 修改文件清单

| 文件 | 改动 |
|------|------|
| `packages/studio/src/app-next/router.ts` | 新增 `/books` route |
| `packages/studio/src/app-next/books/BookManagementPage.tsx` | 新建：书籍管理页面 |
| `packages/studio/src/app-next/StudioNextApp.tsx` | RouteMountPoint 添加 books case |
| `packages/studio/src/app-next/shell/ShellSidebar.tsx` | 标题可点击 + 移除右键菜单 |
| `packages/studio/src/app-next/shell/shell-route.ts` | 新增 books route kind |
| `packages/studio/src/app-next/writing-workbench/NewBookGuide.tsx` | 修复 handleSubmit |
| `packages/studio/src/app-next/writing-workbench/CockpitOverview.tsx` | onGuideComplete 刷新资源树 |
| `packages/studio/src/app-next/writing-workbench/WritingWorkbenchRoute.tsx` | 传递 onGuideComplete |
| `packages/studio/src/app-next/writing-workbench/WorkbenchWritingActions.tsx` | 导航时携带 action 参数 |
| `packages/studio/src/app-next/agent-conversation/surface/ConversationSurface.tsx` | 检测 pendingAction 自动发送 |
| `packages/studio/src/api/routes/storage.ts` | guided-setup 增强写入多个文件 |
