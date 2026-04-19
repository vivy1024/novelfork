# NarraFork 更新日志参考

**版本**: v0.1.17  
**创建日期**: 2026-04-20  
**更新日期**: 2026-04-20  
**状态**: ✅ 已完成

---

## 说明

本文件整理 NarraFork 自 `v0.1.0` 到 `v0.1.17` 的代表性更新，用来观察它的平台成熟方向。

关注重点：
- 数据持久化
- WebSocket 与流式恢复
- 权限与工具系统
- 更新机制
- 本地数据库、终端、浏览器、容器、PWA 等基础设施

---

## v0.1.17（2026-04-16）

### 新功能
- 缓冲消息队列持久化到 SQLite，服务器重启后自动恢复
- 实验性 Codex WebSocket 传输，自动回退 HTTP
- WebSearchBlock 提取为独立组件，支持右键菜单和滑动操作
- 权限系统 `activePermissionId` 机制，修复多权限并存时 Enter 键绑定错误

### 修复
- 修复 OpenAI `web_search_call` 兼容性
- 修复 Codex web search 历史重建
- 批量删除消息块性能优化
- `revertPatchForToolUse` 对齐 success 过滤
- Agent loop 中断后自动恢复缓冲消息
- 修复 `codexWebSocket` 字段设置无法持久化
- `persistBufferedTextFiles` 使用 `basename()` 防路径遍历
- 数据库序列重写和前端插入使用事务保证原子性

### 改进
- 拖拽 ghost 使用主题变量适配亮/暗色
- WS hook 返回值 `useMemo` 化，减少重渲染
- 扩展 API 类型与 staleTime 优化

---

## v0.1.16（2025-07-11）

### 性能优化
- 前端渲染大规模 memo 化与懒加载
- WebSocket 面板状态合并为 `useReducer`
- NarraFlow / storage listener / HMR 泄漏修复
- 重型面板按需加载
- `shiki` 高亮动态导入

### 修复
- AI 提供商空响应错误本地化
- 上下文窗口超限错误处理
- `invalid_state` 错误状态标记修复
- `split-tree` 改用 `Math.random()` 兼容 HTTP 非安全上下文

### 其他
- 升级 Vite 到 v7

---

## v0.1.15（2026-04-15）

### 新功能
- Director 工作区布局上线
- Codex WebSocket 恢复机制增强
- 优先级叙述者消息支持插队和中断

### 改进
- OpenAI Responses 与 Codex 历史重建保留消息 ID
- 发送失败恢复草稿文本和附件
- 增加重连决策与历史同步测试覆盖

### 修复
- 修复 Codex WebSocket 中断处理卡死问题

---

## v0.1.14（2026-04-14）

### 新功能
- 数据库清理系统
- 使用历史增强
- Codex WebSocket 默认启用
- 叙述者详情面板
- API 请求 dump 收集器
- 消息角色系统（sys / disp）
- 命令白名单改进

### 改进
- OpenAI Responses API 图片回放
- Agent loop 工具去重
- NUG 提供商 UI 简化

### 修复
- fork 历史/上传清理图片丢失
- 中断后继续重试/compact 恢复流程
- 命令白名单覆盖问题

### 开发者
- 新增大量 provider/history/migration/i18n 测试与迁移脚本

---

## v0.1.13（2026-04-13）

### 新功能
- 从任意消息点 fork 叙述者并立即提问
- 供应商管理重构（概览 + 配置视图）
- 推理强度三级回退
- 浏览器 Headed 模式
- 斜杠命令模型切换

### 改进
- SHA256 动态指纹算法，对齐 Claude Code CLI 认证
- 输出截断保留最后 N 行
- 浏览器截图从 URL 改 Blob URL
- 中断恢复改为重放工具结果包

### 修复
- Dirty 检测、User-Agent、推理块顺序、Chrome 安装错误等问题

---

## v0.1.12（2026-04-09）

### 改进
- PWA 最大缓存文件限制提至 4MB
- 测试基础设施升级：Drizzle 迁移 SQL 回放
- 测试断言对齐当前生产默认值

---

## v0.1.11（2026-04-09）

### 新功能
- 基于索引的权限键盘导航
- 最近标签页快捷键
- Terminal `wait_for` 参数
- 可配置重试退避上限
- 优先发送并中断
- Webview 面板支持
- 智能中断检查超时
- 递归技能目录扫描
- 更新弹窗 Markdown 渲染

### 修复
- WS 订阅、子代理模型池、终端读取缓冲区、Shell 名称检测等问题

---

## v0.1.10（2025-07-22）

### 新功能
- 结构化评审结论工具
- 自动注入评审反馈
- 合并前评审门控
- 分段压缩
- 浏览器会话管理
- 并行工具执行
- 新的 Shell 环境开关
- 子代理结论文件
- 容器事件处理器

### 修复
- 合并竞态、评审创建原子性、提供商 disabled 字段、OpenAI codex 模式 WebSearch 排除等

---

## v0.1.9（2025-07-18）

### 新功能
- 流式输出块按时间顺序渲染
- `NarraForkAdmin` AI 工具
- 用户角色管理
- 推理块右键菜单与多选
- 容器构建/启动阶段检测
- Docker Compose 自托管部署

### 修复
- ZSTD_CLI_MISSING 误报
- 更新脚本异常处理
- 工具卡片主题适配

---

## v0.1.8（2026-04-05）

### 新功能
- TLS 自签名证书生成，自动启用 HTTPS
- 登录页本地化错误提示
- WebFetch 支持 AbortSignal 中断

### 改进
- 浏览器引擎从 Playwright 迁移到 Puppeteer
- Anthropic 提供商空消息过滤与兼容处理

### 修复
- 浏览器 wait/fill 行为问题

---

## v0.1.7 ～ v0.1.0（主题概括）

这些版本逐步奠定了 NarraFork 的平台壳：
- 稳定的流式渲染
- NUG 统一网关提供商
- Markdown 数学公式与 /skill 命令
- Browser 工具、Storage 管理、更新系统
- worktree watcher 优化到 `@parcel/watcher`
- 容器快照、Dockerfile、自重启更新、zstd patch、更新服务器等

---

## 对 NovelFork 的启示

从更新日志可以看到 NarraFork 的演进重点始终围绕：

1. **本地状态持久化（SQLite / 事务 / 队列恢复）**
2. **稳定的流式 AI 交互（WS / 回退 / 中断恢复）**
3. **工具与权限系统细化**
4. **单体产品壳的体验完善（更新、证书、容器、浏览器、终端）**

这再次说明：

> NarraFork 的核心不是某一个 UI 组件，而是一整套围绕本地单体应用设计的产品壳。

NovelFork 回归 NarraFork 路线时，应优先学习这种演进顺序。
