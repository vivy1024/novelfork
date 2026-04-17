# 版本演进历史

本文档记录 InkOS 项目从概念到产品的完整演进路径。

---

## 项目演进时间线

### Phase 0: 概念验证（2025 Q4 - 2026 Q1）

**项目名称**: NovelFork  
**定位**: AI 小说写作实验性工具

#### 核心理念
- 探索 AI 辅助长篇小说创作的可行性
- 验证多 Agent 协作写作模式
- 研究连续性保持与风格一致性问题

#### 技术探索
- 测试不同 LLM 提供商（Claude, GPT-4, etc.）
- 实验 Prompt Engineering 技术
- 探索章节级别的上下文管理

#### 关键产出
- 概念验证代码
- 初步的写作流水线设计
- 连续性问题识别与分类

---

### Phase 1: 架构奠基（2026 Q1）

**里程碑**: 建立 monorepo 架构与核心模块

#### 架构决策
- 采用 pnpm workspace monorepo 结构
- 分离 core（引擎）、cli（命令行）、studio（Web UI）三层
- 确立 TypeScript + Node.js 22.5+ 技术栈

#### 核心模块
- **@actalk/inkos-core**: 写作引擎核心
  - 10-Agent 流水线框架
  - 33 维度连续性审计系统
  - 风格克隆与去 AI 化处理
- **@actalk/inkos-cli**: 命令行工具
  - 基础命令框架
  - EPUB 导出支持
- **@actalk/inkos-studio**: Web 工作台
  - React 19 + Vite 6
  - 基础 UI 框架

#### 技术选型
- **验证框架**: Zod（类型安全的数据验证）
- **Web 框架**: Hono（轻量级）+ Express（兼容性）
- **UI 库**: React 19 + Tailwind CSS 4
- **构建工具**: Vite 6 + TypeScript 5.8

---

### Phase 2: 工具系统（2026 Q1 - Q2）

**里程碑**: 实现完整的工具调用与 Worktree 系统

#### 工具系统（Phase 1-3）
- **Phase 1**: 工具系统基础框架
  - 工具注册与执行接口
  - AI 提供商管理（Anthropic, OpenAI）
- **Phase 2**: 核心工具实现
  - 文件操作工具
  - Git 操作工具
  - 搜索与查询工具
- **Phase 3**: 工具 API 暴露
  - RESTful API 接口
  - WebSocket 实时通信

#### Worktree 系统（Phase 4-6）
- **Phase 4**: 工具显示组件
  - 工具调用可视化
  - 参数展示与编辑
- **Phase 5**: Worktree 后端
  - Git Worktree 管理
  - 多分支并行支持
- **Phase 6**: Worktree UI
  - 分支切换界面
  - 合并冲突解决

#### 文件修改系统（Phase 7）
- Diff 查看器
- 文件修改面板
- 版本对比功能

#### 测试覆盖（Phase 8）
- 集成测试框架
- 工具系统测试
- Worktree 系统测试

#### AI 提供商管理（Phase 9）
- 多提供商配置
- API Key 管理
- 模型选择与切换

---

### Phase 3: Studio 可视化（2026 Q2）

**里程碑**: 完整的 Web 工作台与可视化系统

#### 核心界面
- **多窗口卡片对话系统**: 支持多个对话窗口并行
- **实时上下文管理**: 动态显示当前写作上下文
- **AI 聊天界面**: 与 AI 助手交互
- **消息编辑与重新生成**: 编辑历史消息并重新生成

#### 可视化组件
- **监控面板**: WebSocket 实时日志流
- **会话管理**: 多会话切换与历史记录
- **工具调用可视化**: 展示 Agent 工具使用情况
- **全局搜索**: FTS 全文索引搜索

#### Git 集成
- **双 Git 按钮**: 日志查看器 + Fork/Merge 操作
- **Git Worktree 可视化**: 分支管理界面

#### 设置系统
- **Config 标签**: 基础配置
- **Status 标签**: 系统状态监控
- **Usage 标签**: 使用统计

#### 布局系统
- CSS Grid 响应式布局
- 可调整大小的面板
- 底部上下文面板（4 个 Tab）

#### PWA 支持
- 离线使用能力
- 安装到桌面
- Service Worker 缓存

---

### Phase 4: 核心功能完善（2026 Q2 - Q3）

**里程碑**: 套路系统与 NER 集成（v1.1.1）

#### 套路系统（Routines System）
- 写作模板管理
- 套路库（常见情节模式）
- 自定义套路创建

#### NER + Lorebook RAG
- 命名实体识别（80%+ 准确率）
- 实体关系图谱
- Lorebook 自动构建
- RAG 检索增强生成

#### 倒计时系统
- 写作进度追踪
- 截止日期管理
- 逾期警告

#### 黄金三章分析器
- 开篇分析
- 钩子识别
- 改进建议

---

### Phase 5: 架构扩展（2026 Q3 - Q4）

**里程碑**: P2 阶段完成，可观测性升级（v1.2.0）

#### ToolRegistry（P2-0）
- 统一工具注册接口
- 支持 builtin/mcp/plugin 三种来源
- 移除 250+ 行 switch-case

#### Pipeline Hooks（P2-2）
- 16 个生命周期阶段拦截器
- before-plan, after-write, chapter-complete 等
- 支持通知、日志、自动备份扩展

#### MCP Client 集成（P2-3）
- stdio 和 SSE 传输支持
- 自动重连机制（180s 超时）
- MCP 工具自动注册
- 21 个测试全部通过
- 与 Claude Code / CC Switch 配置兼容

#### Plugin 系统（P2-11）
- PluginManager 生命周期管理
- 动态注册 tools 和 hooks
- 示例 AutoBackupPlugin
- 热重载支持

#### Pipeline 可视化（P2-6）
- VoltOps 风格运行态流程图
- 7 个阶段卡片（plan → compose → write → normalize → settle → audit → revise）
- 实时状态显示 + Token 统计
- SSE 实时事件流

#### State Projections 可视化（P2-13）
- 结构化展示运行时状态快照
- current_state/hooks/summaries

#### MCP Server 管理（P2-10）
- MCP Server 启动/停止/删除
- 工具列表查询
- 进程管理 + inkos.json 配置持久化

#### 其他可视化
- Agent 管理面板
- Scheduler 高级配置
- AIGC 检测配置
- 伏笔健康仪表盘
- LLM 高级参数暴露
- Author Intent / Current Focus 编辑器

---

## 版本号说明

### 语义化版本（Semantic Versioning）

InkOS 遵循 [Semantic Versioning 2.0.0](https://semver.org/) 规范：

```
MAJOR.MINOR.PATCH

例如: 1.2.0
     │ │ │
     │ │ └─ PATCH: 向后兼容的 bug 修复
     │ └─── MINOR: 向后兼容的新功能
     └───── MAJOR: 不向后兼容的 API 变更
```

### 版本历史

| 版本 | 发布日期 | 里程碑 | 关键特性 |
|------|---------|--------|---------|
| **0.0.1** | 2026-04-18 | 初始版本 | 基础架构、CLI、Studio 框架 |
| **1.1.1** | 2026-04-08 | Phase 4 完成 | 套路系统、NER+RAG、Studio 可视化 |
| **1.2.0** | 2026-04-14 | P2 阶段完成 | MCP 集成、Plugin 系统、Pipeline 可视化 |

### 版本命名规则

- **0.x.x**: 早期开发版本，API 不稳定
- **1.x.x**: 稳定版本，向后兼容
- **2.x.x**: 重大架构升级（未来）

---

## 技术栈演进

### 前端技术栈

| 技术 | 初始版本 | 当前版本 | 演进原因 |
|------|---------|---------|---------|
| React | 18.x | 19.0.0 | 性能优化、新特性 |
| Vite | 5.x | 6.0.0 | 构建速度提升 |
| Tailwind CSS | 3.x | 4.0.0 | 新特性、性能优化 |
| TypeScript | 5.3 | 5.8.0 | 类型系统增强 |

### 后端技术栈

| 技术 | 初始版本 | 当前版本 | 演进原因 |
|------|---------|---------|---------|
| Node.js | 20.x | 22.5+ | 性能提升、新 API |
| Hono | 3.x | 4.7.0 | 轻量级、高性能 |
| Zod | 3.22 | 3.24.0 | 验证功能增强 |

### AI SDK

| 技术 | 初始版本 | 当前版本 | 演进原因 |
|------|---------|---------|---------|
| @anthropic-ai/sdk | 0.20.x | 0.78.0 | API 更新、新模型支持 |
| openai | 4.20.x | 4.80.0 | API 更新、新模型支持 |
| @modelcontextprotocol/sdk | - | 1.0.4 | MCP 集成 |

---

## 关键里程碑

### 🎯 已完成

- ✅ **2026-Q1**: 架构奠基，monorepo 建立
- ✅ **2026-Q2**: 工具系统完成（Phase 1-9）
- ✅ **2026-Q2**: Studio 可视化完成
- ✅ **2026-Q3**: 套路系统与 NER 集成（v1.1.1）
- ✅ **2026-Q3**: P2 阶段完成（v1.2.0）

### 🚀 进行中

- 🔄 **2026-Q4**: Pipeline 可视化集成到 runner.ts
- 🔄 **2026-Q4**: 持久化存储（数据库替换内存 Map）
- 🔄 **2026-Q4**: Pipeline 运行历史列表

### 📋 计划中

- 📅 **2027-Q1**: 完整的 EPUB 导出功能
- 📅 **2027-Q1**: 更多写作流派模板支持
- 📅 **2027-Q2**: 性能优化与缓存机制
- 📅 **2027-Q2**: 多语言支持（i18n）
- 📅 **2027-Q3**: Electron 桌面应用
- 📅 **2027-Q3**: 协作写作功能

---

## 开源生态参考

InkOS 的架构设计参考了以下优秀开源项目：

| 项目 | 参考点 | 应用场景 |
|------|--------|---------|
| **AstrBot** | Agent 架构、插件系统 | Plugin 系统设计 |
| **Mastra** | 工作流编排 | Pipeline 设计 |
| **VoltAgent** | 可视化流程图 | Pipeline 可视化 |
| **CopilotKit** | AI 集成模式 | AI 提供商管理 |
| **CC Switch** | MCP 配置格式 | MCP Client 兼容性 |
| **Rivet** | 节点编辑器 | 未来的可视化编程 |

---

## 贡献者

- **薛小川** (vivy1024) - 项目创始人与核心开发者

---

## 许可证

MIT License

---

**最后更新**: 2026-04-18  
**当前版本**: v0.0.1 → v1.2.0
