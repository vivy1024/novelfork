# Implementation Plan

## Overview

在 backend-contract-v1 和 frontend-refoundation-v1 稳定后，按合同优先原则分阶段整理后端核心：错误语义、领域服务拆分、session runtime 内聚、provider/runtime store 收敛和 legacy 退役。

## Tasks

- [x] 1. 建立后端合同守护清单
  - 从 backend-contract-v1 提取 route/tool/shared type 映射。
  - 标记不可破坏合同：sessions、providers、books/chapters、candidates/drafts、session tools。
  - 验证：每个清单项有对应测试或需补测试项。

- [x] 2. 补齐 contract regression tests
  - 针对 books、sessions、providers、resources、writing actions 建立回归测试入口。
  - 覆盖成功、404/400、unsupported/gate、脱敏输出。
  - 验证：相关 Vitest 通过。

- [ ] 3. 整理错误与状态 helper
  - 抽出现有结构化错误、provider failure envelope、unsupported helper。
  - 新迁移 route 使用 helper；旧 route 不做破坏性改写。
  - 验证：错误响应测试覆盖 code/message/capability/gate 保留。

- [ ] 4. 拆分 storage.ts 只读能力
  - 优先迁移 books list/detail、story/truth list/read、cockpit drilldown 只读入口到领域 service。
  - Route adapter 只做参数解析和响应。
  - 验证：原 route 测试与新增 service 测试通过。

- [ ] 5. 拆分 storage.ts 非破坏写入能力
  - 迁移 books update、chapter create/save、story/truth write、export 生成等非破坏写入。
  - 保持文件系统 index 与内容一致。
  - 验证：写入测试覆盖文件内容、index、错误路径。

- [ ] 6. 拆分 destructive 能力
  - 迁移 book/chapter/file delete、candidate/draft delete 等破坏性入口。
  - 明确软删除/硬删除、前端确认和失败状态。
  - 验证：删除测试覆盖不存在、非法文件名、真实删除结果。

- [ ] 7. 规划 session runtime 内聚拆分
  - 在不改行为的前提下为 transport、recovery、message-store、turn-runner、confirmation 设计边界。
  - 先补 envelope/recovery golden tests，再拆文件。
  - 验证：WebSocket snapshot/replay/ack/abort/confirmation 测试通过。

- [ ] 8. 收敛 Provider/runtime store 边界
  - 保持脱敏输出、真实模型池、adapter failure code。
  - 移除任何残留虚拟模型/fallback 口径。
  - 验证：provider routes、model refresh/test、runtime model pool 测试通过。

- [ ] 9. 标记并退役 legacy route
  - 全仓搜索 frontend client、docs、tests 中的 legacy 入口。
  - 对仍需保留的写 transparent/deprecated 状态；确认无人依赖后删除。
  - 验证：typecheck、route tests、docs verify。

- [ ] 10. 文档与验收
  - 更新 API 文档、存储层开发指引、CHANGELOG 和必要 README。
  - 运行相关 Vitest、`pnpm --dir packages/studio typecheck`、`pnpm docs:verify`。
  - 未跑的验证必须明确写“未运行”。
