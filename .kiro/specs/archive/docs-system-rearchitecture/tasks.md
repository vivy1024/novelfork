# Implementation Plan

## Overview

本任务计划根据已批准的 `requirements.md` 与 `design.md` 执行 NovelFork 文档体系重构。执行目标是把 `docs/` 从旧的 7 类混合目录迁移为“当前事实优先”的 Hub-and-Spoke 文档中心，并建立单一事实源、文档状态隔离、迁移映射和 `bun run docs:verify` 质量门禁。

任务必须按顺序执行。每一步只处理文档体系与文档验证，不修改 Studio 产品功能、API 行为或既有业务 spec 范围。

## Tasks

- [x] 1. 建立文档迁移基线清单
  - 扫描 `docs/**/*.md`，生成当前文档清单，记录旧路径、当前标题、一级目录、是否 README、是否同号冲突、是否疑似 current/reference/archived。
  - 识别并记录已知冲突：API 总览双文档、部署运维 `02-*` 双文档、代码参考 `07-*` 双文档。
  - 将清单作为后续 `docs/00-文档治理/02-迁移映射.md` 的输入，确保 51 篇旧文档均有处理去向。
  - 覆盖需求：Requirement 4、Requirement 7。

- [x] 2. 创建新 docs 顶层目录骨架
  - 创建新顶层目录：`00-文档治理/`、`01-当前状态/`、`02-用户指南/`、`03-产品与流程/`、`04-架构与设计/`、`05-开发者指南/`、`06-API与数据契约/`、`07-运行运维/`、`08-测试与质量/`、`90-参考资料/`、`99-历史归档/`。
  - 为每个顶层目录创建 `README.md`，使用统一表格列出文件、文档类型、状态和说明。
  - 暂不删除旧顶层目录，直到迁移映射和对应内容迁移完成。
  - 覆盖需求：Requirement 1、Requirement 5。

- [x] 3. 建立文档治理文档
  - 将 `docs/00-文档命名整理规则.md` 迁移并升级为 `docs/00-文档治理/01-文档体系规范.md`。
  - 新增 `docs/00-文档治理/02-迁移映射.md`，使用表格列出旧路径、新路径、处理方式、文档类型和原因。
  - 新增 `docs/00-文档治理/03-文档验证规则.md`，固化 header、文档类型、README、SSoT、归档和禁用口径规则。
  - 更新 `docs/00-文档治理/README.md`，指向规范、迁移映射和验证规则。
  - 覆盖需求：Requirement 1.7、Requirement 3、Requirement 4.1、Requirement 7.3。

- [x] 4. 重写根文档入口
  - 重写 `docs/README.md`，使其成为唯一总入口。
  - 添加当前阅读路径：新用户、开发者、AI agent 三类入口。
  - 添加当前事实入口，只指向 `current` 或明确标注的 `planning` 文档。
  - 添加新目录结构、文档状态说明和维护规则入口。
  - 移除“回归 NarraFork 路线”为当前核心口径的表述，将 NarraFork 降级为参考资料入口。
  - 覆盖需求：Requirement 1.2、Requirement 1.6、Requirement 5。

- [x] 5. 创建当前状态事实入口
  - 新增 `docs/01-当前状态/01-项目当前状态.md`，摘要当前产品事实、执行主线、真实能力和透明过渡边界。
  - 新增或迁移为 `docs/01-当前状态/02-Studio能力矩阵.md`，承接 Studio 真实可用、透明过渡、内部示例和待迁移能力。
  - 新增 `docs/01-当前状态/03-当前执行主线.md`，链接当前主要 Kiro specs 和执行优先级。
  - 更新 `docs/01-当前状态/README.md`，确保该目录是当前事实唯一入口。
  - 覆盖需求：Requirement 1.4、Requirement 2.6、Requirement 3。

- [x] 6. 合并 API 总览文档
  - 将 `docs/05-API文档/01-Studio API总览.md` 与 `docs/05-API文档/01-Studio接口总览.md` 合并为 `docs/06-API与数据契约/01-Studio API总览.md`。
  - 保留一个 current API 总览，删除已合并的重复旧文件。
  - 更新 `docs/06-API与数据契约/README.md`，列出 API 总览和后续数据契约文档入口。
  - 在迁移映射中标记旧 API 文件的处理方式为 `merge` 和 `delete-after-merge`。
  - 覆盖需求：Requirement 2.2、Requirement 4.2、Requirement 5。

- [x] 7. 合并版本变更记录
  - 将 `docs/06-部署运维/02-NovelFork版本变更记录.md` 迁移为 `docs/07-运行运维/04-版本变更记录.md`。
  - 将 `docs/06-部署运维/02-NovelFork历史变更记录.md` 移入 `docs/99-历史归档/旧文档体系归档/NovelFork历史变更记录.md`。
  - 在 current 版本变更记录中保留当前有效版本脉络，不复制历史归档全文。
  - 更新迁移映射和 `docs/07-运行运维/README.md`。
  - 覆盖需求：Requirement 2.3、Requirement 4、Requirement 7。

- [x] 8. 迁移小说写作与 AI 调研文档
  - 将 `docs/03-代码参考/07-小说写作与AI调研.md` 迁移到 `docs/90-参考资料/小说写作与AI调研/01-小说写作与AI调研.md`，文档类型设为 `reference`。
  - 将 `docs/03-代码参考/07-小说写作与AI调研-v0.1-v0.4-archive.md` 迁移到 `docs/99-历史归档/旧文档体系归档/小说写作与AI调研-v0.1-v0.4-archive.md`，文档类型设为 `archived`。
  - 在 reference 文档开头添加“仅供参考，不代表当前实现或承诺”的说明。
  - 更新 `docs/90-参考资料/README.md` 和迁移映射。
  - 覆盖需求：Requirement 2.4、Requirement 3.4、Requirement 4.2。

- [x] 9. 迁移 NarraFork 与 Claude Code 参考资料
  - 将 NarraFork 依赖参考、NarraFork 更新日志参考、NarraFork UIUX 调研迁入 `docs/90-参考资料/NarraFork参考/`。
  - 将 Claude Code 实现经验、配置系统参考、体验优化参考迁入 `docs/90-参考资料/Claude-Code参考/`。
  - 为每篇参考资料添加 `reference` 文档类型和非当前承诺说明。
  - 更新参考资料目录 README 和迁移映射。
  - 覆盖需求：Requirement 1.5、Requirement 3.4、Requirement 4.5。

- [x] 10. 重写用户启动与运行入口
  - 将快速开始、安装指南、环境配置、Bun 体验指南和当前运行方式整理为 `docs/02-用户指南/01-安装与启动.md` 与 `docs/07-运行运维/01-当前运行与启动方式.md`。
  - current 用户文档必须只描述当前真实启动方式，历史过渡内容移入 `docs/99-历史归档/旧文档体系归档/`。
  - 将配置和环境变量内容整理为 `docs/07-运行运维/02-配置与环境变量.md`。
  - 更新用户指南和运行运维 README。
  - 覆盖需求：Requirement 4.4、Requirement 5、Requirement 7.5。

- [x] 11. 迁移产品流程文档
  - 建立 `docs/03-产品与流程/01-小说创作流程.md`，承接用户视角的小说创作流程。
  - 建立 `docs/03-产品与流程/02-资源管理器模型.md`，描述作品、卷、章节、候选稿、草稿、大纲、经纬、Story/Truth、素材和发布报告的资源树关系。
  - 建立 `docs/03-产品与流程/03-AI输出与候选稿流程.md`，明确 AI 输出必须进入候选稿或草稿，用户确认后才影响正文。
  - 建立 `docs/03-产品与流程/04-故事经纬流程.md`，用户侧统一使用“故事经纬 / 经纬”。
  - 覆盖需求：Requirement 1、Requirement 2.5、Requirement 3。

- [x] 12. 迁移架构与开发者指南
  - 将系统架构总览、技术栈选型、Studio 工作台架构等 current 架构文档迁入 `docs/04-架构与设计/`。
  - 将存储层开发指引、AI 味过滤器开发指引、故事经纬相关开发指引迁入 `docs/05-开发者指南/`。
  - 将用户侧标题中的 `Bible` 改为“故事经纬”，保留技术符号和 legacy 说明中的 `Bible`。
  - 更新架构与设计、开发者指南 README。
  - 覆盖需求：Requirement 2、Requirement 3、Requirement 5。

- [x] 13. 迁移旧规划和历史报告
  - 将平台迁移方案、平台回正规划、平台迁移待办清单、旧路线图失效说明移入 `docs/99-历史归档/迁移方案归档/`。
  - 将历史测试报告、Phase 完成报告、v2 规格方案归档、技术栈演变旧报告移入 `docs/99-历史归档/测试报告归档/` 或 `docs/99-历史归档/旧文档体系归档/`。
  - 每篇归档文档添加归档日期、归档原因和替代入口。
  - 更新历史归档 README 和迁移映射。
  - 覆盖需求：Requirement 3.5、Requirement 4.6、Requirement 4.7、Requirement 7。

- [x] 14. 清理旧顶层目录
  - 对照迁移映射确认旧顶层目录 `01-快速开始` 到 `07-测试报告` 下的 Markdown 文件均已迁移、合并或归档。
  - 删除已空的旧顶层目录和已合并的重复文档。
  - 保留非 Markdown 静态资源时，将其移动到对应新目录的资源子目录，并更新引用。
  - 覆盖需求：Requirement 4.8、Requirement 7.2。

- [x] 15. 统一 header、状态和 README 文件列表
  - 检查所有迁移后的 docs 文档 header，确保包含版本、创建日期、更新日期、状态和文档类型。
  - 检查所有顶层目录和参考/归档子目录 README，确保文件列表与实际文件一致。
  - 确保 reference、archived、deprecated 文档不会被根 README 当前快速导航引用。
  - 覆盖需求：Requirement 3、Requirement 5。

- [x] 16. 实现文档验证脚本
  - 新增 `scripts/verify-docs.ts`。
  - 在根 `package.json` 增加 `docs:verify` 脚本，命令为 `bun run scripts/verify-docs.ts`。
  - 验证脚本检查：Markdown 相对链接、同目录编号重复、顶层目录 README、docs header、文档类型枚举、根 README 快速导航、current 用户文档 `Bible` 主称呼、禁用口径扫描、README 文件列表覆盖。
  - 验证失败时输出文件、问题类型和修复建议。
  - 覆盖需求：Requirement 6。

- [x] 17. 运行文档验证并修复失败项
  - 运行 `bun run docs:verify`。
  - 修复所有断链、重复编号、README 漏列、header 缺失、文档类型错误、禁用口径和用户侧 `Bible` 主称呼问题。
  - 再次运行 `bun run docs:verify`，确认通过。
  - 覆盖需求：Requirement 6.10、Requirement 7.5。

- [x] 18. 编写迁移验收报告
  - 新增 `docs/08-测试与质量/03-文档体系迁移验收报告.md`。
  - 记录迁移数量、合并数量、归档数量、删除数量、保留参考数量和验证结果。
  - 记录已知未重写的历史文档范围，并标注其不属于 current 事实入口。
  - 更新 `docs/08-测试与质量/README.md`。
  - 覆盖需求：Requirement 7.6。

- [x] 19. 最终核对和工作区检查
  - 核对 `docs/` 顶层目录只保留新体系目录和根 README。
  - 核对迁移映射覆盖迁移前所有 docs Markdown 文件。
  - 运行 `bun run docs:verify`。
  - 运行 `git status --short` 和相关 diff 检查，确认没有误删未迁移内容。
  - 覆盖需求：Requirement 1、Requirement 4、Requirement 6、Requirement 7。
