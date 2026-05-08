# NovelFork UI v1 Tasks

> **Superseded / 不再执行**：本任务清单已被 `backend-contract-v1` 与 `frontend-refoundation-v1` 取代。不要从这里继续派发实现任务；仅作历史过渡参考。

## Overview

重做前端布局：NarraFork 风格的 sidebar + 全宽内容区，叙事线详情页独立。

## Tasks

- [ ] 1. 回退搞坏的前端代码
  - 恢复 StudioNextApp.tsx 到 v0.0.5 的 NextShell 路由模式。
  - 恢复 layouts.tsx 的 ResourceWorkspaceLayout。
  - 恢复 WorkspacePage.tsx（去掉 hideNarrator）。
  - 恢复 entry.ts（去掉 studio 路由）。
  - 验证：编译通过、冒烟测试正常、和 v0.0.5 功能一致。

- [ ] 2. 替换 NextShell 为 NarraFork 风格 Sidebar
  - StudioNextApp 改为：左侧 Sidebar（复用已有的 sidebar/Sidebar.tsx）+ 右侧全宽内容区。
  - Sidebar 接入真实数据：叙事线（书籍列表）、叙述者（会话列表）、套路、设置。
  - 去掉 NextShell 的顶部导航按钮（仪表盘/创作工作台/工作流/会话/设置/套路），改为 Sidebar 中的入口。
  - 验证：Sidebar 显示正确、点击切换页面正常。

- [ ] 3. 主界面对话框全宽渲染
  - 默认路由（/next）下，内容区全宽渲染 NarratorPanel。
  - 复用现有的 ChatWindow docked 模式，但不嵌套在 ResourceWorkspaceLayout 中。
  - 对话框占据 sidebar 右侧的全部空间。
  - 验证：对话可发送/接收、工具调用正常、确认门正常、模型/权限选择器正常。

- [ ] 4. 叙事线详情页路由
  - 新增路由 /next/book/:id → 渲染叙事线详情页。
  - 叙事线详情页有自己的两栏布局：左侧资源管理器 + 右侧编辑器。
  - 复用 WorkspacePage 的资源树和编辑器组件。
  - 顶部有返回按钮 + 书名。
  - 验证：点击叙事线的书进入详情页、资源树正常、编辑器正常、返回正常。

- [ ] 5. 叙事线详情页写作工具
  - 在叙事线详情页底部或编辑器下方添加写作工具栏。
  - 写作方式按钮：续写/扩写/审校/生成下一章/去AI味/连续性检查。
  - 点击写作方式 → 创建或复用绑定该书的叙述者会话。
  - 可以在页面内弹出对话面板，或跳转到主界面对话框。
  - 验证：写作方式可触发、叙述者会话正确绑定。

- [ ] 6. 页面导航与 URL 同步
  - Sidebar 点击叙述者 → /next（主界面对话框）
  - Sidebar 点击叙事线的书 → /next/book/:id（叙事线详情页）
  - Sidebar 点击套路 → /next/routines
  - Sidebar 点击设置 → /next/settings
  - 浏览器前进/后退正常。
  - 验证：所有导航路径正确、URL 同步。

- [ ] 7. 清理旧代码
  - 移除不再使用的 NextShell 组件（如果 SettingsLayout 等不依赖它）。
  - 移除 StudioApp.tsx（旧的三面板骨架）。
  - 移除 useStudioData.ts（如果叙事线详情页不需要）。
  - 更新测试。
  - 验证：typecheck 通过、测试通过。

- [ ] 8. 编译验证与冒烟测试
  - typecheck + 全量测试。
  - 编译 exe。
  - 冒烟测试：启动 → 主界面对话 → 点击叙事线进入详情页 → 编辑章节 → 返回 → 设置 → 套路。
  - 更新 CHANGELOG。
