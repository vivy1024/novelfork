# Design Document

## Overview

采用“保留特殊目录 + 重建普通 docs + 同步引用 + 脚本验证”的最小重写方案。原则：少写、准写、可反查、可验证。

## Target Structure

```text
docs/
├── README.md                         # 唯一总入口
├── 01-codewiki/                      # 第一入口：代码百科、模块索引、维护规则
├── 02-用户指南/                      # 用户怎么用
├── 03-产品与流程/                    # 写作主链路、经纬、叙事记忆、资源关系
├── 04-架构与设计/                    # 系统架构、Agent Runtime、存储、插件边界
├── 05-开发者指南/                    # 构建测试、添加工具/路由/适配器、发布
├── 06-API与数据契约/                 # HTTP、WebSocket、工具 schema、数据表
├── 07-运行运维/                      # 配置、日志、调试、打包运行
├── 08-测试与质量/                    # 测试矩阵、质量门禁、文档验证
├── 90-参考资料/                      # reference-only 调研资料
├── codegraph/                        # 生成物，保留
└── learning/                         # 学习中心运行时文档，保留
```

如确需保留 `01-当前状态/`，只能作为迁移说明，不作为权威 current 入口。

## Document Rules

普通 docs 每篇必须包含：

```markdown
**版本**: v3.0.0
**创建日期**: 2026-06-26
**更新日期**: 2026-06-26
**状态**: current
**文档类型**: current
```

允许文档类型：`current`、`planning`、`reference`、`archived`、`deprecated`。

## Content Strategy

### 1. docs/README.md

- 只做入口，不承载长正文。
- “当前事实入口”只指向 `current` 或 `planning`。
- 明确 `learning/`、`codegraph/` 是特殊目录。

### 2. CodeWiki

保留为第一入口，但只写代码事实：

- 模块职责
- 真实文件路径
- 关键函数/路由/工具
- 输入输出
- 当前保留/废弃/迁移状态
- 维护规则

CodeWiki 不重复用户教程和完整架构长文。

### 3. 用户/流程/架构/API/开发/运维/质量

每个目录先保留 1 个 README + 1~3 篇核心 current 文档，避免大而不准：

- 用户指南：安装启动、基础创作、模型设置。
- 产品流程：写作主链路、经纬/叙事记忆边界、章节结果流。
- 架构设计：系统总览、Agent 写作管线、存储边界。
- 开发指南：构建测试、添加 Agent 工具、发布流程。
- API 契约：路由总览、工具 schema、数据契约。
- 运维：配置与日志、exe 打包运行。
- 质量：测试状态、文档验证规则、质量门禁。

### 4. 参考资料

调研、历史分析、外部参考统一 `reference`，必须写明“不代表当前实现承诺”。

## Reference Sync

重写后同步以下入口引用：

- `README.md`
- `CLAUDE.md`
- `AGENTS.md`
- `CONTRIBUTING.md`
- `.kiro/specs/README.md`

归档 spec 内旧链接不逐条重写，除非被当前入口引用。

## Verification

必须运行：

```bash
bun run docs:verify
bun run docs:drift
```

如果修改 `scripts/verify-docs.ts`，同时运行：

```bash
node --test scripts/verify-docs.test.mjs
```

## Risks

| 风险 | 处理 |
|------|------|
| 删除 learning 导致 /learn 或 exe 学习文档缺失 | 明确保留并不纳入普通 docs 重写 |
| 删除 codegraph 导致 CODEMAP 丢失 | 保留生成物目录，不手改 |
| 新目录绕过验证脚本语义 | 优先沿用当前验证器已覆盖的中文目录 |
| 大量 current 声明不准 | 第一版只写最小 current，未验证能力降级 |
| 外部入口仍指旧路径 | 最后全仓搜索旧 docs 路径并同步 |
