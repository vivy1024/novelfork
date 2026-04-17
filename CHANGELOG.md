# Changelog

## v1.2.0 (2026-04-14)

### Release Focus

**P2 阶段完成** — 架构扩展与可观测性全面升级。新增 MCP Client 集成、Plugin 系统、Pipeline 可视化、Pipeline Hooks 等核心基础设施，为 InkOS 生态扩展和深度集成奠定基础。

### 新功能

#### 核心基础设施

- **ToolRegistry** (P2-0): 统一工具注册与执行接口，支持 builtin/mcp/plugin 三种来源，移除 250+ 行 switch-case
- **Pipeline Hooks** (P2-2): 16 个生命周期阶段拦截器（before-plan/after-write/chapter-complete 等），支持通知、日志、自动备份等扩展
- **MCP Client 集成** (P2-3): 
  - 支持 stdio 和 SSE 传输
  - 自动重连机制（180s 超时）
  - MCP 工具自动注册到 ToolRegistry（source: "mcp"）
  - 21 个测试全部通过
  - 与 Claude Code / CC Switch 配置格式兼容
- **Plugin 系统** (P2-11):
  - PluginManager 生命周期管理（discover → load → initialize → active → terminate）
  - 动态注册 tools 和 hooks
  - 示例 AutoBackupPlugin（章节自动备份）
  - 热重载支持

#### Studio 可视化

- **State Projections 可视化** (P2-13): 结构化展示运行时状态快照（current_state/hooks/summaries）
- **MCP Server 管理** (P2-10): 
  - MCP Server 启动/停止/删除
  - 工具列表查询
  - 进程管理 + inkos.json 配置持久化
- **Pipeline 可视化** (P2-6):
  - VoltOps 风格运行态流程图
  - 7 个阶段卡片（plan → compose → write → normalize → settle → audit → revise）
  - 实时状态显示 + Token 统计 + 耗时 + tool 调用日志
  - SSE 实时事件流

#### 其他改进

- **Agent 管理面板**: Agent 配置、状态监控、启停控制
- **Scheduler 高级配置**: 调度策略可视化配置
- **AIGC 检测配置**: AI 检测参数调整
- **伏笔健康仪表盘**: 伏笔池状态可视化
- **LLM 高级参数暴露**: 温度、token、thinking budget 等参数可视化配置
- **Author Intent / Current Focus 编辑器**: 长期意图和当前焦点可视化编辑

### 架构变更

- **P2-4 MCP Server 暴露已删除**: 场景不成立（MCP Server 需要常驻运行，但 InkOS 是写作工具不是后台服务）。替代方案：外部工具直接读 markdown 文件或使用 HTTP API

### Bug Fixes

- 修复 `webhook.ts` 缺失的 `"chapter-failed"` 事件类型
- 恢复 `runner.ts` 完整文件（之前提交破坏了该文件）
- 修复 SSE 传输层 headers 兼容性

### 文档更新

- 更新 PROGRESS.md 标记 P2 阶段 100% 完成
- 新增开源参考项目映射（AstrBot、Mastra、VoltAgent、CopilotKit、CC Switch、Rivet）
- 更新工期估算和 Git 提交历史

### 后续工作

1. Pipeline 可视化集成：修改 `packages/core/src/pipeline/runner.ts` 发送实时事件
2. 持久化存储：将内存 Map 替换为数据库存储
3. 历史记录：添加 pipeline 运行历史列表页面

---

## v1.1.1 (2026-04-08)

### 新功能

#### Studio 可视化工作台
- 实现全局搜索功能，支持 FTS 全文索引
- 实现监控可视化面板，支持 WebSocket 实时日志流
- 实现会话管理功能，支持多会话切换与历史记录
- 实现双 Git 按钮（日志查看器 + Fork/Merge 操作）
- 实现工具调用可视化功能，展示 Agent 工具使用情况
- 实现消息编辑与重新生成功能
- 实现设置页面，包含 Config/Status/Usage 三个标签页
- 实现 AI 聊天界面，支持与助手对话
- 实现多窗口卡片对话系统
- 实现实时上下文管理系统
- 实现倒计时系统，支持逾期警告
- 实现底部上下文面板的 4 个新 Tab 组件
- 实现 CSS Grid 布局与可调整大小的面板
- 添加 PWA 支持，支持离线使用
- 实现 Phase 7 文件修改面板与 Diff 查看器
- 实现 Phase 4 工具显示组件
- 完成设置系统阶段 3-6 实现

#### 核心功能
- 实现套路系统（Routines System），支持写作模板与套路管理
- 集成 NER + Lorebook RAG 到 Composer Agent
- 实现 NER 实体提取，准确率 80%+
- 实现 Phase 3 和 Phase 6 工具 API 与 Worktree UI
- 实现 Phase 2 和 Phase 5 核心工具与 Worktree 后端
- 实现 Phase 1 工具系统与 Phase 9 AI 提供商管理

#### Git Worktree 系统
- 完善 Git Worktree 多线并行系统

#### 测试
- 添加 Phase 8 集成测试，覆盖工具与 Worktree 系统

### 变更

- 简化提供商管理，仅保留 Anthropic 和 OpenAI
- 清理技术栈演变遗留物

### Bug Fixes

- 修复搜索路由与组件导入问题
- 修复 Studio 测试以处理新的服务器返回类型
- 修正黄金三章分析器正则表达式锚点问题
- 修复 Studio TypeScript 构建错误
- 修复 @tauri-apps/plugin-shell Vite 外部配置
- 添加缺失的 PluginManager 导入

### 文档更新

- 新增技术栈演变与当前状态完整报告
- 新增 v2.0 完整规划文档体系
- 清理冗余文档，保留核心计划
- 重新整理计划文档，明确 PWA+IDE 需求
- 新增实现完成报告
- 新增 InkOS Studio 启动脚本
- 添加 Phase 9 AI 提供商与 Agent 配置管理计划

---

## v0.0.1 (2026-04-18)

### 初始版本

这是 InkOS（原 NovelFork）项目的首个正式版本标记，标志着从概念验证到可用产品的转变。

#### 核心架构
- 建立 monorepo 结构（packages/core, packages/cli, packages/studio）
- 实现 10-Agent 写作流水线基础架构
- 建立 33 维度连续性审计系统
- 实现风格克隆与去 AI 化处理

#### 基础功能
- CLI 命令行工具基础框架
- Studio Web 工作台基础界面
- 多 AI 提供商支持（Anthropic, OpenAI）
- 基础的章节生成与管理

#### 技术栈
- TypeScript + Node.js 22.5+
- React 19 + Vite 6
- Hono + Express
- Zod 验证
- pnpm workspace

---

## 版本说明

- **v1.2.0**: P2 阶段完成，架构扩展与可观测性升级
- **v1.1.1**: Phase 4 功能完成，Studio 可视化工作台成熟
- **v0.0.1**: 初始版本，基础架构建立
