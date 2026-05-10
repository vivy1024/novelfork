# 小说写作特有功能 — 任务清单

**关键发现**：`writing-presets-v1`、`writing-modes-v1`、`writing-tools-v1` 三个归档 spec 已完成底层实现。核心引擎、API、数据结构都已就绪。当前缺口是**新前端（app-next）未接通这些已有能力**。

本任务聚焦：将已有后端能力接入 app-next 工作台 UI。

---

## Phase 1: 写作预设接入新工作台

**已有底层**：`packages/core/src/presets/`（注册中心 + 6流派 + 5文风 + 6时代基底 + 8逻辑风险 + 6Bundle + 5节拍 + 4AI味 + 4文学技法）、`packages/studio/src/api/routes/presets.ts`（API 已有）

- [ ] 1.1 在 WritingToolsPanel 中接入预设 API（`GET /api/presets`），展示可用预设列表
- [ ] 1.2 实现预设执行交互：选预设 → 选作用范围（全章/选段）→ 调用 → 展示结果
- [ ] 1.3 将 PresetManager 页面接入 app-next 路由（当前在旧页面 `src/pages/PresetManager.tsx`）
- [ ] 1.4 在作品工作台顶部动作栏暴露"预设"入口
- [ ] 1.5 实现预设结果渲染（文本/结构化/对比三种 outputFormat）
- [ ] 1.6 浏览器验证：打开工作台 → 选预设 → 执行 → 看到 LLM 返回结果

## Phase 2: 消 AI 味管线接入

**已有底层**：`packages/core/src/presets/anti-ai/`（4个预设）、`packages/core/src/tools/` 中的 AI 味检测逻辑、`ai-taste-filter-v1` spec 已完成

- [ ] 2.1 确认 AI 味检测 API 端点是否已在 storage.ts 中注册，若无则添加
- [ ] 2.2 在 WorkbenchCanvas 编辑器中实现 AI 味高亮层（标记命中段落）
- [ ] 2.3 实现"一键降 AI"按钮：调用 AI 味修复预设 → 替换/建议
- [ ] 2.4 在章节资源卡片上显示 AI 味分数徽章
- [ ] 2.5 实现循环检测：降 AI 后自动二次检测直到分数达标
- [ ] 2.6 浏览器验证：写一段 AI 味重的文字 → 检测高亮 → 一键修复 → 分数下降

## Phase 3: 章节健康度接入

**已有底层**：`packages/core/src/tools/analysis/rhythm-analyzer.ts`、`dialogue-analyzer.ts`、全书健康仪表盘逻辑、`BookHealthSummary` 类型

- [ ] 3.1 确认健康度 API 端点，若无则基于已有 analyzer 添加 `POST /books/:id/chapters/:chId/health`
- [ ] 3.2 在 CockpitOverview 中嵌入章节健康度摘要卡片
- [ ] 3.3 实现 EmotionCurve 可视化组件（SVG 折线图，复用已有情绪标注数据）
- [ ] 3.4 实现 PacingChart 组件（爽点分布可视化）
- [ ] 3.5 在章节详情视图中展示完整健康度面板
- [ ] 3.6 浏览器验证：打开有内容的章节 → 看到健康度卡片 + 情绪曲线

## Phase 4: 写作模式接入

**已有底层**：`packages/core/src/agents/inline-writer.ts`（InlineWriterAgent：续写/扩写/补写/对话/多版本/大纲分支）、对应 API

- [ ] 4.1 确认 inline-writer API 端点是否已注册
- [ ] 4.2 在 WorkbenchCanvas 编辑器中实现选区浮动工具栏（选中文字 → 续写/扩写/改写/对话化）
- [ ] 4.3 实现多版本对比视图（同章多变体并排展示）
- [ ] 4.4 实现大纲分支 UI（在资源树中展示分支大纲）
- [ ] 4.5 实现段落补写交互（两段之间插入过渡）
- [ ] 4.6 浏览器验证：选中段落 → 浮动工具栏 → 选"扩写" → 看到扩写结果

## Phase 5: 日更进度 + 节拍表接入

**已有底层**：`DailyProgress` 类型 + SQLite `daily_progress` 表 + `packages/core/src/presets/beats/`（5个节拍模板）

- [ ] 5.1 确认日更进度 API 端点，若无则添加
- [ ] 5.2 在 DashboardPage / CockpitOverview 中嵌入日更进度组件（今日字数/目标/连续天数）
- [ ] 5.3 实现 CalendarHeatmap 组件（日历热力图）
- [ ] 5.4 在作品工作台中实现节拍进度条（当前章节在哪个节拍）
- [ ] 5.5 实现节拍标记交互（章节 metadata 中标记节拍位置）
- [ ] 5.6 浏览器验证：写作后看到今日字数更新 + 节拍进度条正确

## Phase 6: 平台合规 + 导出

**已有底层**：`platform-compliance-v1` spec 已完成（敏感词/AI含量/标注）

- [ ] 6.1 确认合规检查 API 端点
- [ ] 6.2 在作品工作台中添加"发布检查"按钮
- [ ] 6.3 实现合规检查结果页（敏感词列表 + AI含量 + 建议）
- [ ] 6.4 实现导出功能：TXT（按章分割）
- [ ] 6.5 实现导出功能：Word (.docx)（带格式）
- [ ] 6.6 实现导出功能：ePub
- [ ] 6.7 在工作台添加"导出"按钮 + 格式选择
- [ ] 6.8 浏览器验证：点击发布检查 → 看到结果；点击导出 → 下载文件格式正确

## Phase 7: 角色弧线 + 文风漂移 + 模板市场

**已有底层**：`CharacterArc` + `ArcBeat` 类型、`ToneDriftResult` 类型、流派模板数据

- [ ] 7.1 在经纬面板中展示角色弧线追踪视图
- [ ] 7.2 实现文风漂移检测 UI（定期报告 + 偏离维度可视化）
- [ ] 7.3 实现模板市场浏览页（展示 6 流派 + 6 Bundle）
- [ ] 7.4 实现模板一键导入（选模板 → 写入经纬 + 启用预设）
- [ ] 7.5 浏览器验证：打开模板市场 → 选择"凡人宗门修仙" → 导入 → 经纬中出现对应栏目

## Phase 8: 项目文档优化整理

**背景**：项目有 80+ 文档散布在 `docs/`、`.kiro/steering/`、`.kiro/specs/`、`.narrafork-reference/` 等位置，但 `CLAUDE.md` 的"按需加载参考"只列了极少入口。很多重要资料（调研、竞品分析、架构设计、开发指引、NarraFork 参考、Claude Code 参考）没有被 steering 文件提及，导致新会话无法快速定位关键信息。

- [ ] 8.1 审计所有文档，标记过时/重复/矛盾的内容
  - `docs/01-当前状态/` — 检查是否反映最新功能（新书引导等）
  - `docs/02-用户指南/` — 检查是否覆盖新流程
  - `docs/03-产品与流程/` — 检查是否与实际代码一致
  - `docs/04-架构与设计/` — 检查是否反映当前架构
  - `docs/08-测试与质量/` — 检查测试数量/覆盖率是否准确
- [ ] 8.2 更新 `CLAUDE.md` "按需加载参考"表，补充关键入口
  - 添加：调研文档 `docs/90-参考资料/小说写作与AI调研/01-小说写作与AI调研.md`
  - 添加：NarraFork UI 参考 `docs/90-参考资料/NarraFork参考/03-NarraFork-UIUX与交互功能调研.md`
  - 添加：Claude Code 参考 `docs/90-参考资料/Claude-Code参考/`
  - 添加：架构总览 `docs/04-架构与设计/01-系统架构总览.md`
  - 添加：Agent 管线设计 `docs/04-架构与设计/03-Agent写作管线.md`
  - 添加：小说创作流程 `docs/03-产品与流程/01-小说创作流程.md`
  - 添加：AI味过滤器开发指引 `docs/05-开发者指南/04-AI味过滤器开发指引.md`
  - 添加：当前 spec 主线 `.kiro/specs/novel-writing-features/`
  - 添加：已完成的预设/模式/工具 spec（归档但有实现参考价值）
- [ ] 8.3 更新 `.kiro/steering/project-profile.md`
  - 同步"当前已实现的核心功能"（加入新书引导向导）
  - 同步"当前目标"（从 v0.1.0 发布 → 小说写作功能接入新前端）
  - 补充"关键参考文档"索引段
  - 补充"已完成但未接入新前端的底层能力"清单
- [ ] 8.4 清理 `docs/01-当前状态/` 中过时的状态描述
  - `03-当前执行主线.md` — 更新为 novel-writing-features
  - `04-产品能力重新验收矩阵.md` — 标记新书引导已实现
- [ ] 8.5 更新 `docs/02-用户指南/02-小说管理与创作.md`
  - 补充新建书籍极简流程（仓库优先+可选书名）
  - 补充新书引导向导（11题三模式）
  - 补充引导完成后进入工作台的流程
- [ ] 8.6 更新 `docs/README.md` 文档中心入口
  - 确保所有重要文档都能从入口找到
  - 添加"小说写作功能开发"专区链接
- [ ] 8.7 归档或删除已失效的文档
  - `docs/narrafork-parity-gap-report.md` — 评估是否仍有价值
  - `docs/99-历史归档/` 中的内容确认不再被引用
- [ ] 8.8 验证文档一致性
  - 全仓搜索旧口径（如"叙事线"应为"叙事线（书籍）"）
  - 确认所有文档中的命令/路径/端口与实际一致
  - 确认 CHANGELOG.md Unreleased 段包含本次所有改动
