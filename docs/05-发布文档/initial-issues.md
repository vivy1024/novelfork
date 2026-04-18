# NovelFork 初始 Issues 清单

**创建日期**: 2026-04-18  
**版本**: v0.0.1

---

## 优先级说明

- **P0**: 阻塞性问题，必须立即修复
- **P1**: 重要问题，影响核心功能
- **P2**: 一般问题，影响用户体验
- **P3**: 优化建议，可以延后处理

---

## Bug 修复类 Issues

### P1: 测试覆盖率问题

**标题**: [Bug] E2E 测试失败率高 - 组件缺少 data-testid 属性

**描述**:
当前 E2E 测试通过率只有 21% (4/19)，主要原因是组件缺少 `data-testid` 属性导致测试无法定位元素。

**影响范围**:
- WorktreeManager 组件
- ChatPanel/ChatBar/ChatWindow 组件
- Admin 组件
- SettingsView 组件
- 其他核心组件

**期望行为**:
所有可交互组件应该添加 `data-testid` 属性，方便测试定位。

**复现步骤**:
```bash
npm run test:e2e
```

**相关文件**:
- `e2e/phase4-integration.spec.ts`
- `e2e-test-report.md`

**标签**: `bug`, `testing`, `P1`, `good first issue`

---

### P2: 页面初始化空白问题

**标题**: [Bug] 部分测试显示页面初始化为空白

**描述**:
在 E2E 测试中，部分测试截图显示页面为空白，可能是页面初始化流程有问题。

**影响范围**:
- 对话式交互界面
- 上下文管理面板
- 管理面板

**期望行为**:
页面应该正常加载并显示内容。

**复现步骤**:
1. 运行 E2E 测试
2. 查看失败测试的截图
3. 发现页面为空白

**相关文件**:
- `packages/studio/src/components/ChatPanel.tsx`
- `packages/studio/src/components/Admin/Admin.tsx`

**标签**: `bug`, `ui`, `P2`

---

## 功能增强类 Issues

### P1: 添加功能性测试

**标题**: [Enhancement] 添加功能性 E2E 测试（不仅是可见性检查）

**描述**:
当前 E2E 测试只检查元素是否可见，缺少功能性测试（如点击按钮、输入文本、验证结果等）。

**建议测试场景**:
1. **Git Worktree**:
   - 创建新 worktree
   - 切换 worktree
   - 删除 worktree
   - 合并 worktree

2. **多窗口卡片**:
   - 打开新窗口
   - 拖拽窗口
   - 缩放窗口
   - 关闭窗口

3. **对话式交互**:
   - 发送消息
   - 接收 AI 回复
   - 编辑消息
   - 重新生成回复

4. **上下文管理**:
   - 查看上下文占用
   - 压缩上下文
   - 裁剪上下文
   - 清空上下文

5. **全局搜索**:
   - 搜索章节
   - 搜索设定
   - 搜索消息
   - 验证搜索结果

**相关文件**:
- `e2e/phase4-integration.spec.ts`

**标签**: `enhancement`, `testing`, `P1`, `help wanted`

---

### P2: 添加单元测试

**标题**: [Enhancement] 添加单元测试覆盖核心功能

**描述**:
当前项目缺少单元测试，建议为核心功能添加单元测试。

**建议测试范围**:
1. **Git 工具函数** (`packages/studio/src/api/lib/git-utils.ts`)
   - Slug 验证
   - Worktree 创建/删除
   - Git 命令执行

2. **Token 计算** (`packages/studio/src/api/lib/token-counter.ts`)
   - Token 计数准确性
   - 不同模型的 Token 计算

3. **搜索引擎** (`packages/studio/src/api/lib/search-index.ts`)
   - 索引构建
   - 搜索准确性
   - 高亮匹配

4. **Routines 服务** (`packages/studio/src/api/lib/routines-service.ts`)
   - 权限检查
   - 配置加载/保存

**测试框架**: Vitest

**标签**: `enhancement`, `testing`, `P2`, `help wanted`

---

### P2: 性能优化 - 虚拟滚动

**标题**: [Enhancement] 优化对话流虚拟滚动性能

**描述**:
参考 Claude Code 的实现，优化对话流的虚拟滚动性能。

**优化方向**:
1. **搜索索引预热**: 使用 WeakMap 缓存搜索文本
2. **React.memo 优化**: 防止级联重渲染
3. **消息折叠**: 自动折叠相关消息（后台任务、工具调用等）
4. **Sticky Prompt**: 长提示词粘性显示

**参考文档**:
- `docs/claude-code-implementation-learnings.md`（第五节：虚拟滚动）

**相关文件**:
- `packages/studio/src/components/ChatPanel.tsx`

**标签**: `enhancement`, `performance`, `P2`

---

### P2: 性能优化 - 上下文管理

**标题**: [Enhancement] 优化上下文管理性能

**描述**:
参考 Claude Code 的实现，优化上下文管理性能。

**优化方向**:
1. **上下文来源分组**: 按来源分组显示（Project/User/Plugin）
2. **Git 状态缓存**: 只在会话开始时获取一次
3. **自动压缩**: 超过 80% 自动触发压缩
4. **分段压缩**: span-based 压缩策略

**参考文档**:
- `docs/claude-code-implementation-learnings.md`（第四节：上下文管理）

**相关文件**:
- `packages/studio/src/api/routes/context-manager.ts`
- `packages/studio/src/components/ContextCircle.tsx`

**标签**: `enhancement`, `performance`, `P2`

---

### P3: 主题切换功能

**标题**: [Feature] 添加主题切换功能（Light/Dark/Auto）

**描述**:
当前项目只有一个主题，建议添加主题切换功能。

**功能需求**:
1. Light 主题
2. Dark 主题
3. Auto 主题（跟随系统）
4. 主题配置持久化

**参考实现**:
- 使用 CSS 变量
- 使用 `prefers-color-scheme` 媒体查询

**相关文件**:
- `packages/studio/src/components/Settings/Config.tsx`

**标签**: `feature`, `ui`, `P3`, `good first issue`

---

### P3: 快捷键支持

**标题**: [Feature] 添加快捷键支持

**描述**:
当前项目只有全局搜索快捷键（Shift+Ctrl+K），建议添加更多快捷键。

**建议快捷键**:
- `Cmd/Ctrl + N`: 新建章节
- `Cmd/Ctrl + S`: 保存
- `Cmd/Ctrl + W`: 关闭当前窗口
- `Cmd/Ctrl + T`: 新建窗口
- `Cmd/Ctrl + ,`: 打开设置
- `Cmd/Ctrl + /`: 显示快捷键帮助

**参考实现**:
- 使用 `react-hotkeys-hook`

**标签**: `feature`, `ux`, `P3`, `good first issue`

---

### P3: 国际化支持

**标题**: [Feature] 添加国际化支持（i18n）

**描述**:
当前项目只支持中文，建议添加国际化支持。

**功能需求**:
1. 支持中文（简体/繁体）
2. 支持英文
3. 语言切换功能
4. 语言配置持久化

**参考实现**:
- 使用 `react-i18next`

**相关文件**:
- `packages/studio/src/components/Settings/Config.tsx`

**标签**: `feature`, `i18n`, `P3`, `help wanted`

---

## 文档类 Issues

### P1: 添加快速开始指南

**标题**: [Docs] 添加快速开始指南

**描述**:
当前 README.md 缺少详细的快速开始指南，建议添加。

**内容建议**:
1. 安装步骤（详细）
2. 配置说明（环境变量、API Key 等）
3. 基本使用（创建项目、启动工作台、创建章节等）
4. 常见问题（FAQ）

**相关文件**:
- `README.md`

**标签**: `documentation`, `P1`, `good first issue`

---

### P2: 添加 API 文档

**标题**: [Docs] 添加 API 文档

**描述**:
当前项目缺少 API 文档，建议添加。

**内容建议**:
1. REST API 文档（所有路由）
2. WebSocket API 文档（事件类型）
3. 请求/响应示例
4. 错误码说明

**工具建议**:
- 使用 Swagger/OpenAPI

**标签**: `documentation`, `P2`, `help wanted`

---

### P3: 添加架构设计文档

**标题**: [Docs] 添加架构设计文档

**描述**:
当前项目缺少架构设计文档，建议添加。

**内容建议**:
1. 系统架构图
2. 数据流图
3. 技术选型说明
4. 设计决策记录（ADR）

**相关文件**:
- `docs/architecture.md`

**标签**: `documentation`, `P3`, `help wanted`

---

## 社区建设类 Issues

### P1: 创建 Discussions 分类

**标题**: [Community] 创建 GitHub Discussions 分类

**描述**:
建议创建以下 Discussions 分类：
1. **Announcements** - 公告
2. **General** - 一般讨论
3. **Ideas** - 功能建议
4. **Q&A** - 问答
5. **Show and tell** - 展示作品

**标签**: `community`, `P1`

---

### P2: 创建贡献者指南视频

**标题**: [Community] 创建贡献者指南视频

**描述**:
为了降低贡献门槛，建议创建贡献者指南视频。

**内容建议**:
1. 项目介绍
2. 开发环境搭建
3. 代码结构说明
4. 提交 PR 流程
5. 常见问题解答

**标签**: `community`, `documentation`, `P2`, `help wanted`

---

### P3: 创建示例项目

**标题**: [Community] 创建示例项目

**描述**:
为了帮助用户快速上手，建议创建示例项目。

**示例建议**:
1. 玄幻小说示例
2. 都市小说示例
3. 科幻小说示例
4. 历史小说示例

**标签**: `community`, `documentation`, `P3`, `help wanted`

---

## 总结

**总计**: 20 个 issues

**优先级分布**:
- P0: 0 个
- P1: 6 个（测试、文档、社区）
- P2: 8 个（Bug、性能、文档）
- P3: 6 个（功能、文档、社区）

**类型分布**:
- Bug: 2 个
- Enhancement: 5 个
- Feature: 3 个
- Documentation: 4 个
- Community: 3 个
- Testing: 3 个

**建议创建顺序**:
1. 先创建 P1 issues（6 个）
2. 再创建 P2 issues（8 个）
3. 最后创建 P3 issues（6 个）

**标签建议**:
- `bug` - Bug 修复
- `enhancement` - 功能增强
- `feature` - 新功能
- `documentation` - 文档
- `community` - 社区建设
- `testing` - 测试
- `performance` - 性能优化
- `ui` - UI/UX
- `i18n` - 国际化
- `good first issue` - 适合新手
- `help wanted` - 需要帮助
- `P0`/`P1`/`P2`/`P3` - 优先级

---

**创建 issues 的命令**:

可以使用 GitHub CLI (`gh`) 批量创建 issues：

```bash
# 安装 GitHub CLI
# https://cli.github.com/

# 登录
gh auth login

# 创建 issue（示例）
gh issue create \
  --title "[Bug] E2E 测试失败率高 - 组件缺少 data-testid 属性" \
  --body "$(cat issue-template.md)" \
  --label "bug,testing,P1,good first issue"
```

或者手动在 GitHub 网页上创建。
