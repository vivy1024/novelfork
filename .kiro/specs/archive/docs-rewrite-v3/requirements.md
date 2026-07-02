# Requirements Document

## Introduction

当前 docs 需要重写为“够准、够短、可验证”的文档中心。目标不是保留旧长文，也不是新建一套脱离脚本的目录，而是在现有 `docs:verify` / `docs:drift` / 学习中心 / codegraph 约束下，重建普通 docs 的权威入口和最小可信内容。

## Requirements

### Requirement 1: 保留运行时与生成物目录

**User Story:** 作为维护者，我需要避免误删被运行时或脚本消费的 docs 子目录。

#### Acceptance Criteria

1. WHEN 重写 docs THEN `docs/learning/` 必须保留，且不得破坏学习中心 frontmatter 与 exe 编译复制逻辑。
2. WHEN 重写 docs THEN `docs/codegraph/` 必须保留为 `bun run codegraph` 生成物目录。
3. WHEN 普通文档治理执行 THEN 不得把 `learning/` 与 `codegraph/` 纳入普通 header/README 规则。

### Requirement 2: 重建普通 docs 权威骨架

**User Story:** 作为开发者和 AI agent，我需要从 `docs/README.md` 快速进入当前事实、用户指南、产品流程、架构、开发、API、运维、质量和参考资料。

#### Acceptance Criteria

1. WHEN 查看 `docs/README.md` THEN 它必须是唯一总入口，并明确列出各目录用途。
2. WHEN 查看普通 docs 目录 THEN 每个目录必须有 `README.md`，且列出直接子项。
3. WHEN 查看普通 `.md` THEN 必须包含 `版本/创建日期/更新日期/状态/文档类型` header。
4. WHEN 文档类型被声明 THEN 只能使用 `current`、`planning`、`reference`、`archived`、`deprecated`。

### Requirement 3: CodeWiki 作为第一入口但不替代全部文档

**User Story:** 作为维护者，我希望 CodeWiki 是第一代码事实入口，但用户指南、流程、架构、API 等仍各司其职。

#### Acceptance Criteria

1. WHEN 查看 docs 第一入口 THEN `docs/01-codewiki/` 必须存在并作为代码百科入口。
2. WHEN CodeWiki 描述模块 THEN 必须引用真实存在的代码路径或指向 `docs/codegraph/CODEMAP.md`。
3. WHEN 旧 `01-当前状态` 被引用 THEN 必须更新引用，或只保留明确迁移说明。
4. WHEN CodeWiki 与其他文档重复 THEN CodeWiki 保留代码索引和维护规则，其他目录保留用户/流程/架构/API 视角。

### Requirement 4: 删除或降级过时口径

**User Story:** 作为读者，我不应被旧功能、旧路径、旧状态或夸大完成声明误导。

#### Acceptance Criteria

1. WHEN 文档声明能力 current THEN 必须有真实代码、测试、E2E、截图或明确验证证据。
2. WHEN 能力未验证或只是计划 THEN 必须标为 `planning`、`partial`、`deprecated`、`unsupported` 或写明限制。
3. WHEN 文档提到废弃工具/旧 candidate/draft/旧入口 THEN 必须说明废弃或迁移语境。
4. WHEN 用户侧 current 文档描述“经纬” THEN 不得把 `Bible` 作为主称呼。

### Requirement 5: 同步外部引用

**User Story:** 作为维护者，我需要项目入口文档和 agent 规则不再指向被删除的旧 docs 路径。

#### Acceptance Criteria

1. WHEN docs 路径重写 THEN `README.md`、`CLAUDE.md`、`AGENTS.md`、`CONTRIBUTING.md` 中的 docs 链接必须同步。
2. WHEN `.kiro/specs/README.md` 描述 active spec THEN 必须反映当前真实 spec 状态，不保留明显过期主线。
3. WHEN 旧归档 spec 引用旧 docs THEN 可不逐项重写，但不得作为当前事实入口。

### Requirement 6: 验证门禁

**User Story:** 作为维护者，我需要用脚本证明文档重写没有断链和漂移。

#### Acceptance Criteria

1. WHEN 重写完成 THEN `bun run docs:verify` 必须通过。
2. WHEN 重写完成 THEN `bun run docs:drift` 必须通过。
3. WHEN 修改 docs 验证规则 THEN 必须补充或更新 `scripts/verify-docs.test.mjs`。
4. WHEN 引用代码路径 THEN 引用必须指向存在的 `packages/` 或 `scripts/` 文件。

## Non-Goals

- 不重写 `docs/learning/` 的学习中心内容，除非链接/入口必须修正。
- 不手改 `docs/codegraph/` 生成内容。
- 不实现产品功能或 API 行为变更。
- 不为每个接口生成完整 OpenAPI。
- 不保留旧长文作为 current 事实来源。
