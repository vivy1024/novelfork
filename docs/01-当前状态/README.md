# 01 - 当前状态

NovelFork Studio 项目状态总览。

## 版本信息

| 项目 | 值 |
|------|------|
| 当前版本 | v1.11.2 |
| 发布日期 | 2025-01 |
| 运行平台 | Windows x64（单 exe） |
| 开发者 | 薛小川 (vivy1024) |

## 技术栈

| 层 | 技术 |
|----|------|
| 运行时 | Bun 1.2+ |
| 语言 | TypeScript 5.x (strict) |
| 前端 | React 19 + Vite |
| 后端 | Hono (HTTP/WebSocket) |
| 数据库 | SQLite (bun:sqlite) |
| 编译产物 | bun build --compile → 单 exe |

## 能力矩阵

| 能力域 | 工具数 | 说明 |
|--------|--------|------|
| 基础工具 | 25 | 文件/终端/Git/搜索/浏览器/MCP |
| 小说领域工具 | 24 | 经纬/管线/驾驶舱/审计/资源 |
| **合计** | **~49** | |

## 模块统计

| 模块类型 | 数量 |
|----------|------|
| Harness 模块 | 15+ |
| Agent 类型 | 7 (Writer/Continuity/Reviser/LengthNorm/StateValidator/Radar/Architect) |
| Provider 适配器 | 4 (Anthropic/Completions/Codex/ClaudeCode) |
| 前端页面组件 | 38 (写作工作台) |
| 数据库迁移 | 30+ |

## Agent Runtime 对齐状态

| 维度 | 评分 | 说明 |
|------|------|------|
| 工具执行 | ✅ | 90-case 分发中枢，完整权限管线 |
| 安全层 | ✅ | 5 层防护（子命令拆分/引号状态机/路径沙箱/密钥检测/YOLO 安全反思） |
| 上下文管理 | ✅ | 4 层渐进压缩（Snip/Compact/Summary/Archive） |
| 流式输出 | ✅ | WebSocket envelope 协议，实时推送 |
| Provider 兼容 | ✅ | Anthropic 原生 + OpenAI Completions + Codex + ClaudeCode |
| 会话持久化 | ✅ | SQLite 全量存储 + fork/回滚/分支 |
| MCP 集成 | ✅ | 动态服务器管理 + 工具注入 |
| 权限系统 | ✅ | permission-pipeline + YOLO mode + safety reflection |
| 小说领域 | ✅ | 完整写作管线 v2 + 质量门禁 |
| 插件化 | ✅ | core/studio/novel-plugin 三层分离 |
| **总分** | **10/10** | |

## 已知问题

| 问题 | 状态 | 说明 |
|------|------|------|
| 图片发送 | 待验证 | 多模态消息格式需实测 |
| 清空上下文 | 待优化 | 当前直接删记录，计划改为标记式 |

## 代码规模

| 指标 | 值 |
|------|------|
| 源文件数 | 822+ |
| 符号数 | 4000+ |
| Git Commits | 1645+ |
| 总代码行数 | ~120k TS |
