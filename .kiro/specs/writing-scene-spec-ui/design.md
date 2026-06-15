# 写作区 scene.spec 可视化 — Design

**版本**: v1.0.0
**创建日期**: 2026-06-15
**对应 Requirements**: `requirements.md` R1-R5

---

## 设计总览

新增 SceneSpecPanel 组件，在 WorkbenchCanvas 中 chapter/candidate 类型节点旁并排显示。支持可视化展示 + 拖拽编辑 + 一键生成。

---

## 组件设计

### SceneSpecPanel

```ts
interface SceneSpecPanelProps {
  bookId: string
  chapterId: string
  sceneSpec: SceneSpec | null  // null = 未生成
  onUpdate: (spec: SceneSpec) => void
}
```

内部结构：
- Header：章节号 + 标题 + 字数目标 badge + "重新生成"按钮
- SceneCardList：可拖拽排序的场景卡片列表（react-dnd 或原生 drag）

### SceneCard

```ts
interface SceneCardProps {
  scene: SceneItem
  index: number
  onEdit: (field: string, value: any) => void
}
// 渲染：
// - 角色标签组（Chip 列表，可增删）
// - 地点标签
// - 冲突描述（可编辑 textarea）
// - 情绪曲线：起始情绪 → 结束情绪（双下拉或文字）
// - 伏笔进出 badge（进=绿色向下箭头 / 出=橙色向上箭头 + 伏笔名）
// - 约束列表（可编辑）
```

### WorkbenchCanvas 集成

```
┌──────────────────────────────────────────────┐
│ ChapterEditor (flex: 1)  │ SceneSpecPanel    │
│                          │ (width: 360px,    │
│                          │  可收起)           │
└──────────────────────────────────────────────┘
```

- 条件渲染：`node.kind === "chapter" || node.kind === "candidate"` 时显示
- 收起状态：侧边栏缩为一个"蓝图"图标按钮
- 数据来源：从 chapter metadata 或 candidate 的 sceneSpec 字段读取

### "生成蓝图"按钮

- 位置：编辑器工具栏（ChapterActionsBar / CandidateActionsBar）
- 调用：`POST /books/:id/scene-spec`（已有后端路由）
- 传参：chapterId + 当前上下文
- 返回后更新 SceneSpecPanel

### 编辑后保存

- 拖拽/编辑操作 → 本地 state 更新 → debounce 300ms → 保存到 chapter/candidate metadata
- pipeline.write 调用时从 metadata 读取最新 spec 作为输入

---

## 数据流

```
WorkbenchCanvas (chapter/candidate node)
  → 读取 sceneSpec from metadata
  → SceneSpecPanel 渲染
  → 用户编辑 → onUpdate → save to metadata
  → "生成蓝图" → POST /books/:id/scene-spec → 刷新 panel
  → pipeline.write → 读取 metadata.sceneSpec 作为输入
```

---

## 非破坏性

- WorkbenchCanvas 现有布局加 flex 容器包裹，不改动编辑器本身
- SceneSpecPanel 为独立新文件
- 已有 scene.spec 后端不改动
