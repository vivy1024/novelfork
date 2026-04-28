# SSE与运行事件

**版本**: v1.0.0
**创建日期**: 2026-04-28
**更新日期**: 2026-04-28
**状态**: 📋 规划中
**文档类型**: planning

---

## 当前定位

本文记录 Studio 运行态事件、SSE 和 WebSocket 的文档入口。

## 当前已知事实

- Pipeline runs 仍有 `process-memory` 透明过渡边界。
- 会话聊天运行时已经使用 runtime metadata 区分成功和失败。
- Inline completion 当前是完整结果切片，不等同于上游原生流式。

## 维护规则

任何流式能力都必须写清：数据来源、是否持久化、是否原生流式、失败时的错误 envelope。
