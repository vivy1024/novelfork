# NovelFork 文档目录

**项目**: NovelFork - 网文小说 AI 辅助创作工作台  
**版本**: v0.0.1  
**更新日期**: 2026-04-18

---

## 📚 文档分类

### 1. 开发文档 (`development/`)

**Phase 4 实现参考**：
- [phase4-completion-report.md](development/phase4-completion-report.md) - Phase 4 完成报告（P0/P1/P2 功能总结）
- [claude-code-implementation-learnings.md](development/claude-code-implementation-learnings.md) - Claude Code 源码学习（P0 核心功能）
- [claude-code-p1-config-system.md](development/claude-code-p1-config-system.md) - Claude Code P1 配置系统学习
- [claude-code-p2-optimization.md](development/claude-code-p2-optimization.md) - Claude Code P2 体验优化学习

**对比分析**：
- [narrafork-vs-novelfork-ui-comparison.md](development/narrafork-vs-novelfork-ui-comparison.md) - NarraFork vs NovelFork UI/UX 深度对比

**规划文档**：
- [spec-plan-v2.md](development/spec-plan-v2.md) - 项目规格说明 v2

---

### 2. 发布文档 (`release/`)

**v0.0.1 发布**：
- [release-v0.0.1.md](release/release-v0.0.1.md) - v0.0.1 详细发布说明（用于 GitHub Release）
- [release-summary.md](release/release-summary.md) - v0.0.1 发布总结和下一步行动
- [initial-issues.md](release/initial-issues.md) - 初始 Issues 清单（20 个，待社区反馈后创建）

---

### 3. 学习资料 (`learning/`)

**Claude Code 学习**：
- [claude-code-implementation-learnings.md](learning/claude-code-implementation-learnings.md) - P0 核心功能实现参考
- [claude-code-p1-config-system.md](learning/claude-code-p1-config-system.md) - P1 配置系统学习
- [claude-code-p2-optimization.md](learning/claude-code-p2-optimization.md) - P2 体验优化学习

---

### 4. 归档文档 (`archive/`)

**历史文档**（已过时或已合并）：
- [已实现功能清单.md](archive/已实现功能清单.md) - 旧版功能清单（已被 phase4-completion-report.md 替代）
- [未实现功能路线图.md](archive/未实现功能路线图.md) - 旧版路线图（已被 ROADMAP.md 替代）
- [技术栈演变与当前状态.md](archive/技术栈演变与当前状态.md) - 技术栈演变历史（已被 VERSION_HISTORY.md 替代）

---

## 📖 快速导航

### 我想了解...

**项目概况**：
- 项目介绍 → [../README.md](../README.md)
- 版本历史 → [../VERSION_HISTORY.md](../VERSION_HISTORY.md)
- 更新日志 → [../CHANGELOG.md](../CHANGELOG.md)
- 产品路线图 → [../ROADMAP.md](../ROADMAP.md)

**开发指南**：
- 贡献指南 → [../CONTRIBUTING.md](../CONTRIBUTING.md)
- 依赖清单 → [../dependencies-list.md](../dependencies-list.md)
- Phase 4 完成报告 → [development/phase4-completion-report.md](development/phase4-completion-report.md)

**发布信息**：
- v0.0.1 发布说明 → [release/release-v0.0.1.md](release/release-v0.0.1.md)
- 发布总结 → [release/release-summary.md](release/release-summary.md)

**学习资料**：
- Claude Code 实现学习 → [learning/](learning/)
- UI/UX 对比分析 → [development/narrafork-vs-novelfork-ui-comparison.md](development/narrafork-vs-novelfork-ui-comparison.md)

---

## 🗂️ 文档维护规范

### 新增文档

1. **开发文档** → `development/`
   - 技术设计文档
   - 架构说明
   - 实现参考

2. **发布文档** → `release/`
   - 版本发布说明
   - Release Notes
   - Issues 清单

3. **学习资料** → `learning/`
   - 源码学习笔记
   - 技术调研
   - 最佳实践

4. **归档文档** → `archive/`
   - 已过时的文档
   - 已被替代的文档
   - 历史参考资料

### 文档命名规范

- 使用小写字母和连字符：`feature-name.md`
- 版本号使用 `v` 前缀：`release-v0.0.1.md`
- 日期格式：`YYYY-MM-DD`
- 中文文档可以使用中文文件名

### 文档更新

- 每次更新文档时，更新文档头部的「更新日期」
- 重大变更时，在 CHANGELOG.md 中记录
- 过时文档移动到 `archive/` 目录

---

## 📝 文档状态

| 文档 | 状态 | 最后更新 | 说明 |
|------|------|---------|------|
| phase4-completion-report.md | ✅ 最新 | 2026-04-18 | Phase 4 完成报告 |
| release-v0.0.1.md | ✅ 最新 | 2026-04-18 | v0.0.1 发布说明 |
| release-summary.md | ✅ 最新 | 2026-04-18 | 发布总结 |
| claude-code-*.md | ✅ 最新 | 2026-04-18 | Claude Code 学习资料 |
| narrafork-vs-novelfork-ui-comparison.md | ✅ 最新 | 2026-04-18 | UI/UX 对比 |
| spec-plan-v2.md | ⚠️ 部分过时 | 2026-04-17 | 部分内容已实现 |
| 已实现功能清单.md | 🗄️ 已归档 | 2026-04-17 | 已被 phase4-completion-report.md 替代 |
| 未实现功能路线图.md | 🗄️ 已归档 | 2026-04-17 | 已被 ROADMAP.md 替代 |
| 技术栈演变与当前状态.md | 🗄️ 已归档 | 2026-04-18 | 已被 VERSION_HISTORY.md 替代 |

---

## 🔗 相关链接

- **GitHub 仓库**: https://github.com/vivy1024/novelfork
- **Issues**: https://github.com/vivy1024/novelfork/issues
- **Discussions**: https://github.com/vivy1024/novelfork/discussions
- **原项目 InkOS**: https://github.com/Narcooo/inkos

---

**维护者**: 薛小川 (vivy1024)  
**许可证**: MIT License
