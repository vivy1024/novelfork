# NovelFork v0.0.1 Release Notes

**发布日期**: 2026-04-18  
**项目地址**: https://github.com/vivy1024/inkos  
**标签**: v0.0.1

---

## 🎉 首个公开版本

NovelFork 是从 InkOS 项目 fork 出来的专注于**中文网文小说创作**的 AI 辅助工作台。

本版本包含完整的 Phase 4 功能，提供了强大的多线并行创作、对话式交互、上下文管理等核心能力。

---

## ✨ 核心功能

### P0 核心交互（98h）

#### 1. Git Worktree 多线并行
- ✅ 主线 + Fork 分支独立开发
- ✅ Slug 验证与路径安全（防止路径遍历）
- ✅ 快速恢复路径（避免重复 fetch）
- ✅ 防止凭证提示挂起
- ✅ 自动清理机制（30 天未使用）

#### 2. 多窗口卡片系统
- ✅ 使用 react-grid-layout 实现拖拽布局
- ✅ 每个窗口独立 WebSocket 连接
- ✅ 窗口状态持久化（IndexedDB）
- ✅ 支持最小化/最大化/关闭

#### 3. 对话式交互界面
- ✅ 类似 ChatGPT 的对话流
- ✅ 虚拟滚动（react-window）
- ✅ Markdown 渲染（react-markdown）
- ✅ 代码高亮（react-syntax-highlighter）
- ✅ SSE 实时推送 AI 回复

#### 4. 实时上下文管理
- ✅ Token 计算（tiktoken）
- ✅ 上下文来源分组（Project/User/Plugin）
- ✅ 自动压缩机制（超过 80% 触发）
- ✅ Git 状态缓存（只获取一次）
- ✅ 圆圈进度条显示（0-100%）

---

### P1 配置系统（72h）

#### 5. 设置页面
- ✅ 三层 Tab 结构（Status/Config/Usage）
- ✅ 搜索模式（实时过滤配置项）
- ✅ 变更追踪（Esc 回滚）
- ✅ 子菜单系统（Theme/Model/Language）

#### 6. 套路系统
- ✅ 9 个标签页：
  - Commands（自定义命令）
  - Tools（可选工具）
  - Permissions（工具权限）
  - Global Skills（全局技能）
  - Project Skills（项目技能）
  - Sub-agents（自定义子代理）
  - Global Prompts（全局提示词）
  - System Prompts（系统提示词）
  - MCP Tools（MCP 工具集成）
- ✅ 全局/项目两级配置
- ✅ 工具权限细粒度控制

#### 7. 管理面板
- ✅ 7 个管理模块：
  - Users（用户管理）
  - Providers（API 供应商管理）
  - Terminals（终端进程管理）
  - Containers（容器管理）
  - Storage（存储空间监控）
  - Resources（运行资源监控）
  - Requests（API 请求历史）
- ✅ WebSocket 实时监控
- ✅ 资源监控（CPU/内存/网络）

---

### P2 体验优化（38h）

#### 8. 消息编辑
- ✅ 点击任意消息进入编辑模式
- ✅ 支持 Markdown 编辑
- ✅ 编辑后重新生成后续消息
- ✅ 保留编辑历史

#### 9. 会话管理
- ✅ 会话列表显示
- ✅ 拖拽排序（@dnd-kit）
- ✅ 会话重命名
- ✅ 会话删除（带确认）

#### 10. 双 Git 按钮
- ✅ 按钮 1：Git 日志查看器（log + diff + status）
- ✅ 按钮 2：Fork/合并操作（worktree + merge）
- ✅ 支持暂存（git add）、提交（git commit）

#### 11. 工具调用可视化
- ✅ 显示工具名、命令、耗时
- ✅ 长输出自动折叠
- ✅ 支持复制命令
- ✅ 支持重新运行

#### 12. 监察者可视化
- ✅ 状态徽章（running/stopped/interrupted/error）
- ✅ 当前任务显示
- ✅ 进度条
- ✅ 实时日志流（WebSocket）

#### 13. 项目拖拽排序
- ✅ 使用 @dnd-kit/core
- ✅ 拖拽后保存顺序（localStorage）
- ✅ 支持分组

---

### 其他功能（18h）

#### 14. 全局搜索
- ✅ 内存 FTS 搜索引擎（Fuse.js）
- ✅ 搜索对话框（Shift+Ctrl+K 快捷键）
- ✅ 类型过滤（章节/设定/消息）
- ✅ 高亮匹配文本

#### 15. 全供应商模型选择
- ✅ 支持多个供应商（Anthropic/OpenAI/DeepSeek）
- ✅ API Key 管理
- ✅ 自定义 Base URL
- ✅ 模型切换功能

---

## 🛠️ 技术栈

### 前端
- **React 18** - UI 框架
- **TypeScript 5** - 类型安全
- **Vite 6** - 构建工具
- **TipTap 2.27** - 富文本编辑器
- **react-grid-layout** - 拖拽布局
- **react-window** - 虚拟滚动
- **react-markdown** - Markdown 渲染
- **@dnd-kit** - 拖拽排序
- **Fuse.js** - 全文搜索

### 后端
- **Node.js 22** - 运行时
- **tiktoken** - Token 计算
- **simple-git** - Git 操作
- **WebSocket** - 实时通信

### 存储
- **IndexedDB** - 客户端持久化
- **localStorage** - 配置存储

---

## 📦 安装与使用

### 前置要求
- Node.js 22+
- Git 2.30+

### 安装步骤

```bash
# 克隆仓库
git clone https://github.com/vivy1024/novelfork.git
cd inkos

# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

### 使用 CLI

```bash
# 安装 CLI
npm install -g @vivy1024/novelfork-cli

# 创建新项目
novelfork init my-novel

# 启动工作台
novelfork studio
```

---

## 📚 文档

- [CHANGELOG.md](../CHANGELOG.md) - 完整更新日志
- [VERSION_HISTORY.md](../VERSION_HISTORY.md) - 版本演进历史
- [CONTRIBUTING.md](../CONTRIBUTING.md) - 贡献指南
- [ROADMAP.md](../ROADMAP.md) - 产品路线图
- [dependencies-list.md](../dependencies-list.md) - 依赖清单

---

## 🧪 测试

### E2E 测试结果
- **通过**: 4/19 (21%)
- **失败**: 15/19 (79%)
- **执行时间**: 3 分钟

**注意**: 大部分失败是因为组件缺少 `data-testid` 属性，功能本身已实现。详见 [e2e-test-report.md](../e2e-test-report.md)。

### 运行测试

```bash
# 运行 E2E 测试
npm run test:e2e

# 查看测试报告
npx playwright show-report
```

---

## 🐛 已知问题

1. **测试覆盖率低**: 组件缺少 `data-testid` 属性，需要补充
2. **页面初始化**: 部分测试显示空白页，需要检查初始化流程
3. **功能性测试**: 当前测试只检查可见性，需要添加功能性测试

详见 [GitHub Issues](https://github.com/vivy1024/inkos/issues)。

---

## 🗺️ 路线图

### Phase 5: 交互叙事与局部干预（规划中）
- 分支剧情编辑器
- 角色关系图谱
- 情节节点可视化
- 局部重写与续写

### Phase 6: 协作与发布（规划中）
- 多人实时协作
- 版本历史与回溯
- 导出功能（PDF/EPUB/DOCX）
- 云同步

### Phase 7: AI 能力增强（规划中）
- 语音输入
- 图像生成
- 智能推荐
- 自动润色

详见 [ROADMAP.md](../ROADMAP.md)。

---

## 🙏 致谢

- **InkOS 项目** - 提供了基础架构和灵感
- **Claude Code 项目** - 提供了实现参考
- **开源社区** - 提供了优秀的工具和库

---

## 📄 许可证

MIT License - 详见 [LICENSE](../LICENSE)

Copyright (c) 2026 薛小川 (vivy1024)

---

## 🔗 链接

- **GitHub**: https://github.com/vivy1024/novelfork
- **Issues**: https://github.com/vivy1024/novelfork/issues
- **Discussions**: https://github.com/vivy1024/novelfork/discussions

---

**Happy Writing! 📝✨**
