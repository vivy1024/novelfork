# NovelFork 前端架构分析（2026-05-08）

## 真实可用 vs 空壳

### ✅ 真实可用
1. 作者首页 — 真实作品/会话/模型状态
2. 对话界面 — WebSocket 实时流、消息渲染、工具调用、slash 命令、模型/权限/推理切换
3. 写作工作台 — 资源树、画布编辑、保存、写作动作
4. 会话中心 — 列表管理
5. 套路页 — 命令/工具/权限/技能/MCP/钩子 CRUD
6. 设置页 — 12 个分区
7. 全局搜索 — 搜索可用但结果点击无导航

### ⚠️ 部分可用（有 UI 但不完整）
1. ChapterGraph — 节点内容是占位文字，没有嵌入对话
2. 搜索结果点击 — 只 console.log
3. 附件按钮 — file input 存在但 onAttach 未接通
4. 写作动作 — 按钮可点但 Agent 管线完成度取决于后端

### ❌ 对比 NarraFork 缺失
1. 对话嵌入 react-flow 图节点（核心架构差异）
2. 消息右键菜单（回退/分叉/压缩/编辑重生成）
3. 文件修改追踪（按消息查看 diff）
4. 终端系统（xterm.js）
5. 浏览器会话管理
6. Git 交互面板（stage/commit/diff）
7. 段落压缩 UI（选择消息范围）
8. 顺便问（从消息 fork）
9. Codex 额度柱状图
10. 上下文环（Context Ring SVG）
11. 多叙述者工作区
12. 通知/IM 网关

### ❌ 对比 Claude Code CLI 缺失
- 完整 event taxonomy（JSONL）
- OS sandbox
- Granular approval policy
- Image input
- Code review 命令
- TOML config/profiles
- Plugin/skills 动态加载

## 核心架构差异

| | NarraFork | NovelFork |
|---|---|---|
| 对话位置 | 嵌入 react-flow 节点 | 独立路由页面 |
| 章节管理 | react-flow 图 + 完整 fork/merge | 有图组件但内容占位 |
| 终端 | xterm.js 多标签 | 无 |
| Git | 完整面板（stage/commit/diff/stash） | 只有状态栏展示 |
| 消息操作 | 右键菜单（回退/分叉/压缩/编辑） | 无 |
| 文件追踪 | 按消息查看修改 + diff + 回退 | 无 |

## 用户打开软件后的真实体验

能做：
- 创建作品、编辑章节、保存
- 与 AI 对话、发消息、中断、切换模型
- 查看工具调用、批准/拒绝确认门
- slash 命令、全局搜索、套路配置、设置

不能做（点了没反应或假的）：
- 搜索结果点击导航
- 章节图节点内嵌对话
- 附件上传
- 消息右键操作
- 文件 diff 查看
- Git 操作
