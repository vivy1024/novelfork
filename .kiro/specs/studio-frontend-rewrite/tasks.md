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

- [x] A1. 套路页水平 tab 重写
  - 删除外层标题卡片（双层标题）、4 个 MetricCard、左侧"分区导航"nav。
  - 改为：标题行（"套路" + scope 切换 + 保存/重置）+ 水平 tab 标签页 + 直接渲染编辑器内容。
  - 对标 NarraFork 套路页截图：一个标题 + 一行描述 + 水平 tab + 内容。
  - 验收：无 MetricCard、无左侧导航、无"打开XXX"按钮。

### 供应商页

- [x] A2. 供应商页总览行内联 + 卡片展开
  - 总览从 3 个 MetricCard 改为一行文字：`N 供应商 · N 已启用 · N 可用模型 [+ 添加供应商]`。
  - 删除右侧固定 aside 详情面板，改为卡片点击展开 accordion。
  - 添加表单默认收起。
  - 验收：无 MetricCard、无右侧固定面板。

### 设置页

- [x] A3. 设置页导航去 status badge
  - 删除分区按钮后的"可编辑"/"部分接入"等 status 文字。
  - 验收：左侧导航只显示分区名称。

### 工作台

- [x] A4. 工作台顶栏精简 + AI 面板紧凑化
  - 删除 SectionLayout 的 description 文字。
  - AI 动作按钮改为 2 列 grid，删除"输出到候选稿"后缀。
  - 验收：顶栏无描述文字，AI 面板一屏内显示。

- [x] A5. 工作台编辑器升级（合并到 B3）
  - InkEditor（TipTap 富文本）替换 textarea，零改动直接 import。
  - 保留字数、保存状态、未保存提示。
  - 验收：编辑器支持富文本 markdown I/O、slash commands、bubble menu。

### 测试 + 验收

- [x] A6. 更新测试适配新 UI 结构
  - 套路页测试从 nav 按钮改为 tab。
  - 供应商页测试适配 accordion。
  - InkEditor mock 为 textarea fallback。
  - 全量 typecheck + test。
  - 验收：12 测试文件 65 测试全部通过。

## 线 B：旧前端迁移

### P0 — 创作主流程（用户每天用）

- [x] B1. 迁移 Dashboard（书籍列表 + 创建入口）
  - 新建 DashboardPage，useApi('/books') + useApi('/daily-stats') 加载真实数据。
  - 书籍卡片网格：书名、题材 badge、章节数/字数、状态圆点、日更进度条。
  - 集成到路由系统 /next/dashboard，导航栏加"仪表盘"tab。
  - 验收：打开 /next/dashboard → 看到真实书籍列表。

- [x] B2. 迁移 BookDetail（书籍详情 + 章节管理）
  - 资源树章节节点加状态圆点（绿=approved、黄=review、灰=其他）。
  - 工作台从 useApi 加载真实书籍详情 + 章节列表 + 候选稿。
  - 验收：选中书籍后资源树显示真实章节和状态。

- [x] B3. 升级 ChapterReader（富文本编辑器）
  - InkEditor 零改动直接 import 替换 textarea。
  - 支持 markdown I/O、slash commands、bubble menu、ghost text、diff panel。
  - 测试中 mock InkEditor 为 textarea fallback。
  - 验收：编辑器支持富文本，保存可用。

- [x] B4. 迁移 BibleView（经纬资料库）
  - 新建 BiblePanel，4 tab 切换（人物/事件/设定/摘要）。
  - 真实 API CRUD：useApi 加载 + postApi 创建。
  - 内联创建表单、条目展开/收起。
  - 替换旧的 BibleRelatedPanel，删除 WorkspaceBibleApi 等旧接口。
  - 验收：可查看/创建经纬条目。

### P1 — 配置与工作流

- [x] B5. 迁移 BookCreate（新书创建向导）
  - DashboardPage 内联创建表单：2 列 grid，书名/题材/平台/字数/章节/语言。
  - POST /books/create，成功后自动刷新书籍列表。
  - 验收：可创建新书。

- [x] B6. 迁移 ConfigView（项目配置）
  - 新建 ProjectConfigSection，从 /project 和 /project/overrides 加载。
  - 集成到设置页"实例管理"组。
  - 验收：可查看项目级配置。

- [x] B7. 迁移 WorkflowWorkbench（工作流总控台）
  - 新建 WorkflowPage，水平 tab：Agent 状态、管线运行、调度配置。
  - 集成到路由 /next/workflow。
  - 验收：可查看 agent 状态。

### P2 — 辅助功能

- [x] B8. 迁移 PublishReadiness + 合规组件
  - 新建 PublishPanel，POST /books/{id}/compliance/publish-readiness。
  - 平台选择 + 4 指标（状态/敏感词/AI 比例/格式）。
  - 集成到工作台顶栏。
  - 验收：可运行发布就绪检查。

- [x] B9. 迁移 SearchView（全局搜索）
  - 新建 SearchPage，GET /search?q=xxx，防抖搜索 + 高亮片段。
  - 集成到路由 /next/search。
  - 验收：可搜索。

- [x] B10. 迁移 StyleManager + TruthFiles（文风管理）
  - 新建 TruthPanel，GET /books/{id}/truth 列表 + 内容预览。
  - 集成到工作台。
  - 验收：可查看真相文件。

- [x] B11. 迁移 DetectView + DiffView（AI 检测 + 版本对比）
  - 新建 DetectPanel，GET /books/{id}/detect/stats + POST /books/{id}/detect。
  - 验收：可查看 AI 检测评分。

- [x] B12. 迁移 ImportManager（导入管理）
  - DashboardPage 内联导入面板：章节文本导入 + URL 抓取。
  - 验收：可导入章节。

### 基础设施

- [x] B13. 路由系统扩展
  - 6 个路由：dashboard/workspace/settings/routines/workflow/search。
  - 所有页面通过 URL 直接访问，pushState 同步。
  - 验收：刷新不丢状态。

- [ ] B14. 全量烟测 + 旧前端对比
  - 逐页面对比旧前端和新前端功能覆盖。
  - 记录剩余差距和未迁移项。
  - 验收：核心创作流程可在 app-next 完成。

## Done Definition

Phase 2 完成标准：
- 线 A：已有页面 UIUX 与 NarraFork 一致，无 MetricCard/壳子/双层标题。✅
- 线 B P0：Dashboard + BookDetail + ChapterReader + BibleView 迁移完成。✅
- 线 B P1：BookCreate + ConfigView + WorkflowWorkbench 迁移完成。✅
- 线 B P2：PublishReadiness + Search + TruthFiles + DetectView + ImportManager 迁移完成。✅
- 线 B 基础设施：6 个路由，pushState 同步。✅
- 所有测试通过，typecheck 通过。✅ 12 文件 65 测试
- 剩余：B14 全量烟测。
