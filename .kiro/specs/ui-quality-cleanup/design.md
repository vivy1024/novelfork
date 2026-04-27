# UI Quality Cleanup Design

## 设计原则

不加新功能，只修已有问题。每个改动必须有审计报告中的具体问题编号对应。

## 改动范围

15 个文件，3 类问题，按文件逐个修复。

## 视觉规范（全局统一）

```
圆角：卡片/面板 rounded-lg，按钮/input rounded-md，小标签 rounded
颜色：错误 text-destructive，成功 text-emerald-600，警告 text-amber-600
标题：页面 text-lg font-semibold，分区 text-base font-semibold，字段 text-sm font-medium
间距：默认 space-y-3，grid gap-2
内容区：max-w-7xl mx-auto
```

## 空壳处理策略

| 空壳 | 处理 |
|------|------|
| 功能未实现但有入口 | 隐藏入口，不显示"未接入" |
| 功能未实现但有按钮 | 按钮 disabled + tooltip "即将推出" |
| 回调是 noop | 按钮 disabled |
| 输入框无功能 | 移除 |
| 硬编码文案 | 替换为真实数据或移除 |

## 不做的事

- 不加新页面
- 不加新 API
- 不改后端逻辑
- 不改测试（除非 UI 结构变化导致测试断裂）
