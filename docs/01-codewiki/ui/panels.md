**版本**: v3.0.0
**创建日期**: 2026-06-26
**更新日期**: 2026-06-26
**状态**: current
**文档类型**: current

# Panels

## 真实代码路径

- `packages/novel-plugin/src/pages/writing-workbench/NarrativeMemoryPanel.tsx`
- `packages/novel-plugin/src/pages/writing-workbench/NarrativeMemoryGraphWorkspace.tsx`
- `packages/novel-plugin/src/pages/writing-workbench/JingweiGraphWorkspace.tsx`
- `packages/novel-plugin/src/pages/writing-workbench/PresetsPanel.tsx`
- `packages/novel-plugin/src/pages/writing-workbench/StyleDriftPanel.tsx`
- `packages/novel-plugin/src/pages/writing-workbench/CompliancePanel.tsx`

## 面板归属

| 面板 | 数据层 |
|------|--------|
| NarrativeMemoryPanel | 动态叙事记忆 |
| JingweiGraphWorkspace | 静态 Lore / 经纬 |
| PresetsPanel | 配置层 |
| StyleDriftPanel | 分析工具 |
| CompliancePanel | 质量/合规检查 |

## 维护规则

1. 面板命名要反映数据归属。
2. 经纬面板不展示动态事实写回入口。
3. 叙事记忆面板不写静态 Lore。
