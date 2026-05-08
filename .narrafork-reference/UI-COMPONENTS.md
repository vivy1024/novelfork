# NarraFork UI 组件结构参考（DOM 爬取 2026-05-08）

## 整体布局

```
AppShell (Mantine)
├── Header: 标题 + 版本badge + 搜索框 + 用量
├── Navbar (左侧导航):
│   ├── 仪表盘 (/)
│   ├── 叙事线 (/projects) — 展开项目列表
│   ├── 叙述者 — 展开会话列表 + 新建按钮
│   ├── 套路 (/routines)
│   ├── 设置 (/settings)
│   └── 退出登录 + 版本号
└── Main:
    └── 项目页: react-flow 图 + 章节节点（每个节点是完整对话窗口）
```

## 章节节点（对话窗口）结构

```
Card (border-color: green-4, flex-direction: column)
├── DragHandle (cursor: grab, flex-shrink: 0, padding: 6px 8px)
│   └── Group (justify: space-between)
│       ├── Text (fw: 600, truncate): "spec任务4"
│       └── Group: Badge("活跃") + ActionIcon(最小化)
│
└── Content (flex: 1, overflow: hidden, border-top: 1px solid dark-4)
    └── Stack (gap: 0, height: 100%)
        ├── [0] 顶部工具栏
        ├── [1] 消息列表（flex: 1, overflow）
        ├── [2] 底部状态栏（Git 信息）
        ├── [3] 容器面板（隐藏，opacity: 0）
        ├── [4] Git 面板（隐藏，opacity: 0）
        ├── ... 状态指示器 + Composer
        └── Composer
```

## 顶部工具栏

```
Group (justify: space-between, border-bottom, padding-inline: md, padding-block: xs)
├── Left Group (flex: 1):
│   ├── ActionIcon(external-link) — 在新标签打开
│   └── Group:
│       ├── Text(sm, fw:500, truncate, cursor:pointer): "spec任务4" — 标题
│       ├── ActionIcon(pencil, xs): 编辑标题
│       └── ActionIcon(sparkles, xs): 生成标题
└── Right Group:
    ├── ActionIcon(search): 搜索
    ├── ActionIcon(code-off): 代码折叠
    ├── ActionIcon(photo): 图片
    ├── ActionIcon(file-code): 文件
    ├── ActionIcon(info-circle): 信息
    └── ActionIcon(archive): 归档
```

## 底部状态栏（Git 信息）

```
Group (justify: space-between, border-bottom, bg: gray-0/dark-7, padding-inline: md, padding-block: 0.25rem)
├── Left Group (gap: 0.375rem, flex: 1):
│   ├── Text(xs, fw:500, truncate): "spec任务4" — 章节名
│   ├── Text(xs, dimmed): "·"
│   ├── Text(xs, dimmed, mono, truncate): "chapter/spec任务4-XvCRK-" — Git 分支
│   └── Button(unstyled):
│       └── Badge(light, xs, blue, leftSection=GitCommitIcon): "3" — 变更数
└── Right Group (flex-shrink: 0):
    └── ActionIcon 组（复制/fork/设置等）
```

## 状态指示器（Composer 上方）

```
Group (gap: 0.375rem, flex-shrink: 0)
├── Dot (border-radius: 50%, bg: gray-filled, 0.5rem × 0.5rem) — 状态圆点
├── Text(xs, dimmed, truncate): "空闲" — 主状态
└── Text(xs, dimmed, flex-shrink: 0): "· 上轮耗时 1:05" — 耗时
```

状态圆点颜色：
- gray: idle（空闲）
- blue: working（工作中）
- yellow: waiting（等待中）
- green: unread（已完成）
- red: error（错误）
- orange: interrupted（已中断）

## Composer（输入区）

```
div (flex-shrink: 0, padding-inline: md, padding-bottom: xs)
├── input[type=file, multiple, display:none] — 隐藏文件选择器
└── Group (gap: xs, align: end, wrap: nowrap)
    ├── ActionIcon(subtle, paperclip): 附件按钮
    ├── div (flex: 1):
    │   └── Textarea (placeholder: "发送消息...", rows: 2)
    └── Button: "继续" (idle) / "中断" (working)
```

**关键：Composer 里没有模型/权限下拉！** 模型和权限切换在别处。

## 消息渲染

### 推理块
```
Group (align: start)
├── ThemeIcon (variant: light) — 🔮 图标
├── Text: "推理"
└── Text(dimmed): "— **考虑 Git 命令** 我在考虑..." — 摘要预览（可点击展开）
```

### 工具调用块
```
div#tool-use-call_xxx
└── div
    └── div
        ├── Button(unstyled) — 可点击展开/折叠
        │   └── Group
        │       ├── ThemeIcon — 工具图标（颜色按状态：green=成功）
        │       ├── Text: "Bash" — 工具名
        │       ├── Text(title="查看工作树状态"): "查看工作树状态" — 描述
        │       └── Group:
        │           ├── Text: "881ms" — 耗时
        │           └── span: "/ 2m" — 上下文占用
        └── div (展开内容)
            ├── pre.mantine-Code-root: "$ git status --short" — 命令（终端风格）
            ├── Text: "输出"
            └── pre.mantine-Code-root: "M packages/..." — 输出内容
        └── Divider — 分隔线
```

### 消息列表容器
```
div.broad-message-list
└── div.broad-message-list-inner
    └── div (每条消息)
        └── div#msg-xxx
```

## 关键设计决策

1. **对话窗口嵌入 react-flow 节点** — 不是独立页面，是图中的可拖拽卡片
2. **Composer 极简** — 只有 📎 + textarea + 一个按钮（继续/中断）
3. **模型/权限不在 Composer** — 在顶部工具栏或状态栏的其他位置
4. **工具调用用 Mantine Code 组件** — `pre.mantine-Code-root` 渲染命令和输出
5. **状态圆点** — 0.5rem 圆形 div，颜色表示状态
6. **Git 分支用 monospace 字体** — `font-family: var(--mantine-font-family-monospace)`
7. **变更数用 Badge** — `Badge(light, xs, blue)` + GitCommit 图标
8. **面板折叠** — 容器/Git/快照面板默认 `opacity: 0; height: 0; overflow: hidden`
