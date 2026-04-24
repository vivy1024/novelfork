# 开发指南

**版本**: v1.0.0  
**创建日期**: 2026-04-20  
**更新日期**: 2026-04-20  
**状态**: 🔄 持续更新

---

本目录回答“怎么推进 NovelFork 的开发和迁移”。

## 文件列表

- [05-调研规划/](./05-调研规划/)

## notify 使用规范（Package 6 / 7.3 收口）

Studio 的用户可见提示**必须**走 `@/lib/notify`，禁止在业务代码里 `import { toast } from "sonner"` 或 `alert()`：

| 场景 | 通道 | 例 |
|---|---|---|
| 操作成功、保存成功、复制成功 | `notify.success(title, opts?)` | `notify.success("会话 ID 已复制")` |
| 用户可见错误（catch 后） | `notify.error(title, { description })` | `notify.error("复制失败", { description: "浏览器拒绝了剪贴板写入" })` |
| 会话离线、待恢复等中性警告 | `notify.warning(title, { id, description })` | `notify.warning("连接中断，正在重连…", { id: "recovery-" + windowId })` |
| 进度性/信息性提示 | `notify.info(title, { id })` | `notify.info("窗口已关闭", { description: "会话仍在会话中心，随时可重新打开" })` |
| 非严重一次性消息 | `notify.message(title, opts?)` | 少用，优先走上面四个带语义的通道 |

三条硬性约束：

1. **recovery 五态** 的 toast 已由 `hooks/use-recovery-toasts.ts` 统一生成，业务代码**不要**再在 WS 回调里手写 `notify.warning("重连中…")`。
2. **同一流程**多次提示要用**相同 `id`**，让后续 toast 覆盖前一条而不是堆叠（见上表 `recovery-` 与 `loading-` 前缀约定）。
3. **`alert()` 全仓禁用**；替换为 `notify.warning` 或 `notify.error`（alert 会阻塞 UI 且不符合窗口化心智）。

违反以上约束的 PR 按 UI/UX 回归处理。
