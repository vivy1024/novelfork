# 真实运行时与Mock清理验收报告

**版本**: v1.0.0
**创建日期**: 2026-04-28
**更新日期**: 2026-04-28
**状态**: 📋 规划中
**文档类型**: planning

---

## 当前定位

本文记录真实运行时与 mock 清理的验收入口。详细事实源来自 `.kiro/specs/project-wide-real-runtime-cleanup/` 与 Studio 能力矩阵。

## 当前口径

- mock、fake、noop 不能出现在用户可见成功路径中。
- 透明过渡能力必须标明 `process-memory`、`prompt-preview`、`unsupported` 或等价状态。
- 内部示例不得从生产入口导出。

## 关联入口

- [Studio能力矩阵](../01-当前状态/02-Studio能力矩阵.md)
- [当前测试状态](./01-当前测试状态.md)
