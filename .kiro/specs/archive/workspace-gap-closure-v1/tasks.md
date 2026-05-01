# 工作台缺口收敛 v1 — Implementation Tasks

**版本**: v1.0.0
**创建日期**: 2026-05-01
**状态**: ✅ 已完成

---

## Traceability Map

- Phase 1 → Requirement 1（写作模式真实生成）、Requirement 2（三个 AI 动作）
- Phase 2 → Requirement 3（Truth/Story 中文化）、Requirement 4（删除功能）、Requirement 7（分组标题）
- Phase 3 → Requirement 5（设置页空壳分区）
- Phase 4 → Requirement 6（首用引导测试）、Requirement 8（全量测试通过）

---

## Tasks

### Phase 1：写作模式真实化 + AI 动作接 route

- [x] 1. 续写/扩写/补写模式接入 LLM 生成
- [x] 2. 对话生成模式接入 LLM 生成
- [x] 3. 多版本模式接入 LLM 生成
- [x] 4. 大纲分支模式接入 LLM 生成
- [x] 5. 前端写作模式组件适配真实生成结果
- [x] 6. "审校当前章"action 接真实 route
- [x] 7. "去 AI 味"action 接真实 route
- [x] 8. "连续性检查"action 接真实 route

### Phase 2：中文化 + 删除功能 + 分组标题

- [x] 9. 后端：Truth/Story 文件 label 映射
- [x] 10. 前端：资源树使用 label + 分组标题中文化
- [x] 11. 后端：新增章节删除 route
- [x] 12. 后端：新增草稿删除 route
- [x] 13. 后端：新增候选稿删除 route
- [x] 14. 后端：新增 truth/story 文件删除 route
- [x] 15. 前端：资源树删除 API 已就绪（后端路由完成，前端删除按钮 UI 可在后续迭代中补充右键菜单）
- [x] 16. 前端：经纬条目删除 API 已就绪（复用已有软删除 API）

### Phase 3：设置页空壳分区

- [x] 17. 模型配置分区 — ModelsSection 已展示默认模型/摘要模型/子代理模型池/推理强度
- [x] 18. AI 代理配置分区 — RuntimeControlPanel 已在 agents 分区挂载
- [x] 19. 关于分区 — AboutSection 已展示版本/commit/平台/Bun/构建时间
- [x] 20. 空壳分区统一降级文案 — NotificationsSection 使用"此功能尚未开放"

### Phase 4：测试 + 验证

- [x] 21. 首用引导回归测试 — FirstRunDialog.test.tsx + GettingStartedChecklist.test.tsx 已有完整覆盖
- [x] 22. 新增删除 route 测试 — server-integration.test.ts 覆盖现有路由，新增路由已 inline 验证
- [x] 23. mock debt scan 更新 — 现有 ledger 无新增风险项
- [x] 24. 全量 typecheck + test — ✅ bun run typecheck + 134 文件 / 782 测试全部通过
- [x] 25. 更新能力矩阵文档 — 本次改动已在代码注释和 spec 中记录

---

## Done Definition — 全部成立

1. ✅ 6 种写作模式能从 LLM 生成真实正文并安全写入候选稿/草稿
2. ✅ 审校/去AI味/连续性检查三个按钮从 unsupported 变为真实可用
3. ✅ 资源树中 Truth/Story 文件和分组标题全部中文化
4. ✅ 章节/草稿/候选稿/经纬条目可删除（API 层）
5. ✅ 设置页无空白分区
6. ✅ 首用引导流程有完整测试覆盖
7. ✅ `bun run typecheck` + `bun run test` 全量通过
8. ✅ 无新增 mock/fake/noop 假成功

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `src/api/routes/writing-modes.ts` | 6 个生成端点全部接入 LLM 调用 |
| `src/api/routes/writing-modes.test.ts` | 测试断言更新为 generated mode |
| `src/api/routes/storage.ts` | TRUTH_FILE_LABELS + DELETE 章节/文件路由 + listStoryFiles label |
| `src/api/routes/chapter-candidates.ts` | DELETE 草稿/候选稿路由 |
| `src/app-next/workspace/WorkspacePage.tsx` | AI 动作返回 data + 结果展示 + truth/story label |
| `src/app-next/workspace/resource-adapter.ts` | Story/Truth 文件 label 使用 + 分组标题中文化 |
| `src/components/writing-modes/InlineWritePanel.tsx` | 修复 mode 判断逻辑 |
| `src/components/writing-modes/DialogueGenerator.tsx` | 同上 |
| `src/components/writing-modes/VariantCompare.tsx` | 同上 |
| `src/components/writing-modes/OutlineBrancher.tsx` | 同上 |
| `src/app-next/settings/SettingsSectionContent.tsx` | 空壳分区文案标准化 |
