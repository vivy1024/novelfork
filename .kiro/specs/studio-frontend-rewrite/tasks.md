# Implementation Plan — Phase 2: UIUX 对标 NarraFork

## 背景

Phase 1（tasks 1-28）建立了 app-next 骨架并接入了真实 API，但 UIUX 质量与 NarraFork 差距大：
- 套路页用左侧导航 + MetricCard 壳子，NarraFork 用水平 tab + 直接内容
- 设置页已挂载旧 Panel 组件（ProfilePanel/RuntimeControlPanel/AppearancePanel 等），质量可接受
- 供应商卡片已有 switch + 模型标签，但详情面板仍是右侧固定栏
- 工作台资源树已接入真实 API，但编辑器是 textarea 不是富文本

Phase 2 目标：按 NarraFork 设计语言修复所有页面的 UIUX 问题。

## NarraFork 设计语言（必须遵守）

1. **零冗余**：一个标题 + 一行描述 + 直接进入内容。禁止壳子套壳子。
2. **内容优先**：用户第一眼看到可操作内容，不是统计卡片和描述文字。
3. **控件内联**：select/switch/input 直接出现在内容区。
4. **紧凑信息密度**：text-sm/text-xs、space-y-2/gap-2、rounded-md/rounded-lg。
5. **禁止 MetricCard 堆砌**、禁止描述性 badge、禁止"打开XXX"按钮、禁止双层标题。

## Tasks

- [ ] 1. 套路页重写：左侧导航 → 水平 tab
  - 删除外层"套路"标题卡片（双层标题）。
  - 删除 4 个 MetricCard（固定分区/当前资产/MCP 服务器/当前 scope）。
  - 删除左侧"分区导航"nav，改为水平 tab 标签页（对标 NarraFork 套路页截图）。
  - 删除右侧 article 中的 MetricCard（当前数量/数据 scope）和"打开XXX"按钮。
  - scope 切换按钮和保存/重置按钮移到标题行右侧，一行搞定。
  - 每个 tab 直接渲染 RoutineSectionEditor 内容，无额外包裹。
  - 验收：打开套路页 → 看到水平 tab → 点击"命令" → 直接看到 CommandsTab 内容，无任何 MetricCard。

- [ ] 2. 套路页 scope 切换紧凑化
  - scope 按钮（生效视图/全局/项目）改为小型 segmented control，放在标题行。
  - 保存/重置按钮紧贴 tab 内容区底部，不单独占一行。
  - 只读提示用 inline badge，不用整行文字。
  - 验收：scope 切换不占额外空间，保存按钮在内容区底部。

- [ ] 3. 供应商页详情面板改为卡片展开
  - 删除右侧固定 aside 详情面板。
  - 点击供应商卡片后，在卡片下方展开详情区域（accordion 模式）。
  - 详情区域包含：高级字段、刷新模型按钮、模型列表。
  - 添加供应商表单默认收起，点击"+ 添加供应商"按钮展开。
  - 验收：供应商页无右侧固定面板，卡片点击展开详情。

- [ ] 4. 供应商页总览行紧凑化
  - 3 个 MetricCard 改为一行内联文字：`13 供应商 · 6 已启用 · 40/60 可用模型 [+ 添加供应商]`。
  - 删除 MetricCard 组件。
  - 验收：总览信息在一行内显示。

- [ ] 5. 工作台编辑器从 textarea 升级
  - 将 ChapterEditor 的 `<textarea>` 替换为旧前端的 InkEditor 或等价的 contenteditable 编辑器。
  - 如果 InkEditor 依赖过重，先用 `<div contenteditable>` + 基础格式化作为过渡。
  - 保留字数统计、保存状态、未保存提示。
  - 验收：编辑器支持基础富文本（段落、换行），不是纯 textarea。

- [ ] 6. 工作台顶栏精简
  - 删除"第一主页面：资源管理器、正文编辑器、AI / 经纬面板三栏闭环"描述文字。
  - 作品选择下拉框 + 搜索框 + 运行状态 + 发布就绪/预设入口，一行搞定。
  - 验收：顶栏只有功能控件，无描述文字。

- [ ] 7. 工作台 AI 面板紧凑化
  - 6 个 AI 动作按钮改为紧凑的按钮组（2 列 grid 或 flex-wrap）。
  - 删除每个按钮后面的"输出到候选稿"文字（用 tooltip 替代）。
  - 经纬面板和写作工具面板间距缩小。
  - 验收：AI 面板在一屏内显示所有动作 + 经纬 + 写作工具入口。

- [ ] 8. 设置页导航去掉 status badge
  - 删除每个分区按钮后面的"可编辑"/"部分接入"/"复用运行时"/"未接入"/"可迁移"/"可管理"/"只读"/"可查看" status 文字。
  - NarraFork 的设置导航只有分区名称，无 status。
  - 验收：设置页左侧导航只显示分区名称。

- [ ] 9. 更新测试适配新 UI 结构
  - 套路页测试：从 `getByRole("navigation", { name: "套路分区" })` 改为 `getByRole("tab")`。
  - 供应商页测试：适配卡片展开模式。
  - 工作台测试：适配编辑器升级。
  - 验收：所有 app-next 测试通过。

- [ ] 10. 浏览器烟测 + NarraFork 对比截图
  - 逐页面截图对比 NarraFork。
  - 记录剩余差距。
  - 验收：三个主页面的 UIUX 与 NarraFork 设计语言一致。

## Done Definition

- 套路页用水平 tab，无 MetricCard，无左侧导航。
- 供应商页卡片展开详情，无右侧固定面板。
- 工作台编辑器不是纯 textarea。
- 所有页面无双层标题、无描述性 badge、无"打开XXX"按钮。
- 所有 app-next 测试通过，typecheck 通过。
- 浏览器烟测三条路径通过。
