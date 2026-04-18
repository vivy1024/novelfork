# 学习资料

本目录包含从 Claude Code 项目学习的实现参考文档。

---

## 📚 Claude Code 学习系列

### P0 核心功能实现

- **[claude-code-implementation-learnings.md](claude-code-implementation-learnings.md)** - P0 核心功能实现参考（589 行）
  - Git Worktree 实现（Slug 验证、快速恢复、防凭证挂起）
  - 多窗口/多 Agent 协调（Coordinator/Worker 模式）
  - 上下文管理（上下文折叠、来源分组、Git 状态缓存）
  - 虚拟滚动（自定义 Hook、搜索索引预热、Sticky Prompt）
  - 消息渲染优化（Logo Header Memo、消息折叠、Brief-Only 模式）
  - 性能优化技巧（避免 subprocess、并行执行、WeakMap 缓存）
  - 安全最佳实践（路径验证、防命令注入、防凭证泄露）

### P1 配置系统

- **[claude-code-p1-config-system.md](claude-code-p1-config-system.md)** - P1 配置系统学习（475 行）
  - Settings 架构（三层 Tab 结构：Status/Config/Usage）
  - 权限系统（7 层来源优先级：managed > project > user > local > cliArg > command > session）
  - MCP 工具集成（MCP Server 管理、审批流程）
  - Skills 系统（5 个优先级：Built-in > Plugin > User > Project > Managed）
  - Routines 系统（9 个标签页：Commands/Tools/Permissions/Skills/Sub-agents/Prompts/MCP）
  - Admin 管理面板（7 个模块：Users/Providers/Terminals/Containers/Storage/Resources/Requests）

### P2 体验优化

- **[claude-code-p2-optimization.md](claude-code-p2-optimization.md)** - P2 体验优化学习（623 行）
  - 消息编辑（编辑历史、撤销/重做）
  - 双 Git 按钮（日志查看器 + Fork/合并操作）
  - 工具调用可视化（显示命令、耗时、输出、折叠长输出）
  - 会话管理（会话列表、拖拽排序）
  - 监察者可视化（状态徽章、实时日志流）
  - 项目拖拽排序（@dnd-kit）
  - 错误提示优化（错误分类、详细信息、建议操作）
  - 代码块展开/折叠（超过 20 行自动折叠）
  - 全局搜索（SQLite FTS5 全文搜索）
  - 全供应商模型选择（Anthropic/OpenAI/DeepSeek）

---

## 🎯 学习成果

### 核心设计模式

1. **Slug 验证与路径安全** - 防止路径遍历攻击
2. **快速恢复路径** - 避免重复 subprocess 开销
3. **Coordinator/Worker 模式** - 清晰的角色分工
4. **权限分层管理** - 7 层来源优先级
5. **虚拟滚动优化** - 搜索索引预热、React.memo、WeakMap 缓存
6. **上下文管理** - 来源分组、自动压缩、Git 状态缓存

### 性能优化技巧

1. **避免 subprocess 开销** - 直接读取文件而非调用 git 命令
2. **并行执行 Git 命令** - 使用 Promise.all
3. **使用 WeakMap 缓存** - 自动垃圾回收
4. **React.memo 防止级联重渲染** - 只在 props 变化时重渲染
5. **截断过长输出** - 防止上下文爆炸

### 安全最佳实践

1. **防止路径遍历** - 验证 slug，拒绝 `..` 和 `/`
2. **防止命令注入** - 使用 execFile 而非 exec
3. **防止凭证泄露** - 设置环境变量防止交互式提示

---

## 📖 如何使用这些学习资料

### 实现新功能时

1. 先查看对应的学习文档（P0/P1/P2）
2. 参考核心设计模式和代码示例
3. 应用性能优化技巧
4. 遵循安全最佳实践

### 优化现有功能时

1. 查看性能优化章节
2. 对比当前实现和参考实现
3. 识别优化空间
4. 逐步应用优化技巧

### 解决问题时

1. 查看相关章节的"学习要点"
2. 参考"关键设计模式"
3. 查看"安全最佳实践"
4. 应用到具体场景

---

## 🔗 相关文档

- 开发文档 → [../development/](../development/)
- Phase 4 完成报告 → [../development/phase4-completion-report.md](../development/phase4-completion-report.md)
- 返回文档首页 → [../README.md](../README.md)
