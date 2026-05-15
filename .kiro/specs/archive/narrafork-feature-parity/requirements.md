# NarraFork 功能对齐 — 需求文档

## 背景

对比 NarraFork v0.1.0 ~ v0.4.13 的更新日志，NovelFork 缺少以下已验证的平台能力。这些功能按优先级分类，作为后续迭代的参考。

---

## Phase 1：核心平台能力（P1）

### 1.1 自重启更新系统
- 新进程杀旧进程方案
- 增量更新（zstd patch-from，更新包缩小 99%+）
- 双语更新日志，跨版本显示中间版本 release notes
- 设置页"检查更新"按钮

### 1.2 评审系统
- ConcludeReview 工具：结构化裁定（批准/请求修改/仅评论）
- 评审反馈自动注入源叙述者
- 合并前评审门控（requireReviewBeforeMerge）

### 1.3 顺便提问（Ask in Passing）
- 从任意消息 fork 叙述者并立即提问
- 支持待定状态和实时更新
- 只读模式 + "转正"按钮

### 1.4 文件修改时间线
- FileSummaryTab 按消息查看历史文件状态
- diff 端点支持 upToMessageId 过滤
- 当前只有 FileChangesPanel（无时间线）

---

## Phase 2：性能与渲染（P2）

### 2.1 Pixi 高性能消息渲染器
- Canvas 渲染替代 DOM，长对话浏览更流畅
- 支持选择渲染模式（React DOM / Pixi）
- 行内代码 Shiki 语法高亮
- 词级别 diff 高亮

### 2.2 前端渲染优化
- memo 化高频组件
- WebSocket 面板状态合并为 useReducer
- 懒加载重型面板
- requestAnimationFrame 批量更新
- NarraFlow 统一 wheel 事件委托

### 2.3 流式输出块排序
- 推理、网络搜索和文本块按实际到达顺序显示
- 多 outputIndex 并行块支持

---

## Phase 3：容器与隔离（P2）

### 3.1 容器系统
- Docker/Podman 容器管理
- 容器启动/停止/重建
- 容器事件处理器（启动时注入访问 URL）
- 容器数据卷快照（创建/应用/删除）

### 3.2 TLS 自签名证书
- 一键生成 RSA 2048 / 10 年有效期
- 自动启用 HTTPS 并重启服务器

### 3.3 PWA 离线支持
- Service Worker 缓存
- maximumFileSizeToCacheInBytes 配置

---

## Phase 4：IM 网关（P3）

### 4.1 多平台 IM 接入
- Telegram/Discord/Slack/飞书/微信/QQ Bot
- 每个 IM 会话自动创建独立叙述者
- 流式输出渐进式消息编辑
- 速率限制、空闲超时
- /model /list /search /switch 命令
- 跨会话权限审批（引用消息回复）

### 4.2 网关热重载
- POST /reload 按平台定向重载
- 网关配置从文件迁移到数据库

---

## Phase 5：高级交互（P3）

### 5.1 Director 工作区布局
- 主次面板自适应切换
- 预览模式
- 触摸激活

### 5.2 滑动手势（移动端）
- 消息块滑动菜单
- 水平可滚动祖先检测
- 门户菜单跟手追踪

### 5.3 消息块级操作
- 块级回退右键菜单
- ImageBlock/TextFileBlock 右键菜单
- 分段压缩（选定消息范围压缩为摘要）

### 5.4 优先消息队列
- 长按发送按钮插入队列最前端并中断
- 缓冲消息拖拽重排

---

## Phase 6：安全与稳定（P2）

### 6.1 YOLO 安全系统完善
- 只读确认跳过开关
- 破坏性 stash 操作风险提示
- 高风险命令严格保护
- 安全暂停消息国际化

### 6.2 智能中断检查
- 15 秒后端 + 20 秒前端双层超时
- 防止摘要模型调用卡住

### 6.3 僵尸叙述者检测
- loop 已结束但状态仍为 thinking/waiting 时强制重置

---

## 不做的功能

以下是 NarraFork 特有的、NovelFork 不需要的功能：
- NUG 统一网关（用 Sub2API 代替）
- Codex WebSocket 传输（NovelFork 不接 Codex）
- NKP 排队位置显示（NovelFork 不用 NKP）
- Cline 余额接口（NovelFork 不接 Cline）
- VNet Relay（NovelFork 不需要虚拟网络）

---

## 实施建议

按内测反馈优先级排序：
1. 先做 Phase 1（核心平台能力）— 评审系统和更新系统对团队使用最重要
2. Phase 6（安全稳定）— 内测中会暴露的问题
3. Phase 2（性能）— 长对话场景
4. Phase 3-5 — 按需求驱动
