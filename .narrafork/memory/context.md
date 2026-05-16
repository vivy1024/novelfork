# 工作上下文 — NovelFork
更新: 2026-05-18

## 当前版本
v0.9.1

## 分支
master

## 最近完成
- runtime-capability-alignment spec 6 Phase 全部完成
- Subagent 深度改造（fork cache/abort/auto-bg/运行中转后台）
- 8 个通用工具补全（WebSearch/WebFetch/PlanMode/TaskCreate/AskUser/Send/Recall）
- Review 修复（内存泄漏/行号匹配/工具过滤/后台异常）
- 使用历史真实数据 + 服务器配置可编辑
- 对话面板 bug 修复（中断/切换/折叠/归档/溢出）

## 技术笔记
- user-config.json: C:\Users\17655\.novelfork\user-config.json
- 白名单目录修复：resolveToolPath + Glob/Grep 都检查白名单
- Subagent 架构：同进程 executeRuntimeTurn，非子进程
- Fork 模式：继承父级最近 20 条消息实现 cache 共享
- 压缩摘要：调用 summaryModel，失败直接报错不 fallback
- 工具过滤：CORE_TOOL_NAMES 集合控制默认注入的工具

## 下一步
- 内测分发 + 用户反馈
- Worktree 隔离（git worktree）
- Agent Memory 持久化
- 真实终端 PTY（WebSocket + xterm.js）
