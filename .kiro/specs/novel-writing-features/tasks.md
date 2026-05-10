# 小说写作特有功能 — 任务清单

## Phase 1: 写作预设引擎 + 核心预设

- [ ] 1.1 设计 `WritingPreset` 接口和 `PresetEngine` 核心类
- [ ] 1.2 实现预设存储（内置 + 自定义 JSON）
- [ ] 1.3 实现预设执行流程（组装上下文 → LLM 调用 → 返回结果）
- [ ] 1.4 实现预设「续写下一节」— 注入经纬+前文+节奏规则
- [ ] 1.5 实现预设「风格改写」— 选段 + 5种文风切换
- [ ] 1.6 实现预设「脂砚斋评点」— 夹批式反馈（技法/伏笔/情绪/节奏）
- [ ] 1.7 实现预设「消 AI 味润色」— 12特征检测+9招改写
- [ ] 1.8 前端 PresetSelector 组件（替换/扩展 WritingToolsPanel）
- [ ] 1.9 前端 PresetResultView 组件（按 outputFormat 渲染结果）
- [ ] 1.10 API: `POST /books/:id/presets/:presetId/run`
- [ ] 1.11 浏览器验证：选段 → 选预设 → 执行 → 看到结果

## Phase 2: 消 AI 味管线

- [ ] 2.1 实现 `AiTasteDetector` — 本地12特征检测算法
- [ ] 2.2 实现 AI 味评分算法（0-100）
- [ ] 2.3 实现 `AiTasteFixer` — 9招降AI味改写（调LLM）
- [ ] 2.4 API: `POST /books/:id/chapters/:chId/ai-taste/detect`
- [ ] 2.5 API: `POST /books/:id/chapters/:chId/ai-taste/fix`
- [ ] 2.6 前端 AiTasteOverlay — 编辑器内高亮 AI 味段落
- [ ] 2.7 前端一键降 AI 按钮 + 循环检测直到达标
- [ ] 2.8 章节卡片上显示 AI 味分数徽章
- [ ] 2.9 浏览器验证：写一段AI味重的文字 → 检测 → 高亮 → 一键修复 → 分数下降

## Phase 3: 章节健康度

- [ ] 3.1 实现 `ChapterHealthAnalyzer` 核心类
- [ ] 3.2 实现节奏评分算法（爽点间距分析）
- [ ] 3.3 实现情绪曲线标注（LLM 按段落标注 + 缓存）
- [ ] 3.4 实现开篇吸引力评分（前500字分析）
- [ ] 3.5 实现结尾卡点评分（后200字分析）
- [ ] 3.6 实现估算完读率公式（综合加权）
- [ ] 3.7 API: `POST /books/:id/chapters/:chId/health`
- [ ] 3.8 前端 HealthDashboard 组件（卡片式展示所有指标）
- [ ] 3.9 前端 EmotionCurve 可视化（SVG 折线图）
- [ ] 3.10 CockpitOverview 集成健康度摘要
- [ ] 3.11 浏览器验证：打开章节 → 看到健康度卡片 → 情绪曲线正确

## Phase 4: 节拍表系统

- [ ] 4.1 设计 `BeatTemplate` 和 `Beat` 数据结构
- [ ] 4.2 实现4个内置模板（救猫咪/英雄之旅/三幕/网文开篇12式）
- [ ] 4.3 实现章节节拍标记（chapter metadata 扩展）
- [ ] 4.4 实现节拍约束注入（生成时注入当前节拍要求到 system prompt）
- [ ] 4.5 API: `POST /books/:id/chapters/:chId/beat-annotate`
- [ ] 4.6 前端 BeatProgressBar 组件（显示当前在哪个节拍）
- [ ] 4.7 前端节拍选择器（新建章节时选择/标记节拍）
- [ ] 4.8 浏览器验证：选择救猫咪模板 → 标记章节节拍 → AI生成时遵循约束

## Phase 5: 日更进度追踪

- [ ] 5.1 SQLite migration: `daily_progress` 表
- [ ] 5.2 实现 `DailyProgressTracker` 服务（自动统计每日字数）
- [ ] 5.3 API: `GET /books/:id/daily-progress`
- [ ] 5.4 API: `PUT /books/:id/daily-progress/target`（设置日更目标）
- [ ] 5.5 前端 DailyProgressWidget（今日字数/目标/连续天数）
- [ ] 5.6 前端 CalendarHeatmap（日历热力图）
- [ ] 5.7 DashboardPage 集成进度组件
- [ ] 5.8 浏览器验证：写作后看到今日字数更新 + 热力图有数据

## Phase 6: 剩余预设 + 黄金三章 + 合规

- [ ] 6.1 实现预设「黄金三章特检」— 5要素打分
- [ ] 6.2 实现预设「爽点设计」— 基于节拍给3个方案
- [ ] 6.3 实现预设「金手指设计」— 8问自检+限制建议
- [ ] 6.4 实现预设「反套路思考」— 反转/颠覆方案
- [ ] 6.5 实现预设「人设辩论」— 多agent模拟角色对话
- [ ] 6.6 实现预设「大纲展开」— McKee五层结构
- [ ] 6.7 实现预设「同章多变体」— 3-5种并排对比
- [ ] 6.8 实现预设「短剧分镜化」— 15-20集分镜
- [ ] 6.9 实现 `ComplianceChecker` — 敏感词+AI含量+标注
- [ ] 6.10 API: `POST /books/:id/compliance-check`
- [ ] 6.11 前端合规检查结果页
- [ ] 6.12 浏览器验证：每个预设执行产出合理结果

## Phase 7: 文风漂移 + 模板市场 + 导出

- [ ] 7.1 实现 `StyleDriftDetector` — 基线建立+漂移检测
- [ ] 7.2 实现文风漂移报告（偏离维度+校准建议）
- [ ] 7.3 设计模板市场数据结构（流派模板包）
- [ ] 7.4 实现6个流派模板（玄幻/仙侠/都市/科幻/言情/悬疑）
- [ ] 7.5 实现模板导入机制（一键导入到经纬）
- [ ] 7.6 前端模板市场浏览页
- [ ] 7.7 实现 `ExportService` — TXT/DOCX/ePub
- [ ] 7.8 API: `POST /books/:id/export/:format`
- [ ] 7.9 前端导出按钮 + 格式选择
- [ ] 7.10 浏览器验证：导出 Word 在 Office 中打开格式正确
