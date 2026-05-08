# 待修复清单（2026-05-08 对比 NarraFork 后）

## 已修复
- [x] 设置页：模型页从调试 FactRow 改为真实 RuntimeControlPanel 表单
- [x] 套路页：隐藏 planned 命令，去掉调试信息（来源/状态）
- [x] Composer：移除 select 下拉，改为极简模式
- [x] NarratorStatusBar：添加模型/推理/权限/FastMode 按钮
- [x] MarkdownRenderer：安装 @tailwindcss/typography，prose 类生效
- [x] 旧底部状态栏：已移除
- [x] 端口占用闪退：自动递增重试

## 对话界面差距（对比 NarraFork）

### 必须修
1. 用户消息气泡样式太丑 — 当前是深色块，NarraFork 是简洁的文本
2. NarratorStatusBar 按钮太小看不清 — 需要加大尺寸和间距
3. 顶部工具栏缺图标 — NarraFork 有：外部链接、编辑标题、生成标题、搜索、代码折叠、图片、文件、信息、归档
4. 标题栏太简陋 — 缺编辑标题、生成标题功能
5. 消息右键菜单 — 代码写了但没验证是否真的弹出并工作
6. 工具调用卡片 — 需要验证 ToolCallBlock 是否真的渲染（之前 ToolCallCard 的简化版可能还在某些路径被使用）
7. 推理折叠 — ThinkingBlock 代码写了但没有真实数据验证
8. 底部 Git 状态栏 — NarraFork 显示 章节名·分支·变更数，NovelFork 没有

### 应该修
9. 对话嵌入 react-flow 节点 — ChapterNode 内容区是占位
10. 搜索结果点击无导航
11. 附件按钮 onAttach 未接通上层

## 设置页差距

### 必须修
12. RuntimeControlPanel 虽然有表单控件，但缺少 NarraFork 的一些字段：
    - 旧编码支持 switch
    - 刷新 Shell 环境 switch
    - 新叙述者默认进入计划模式 switch
    - 沉默工具调用阈值 number input
    - 跳过只读危险反思确认 switch
13. 模型页的下拉选择器显示原始 ID（deepseek-1778245457279:deepseek-chat）而不是友好名称

## 套路页差距

### 必须修
14. 可选工具 tab — NarraFork 显示高层 Agent 能力（Terminal/Browser/Recall 等），NovelFork 显示什么？需要验证
15. MCP 工具 tab — 有 UI 壳但连接状态是否真实？
16. 其他 tab（技能/子代理/提示词/钩子）— 需要逐个验证是否有 mock

## 首页差距

17. NarraFork 首页有统计卡片（活跃项目数/总项目数/独立会话数）— NovelFork 有类似的但需要验证数据是否真实

## 执行原则

- 每修一个，build + 截图验证
- 发现新问题当场修，不开新 spec
- 不写占位/mock/planned
