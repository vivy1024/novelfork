# 学习资料

本目录包含从 Claude Code 项目学习的实现参考文档。

---

## 📚 Claude Code 学习系列

### P0 核心功能实现

- **[claude-code-implementation-learnings.md](claude-code-implementation-learnings.md)** - P0 核心功能实现参考（589 行）
  - Git Worktree 实现
  - 多窗口/多 Agent 协调
  - 上下文管理
  - 虚拟滚动
  - 消息渲染优化
  - 性能优化技巧
  - 安全最佳实践

### P1 配置系统

- **[claude-code-p1-config-system.md](claude-code-p1-config-system.md)** - P1 配置系统学习（475 行）
  - Settings 架构
  - 权限系统
  - MCP 工具集成
  - Skills 系统
  - Routines 系统
  - Admin 管理面板

### P2 体验优化

- **[claude-code-p2-optimization.md](claude-code-p2-optimization.md)** - P2 体验优化学习（623 行）
  - 消息编辑
  - 双 Git 按钮
  - 工具调用可视化
  - 会话管理
  - 监察者可视化
  - 项目拖拽排序
  - 错误提示优化
  - 代码块展开/折叠
  - 全局搜索
  - 全供应商模型选择

---

## 🎯 学习成果

### 核心设计模式

1. **Slug 验证与路径安全** - 防止路径遍历攻击
2. **快速恢复路径** - 避免重复 subprocess 开销
3. **Coordinator/Worker 模式** - 清晰的角色分工
4. **权限分层管理** - 7 层来源优先级
5. **虚拟滚动优化** - 搜索索引预热、React.memo、WeakMap 缓存
6. **上下文管理** - 来源分组、自动压缩、Git 状态缓存

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

---

## 🔗 相关文档

- 开发指南 → [../02-开发指南/](../02-开发指南/)
- Phase 4 完成报告 → [../02-开发指南/phase4-completion-report.md](../02-开发指南/phase4-completion-report.md)
- 返回文档首页 → [../README.md](../README.md)
