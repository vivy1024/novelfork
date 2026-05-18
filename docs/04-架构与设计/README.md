# 架构与设计

**版本**: v1.0.0
**创建日期**: 2026-05-10
**状态**: ✅ 当前有效
**文档类型**: current

---

## 目录职责

记录 NovelFork Studio 的系统架构、工作台架构、Agent 写作管线、存储层和技术栈选型。

## 适合阅读的人

开发者、AI agent

## 文件列表

| 文件 | 类型 | 状态 | 说明 |
|---|---|---|---|
| [01-系统架构总览.md](./01-系统架构总览.md) | current | ✅ 当前有效 | Monorepo 结构、技术栈、数据流、部署模型 |
| [02-Studio工作台架构.md](./02-Studio工作台架构.md) | current | ✅ 当前有效 | 三栏布局、路由系统、backend-contract、组件树、实时通信 |
| [03-Agent写作管线.md](./03-Agent写作管线.md) | current | ✅ 当前有效 | PipelineRunner、Agent 角色、工具链、写作动作、审计检测 |
| [04-存储与数据流.md](./04-存储与数据流.md) | current | ✅ 当前有效 | SQLite schema、文件系统布局、数据流转 |
| [05-技术栈选型.md](./05-技术栈选型.md) | current | ✅ 当前有效 | 技术选型决策记录 |
| [06-长篇驾驶舱设计.md](./06-长篇驾驶舱设计.md) | current | ✅ 当前有效 | CockpitOverview、驾驶舱 API、数据模型、工具结果卡片 |
| [07-小说前端架构.md](./07-小说前端架构.md) | current | ✅ 当前有效 | 写作工作台组件树、数据流、面板清单、状态管理 |
| [08-小说后端架构.md](./08-小说后端架构.md) | current | ✅ 当前有效 | novel-plugin 模块地图、API 路由清单、服务层、数据库表 |
| [09-Agent运行时对比分析.md](./09-Agent运行时对比分析.md) | current | ✅ 当前有效 | NovelFork/Claude Code/Codex CLI/NarraFork 对比 |
| [10-经纬系统架构.md](./10-经纬系统架构.md) | current | ✅ 当前有效 | 经纬数据模型、上下文注入管线、可见性规则、关联层 |

## 维护规则

- 本 README 只做导航，不复制子文档长正文。
- 文件列表必须与实际文件保持一致。
- `reference` 和 `archived` 文档不得冒充当前事实。
