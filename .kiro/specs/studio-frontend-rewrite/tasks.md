# Implementation Plan — Phase 2: UIUX 对标 + 旧前端迁移

## 背景

Phase 1（已完成）建立了 app-next 骨架、接入真实 API、挂载旧 Panel 组件。但 UIUX 与 NarraFork 差距大，且 app-next 只有 3 个路由（workspace/settings/routines），旧前端有 22+ 个页面未迁移。

Phase 2 分两条线并行：
- **线 A：UIUX 返工**（修复已有 3 个页面）
- **线 B：旧前端迁移**（按 NarraFork 设计语言迁移 A/B 级页面到 app-next）

## NarraFork 设计语言（所有任务必须遵守）

1. 零冗余：标题 + 描述 + 直接内容。禁止壳子套壳子、MetricCard 堆砌、描述性 badge。
2. 内容优先：用户第一眼看到可操作内容。
3. 控件内联：select/switch/input 直接在内容区。
4. 紧凑信息密度：text-sm、space-y-2、rounded-lg。
5. 水平 tab（套路页）、卡片展开（供应商页）、左侧窄导航（设置页）。
6. 每个页面必须有真实 API 调用和可完成的用户路径。

## 线 A：UIUX 返工

### 套路页

- [ ] A1. 套路页水平 tab 重写
  - 删除外层标题卡片（双层标题）、4 个 MetricCard、左侧"分区导航"nav。
  - 改为：标题行（"套路" + scope 切换 + 保存/重置）+ 水平 tab 标签页 + 直接渲染编辑器内容。
  - 对标 NarraFork 套路页截图：一个标题 + 一行描述 + 水平 tab + 内容。
  - 验收：无 MetricCard、无左侧导航、无"打开XXX"按钮。

### 供应商页

- [ ] A2. 供应商页总览行内联 + 卡片展开
  - 总览从 3 个 MetricCard 改为一行文字：`N 供应商 · N 已启用 · N 可用模型 [+ 添加供应商]`。
  - 删除右侧固定 aside 详情面板，改为卡片点击展开 accordion。
  - 添加表单默认收起。
  - 验收：无 MetricCard、无右侧固定面板。

### 设置页

- [ ] A3. 设置页导航去 status badge
  - 删除分区按钮后的"可编辑"/"部分接入"等 status 文字。
  - 验收：左侧导航只显示分区名称。

### 工作台

- [ ] A4. 工作台顶栏精简 + AI 面板紧凑化
  - 删除 SectionLayout 的 description 文字。
  - AI 动作按钮改为 2 列 grid，删除"输出到候选稿"后缀。
  - 验收：顶栏无描述文字，AI 面板一屏内显示。

- [ ] A5. 工作台编辑器升级
  - textarea 替换为 contenteditable div 或复用旧 InkEditor。
  - 保留字数、保存状态、未保存提示。
  - 验收：编辑器支持段落换行，不是纯 textarea。

### 测试 + 验收

- [ ] A6. 更新测试适配新 UI 结构
  - 套路页测试从 nav 按钮改为 tab。
  - 供应商页测试适配 accordion。
  - 全量 typecheck + test。
  - 验收：12+ 测试文件全部通过。

## 线 B：旧前端迁移

### P0 — 创作主流程（用户每天用）

- [ ] B1. 迁移 Dashboard（书籍列表 + 创建入口）
  - 从旧 Dashboard.tsx 提取书籍列表逻辑（useApi('/books')），按 NarraFork 设计语言重写 UI。
  - 作为 app-next 的默认首页或工作台的书籍选择器。
  - 支持创建新书入口（跳转或内联表单）。
  - 验收：打开 /next → 看到真实书籍列表 → 点击进入工作台。

- [ ] B2. 迁移 BookDetail（书籍详情 + 章节管理）
  - 从旧 BookDetail.tsx 提取章节列表、批量操作、审计状态逻辑。
  - 集成到工作台资源管理器或独立页面。
  - 验收：选中书籍后看到章节列表、状态、字数。

- [ ] B3. 升级 ChapterReader（富文本编辑器）
  - 评估旧 InkEditor 的依赖和可迁移性。
  - 如果可迁移：直接在 app-next 的 ChapterEditor 中替换 textarea。
  - 如果不可迁移：用 contenteditable + 基础格式化过渡。
  - 保留自动保存、大纲面板、写作工具挂载点。
  - 验收：编辑器支持富文本，自动保存可用。

- [ ] B4. 迁移 BibleView（经纬资料库）
  - 从旧 BibleView.tsx 提取角色/事件/设定/世界观 CRUD 逻辑。
  - 集成到工作台右侧面板或独立页面。
  - 验收：可查看/创建/编辑经纬条目。

### P1 — 配置与工作流

- [ ] B5. 迁移 BookCreate（新书创建向导）
  - 从旧 BookCreate.tsx 提取创建流程。
  - 按 NarraFork 设计语言重写为分步表单或短表单。
  - 验收：可创建新书并进入工作台。

- [ ] B6. 迁移 ConfigView（项目配置）
  - 从旧 ConfigView.tsx 提取模型路由、agent 覆盖、环境变量配置。
  - 合并到设置页或独立页面。
  - 验收：可查看/编辑项目级配置。

- [ ] B7. 迁移 WorkflowWorkbench（工作流总控台）
  - 从旧 WorkflowWorkbench.tsx 提取 Agent/Pipeline/Scheduler 子页面。
  - 按 NarraFork 设计语言重写为 tab 布局。
  - 验收：可查看 agent 状态、管线运行、调度配置。

### P2 — 辅助功能

- [ ] B8. 迁移 PublishReadiness + 合规组件
  - 从旧 PublishReadiness.tsx 和 compliance/ 组件迁移。
  - 验收：可运行发布就绪检查。

- [ ] B9. 迁移 SearchView（全局搜索）
  - 从旧 SearchView.tsx 提取搜索逻辑。
  - 验收：可搜索章节/真相/伏笔。

- [ ] B10. 迁移 StyleManager + TruthFiles（文风管理）
  - 从旧 StyleManager.tsx 和 TruthFiles.tsx 提取文风分析和真相文件管理。
  - 验收：可查看/编辑真相文件。

- [ ] B11. 迁移 DetectView + DiffView（AI 检测 + 版本对比）
  - 验收：可运行 AI 检测、查看章节 diff。

- [ ] B12. 迁移 ImportManager（导入管理）
  - 验收：可导入章节/正典。

### 基础设施

- [ ] B13. 路由系统扩展
  - 从 3 个路由扩展到支持所有迁移页面。
  - 实现 Sidebar 导航（书籍树 + 页面入口）。
  - 验收：所有迁移页面可通过 URL 直接访问。

- [ ] B14. 全量烟测 + 旧前端对比
  - 逐页面对比旧前端和新前端功能覆盖。
  - 记录剩余差距和未迁移项。
  - 验收：核心创作流程（创建书 → 写章节 → AI 生成 → 审校 → 发布检查）可在 app-next 完成。

## Done Definition

Phase 2 完成标准：
- 线 A：3 个已有页面 UIUX 与 NarraFork 一致，无 MetricCard/壳子/双层标题。
- 线 B P0：Dashboard + BookDetail + ChapterReader + BibleView 迁移完成，创作主流程可在 app-next 完成。
- 线 B P1-P2：按优先级逐步迁移，每批有独立验收。
- 所有测试通过，typecheck 通过。
- 旧前端可作为回退但不再是主入口。
