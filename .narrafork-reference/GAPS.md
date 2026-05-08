# NarraFork 功能全景（未覆盖项清单）

## 已学习并写入参考的

- ✅ API 端点（API-REFERENCE.md）
- ✅ 对话窗口 DOM 结构（UI-COMPONENTS.md）
- ✅ 提供商三种 API 模式 + Codex 多账号（PROVIDERS.md）
- ✅ 设置→对话界面数据流（UI-COMPONENTS.md 状态指示器行）
- ✅ 叙述者状态机（status-registry）
- ✅ i18n 文案

## 未学习/未写入参考的

### 1. 章节系统（react-flow 图）
- 章节状态：active / dormant / merged / abandoned / frozen
- 章节角色：trunk / branch / exploration / review
- 章节操作：fork / merge / split / cherry-pick / sync-upstream / batch-fork
- 探索组：创建 → 决定（选择胜出章节）→ 放弃
- 章节边：fork / merge / dependency / cherry_pick / review
- 标尺（Ruler）：时间线视图，fork/merge/abandon/rebase 操作
- 容器管理：podman-compose，start/stop/pause/logs/snapshots
- Git 集成：stage/unstage/commit/discard/diff/stash/log/reset/AI commit message

### 2. 终端系统
- 多终端标签管理
- 终端进程监控
- dtach 孤立会话管理
- 终端图状态（在 react-flow 中的位置）
- xterm.js 渲染

### 3. 浏览器会话管理
- 每个叙述者可有多个浏览器会话
- 关闭/停止追踪
- 底部"浏览器 1"标签

### 4. 工作区（Workspace）
- 多叙述者工作区
- 添加/解散工作区
- 工作区视图

### 5. 消息交互
- 右键上下文菜单：回退到此处 / 从此处分叉 / 压缩到此消息前 / 切换自动换行
- 消息编辑并重新生成
- 消息删除（单条/块/批量）
- 消息回滚预览
- 文件修改追踪（按消息查看）
- 文件 diff 查看
- 文件回退/取消回退
- 顺便问（Ask in Passing）：从某条消息 fork 并提问
- 批量消息 fork 到新叙述者
- 段落压缩（Segment Compact）

### 6. 权限系统细节
- 危险反思（Danger Reflection）：全部允许模式下高风险操作的额外安全检查
- 计划反思（Plan Reflection）：ExitPlanMode 时运行计划反思
- 自动批准计划
- 文件预览（权限请求时展示将修改的文件内容）
- 白名单/黑名单目录（per-narrator）
- 命令白名单/黑名单（per-narrator，支持 deny prompt）

### 7. 套路/命令系统
- 自定义命令：名称 + Bash 指令 + 参数 + 模型覆盖 + 先执行 Bash 再发 AI
- 全局/项目技能
- 自定义子代理类型（专用提示词 + 工具权限）
- 全局提示词
- 钩子（Hooks）

### 8. 通知与 IM 网关
- 通知声音自定义（上传 MP3/WAV/OGG）
- 钉钉 Webhook
- 飞书 Webhook
- 微信扫码登录
- QQ Bot（Markdown 格式）
- IM 网关：将 IM 平台连接到叙述者

### 9. 外观与界面
- 主题切换
- 叙述者消息渲染器选择（React / PixiJS 实验性）
- 代码折叠开关
- 自动换行

### 10. 管理功能
- 多用户管理（admin）
- 存储扫描与清理
- 数据库清理预览
- 运行时资源管理
- 更新检查与应用
- TLS 证书生成

## 未写入 spec 任务的

### 高优先级（影响核心体验）
1. **Composer 控件修正**：移除 select 下拉，改为状态指示器行 + ActionIcon Menu
2. **对话嵌入 react-flow**：当前是独立路由页面，应该嵌入图节点
3. **消息右键菜单**：回退/分叉/压缩/编辑重生成
4. **文件修改追踪**：按消息查看修改了哪些文件 + diff
5. **章节系统**：fork/merge/exploration 图

### 中优先级（功能完整性）
6. **终端集成**：xterm.js 终端标签
7. **权限细节**：白名单/黑名单目录、命令访问控制、危险反思
8. **段落压缩**：选择消息范围压缩
9. **顺便问**：从消息 fork 并提问
10. **Codex 额度可视化**：柱状图 + 预测

### 低优先级（锦上添花）
11. IM 网关
12. 通知声音
13. PixiJS 渲染器
14. 容器管理
15. 工作区
