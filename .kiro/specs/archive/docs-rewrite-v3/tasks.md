# Implementation Plan

## Tasks

- [x] 1. DOCS: 建立 docs 重写清单
  - 盘点当前 `docs/`、`README.md`、`CLAUDE.md`、`AGENTS.md`、`CONTRIBUTING.md` 的 docs 引用。
  - 标记必须保留：`docs/learning/`、`docs/codegraph/`。
  - 标记可删除/重建的普通 docs 目录与旧迁移入口。

- [x] 2. DOCS: 重建 docs 根入口
  - 重写 `docs/README.md` 为唯一总入口。
  - 增加“当前事实入口”“目录导航”“特殊目录说明”“维护规则”。
  - 确保当前事实入口只指向 `current` 或 `planning`。

- [x] 3. DOCS: 重建普通目录骨架
  - 建立/修正 `01-codewiki`、`02-用户指南`、`03-产品与流程`、`04-架构与设计`、`05-开发者指南`、`06-API与数据契约`、`07-运行运维`、`08-测试与质量`、`90-参考资料`。
  - 每个目录写 `README.md` 并列出直接子项。
  - 移除空目录和无权威意义的旧入口。

- [x] 4. DOCS: 写最小 current 核心文档
  - 用户指南：安装启动、基础创作、设置模型。
  - 产品流程：写作主链路、经纬/叙事记忆边界、章节结果流。
  - 架构设计：系统总览、Agent 写作管线、存储边界。
  - 开发/API/运维/质量：只写可反查、可维护的核心入口。

- [x] 5. DOCS: CodeWiki 收口
  - 保持 `docs/01-codewiki/` 为第一代码入口。
  - 每个 CodeWiki 页面引用真实存在的文件或 `docs/codegraph/CODEMAP.md`。
  - 删除或降级重复、过时、无代码依据的 CodeWiki 内容。

- [x] 6. DOCS: 参考资料降级
  - 将调研/历史/外部参考统一标为 `reference` 或 `archived`。
  - 明确“不代表当前实现承诺”。
  - 不让 reference 文档进入当前事实入口。

- [x] 7. GUARD: 同步验证规则
  - 如目录规则变化，更新 `scripts/verify-docs.ts`。
  - 如验证脚本变化，更新 `scripts/verify-docs.test.mjs`。
  - 保持 `learning/`、`codegraph/` 跳过普通 docs 治理。

- [x] 8. DOCS: 同步项目入口引用
  - 更新 `README.md`、`CLAUDE.md`、`AGENTS.md`、`CONTRIBUTING.md`。
  - 更新 `.kiro/specs/README.md` 的 active/完成 spec 状态。
  - 搜索旧 docs 路径，修正仍处于 current 入口的引用。

- [x] 9. GUARD: 文档验证
  - 运行 `bun run docs:verify`。
  - 运行 `bun run docs:drift`。
  - 如改验证脚本，运行 `node --test scripts/verify-docs.test.mjs`。
  - 修复所有断链、漂移、header、README 漏列和废弃工具误引用。

- [x] 10. DOCS: 完成验收记录
  - 在 `docs/08-测试与质量/` 记录文档重写验收结果。
  - 保存 Engram 记忆：文档体系决策、特殊目录保留规则、验证命令结果。
