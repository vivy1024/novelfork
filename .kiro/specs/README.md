# Kiro Specs 索引

本目录记录 NovelFork 的 Kiro specs。已完成/过时 spec 归档到 `archive/`，当前 active spec 保留在本目录下。

---

## Active Specs

| Spec | 状态 | 说明 |
|------|------|------|
| `context-visibility-system` | 🔥 主线 | 三种可见性 + 时间线纪律 + 自动链接 + 上下文组装 |
| `writing-tools-completion` | 🔥 主线 | 驾驶舱工具面板 + 选段写作 + EPUB 导出 + 专注模式 + 拖拽排序 |
| `agent-tool-gaps` | 🔥 主线 | Agent 工具缺口补全：修订、整书导入、文风提取、改写写回 |
| `jingwei-core-brief-indexed-reading` | 📋 下一步 | 经纬从全量注入升级为核心包 + 分类目录 + 按需分页阅读 |
| `agent-runtime-hardening` | 📋 下一步 | 级联压缩 + YOLO 安全判断 + turn 恢复 + 循环检测 |

---

## 后续规划

### 主线（v1.2.0 目标）

```
agent-tool-gaps（补齐 Agent 工具）
  ↓
context-visibility-system（经纬可见性控制）
  ↓
writing-tools-completion（写作工具面板）
```

### 第二优先级

```
jingwei-core-brief-indexed-reading（经纬按需阅读）
  ↓
agent-runtime-hardening（运行时加固）
```

---

## 归档 Specs（70+ 个）

`archive/` 下已完成/过时的 spec。本次归档（2026-05-31）：

| Spec | 归档原因 |
|------|---------|
| `cockpit-redesign` | 已完成 |
| `context-and-presets-overhaul` | 已完成（预设注入、写作设置注入已修复） |
| `session-detail-panel` | 已完成（硬编码修复） |
| `studio-bugs-and-features` | 已完成（bug 批量修复） |
| `constraint-driven-writing-v2` | 核心已实现（10 工具、2 步管线、三层经纬） |
| `unified-writing-pipeline` | 方向已变（保留 PipelineRunner，补齐 Agent 工具） |
| `runtime-capability-alignment` | 对标驱动，违反项目纪律 |
| `narrafork-feature-parity` | 对标驱动，违反项目纪律 |
| `docs-sync-v071` | 版本号过时（当前 v1.1.1） |
| `error-transparency-and-context-viz` | 被 context-visibility-system 取代 |
| `general-capability-completion` | 对标驱动 |
| `unified-writing-resource` | 被 constraint-driven-writing-v2 取代 |
| `coding-agent-quality` | 已归档（早期） |
| `ui-visibility-gaps` | 已归档（早期） |
| `ui-gap-fixes` | 已归档（早期） |
| `smart-preset-system` | 已归档（早期） |
| `novel-creation-closure` | 已归档（早期） |
| `remaining-closure` | 已归档（早期） |

---

## 非 Spec 参考资料

### `.narrafork-reference/`

从 NarraFork 0.4.2 爬取的第一手参考，**不是 spec，不产生任务**。用于设计对标时查阅。

| 文件 | 内容 |
|------|------|
| `API-REFERENCE.md` | NarraFork 完整 API 端点 |
| `UI-COMPONENTS.md` | DOM 结构 + 状态指示器 + 设置→对话数据流 |
| `PROVIDERS.md` | 三种 API 模式 + Codex 多账号 + 额度管理 |
| `CONVERSATION-INTERNALS.md` | WebSocket 事件、流式渲染、工具状态机 |
| `PROVIDER-AND-NARRATOR-MANAGEMENT.md` | 供应商、权限、叙述者创建 |
| `FRONTEND-LOGIC.md` | 前端逻辑分析 |
| `ARCHITECTURE-ANALYSIS.md` | 架构分析 |
