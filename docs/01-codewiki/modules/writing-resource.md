**版本**: v3.0.0
**创建日期**: 2026-06-26
**更新日期**: 2026-06-26
**状态**: compatibility
**文档类型**: current

# Writing Resource

## 职责

历史资源层，曾承载 draft / candidate / accepted 三态。当前目标是只保留正式章节文件语义，候选稿/草稿作为兼容痕迹处理。

## 真实代码路径

- `packages/novel-plugin/src/engine/writing-resource/service.ts`
- `packages/novel-plugin/src/engine/writing-resource/file-store.ts`
- 已删除的 writing-resource repository 旧实现
- `packages/novel-plugin/src/engine/writing-resource/types.ts`
- `packages/novel-plugin/src/routes/writing-resource.ts`
- `packages/novel-plugin/src/engine/writing-resource/service.test.ts`

## 主要入口

- `createWritingResourceService()`：有 `resolveBookDir` 时使用文件系统 store；无文件路径时保留 SQLite repository fallback。
- `createWritingResourceRouter()`：`POST /api/books/:bookId/resources` 只允许 `type=chapter,status=accepted`；candidate/draft 创建返回 410。
- `applyNarrativeEventsOnAccept()`：接受/结算时将 `metadata.narrativeEvents` 写入 Narrative Memory。

## 输入 / 输出

- 输入：bookId、章节标题、正文、chapterNumber、metadata。
- 输出：`WritingResource`，其中正式章节以 `chapter:<number>` 标识并写入章节文件。

## 当前问题

- `WritingResourceType` 仍保留 `candidate | draft` 以兼容旧数据。
- service 内仍有 transition 逻辑，但 HTTP transition 路由已返回 410。
- legacy `jingweiDelta` 仍存在兼容路径，但已避免覆盖 canon 条目。

## 维护规则

1. 不新增 candidate/draft 业务入口。
2. 新章节正文主语义必须走文件系统正式章节。
3. 动态事实回写优先使用 `NarrativeEvent` / reducer。
4. SQLite repository 只作为旧数据兼容和迁移参考。
