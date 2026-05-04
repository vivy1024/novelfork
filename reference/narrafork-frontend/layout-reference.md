# NarraFork 前端布局参考

从 localhost:7778 实际运行的 NarraFork v0.3.4 提取。

## 整体布局

使用 Mantine AppShell 组件：
- `AppShell-root`: block, 1280x900
- `AppShell-header`: fixed, top:0, 1280x60 — 顶部标题栏
- `AppShell-navbar`: fixed, top:60, 250x840, flex-column — 左侧导航
- `AppShell-main`: padding-left:266px, padding-top:76px — 右侧内容区

```
┌─────────────────────────────────────────────────────────┐
│ Header (fixed, 1280x60)                                 │
│ NarraFork  v0.3.4更新  [搜索框]  [FPS/GPU/CPU/延迟]     │
├──────────┬──────────────────────────────────────────────┤
│ Navbar   │ Main (padding-left:266px, padding-top:76px)  │
│ (fixed   │                                              │
│  250x840)│ 内容区根据路由切换：                           │
│          │ - / → 仪表盘                                  │
│ 仪表盘   │ - /narrators/:id → 对话界面                   │
│ 叙事线 ≡ │ - /projects → 叙事线列表                      │
│  ├ 项目1 │ - /projects/:id → 叙事线详情                  │
│  ├ 项目2 │ - /routines → 套路                            │
│  └ ...   │ - /settings → 设置                            │
│ 叙述者 +≡│                                              │
│  ├ 会话1 │                                              │
│  ├ 会话2 │                                              │
│  └ ...   │                                              │
│ 套路     │                                              │
│ 设置     │                                              │
│ 退出登录 │                                              │
│ v0.3.4   │                                              │
└──────────┴──────────────────────────────────────────────┘
```

## Navbar 结构（250px 宽，flex-column）

| 区域 | 高度 | 内容 | overflow |
|------|------|------|----------|
| resize handle | 840px | 6px 宽的拖拽条（可调 navbar 宽度） | visible |
| 顶部导航 | 85px | 仪表盘 + 叙事线（带管理按钮 ≡） | visible |
| 叙事线列表 | 286px | 项目列表（可滚动） | auto |
| 叙述者标题 | 44px | 叙述者 + 新建按钮 + 管理按钮 | visible |
| 叙述者列表 | 250px | 会话列表（可滚动） | auto |
| 底部导航 | 82px | 套路 + 设置 | visible |
| 退出 | 41px | 退出登录 | visible |
| 版本 | 17px | v0.3.4 开源协议 | visible |

## NavLink 组件

每个导航项使用 Mantine NavLink：
- display: flex
- 宽度: 217px（navbar 250px - padding）
- 高度: 41-53px
- 结构: icon(16x16) + body(label+description) + [section(badge/button)]

## 叙事线列表项

每个项目是一个可点击的 div[role=button]：
- 高度: 41px
- 显示: 项目名
- 点击 → 导航到 /projects/:id

## 叙述者列表项

每个会话是一个可点击的 div[role=button]：
- 高度: 53px
- 显示: 会话名 + 绑定项目名（副标题）
- 点击 → 导航到 /narrators/:id

## 对话界面（/narrators/:id）

右侧 main 区域全宽渲染对话界面：
- 顶部: ← 返回 + 会话标题 + 编辑/生成标题 + 图标按钮组
- 中间: 对话流（消息+工具调用卡片内联）
- 底部: git 状态栏 + 变更/提交/暂存 + 输入框 + 模型/权限控件

## 叙事线详情页（/projects/:id）

右侧 main 区域渲染叙事线详情：
- 顶部: 项目名 + 状态 + 操作按钮（删除/清理/批量合并/命令/技能/套路/设置/新建章节）
- 中间: 章节列表（每个章节是一个对话会话，显示最近的对话内容）
- 章节 = git worktree 中的对话

## 关键 CSS 变量

NarraFork 使用 Mantine 的 CSS 变量系统：
- `--mantine-color-scheme`: light/dark
- 深色模式背景: #1a1b1e（OLED 模式: #000000）
- 导航项 active 状态: 蓝色高亮

## 技术栈

- React 19
- Mantine UI（AppShell, NavLink, ActionIcon, Button, Badge, ScrollArea, Modal, Tabs 等）
- TanStack Query（数据获取）
- i18next（国际化）
- highlight.js（代码高亮）
- 构建: Vite + Rolldown
