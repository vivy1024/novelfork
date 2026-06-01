# Implementation Plan: 约束驱动写作系统 v2

## Tasks

- [ ] 1. ENABLER: 新增 `layer` 字段迁移（0020_jingwei_layer.sql），现有条目默认 dynamic，repository 读写兼容
- [ ] 2. FEATURE: 实现合并后的 `cockpit.snapshot` 工具（合并 get_snapshot + list_open_hooks + list_recent_candidates + health）
- [ ] 3. FEATURE: 实现合并后的 `jingwei.read` 工具（scope=brief/category/search 三合一）
- [ ] 4. FEATURE: 实现 `jingwei.write` 工具升级（增加 layer 字段 + canon 写入保护）
- [ ] 5. FEATURE: 实现合并后的 `pgi.ask` 工具（generate + record + format 三合一）
- [ ] 6. FEATURE: 实现新工具 `scene.spec`（结构化写作蓝图生成 + H4 完整性校验）
- [ ] 7. FEATURE: 实现精简后的 `pipeline.write`（SceneSpec→Writer→AuditRevise 三步管线）
- [ ] 8. FEATURE: 实现合并后的 `chapter.audit`（canon check + POV check + 软约束 + 自动修订）
- [ ] 9. ENABLER: 更新 tool-schemas.ts 和 tool-registry.ts，注册新工具、标记旧工具 deprecated
- [ ] 10. ENABLER: 更新 handler-registry.ts 和 session-tool-executor.ts 接线
- [ ] 11. FEATURE: 更新 agent-prompts.ts，切到新工具名和 PEV 流程
- [ ] 12. ENABLER: Token 预算硬约束集成（prompt 构造前检查，超限拒绝）
- [ ] 13. GUARD: 补充测试：scene spec 完整性校验、canon 写入保护、token 预算拒绝、审计门禁
- [ ] 14. DOCS: 更新架构文档和开发指引
- [ ] 15. FEATURE: typecheck + 聚焦验证
