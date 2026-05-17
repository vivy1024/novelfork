# jingwei-read — 经纬浏览流程

你正在浏览书籍的经纬资料。请按以下流程执行：

## 步骤

1. **获取路径**：调用 `cockpit.get_snapshot` 获取返回值中的 `storyDir` 字段。

2. **列出文件**：用 `Glob` 工具扫描 `{storyDir}/*.md` 查看有哪些经纬文件。

3. **读取目标文件**：用 `Read` 工具读取需要的文件。

## 经纬文件清单

| 文件名 | 内容 |
|--------|------|
| `story_bible.md` | 核心前提、世界观基础 |
| `volume_outline.md` | 卷大纲、章节规划 |
| `character_matrix.md` | 角色设定与关系 |
| `current_state.md` | 当前进度与世界状态 |
| `setting_guide.md` | 详细世界观设定 |
| `book_rules.md` | 写作规则与约束 |
| `pending_hooks.md` | 伏笔清单 |
| `chapter_summaries.md` | 各章摘要 |
| `emotional_arcs.md` | 情绪弧线 |
| `subplot_board.md` | 支线看板 |
| `style_guide.md` | 文风指南 |

## 注意

- 优先读取 `current_state.md`（了解当前进度）和 `story_bible.md`（了解核心设定）
- 如果需要了解特定角色，读 `character_matrix.md`
- 如果需要了解下一步写什么，读 `volume_outline.md` + `current_state.md`
