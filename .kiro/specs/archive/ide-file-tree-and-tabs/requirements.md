# IDE 文件树与编辑器 Tab 对齐 VS Code

## Problem Statement

NovelFork IDE 的文件树和编辑器 Tab 与通用 IDE（VS Code）标准差距较大：
- 所有文件统一 `kind: "chapter"`，非章节文件误触发章节专属功能（变体/蓝图/AI 续写/字数统计）
- 右键菜单不区分文件类型，统一只有"打开/重命名/删除"
- 无文件拖拽移动、无剪贴板操作、无文件过滤/排序
- Tab 无 Pin 固定、无 Split 子菜单、面包屑不可点击导航
- 只能打开 6 种扩展名（md/txt/json/yaml），图片无法预览

## Requirements

### R1: 文件类型区分
- `kind` 字段不再对所有文件统一使用 `"chapter"`
- `chapters/` 目录下 `NNNN_*.md` 文件 → `kind: "chapter"` + `metadata.isChapter: true`
- 其他目录的 `.md/.txt/.json` 等文件 → `kind: "file"`
- WorkbenchCanvas 中章节专属功能（变体/蓝图/AI 续写/ChapterActionsBar/ChapterToolbar）必须检查 `metadata.isChapter === true`，而非 `kind === "chapter"`

### R2: 右键菜单上下文化
- **目录节点**：新建文件 / 新建文件夹 / 在侧边打开 / 重命名 / 删除
- **章节文件**：在侧边打开 / 生成变体 / 章节蓝图 / 重命名 / 删除 / 复制路径
- **普通文件**：在侧边打开 / 重命名 / 删除 / 复制路径
- **经纬条目**：新建条目 / 在侧边打开 / 重命名 / 删除（保持现有）
- **经纬分区**：新建条目（保持现有）
- 菜单项通过注册机制定义，不硬编码在组件中

### R3: 文件拖拽移动
- 文件树内支持拖拽文件/文件夹到目标文件夹
- 拖拽到文件上时冒泡到父文件夹
- 禁止拖拽到自身或自身子目录（循环检测）
- 拖拽过程中目标文件夹高亮 + 自动展开（延迟 500ms）
- 移动操作调用后端 `/api/books/:id/files/rename` API
- 外部文件拖入暂不支持（后续版本）

### R4: 文件剪贴板
- Ctrl+C 复制选中文件路径到内部剪贴板
- Ctrl+X 剪切选中文件（标记为剪切态，视觉半透明）
- Ctrl+V 粘贴到当前聚焦的文件夹（复制=创建副本，剪切=移动）
- Escape 取消剪切状态

### R5: 复制路径
- 右键菜单"复制路径"：复制文件相对于书籍根目录的路径到系统剪贴板
- 使用 `navigator.clipboard.writeText()`

### R6: 文件过滤
- 支持 `.gitignore` 规则过滤（后端解析，前端通过 API 参数控制）
- 支持 `files.exclude` 配置（glob 模式，存入用户设置）
- 默认排除：`node_modules/`、`.git/`、`*.lock`
- 被排除的文件如已在编辑器中打开，仍显示在文件树中

### R7: 文件排序
- 默认：文件夹在前，文件按名称排序
- 可选排序方式：名称 / 扩展名 / 修改时间
- 排序设置持久化到 localStorage（per bookId）

### R8: 树内搜索
- 文件树顶部增加搜索输入框（或 Ctrl+F 聚焦）
- 输入时实时过滤，只显示文件名匹配的节点 + 父目录路径
- 退出搜索时恢复原始展开状态
- 搜索范围：当前已加载的文件树节点（不触发额外 API）

### R9: 自动定位
- 切换编辑器 Tab 时，自动在文件树中选中对应文件节点
- 选中时滚动到可见区域（`scrollIntoView`）
- 可配置关闭（`explorer.autoReveal: false`）

### R10: Tab Pin 固定
- Tab 右键菜单增加"固定"选项
- 固定 Tab 有视觉区分（如左侧色条或 Pin 图标）
- 固定 Tab 不被"关闭其他"/"关闭已保存"/"关闭右侧"关闭
- 固定 Tab 排在非固定 Tab 前面
- 固定状态持久化到 localStorage（per bookId）

### R11: Tab 操作扩展
- 右键菜单增加"拆分到右侧"子菜单（上/下/左/右）
- 右键菜单增加"在新窗口打开"（后续版本，需要 Electron 支持）
- 双击文件树文件 = 在当前 Tab 打开（替换预览 Tab）

### R12: 面包屑增强
- 面包屑中的文件夹段可点击，弹出该目录下的文件列表供选择
- 点击后跳转到选中的文件（打开 Tab）
- 面包屑显示完整文件路径段（书名 > 目录 > 子目录 > 文件名）

### R13: 编辑器操作栏
- Tab 栏右侧增加操作按钮区域（`.editor-actions`）
- 默认按钮：更多操作（下拉菜单：全部关闭/关闭已保存/全部折叠/全部展开）
- 后续可扩展：Split 按钮、Lock 按钮

### R14: 章节功能条件化
- WorkbenchCanvas 中以下功能的渲染条件从 `kind === "chapter"` 改为 `metadata.isChapter === true`：
  - 变体生成按钮
  - 章节蓝图按钮
  - Tab 键 AI 续写
  - 变体对比面板
  - ChapterToolbar 体检工具栏
  - ChapterActionsBar
- 非章节文件（kind="file"）打开后只显示纯编辑器，无章节专属操作栏

### R15: 图片及更多格式预览
- 扩展 `OPENABLE_EXT`：增加 `.png`、`.jpg`、`.jpeg`、`.gif`、`.svg`、`.webp`
- 图片文件用 `<img>` 标签渲染预览（只读）
- `.pdf` 暂不支持（需要 PDF.js，后续版本）
- 不支持的扩展名显示"不支持预览"占位符 + 文件大小信息

### R16: 叙事记忆可见入口
- 左侧 ActivityBar 增加“叙事记忆”入口，作为 IDE 侧边栏视图之一，用户能从写作工作台直接打开。
- 叙事记忆面板展示最近一次 `buildNarrativeContext` 的 diagnostics：purpose、chapterNumber、totalMs、totalEstimatedTokens、warnings。
- 面板展示各 retrieval channel 的状态：channel、status、latencyMs、candidateCount、returnedCount、estimatedTokens。
- 面板展示预算结果：injectedTokensByChannel、droppedCount、degradedCount。
- 若 diagnostics 包含 wave 字段，展示 logicDepth、entropy、activatedTags、rerank/fallback 摘要。
- 面板展示 pending NarrativeEvents：eventType、entity、confidence、risk、evidence、chapterNumber。
- 没有 retrieval log 时不得显示空白或报错堆栈，必须提示“还没有叙事记忆记录，请先运行一次写作”。
- 第一版只读展示，不提供 approve/reject，以免扩大写作状态修改范围。

## Non-Goals
- 不支持外部文件拖入上传（需要文件系统写入 API）
- 不支持多根工作区（NovelFork 单书模式）
- 不支持文件对比（Select for Compare）
- 不支持撤销/重做文件操作（需要 BulkEditService）
- 不支持文件嵌套（File Nesting）
- 不支持压缩文件夹（Compact Folders）

## Success Criteria
- `chapters/` 下的 `.md` 文件 `kind === "chapter"` + `metadata.isChapter === true`
- 其他目录文件 `kind === "file"`，不触发章节专属功能
- 右键菜单根据节点类型显示不同选项
- 文件可拖拽移动到其他文件夹
- Tab 可固定，固定 Tab 不被批量关闭
- 图片文件可在编辑器中预览
- 左侧 ActivityBar 有“叙事记忆”入口，点击后能看到 diagnostics 或明确空状态
- 有 retrieval log 时，叙事记忆面板能展示 channels、tokens、warnings、pending events
- typecheck 零错误
