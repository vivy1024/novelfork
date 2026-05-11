# Changelog

本文件记录 **NovelFork** 的版本变更。

---

## Unreleased

（无）

---

## v0.1.0 (2026-05-11)

首个正式发布版本。网文小说 AI 辅助创作工作台。

### 核心功能

- **多 Agent 写作管线**：5 个固定 Agent（写书/伏笔/章末钩子/审校/大纲与经纬），侧边栏点击书籍即可展开
- **引导式生成**：PGI 生成前追问 → Guided Plan 计划确认 → 候选稿生成，AI 输出不覆盖正文
- **48 个 Agent 工具**：对齐 NarraFork 全量工具（文件操作、Glob/Grep、浏览器、子代理、终端、WebSearch 等）
- **经纬资料管理**：按类别分组（角色/势力/设定/伏笔/大纲/状态/规则），支持子目录结构
- **新书引导向导**：11 题三模式（预设选择/自定义/跳过随机），自动生成初始经纬文件
- **写作预设面板**：6 流派 / 5 文风 / 6 基底 / 8 逻辑规则预设管理
- **AI 味检测**：12 规则本地检测 + 消味建议
- **章节健康度**：节奏/对话比例/句长直方图
- **选段写作**：续写/扩写/补写 + 多版本变体
- **日更进度追踪** + 节拍表
- **平台合规检查** + 导出 TXT/Word/ePub
- **角色弧线** + 文风漂移检测 + 模板市场
- **连续性审计**：自动检测剧情矛盾、人设冲突
- **Checkpoint/Rewind**：资源快照与回滚

### 工作台体验

- **Agent Shell 架构**：左侧边栏（书籍+叙述者）/ 中间画布 / 右侧对话
- **Context Ring**：始终可见的上下文使用率环形图，点击弹出压缩/清空菜单
- **主题切换**：亮色/暗色/跟随系统，Tailwind dark mode class 策略
- **使用历史**：按提供商和模型分组的 Token 统计
- **驾驶舱总览**：进度条/字数/审校/风险/建议
- **候选稿管理**：接受/拒绝/归档/删除操作栏
- **学习中心**：9 篇内置文档 + `/next/learn` 页面
- **Onboarding**：首次运行欢迎弹窗 + 空态教学

### Agent 与对话

- 5 种 Agent 角色专属 system prompt（200+ 行领域知识）
- Agent 自动加载书籍上下文（进度/经纬/伏笔/章节摘要）
- 工具权限管线：permission mode + tool policy + risk 分级
- 确认门机制：高风险操作需用户批准
- 会话 lifecycle：fork/compact/resume/continue
- 流式 tool_use 解析（Anthropic + OpenAI adapter）
- 对话状态栏：模型/权限/推理强度/实时计时器

### 供应商与模型

- 多供应商支持：OpenAI / Anthropic / DeepSeek / 自定义兼容
- 模型池动态加载 + contextWindow/maxOutputTokens
- 供应商详情页：有改动才显示保存按钮
- 推理强度/Fast Mode 按 API 模式条件显示

### CLI

- `novelfork -p` / `novelfork exec` headless 模式
- stream-json NDJSON 输出
- `--book` / `--session` / `--model` / `--permission-mode` 参数

### 工程

- TypeScript monorepo：core / studio / cli
- Bun + React 19 + Hono + SQLite + Vite
- 单文件 exe 编译（bun compile + 嵌入前端资源）
- 213 测试文件 / 1274+ 测试 / typecheck 通过
- 桌面窗口模式（Edge/Chrome app mode）

### 文档

- 用户指南 4 篇（小说管理、AI 写作、叙述者对话、设置与套路）
- 产品流程 4 篇（创作流程、资源管理器、AI 输出与候选稿、故事经纬）
- 架构设计 4 篇（系统架构、Studio 工作台、Agent 写作管线、驾驶舱）
- 开发者指南（存储层、AI 味过滤器）
- 学习中心 9 篇

---

## v0.0.4 (2026-05-02)

### 改进
- Studio 共享 UI 文案统一中文化
- 强化 release 版本管理规则

### 测试
- 新增 UI 本地化断言与 completion audit

## v0.0.3 (2026-05-02)

### 修复
- 修复编译链路不一致、搜索/项目模型/工作流契约断链
- 清理 Tauri 退役残留

## v0.0.2 (2026-05-01)

### 桌面应用
- Edge/Chrome app mode 渲染，无浏览器外壳
- 窗口启动控制环境变量

### 构建
- 单文件产物内置 Studio 静态资源

## v0.0.1 (2026-05-01)

### 创作工作台
- 三栏布局 + 资源管理器 + TipTap 编辑器
- 6 种写作模式 + AI 动作 + Agent 系统
- 驾驶舱 + 故事经纬 + 合规预设
- 137 测试文件 / 801 测试

---

## v0.0.0 (2026-04-19)

### 项目基础
- Fork 自 InkOS，专注中文网文创作
- monorepo 结构：core / studio / cli
