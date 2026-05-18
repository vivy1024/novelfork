# Studio能力矩阵 v3.0

**版本**: v1.0.0
**创建日期**: 2026-04-28
**更新日期**: 2026-05-18
**状态**: ✅ 当前有效
**文档类型**: current

---

## 1. 文档目的

本文记录 NovelFork Studio v1.0.0 的功能能力状态。所有 runtime 能力已对标 Claude Code。

状态口径：
- **真实可用**：有真实 API、持久化或真实 runtime 调用，失败时返回真实错误。
- **透明过渡**：功能可用但仍是临时态，UI/API 明确标注。
- **未接入**：标记为不支持，不伪造成功。

---

## 2. AI 写作能力

| 能力 | 状态 | 说明 |
|------|------|------|
| **续写/扩写/补写** | ✅ 真实可用 | LLM 真实生成，选中文本后触发 |
| **对话生成** | ✅ 真实可用 | 多角色、指定场景和目的 |
| **多版本对比** | ✅ 真实可用 | 2-5 个版本并排 |
| **大纲分支** | ✅ 真实可用 | 2-3 条走向建议 |
| **大纲生成** | ✅ 真实可用 | 流程已验证通过 |
| **整章生成（write-next）** | ✅ 真实可用 | cockpit → PGI → guided plan → candidate 完整链路 |
| **审校当前章** | ✅ 真实可用 | 连续性、人设、文笔审查 |
| **去 AI 味检测** | ✅ 真实可用 | 12 特征规则 + 7 招消味建议 |
| **去 AI 味闭环** | ✅ 真实可用 | 改写后自动重新检测 |
| **连续性检查** | ✅ 真实可用 | 人物/设定/伏笔冲突检测 |
| **章节钩子生成** | ✅ 真实可用 | 3-5 个备选方案 |
| **AI 味过滤** | ✅ 真实可用 | 本地 12 规则 + 可选朱雀 API |
| **文风仿写** | ✅ 真实可用 | 从参考文本导入 + style guide 注入 |
| **生成前追问（PGI）** | ✅ 真实可用 | 写作前自动追问确认上下文 |
| **核心设定变更（CoreShift）** | ✅ 真实可用 | 审计链：propose → accept/reject |
| **非破坏性写入** | 强制 | AI 结果只进候选区，确认后才影响正文 |

## 3. 5 Agent 写作管线

| 能力 | 状态 |
|------|------|
| Explorer Agent（只读探索） | ✅ |
| Planner Agent（规划大纲/节拍） | ✅ |
| Writer Agent（正文生成） | ✅ |
| Auditor Agent（审校/连续性） | ✅ |
| Reviser Agent（修订/润色） | ✅ |
| 串行编排（Explorer→Planner→Writer→Auditor→Reviser） | ✅ |
| WorkflowProgressCard 可见执行链 | ✅ |
| 每种 Agent 专属 system prompt（200+ 行） | ✅ |

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
| 大纲编辑器 | ✅ |
| 导出 TXT/DOCX/ePub | ✅ |
| 删除整书 | ✅ |

## 5. 资源管理器

| 功能 | 状态 |
|------|------|
| 作品 → 已有章节 → 生成章节 → 草稿 → 大纲 | ✅ |
| 故事文件（pending_hooks/章节摘要等） | ✅ |
| 真相文件（book_rules/current_focus等） | ✅ |
| 经纬资料库（人物/事件/设定/摘要） | ✅ |
| 素材 / 发布报告 | ✅ |
| 章节编辑器（TipTap 富文本） | ✅ |
| Markdown/Text viewer | ✅ |
| Mutation 后资源树自动刷新 | ✅ |

## 6. 故事经纬（SQLite 持久化）

| 能力 | 状态 |
|------|------|
| 存储层：SQLite story_jingwei_entry 表（已从 md 迁移） | ✅ |
| 人物 / 事件 / 设定 / 章节摘要 CRUD | ✅ |
| 经纬模板应用（空白/基础/增强/题材推荐） | ✅ |
| 三种可见性规则（tracked/global/nested） | ✅ |
| 时间线纪律（visible_after_chapter） | ✅ |
| 双写作哲学模式（static/dynamic） | ✅ |
| 问答卷系统（模板 + AI 建议） | ✅ |
| 矛盾追踪（8 类矛盾 7 态状态链） | ✅ |
| 世界模型（5 维度） | ✅ |
| 核心设定变更协议 | ✅ |
| 经纬上下文装配（按 token 预算裁剪） | ✅ |
| react-flow 关系图谱（5 种视图模式） | ✅ |
| 图谱可见性标识 | ✅ |
| 批量管理（多选 + 统一设置） | ✅ |
| 自动链接引擎（标题/别名匹配） | ✅ |

## 7. 驾驶舱（从 SQLite jingwei 读取）

| 能力 | 状态 |
|------|------|
| 经纬图谱工作区（react-flow） | ✅ |
| 底部状态条（章数/节拍/质量/AI味/警告） | ✅ |
| 可展开面板（预设/节拍/质量/警告） | ✅ |
| Agent 工具（presets.get_rules / check_compliance / beat.get_current） | ✅ |
| ToolConfigBar 工具启用控制 | ✅ |
| AgentQuickActions 快捷按钮 | ✅ |
| 质量趋势图（AI味/文风漂移/质量评分） | ✅ |

## 8. 写作工具

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

## 9. Agent-native 工作台

| 能力 | 状态 |
|------|------|
| 产品壳首页（最近作品/会话/模型健康/快速动作） | ✅ |
| 左侧资源栏（全局导航 + 书籍资源树） | ✅ |
| 中间画布（多资源 Tab、编辑、dirty guard） | ✅ |
| 右侧叙述者会话（live runtime、工具调用、确认门） | ✅ |
| cockpit 工具结果展示 | ✅ |
| PGI + GuidedGenerationPlan | ✅ |
| Narrative Line | ✅ |
| unsupported-tools 降级 | ✅ |
| OpenAI-compatible 工具名映射 | ✅ |

## 10. 引导系统

| 能力 | 状态 |
|------|------|
| FirstRunDialog 首启弹窗 | ✅ |
| GettingStartedChecklist 开始使用清单 | ✅ |
| 模型未配置 gate（不阻断本地操作） | ✅ |
| 新书引导向导（NewBookGuide 11 题三模式） | ✅ |

## 11. Runtime 能力（对标 Claude Code）

| 能力 | 状态 |
|------|------|
| CLAUDE.md 读取（全局/项目/.claude/rules/） | ✅ |
| LLM 智能压缩（摘要模型生成对话摘要） | ✅ |
| Subagent 系统（explore/plan/general/fork） | ✅ |
| 后台任务（自动后台化） | ✅ |
| Prompt Cache（Anthropic cache_control） | ✅ |
| ToolSearch 动态发现 | ✅ |
| Skills 系统 | ✅ |
| MCP 工具治理 | ✅ |
| 沙箱执行（none/basic/strict） | ✅ |
| Browser 截图（headless Chrome/Edge） | ✅ |
| Terminal 工具 | ✅ |
| WebSearch / WebFetch | ✅ |
| AskUserQuestion（支持多选） | ✅ |
| 文件安全（Staleness check + Dedup + 二进制检测） | ✅ |
| 请求日志 SQLite 持久化（request_log 表） | ✅ |

## 12. 设置与配置

| 功能 | 状态 |
|------|------|
| AI 供应商管理（API key 接入） | ✅ |
| 平台集成（Codex/Kiro JSON 账号导入） | ✅ |
| 模型池管理（刷新/测试/启用禁用） | ✅ |
| Runtime control panel（权限/上下文/工具策略） | ✅ |
| 模型默认值/摘要模型/子代理配置 | ✅ |
| 套路页（命令/工具/权限/技能/子代理/MCP/钩子） | ✅ |
| 更新检查（GitHub API 对比版本） | ✅ |

## 13. 合规与发布

| 功能 | 状态 |
|------|------|
| 敏感词扫描（起点/晋江/番茄/七猫/通用） | ✅ |
| AI 比例估算 | ✅ |
| 发布就绪检查 | ✅ |
| AI 使用声明生成 | ✅ |
| 格式规范检查 | ✅ |
| 导出 TXT/DOCX/ePub | ✅ |

## 14. 写作预设

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

## 15. 工具总数

48+ 工具，涵盖：
- Core 内置工具（plan/compose/write/audit/revise 等）
- 通用工具（Read/Write/Edit/Bash/Grep/Glob/Agent/Await/Terminal/Browser/ToolSearch/Skill/WebSearch/WebFetch/EnterPlanMode/ExitPlanMode/TaskCreate/AskUserQuestion/Send/Recall）
- 小说领域工具（cockpit/jingwei/candidate/writing-mode/compliance/health 等）
