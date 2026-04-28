# Studio工作台架构

**版本**: v1.0.0
**创建日期**: 2026-04-28
**更新日期**: 2026-04-28
**状态**: ✅ 当前有效
**文档类型**: current

---

## 当前架构定位

Studio 是 NovelFork 的本地 Web 工作台，前端负责小说创作交互，后端 Hono API 负责书籍、章节、候选稿、写作工具、供应商和运行态数据。

## 主要分层

```text
React UI
  -> Studio API routes
    -> storage / runtime services
      -> local files / SQLite / provider runtime
```

## 当前边界

旧前端页面只作为回退基线；新创作工作台闭环以已批准 spec 为准。
