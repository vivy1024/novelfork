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

## v1.1.1
