# jingwei-write — 经纬写入流程

你正在执行经纬写入操作。请严格按以下流程执行：

## 步骤

1. **获取路径**：调用 `cockpit.get_snapshot` 获取返回值中的 `storyDir` 字段，这是经纬文件的绝对路径。

2. **确认目标文件**：根据要写入的内容类型，选择正确的文件：

| 文件名 | 用途 | 格式 |
|--------|------|------|
| `story_bible.md` | 核心前提、一句话概念、类型定位、读者承诺 | Markdown，# 标题 + ## 分节 |
| `volume_outline.md` | 卷大纲、章节规划、节拍设计 | Markdown，按卷分节，每章含情节点 |
| `character_matrix.md` | 角色设定、人物弧光、关系网 | Markdown，每角色一个 ## 节 |
| `current_state.md` | 当前进度、世界状态、活跃伏笔 | Markdown，实时更新 |
| `setting_guide.md` | 世界观设定、力量体系、地理 | Markdown |
| `book_rules.md` | 写作规则、字数约束、禁忌 | Markdown，规则列表 |
| `pending_hooks.md` | 待处理伏笔清单 | Markdown，`- [ ]` 未回收，`- [x]` 已回收 |
| `chapter_summaries.md` | 各章摘要 | Markdown，每章一段 |
| `emotional_arcs.md` | 情绪弧线追踪 | Markdown |
| `subplot_board.md` | 支线看板 | Markdown |
| `style_guide.md` | 文风指南 | Markdown |

3. **写入**：使用 `Write` 工具写入 `{storyDir}/{文件名}`。

4. **写入后更新 current_state.md**：如果写入的不是 current_state.md 本身，用 `Edit` 工具更新 `{storyDir}/current_state.md` 中的相关状态。

## 规则

- **绝对禁止**写入 storyDir 以外的路径
- **绝对禁止**在 worktree 根目录下创建 jingwei/ 等自定义目录
- 每个文件用 `#` 作为顶级标题，`##` 作为分节
- 内容必须是完整替换（Write），不是追加
- 如果文件已有内容，先用 `Read` 读取，合并后再 Write
