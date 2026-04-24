# Implementation Plan

## Overview

Novel Bible v1 核心作者向价值。8 个主任务，约 10-14 个工作日。**前置**：`storage-migration` 完成。

## Tasks

- [ ] 1. Schema 与 Repository
  - 在 `packages/core/src/storage/schema.ts` 追加：`book`、`bible_character`、`bible_event`、`bible_setting`、`bible_chapter_summary`
  - 生成 migration `0002_bible_v1.sql`
  - 新建 `packages/core/src/bible/types.ts`：`VisibilityRule` / `BibleMode` / `BibleContextItem` / `BuildBibleContextResult`
  - 新建 `repositories/`：`book-repo.ts` / `character-repo.ts` / `event-repo.ts` / `setting-repo.ts` / `chapter-summary-repo.ts`
  - 软删除支持（`deletedAt`）
  - 单测：CRUD / 多 book 隔离 / 软删过滤

- [ ] 2. 可见性规则引擎
  - `visibility-filter.ts`：时间线过滤（visibleAfterChapter / visibleUntilChapter）
  - `nested-resolver.ts`：BFS + 深度 cap 3 + 环保护
  - `alias-matcher.ts`：Aho-Corasick 构建 + 扫描，支持 name + aliases
  - 单测：每种 type 命中 / 不命中 / 边界章节 / nested 环
  - 性能：500 条目 + 10000 字 sceneText <50ms

- [ ] 3. token-budget 与 composer
  - `token-budget.ts`：估算 tokens（中文字符 × 0.6）+ 按优先级丢弃
  - `compose-context.ts`：格式化 `【类型】名称：内容` 结构
  - 单测：预算不够 / 刚好够 / 绰绰有余三种场景
  - 测试丢弃优先级：tracked 先于 nested 先于 global

- [ ] 4. buildBibleContext 总入口
  - `build-bible-context.ts`：串联以上模块
  - 处理 static / dynamic 两种 bibleMode
  - 当 sceneText 缺失时 fallback 到 global-only
  - 集成测试：使用 fixture book（含 30+ 条目）验证输出完整性

- [ ] 5. REST API
  - 新建 `packages/studio/src/api/routes/bible/`：4 类实体各 GET/POST/PUT/DELETE
  - `preview-context.ts`：POST 接口
  - `book-settings.ts`：PATCH bibleMode / currentChapter
  - zod 校验 + 错误码
  - API 测试：每个路由 happy path + 错误路径

- [ ] 6. Studio UI 最小可用
  - 侧栏新增 Bible 入口
  - 4 Tabs 列表 + 结构化表单（`EntryForm.tsx`）
  - `VisibilityRuleEditor.tsx`：下拉 + 章节数字输入 + nested 父选择
  - Book Settings Panel 添加 bibleMode 切换
  - `ContextPreviewModal.tsx`：展示注入清单 / tokens / 丢弃理由
  - 样式复用现有 NovelFork Studio 设计系统

- [ ] 7. 与写作管线的接口（占位）
  - 在 AI 写作管线的上下文构建点，调用 `buildBibleContext()` 并拼接到 prompt
  - 留出 `bible_chapter_summary.metadataJson.filterReport` 字段，供 ai-taste-filter-v1 写入
  - 本任务不实现 filter 集成本身，仅确认字段与接口稳定

- [ ] 8. 测试、性能与文档
  - 运行 `pnpm --filter ... test`
  - 运行 `pnpm --filter ... typecheck`
  - E2E：创建 book → 加 5 角色 + 3 事件 + 5 设定 → 预览上下文 → 断言注入集正确
  - 新建 `docs/04-开发指南/Bible开发指引.md`
  - 更新 07 调研文档的路线图
  - 记忆 MCP remember：Bible schema 关键点 / 可见性约定

## Done Definition

- 4 张表 + migration 落地
- buildBibleContext() 单测覆盖三档可见性 + 时间线 + 两种模式
- REST API 全部可用并有测试
- Studio UI 能增删改查 + 预览 + 切换模式
- typecheck 通过
- 文档更新
- 至少一次真实烟测：在自有项目上创建 3 章 Bible 并通过 AI 写作验证注入生效
