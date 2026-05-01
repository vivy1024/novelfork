# Studio能力矩阵 v2.0

**版本**: v2.0.0
**创建日期**: 2026-04-28
**更新日期**: 2026-05-01
**状态**: ✅ 当前有效
**文档类型**: current

---

## 1. 文档目的

本文记录 NovelFork Studio 全部已交付能力的事实状态。覆盖 18 个已归档 spec + 3 个新完成 spec 的全部任务产出。

状态口径：
- **真实可用**：有真实 API、持久化或真实 runtime 调用，失败时返回真实错误。
- **透明过渡**：功能可用但仍是临时态、`process-memory`、`prompt-preview` 等，UI/API 明确标注。
- **未接入**：标记为不支持，不伪造成功。

---

## 2. 事实来源

| 来源 | 任务数 | 状态 |
|------|--------|------|
| `novel-creation-workbench-complete-flow` | 53/53 | ✅ |
| `project-wide-real-runtime-cleanup` | 30/30 | ✅ |
| `writing-tools-v1` | 25/25 | ✅ |
| `ui-quality-cleanup` | 25/25 | ✅ |
| `novel-bible-v1` | 21/21 | ✅ |
| `onboarding-and-story-jingwei` | 18/20 | ⚠️ 缺回归测试 |
| `writing-modes-v1` | 17/17 | ✅ |
| `writing-presets-v1` | 16/16 | ✅ |
| `workspace-gap-closure-v1` | 25/25 | ✅ |
| `agent-writing-pipeline-v1` | 15/15 | ✅ |
| `longform-cockpit-v1` | 15/15 | ✅ |
| `narrafork-platform-upgrade` | 15/15 | ✅ |
| `studio-frontend-rewrite` | 14/14 | ✅ |
| `platform-compliance-v1` | 13/13 | ✅ |
| `novelfork-narrafork-closure` | 9/9 | ✅ |
| `ai-taste-filter-v1` | 7/7 | ✅ |
| `storage-migration` | 7/7 | ✅ |
| `old-frontend-decommission` | 5/9 | ⚠️ 旧代码未完全删除 |
| **总计** | **~295** | — |

---

## 3. AI 写作能力

| 能力 | 状态 | 说明 |
|------|------|------|
| **续写/扩写/补写** | 真实可用 | LLM 真实生成，选中文本后触发 |
| **对话生成** | 真实可用 | 多角色、指定场景和目的 |
| **多版本对比** | 真实可用 | 2-5 个版本并排 |
| **大纲分支** | 真实可用 | 2-3 条走向建议 |
| **整章生成（write-next）** | 真实可用 | 异步启动，结果进候选区 |
| **审校当前章** | 真实可用 | 连续性、人设、文笔审查 |
| **去 AI 味检测** | 真实可用 | 12 特征规则 + 7 招消味建议 |
| **连续性检查** | 真实可用 | 人物/设定/伏笔冲突检测 |
| **章节钩子生成** | 真实可用 | 3-5 个备选方案 |
| **AI 味过滤** | 真实可用 | 本地 12 规则 + 可选朱雀 API |
| **文风仿写** | 真实可用 | 从参考文本导入 + style guide 注入 |
| **生成前追问（PGI）** | 真实可用 | 基于矛盾/伏笔/角色状态 |
| **核心设定变更（CoreShift）** | 真实可用 | 审计链：propose → accept/reject |
| **非破坏性写入** | 强制 | AI 结果只进候选区，确认后才影响正文 |

## 4. 章节与作品管理

| 能力 | 状态 |
|------|------|
| 创建/打开/切换作品 | ✅ |
| 创建/编辑/保存章节 | ✅ |
| 删除章节 | ✅ |
| 删除草稿/候选稿 | ✅ |
| 导入章节文本 | ✅ |
| AI 候选稿（查看/合并/替换/另存草稿/放弃） | ✅ |
| 草稿箱管理 | ✅ |
| 大纲编辑器（volume_outline.md） | ✅ |
| 导出 Markdown/TXT | ✅ |
| 删除整书 | ✅ |

## 5. 资源管理器

| 功能 | 状态 |
|------|------|
| 作品 → 已有章节 → 生成章节 → 草稿 → 大纲 | ✅ 中文标签 |
| 故事文件（pending_hooks/章节摘要等） | ✅ 18 个文件全部中文名 |
| 真相文件（book_rules/current_focus等） | ✅ 同上 |
| 经纬资料库（人物/事件/设定/摘要） | ✅ |
| 素材 / 发布报告 | ✅ |
| 章节编辑器（TipTap 富文本） | ✅ |
| Markdown/Text viewer | ✅ |
| Mutation 后资源树自动刷新 | ✅ |

## 6. 故事经纬（Bible/Jingwei）

| 能力 | 状态 |
|------|------|
| 人物 / 事件 / 设定 / 章节摘要 CRUD | ✅ SQLite 持久化 |
| 经纬模板应用（空白/基础/增强/题材推荐） | ✅ |
| 三种可见性规则（tracked/global/nested） | ✅ |
| 时间线纪律（visible_after_chapter） | ✅ |
| 双写作哲学模式（static/dynamic） | ✅ |
| 问答卷系统（模板 + AI 建议） | ✅ |
| 矛盾追踪（8 类矛盾 7 态状态链） | ✅ |
| 世界模型（5 维度） | ✅ |
| 核心设定变更协议 | ✅ |
| 经纬上下文装配（按 token 预算裁剪） | ✅ |

## 7. 写作工具

| 工具 | 状态 |
|------|------|
| 节奏分析（句长直方图） | ✅ |
| 对话占比分析 | ✅ |
| 钩子生成器 | ✅ |
| POV 视角管理 | ✅ |
| 日更进度追踪（streak/趋势） | ✅ |
| 全书健康仪表盘（6 指标） | ✅ |
| 冲突地图 | ✅ |
| 角色弧线追踪 | ✅ |
| 文风一致性检测 | ✅ |

## 8. 驾驶舱（新增）

| Tab | 内容 | 状态 |
|-----|------|------|
| 总览 | 日更进度 + 章节进度 + 当前焦点 + 最近摘要 + 风险卡片 | ✅ |
| 伏笔 | bible foreshadow events + pending_hooks.md 预览 | ✅ |
| 设定 | bible settings + book_rules.md 摘要 | ✅ |
| AI | provider/model 状态 + 最近候选稿 metadata | ✅ |

## 9. Agent 系统（新增）

| 能力 | 状态 |
|------|------|
| 5 种 Agent 角色（Writer/Planner/Auditor/Architect/Explorer） | ✅ |
| 每种 Agent 专属 system prompt（200+ 行领域知识） | ✅ |
| session-chat-service 自动注入 agent prompt | ✅ |
| Explorer Agent（只读探索，ChatWindow 可选） | ✅ |
| 编排函数（Explorer→Planner→Writer→Auditor 串行） | ✅ |
| WorkspacePage Agent 写作入口 | ✅ |
| 13 个 Core Agent 类 | ✅ |
| 18 个 Core 内置工具（plan/compose/write/audit/revise等） | ✅ |
| 22 个通用工具（ToolsTab，9 默认开/13 默认关） | ✅ |
| SubAgent 配置系统（systemPrompt + toolPermissions） | ✅ |

## 10. 设置与配置

| 功能 | 状态 |
|------|------|
| AI 供应商管理（API key 接入） | ✅ |
| 平台集成（Codex/Kiro JSON 账号导入） | ✅ |
| 模型池管理（刷新/测试/启用禁用） | ✅ |
| 虚拟模型 + 写作任务模型配置 | ✅ |
| Runtime control panel（权限/上下文/工具策略） | ✅ |
| 模型默认值/摘要模型/子代理配置 | ✅ |
| 个人资料 | ✅ |
| 关于（版本/commit/Bun） | ✅ |
| 套路页（命令/工具/权限/技能/子代理/MCP/钩子） | ✅ |

## 11. 合规与发布

| 功能 | 状态 |
|------|------|
| 敏感词扫描（起点/晋江/番茄/七猫/通用） | ✅ |
| AI 比例估算 | ✅ |
| 发布就绪检查 | ✅ |
| AI 使用声明生成 | ✅ |
| 格式规范检查 | ✅ |

## 12. 写作预设

| 类别 | 数量 | 状态 |
|------|------|------|
| 流派配置（GenreProfile） | 6 个 | ✅ |
| 文风 tone | 5 类 | ✅ |
| 时代/社会基底（Setting Base） | 6 类 | ✅ |
| 逻辑风险自检（Logic Risk） | 8 类 | ✅ |
| 预设组合（Bundle） | 6 个 | ✅ |
| 叙事节拍模板 | 5 个 | ✅ |
| AI 味过滤预设 | 4 个 | ✅ |
| 文学技法预设 | 4 个 | ✅ |

## 13. 已知缺口

| 缺口 | 状态 |
|------|------|
| 章节拖拽排序/批量操作 | 未规划 |
| EPUB 导出 | 未规划 |
| 专注/全屏写作模式 | 未规划 |
| 世界设定关系图可视化 | 未规划 |
| ChatWindow 嵌入工作台 | 未规划（需改三栏布局） |
| 旧前端源码完全删除 | 5/9 完成 |
| 首次引导烟测 | 缺回归测试 |
| 引导式创作流程串联 | UI 分散，缺统一入口 |
| 能力矩阵文档 | ← 就是这一篇，刚更新 |
