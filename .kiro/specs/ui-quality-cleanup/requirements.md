# UI Quality Cleanup Requirements

## 背景

app-next 的功能骨架已完成（6 个路由、30+ 组件、106 个 spec 任务全部完成），但 UI 质量极差：开发者术语泄露给用户、大量空壳组件、样式混乱、交互缺失。这不是功能缺失问题，是工程质量问题。

## Requirements

### Requirement 1：清除所有开发者内部术语

**User Story:** 作为用户，我不应该看到"旧前端冻结"、"旁路建设中"、"复用旧 Routines API"、API 端点路径等开发者内部信息。

#### Acceptance Criteria

1. UI 中不得出现"旧前端"、"旁路"、"复用"、"迁移"、"接入"等开发者术语。
2. UI 中不得暴露 API 端点路径（如 `/api/agents`、`/api/settings/user`）。
3. "NOVELFORK STUDIO NEXT" 改为 "NovelFork Studio"，去掉 "NEXT"。
4. 所有 "未接入" 文案改为用户友好的表述（如"即将推出"或直接隐藏该入口）。
5. FALLBACK 测试数据（"灵潮纪元"、"第一章 灵潮初起"等）从生产代码移到测试文件。

### Requirement 2：消灭所有空壳组件

**User Story:** 作为用户，我点击的每个按钮都应该有响应，每个输入框都应该有功能。

#### Acceptance Criteria

1. 资源搜索 input 必须有搜索功能或移除。
2. "运行状态：空闲" 必须反映真实状态或移除。
3. 预设管理链接必须指向有效页面或移除。
4. HooksSection 的创建表单必须有提交/取消按钮。
5. WritingModesPanel 和 WritingToolsPanel 的所有回调必须有真实实现或禁用对应按钮。
6. SearchPage 搜索结果必须可点击跳转。
7. NotificationsSection 和 HistorySection 要么有真实内容，要么从导航中隐藏。

### Requirement 3：统一视觉规范

**User Story:** 作为用户，我看到的界面应该视觉一致，不应该有的地方圆角大有的地方圆角小。

#### Acceptance Criteria

1. 全局统一圆角：卡片/面板 `rounded-lg`，按钮/input `rounded-md`。
2. 全局统一颜色：错误用 `text-destructive`，成功用 `text-emerald-600`，警告用 `text-amber-600`。不使用原始色（`text-red-600`）。
3. 全局统一标题层级：页面标题 `text-lg font-semibold`，分区标题 `text-base font-semibold`，字段标题 `text-sm font-medium`。
4. 全局统一间距：`space-y-3` 为默认，`gap-2` 为 grid 默认。
5. 提取共享 Row 组件，消除重复定义。
6. 主内容区加 `max-w-7xl mx-auto` 防止大屏拉伸。

### Requirement 4：修复交互缺陷

**User Story:** 作为用户，表单应该有验证，密码应该隐藏，开关应该持久化。

#### Acceptance Criteria

1. AddProviderForm 的 API Key input 改为 `type="password"`。
2. AddProviderForm 必须验证 name 非空。
3. toggleProvider 必须调用 API 持久化，不能只改本地 state。
4. ProviderSettingsPage 的高级字段根据 apiMode/compatibility 条件渲染。
5. 空态 CTA 按钮必须有 onClick handler。
