# Docs System Rearchitecture Design

**版本**: v1.0.0
**创建日期**: 2026-04-28
**更新日期**: 2026-04-28
**状态**: 📋 规划中

---

## 设计目标

本设计采用方案 B：以“当前事实优先”为核心，重建 `docs/` 为 Hub-and-Spoke 文档中心。

核心目标：

1. 当前事实只有一个入口，避免多个“当前口径”。
2. 当前事实、规划、参考、历史归档硬隔离。
3. 每个主题有 single source of truth，其他文档只引用。
4. 文档可被人读，也可被 AI agent 安全消费。
5. 文档体系通过验证脚本防腐化。

## 总体架构

目标目录：

```text
docs/
├── README.md
├── 00-文档治理/
│   ├── README.md
│   ├── 01-文档体系规范.md
│   ├── 02-迁移映射.md
│   └── 03-文档验证规则.md
├── 01-当前状态/
│   ├── README.md
│   ├── 01-项目当前状态.md
│   ├── 02-Studio能力矩阵.md
│   └── 03-当前执行主线.md
├── 02-用户指南/
│   ├── README.md
│   ├── 01-安装与启动.md
│   ├── 02-创作工作台使用指南.md
│   └── 03-设置与模型配置.md
├── 03-产品与流程/
│   ├── README.md
│   ├── 01-小说创作流程.md
│   ├── 02-资源管理器模型.md
│   ├── 03-AI输出与候选稿流程.md
│   └── 04-故事经纬流程.md
├── 04-架构与设计/
│   ├── README.md
│   ├── 01-系统架构总览.md
│   ├── 02-Studio工作台架构.md
│   ├── 03-Agent写作管线.md
│   └── 04-存储与数据流.md
├── 05-开发者指南/
│   ├── README.md
│   ├── 01-开发环境.md
│   ├── 02-存储层开发指引.md
│   ├── 03-故事经纬开发指引.md
│   └── 04-AI味过滤器开发指引.md
├── 06-API与数据契约/
│   ├── README.md
│   ├── 01-Studio API总览.md
│   ├── 02-创作工作台接口.md
│   ├── 03-数据表与迁移.md
│   └── 04-SSE与运行事件.md
├── 07-运行运维/
│   ├── README.md
│   ├── 01-当前运行与启动方式.md
│   ├── 02-配置与环境变量.md
│   ├── 03-排障手册.md
│   └── 04-版本变更记录.md
├── 08-测试与质量/
│   ├── README.md
│   ├── 01-当前测试状态.md
│   ├── 02-真实运行时与Mock清理验收报告.md
│   └── 03-文档体系迁移验收报告.md
├── 90-参考资料/
│   ├── README.md
│   ├── NarraFork参考/
│   ├── Claude-Code参考/
│   └── 小说写作与AI调研/
└── 99-历史归档/
    ├── README.md
    ├── 路线图归档/
    ├── 测试报告归档/
    ├── 迁移方案归档/
    └── 旧文档体系归档/
```

该结构不是要求一次性补齐所有新文档正文。迁移时优先建立骨架、当前事实入口、迁移映射、重复文档归并和 README 索引。

## 文档类型模型

每篇 docs 文档 header 使用统一模型：

```markdown
# 标题

**版本**: vX.Y.Z
**创建日期**: YYYY-MM-DD
**更新日期**: YYYY-MM-DD
**状态**: ✅ 当前有效 | 📋 规划中 | 📚 参考资料 | 🗄️ 历史归档 | ⚠️ 已废弃
**文档类型**: current | planning | reference | archived | deprecated

---
```

状态和文档类型必须一致：

| 文档类型 | 状态 | 可作为当前事实入口 | 说明 |
|---|---|---:|---|
| current | ✅ 当前有效 | 是 | 当前真实能力、当前使用方式、当前架构事实 |
| planning | 📋 规划中 | 有条件 | 必须引用 Kiro spec，不能冒充已完成 |
| reference | 📚 参考资料 | 否 | 外部项目、竞品、调研、经验 |
| archived | 🗄️ 历史归档 | 否 | 仅追溯历史 |
| deprecated | ⚠️ 已废弃 | 否 | 必须给替代入口 |

## Single Source of Truth 规则

### 当前状态 SSoT

`docs/01-当前状态/01-项目当前状态.md` 是当前状态总入口，只摘要，不复制细节。

它链接到：

- Studio 能力矩阵：`docs/01-当前状态/02-Studio能力矩阵.md`
- 当前执行主线：`docs/01-当前状态/03-当前执行主线.md`
- 当前测试状态：`docs/08-测试与质量/01-当前测试状态.md`
- 当前运行方式：`docs/07-运行运维/01-当前运行与启动方式.md`

### API SSoT

`docs/06-API与数据契约/01-Studio API总览.md` 是 API 总览唯一 current 文档。

重复旧文件处理：

```text
docs/05-API文档/01-Studio API总览.md      -> merge
docs/05-API文档/01-Studio接口总览.md      -> delete-after-merge
```

迁移后不能保留两个 current API 总览。

### 产品命名 SSoT

用户侧统一使用“故事经纬 / 经纬”。

允许出现 `Bible` 的位置：

- 代码符号：`BibleView`、`bible_*` 表、`api/routes/bible.ts`
- 迁移说明中的 legacy 命名
- 历史归档或参考资料原文

current 用户指南、产品流程文档不得以 `Bible` 作为主称呼。

### 参考资料 SSoT

NarraFork、Claude Code、小说写作与 AI 调研统一进入 `90-参考资料/`。

参考资料必须在开头说明：

```text
本文仅供设计和实现参考，不代表 NovelFork 当前已实现能力或产品承诺。
```

### 历史归档 SSoT

旧路线图、旧迁移方案、旧测试报告、旧平台回归口径统一进入 `99-历史归档/`。

归档文档必须说明：

- 归档日期
- 归档原因
- 若有替代文档，链接替代入口

## 迁移策略

迁移分为四批，避免一次性大 diff 失控。

### Batch 1：治理骨架和入口

创建：

```text
docs/00-文档治理/README.md
docs/00-文档治理/01-文档体系规范.md
docs/00-文档治理/02-迁移映射.md
docs/00-文档治理/03-文档验证规则.md
docs/01-当前状态/README.md
docs/01-当前状态/01-项目当前状态.md
docs/README.md
```

迁移：

```text
docs/00-文档命名整理规则.md -> docs/00-文档治理/01-文档体系规范.md
```

### Batch 2：重复当前口径归并

处理重复和同号冲突：

```text
docs/05-API文档/01-Studio API总览.md
docs/05-API文档/01-Studio接口总览.md
  -> docs/06-API与数据契约/01-Studio API总览.md

docs/06-部署运维/02-NovelFork版本变更记录.md
  -> docs/07-运行运维/04-版本变更记录.md

docs/06-部署运维/02-NovelFork历史变更记录.md
  -> docs/99-历史归档/旧文档体系归档/NovelFork历史变更记录.md

docs/03-代码参考/07-小说写作与AI调研.md
  -> docs/90-参考资料/小说写作与AI调研/01-小说写作与AI调研.md

docs/03-代码参考/07-小说写作与AI调研-v0.1-v0.4-archive.md
  -> docs/99-历史归档/旧文档体系归档/小说写作与AI调研-v0.1-v0.4-archive.md
```

### Batch 3：当前事实和用户指南重写

将快速开始和当前运行方式合并为当前真实入口：

```text
docs/01-快速开始/快速开始.md
docs/01-快速开始/安装指南.md
docs/01-快速开始/环境配置.md
docs/01-快速开始/03-Bun体验指南.md
docs/06-部署运维/01-当前运行与启动方式.md
  -> docs/02-用户指南/01-安装与启动.md
  -> docs/07-运行运维/01-当前运行与启动方式.md
```

过渡内容不删除，若仍有历史价值则进入 `99-历史归档/旧文档体系归档/`。

### Batch 4：参考资料和历史归档

迁移参考资料：

```text
docs/03-代码参考/04-NarraFork依赖参考.md
  -> docs/90-参考资料/NarraFork参考/01-NarraFork依赖参考.md

docs/03-代码参考/05-NarraFork更新日志参考.md
  -> docs/90-参考资料/NarraFork参考/02-NarraFork更新日志参考.md

docs/03-代码参考/06-NarraFork-UIUX与交互功能调研.md
  -> docs/90-参考资料/NarraFork参考/03-NarraFork-UIUX与交互功能调研.md
```

迁移旧规划：

```text
docs/04-开发指南/05-调研规划/*平台迁移*
docs/04-开发指南/05-调研规划/*平台回正*
docs/04-开发指南/05-调研规划/*旧路线图*
  -> docs/99-历史归档/迁移方案归档/
```

具体路径以迁移清单为准，迁移清单必须先于实际移动完成。

## README 设计

根 README 结构：

```markdown
# NovelFork 文档中心

## 当前阅读路径
- 新用户：安装与启动 -> 创作工作台使用指南 -> 当前状态
- 开发者：当前状态 -> 架构总览 -> 开发者指南 -> API与数据契约
- AI agent：文档治理 -> 当前执行主线 -> 对应 spec -> 验证规则

## 当前事实入口
| 目标 | 文档 | 类型 |

## 目录结构

## 文档状态说明

## 维护规则
```

目录 README 结构：

```markdown
# 目录名

## 目录职责

## 适合阅读的人

## 文件列表
| 文件 | 类型 | 状态 | 说明 |

## 维护规则
```

README 只能导航，不复制子文档长正文。

## 文档验证设计

新增验证入口优先选择 Bun/TypeScript，便于跨平台和当前项目一致：

```text
scripts/verify-docs.ts
package.json: docs:verify -> bun run scripts/verify-docs.ts
```

验证项：

1. Markdown 相对链接存在性。
2. 同目录编号前缀唯一性，`README.md` 除外。
3. 每个目录必须有 README。
4. Header 必须包含版本、创建日期、更新日期、状态、文档类型。
5. 文档类型必须是允许枚举。
6. 根 README 快速导航不得指向 `archived`、`deprecated`。
7. 用户侧 current 文档不得把 `Bible` 作为主称呼。
8. 禁用口径扫描：
   - `process-memory` 被写成持久化。
   - `prompt-preview` 被写成真实写入。
   - `unsupported` 被写成已完成。
   - `mock`、`fake`、`noop` 假成功被写成真实能力。
9. README 文件列表必须覆盖当前目录直接子文档和子目录。

输出格式：

```text
[docs:verify] FAIL
- docs/README.md: broken-link -> ./missing.md 不存在
- docs/06-API与数据契约/: duplicate-number -> 01 used by A.md, B.md
- docs/02-用户指南/02-创作工作台使用指南.md: forbidden-term -> Bible used as user-facing primary term
```

验证脚本不负责自动改文档，避免误删或误迁移。

## 迁移映射设计

`docs/00-文档治理/02-迁移映射.md` 使用表格维护旧路径到新路径：

```markdown
| 旧路径 | 新路径 | 处理方式 | 文档类型 | 原因 |
|---|---|---|---|---|
```

处理方式：

- `move`：原文迁移，少量 header 更新。
- `merge`：合并到目标文档。
- `archive`：移入历史归档。
- `delete-after-merge`：内容已并入目标，可删除旧文件。
- `rewrite-current`：以当前事实重写，不保留旧正文作为当前内容。
- `keep-reference`：保留为参考资料。

## 与现有 specs 的关系

本 spec 会取代 `novel-creation-workbench-complete-flow` Phase 0 中“局部补 docs”的做法，成为文档体系重构的主线。

关系如下：

- `docs-system-rearchitecture`：负责 docs 架构、迁移、验证、README。
- `novel-creation-workbench-complete-flow`：继续负责 Studio 工作台功能闭环和需要新增的当前能力文档内容。
- `project-wide-real-runtime-cleanup`：提供 mock/透明占位事实源。
- `.kiro/specs/README.md`：仍是 spec 执行守则。

若两个 spec 都要求新增同类文档，以 `docs-system-rearchitecture` 的目录架构为准，以业务 spec 的事实内容为准。

## 风险与处理

| 风险 | 处理 |
|---|---|
| 大规模移动导致 diff 难审查 | 分批执行，先迁移治理和重复文档，再迁移参考和归档 |
| 历史内容丢失 | 删除前必须 merge 或 archive，并记录迁移映射 |
| 新目录变成空壳 | Batch 1 只建立必要骨架；后续 batch 必须迁入真实文档 |
| 旧链接大量失效 | 迁移后运行 docs verify；必要时保留短期迁移映射，不保留跳转页 |
| AI agent 误把参考当事实 | reference/archived/deprecated 不允许进入当前快速导航 |
| 用户文档继续使用 Bible 主称呼 | docs verify 扫描 current 用户侧文档，要求使用“故事经纬 / 经纬” |

## 验收标准

迁移完成后必须满足：

1. `docs/` 顶层目录符合新架构。
2. 根 README 快速导航只指向 current 或明确 planning 文档。
3. API 总览、版本变更、小说写作调研不再有同目录同号并列。
4. NarraFork 与 Claude Code 参考资料进入 `90-参考资料/`。
5. 旧路线图、旧迁移方案、旧报告进入 `99-历史归档/`。
6. 用户侧 current 文档统一使用“故事经纬 / 经纬”。
7. `bun run docs:verify` 通过。
8. 迁移验收报告记录迁移数量、合并数量、归档数量、删除数量和验证结果。
