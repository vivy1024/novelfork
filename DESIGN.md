# NovelFork Studio — Design System

> **"温暖的精密"** — 网文作者的专业创作工作台，兼具文学温度与工具效率。

---

## 1. Visual Theme & Atmosphere

**性格**: 温暖、沉稳、专业。像一间光线柔和的书房，桌上摊着稿纸和墨水瓶。
**密度**: 中等偏紧凑。作者模式稍宽松（16-24px 主间距），高级工作台模式紧凑（12-16px）。
**情绪**: 安静专注，不花哨。动效克制，只在需要反馈时出现。

**关键词**: 旧纸、墨红、琥珀烛光、黑曜石、纸纹理

---

## 2. Color Palette & Roles

使用 oklch 色彩空间，所有颜色通过 CSS 变量定义在 `src/index.css`。

### Light Mode — "Warm Parchment & Ink"

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `oklch(0.985 0.005 80)` | 暖色旧纸底色 |
| `--foreground` | `oklch(0.13 0.02 60)` | 深墨色正文 |
| `--card` | `oklch(1 0 0)` | 白色卡片/面板 |
| `--primary` | `oklch(0.45 0.12 25)` | 深牛血红/墨红 — 主操作、品牌色 |
| `--secondary` | `oklch(0.94 0.01 76)` | 柔纸影 — 次要按钮、背景 |
| `--muted` | `oklch(0.94 0.008 76)` | 褪色墨 — 禁用态、辅助文字 |
| `--accent` | `oklch(0.92 0.02 85)` | 淡金箔 — 高亮、hover |
| `--destructive` | `oklch(0.55 0.18 25)` | 红色 — 删除、错误 |
| `--border` | `oklch(0.84 0.01 76)` | 暖灰边框 |

### Dark Mode — "Obsidian & Candlelight"

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `oklch(0.12 0.01 250)` | 深黑曜石 |
| `--primary` | `oklch(0.78 0.14 85)` | 暖琥珀/烛光 — 主操作 |
| `--card` | `oklch(0.18 0.015 250)` | 浮石墨卡片 |
| `--accent` | `oklch(0.28 0.04 85)` | 暗金 |

### Status Colors（允许使用 Tailwind 原生色）

| 语义 | 色系 | 用法 |
|------|------|------|
| Success | `emerald-500/600` | 已完成、已通过、已启用 |
| Warning | `amber-500/600` | 待处理、需注意 |
| Error | `destructive` token 或 `red-500` | 失败、阻断 |

---

## 3. Typography Rules

### Font Stack

| 用途 | 字体 | CSS 变量 |
|------|------|---------|
| UI 正文 | DM Sans 400-700 | `--font-sans` |
| 标题/文学 | Instrument Serif (italic) | `--font-serif` |
| 代码/数据 | JetBrains Mono 400-500 | `--font-mono` |

### Type Scale

| 元素 | 大小 | 字重 | 字体 |
|------|------|------|------|
| Body | 15px | 450 | sans |
| Small / Caption | 12-13px | 400 | sans |
| h1 | 2.25rem | 500, italic | serif |
| h2 | 1.75rem | 500 | serif |
| h3 | 1.25rem | 500 | serif |
| Button | 14px (text-sm) | 500 | sans |
| Badge / Tag | 10-12px | 600 | sans |
| Code | 13px | 400 | mono |

### Rules

- 标题用 serif，正文和 UI 控件用 sans
- 标题 `letter-spacing: -0.02em`，正文默认
- `line-height: 1.6` 全局基准
- 中文内容不要 italic（Instrument Serif italic 仅用于英文标题）

---

## 4. Component Stylings

### Button

| 尺寸 | 高度 | 内边距 | 圆角 |
|------|------|--------|------|
| xs | 24px (h-6) | px-2 | rounded-md (8px) |
| sm | 28px (h-7) | px-2.5 | rounded-md (8px) |
| default | 32px (h-8) | px-2.5 | rounded-lg (12px) |
| lg | 36px (h-9) | px-2.5 | rounded-lg (12px) |

**变体**: default (primary 填充), outline (边框), secondary (浅色填充), ghost (透明), destructive (红色浅底), link (下划线)

**交互**: hover 降低 10% 不透明度, active `scale(0.97)`, disabled `opacity-50`

### Card / Panel

- 背景: `bg-card`
- 边框: `border border-border`
- 圆角: `rounded-lg` (8px)
- 内边距: `p-3` (12px) 紧凑 / `p-4` (16px) 标准
- 阴影: 默认无阴影（扁平），hover 或浮动面板用 `shadow-3d`

### Input / Select

- 高度: 32px (h-8) default, 28px (h-7) sm
- 背景: `bg-transparent` 或 `bg-input`
- 边框: `border border-input`
- 圆角: `rounded-lg` (8px)
- Focus: `ring-3 ring-ring/50 border-ring`

### Badge / Tag

- 高度: 自适应
- 内边距: `px-1.5 py-0.5`
- 圆角: `rounded` (4px) 或 `rounded-md` (6px)
- 字号: `text-[10px]` 或 `text-xs`
- 字重: `font-semibold`

### Navigation Item

- 高度: 自适应
- 内边距: `px-3 py-1.5`
- 圆角: `rounded-md` (6px)
- Active: `bg-primary/10 text-primary font-medium`
- Hover: `bg-muted text-foreground`

---

## 5. Layout Principles

### Spacing Scale (4px base grid)

| Token | Value | Usage |
|-------|-------|-------|
| 1 | 4px | 图标与文字间距 |
| 1.5 | 6px | 紧凑按钮间距 |
| 2 | 8px | 组件内部小间距 |
| 3 | 12px | **主间距** — 卡片间、列表项间 |
| 4 | 16px | 面板内边距、区块间距 |
| 6 | 24px | 大区块间距 |
| 8 | 32px | 页面级间距 |

### Grid

- **三栏工作台**: `16rem / 1fr / 24rem`，gap-3 (12px)
- **设置页**: `15rem / 1fr`，gap-3 (12px)
- **主壳**: 左侧 sidebar `w-52` (208px) + 右侧 `flex-1`
- **内容区**: `max-w-7xl` (80rem) 居中，`p-4` (16px)

### Responsive

- `xl:` 三栏布局生效
- `lg:` 设置页双栏生效
- 小屏幕单栏堆叠

---

## 6. Depth & Elevation

### Shadow Tokens

| Token | Usage |
|-------|-------|
| `--shadow-sm` | 微浮起 — tooltip, badge |
| `--shadow-md` | 中等浮起 — dropdown, popover |
| `--shadow-lg` | 高浮起 — modal, dialog |
| `--shadow-3d` | 纸张感 — glass-panel, paper-sheet |
| `--shadow-3d-hover` | 纸张 hover — paper-sheet:hover |

### Surface Hierarchy

1. **Background** — 页面底色（暖纸/黑曜石）
2. **Card** — 内容面板（白色/浮石墨）
3. **Popover** — 浮动面板（同 card + shadow-md）
4. **Overlay** — 模态遮罩（`bg-background/60 backdrop-blur-sm`）

### Rules

- 默认卡片**不加阴影**，用边框区分层级
- 浮动面板（popover/dropdown）加 `shadow-md`
- 模态/对话框加 `shadow-lg`
- `.glass-panel` 用 `backdrop-blur` + 半透明背景
- `.paper-sheet` hover 时上浮 4px + 边框变 primary

---

## 7. Do's and Don'ts

### Do

- 用语义 token（`bg-card`, `text-foreground`, `border-border`），不用硬编码 hex
- 间距用 Tailwind 的 4px 网格（`gap-3`, `p-4`），不用奇数值（`p-[13px]`）
- 圆角用 `rounded-md` / `rounded-lg`，不用 `rounded-[7px]`
- 状态色（success/warning/error）可以用 Tailwind 原生色（emerald/amber/red），但用 `/10` 透明度做背景
- 标题用 serif 字体，UI 控件用 sans
- 保持纸纹理叠加（`body::before` SVG noise）

### Don't

- 不用纯黑 `#000` 或纯白 `#fff` 做文字/背景（用语义 token）
- 不用 `rounded-full` 做按钮（那是头像和 badge 的）
- 不加过多阴影层级 — 这是纸面工作台，不是 Material Design
- 不用大面积高饱和色块 — 保持墨水+旧纸的克制感
- 不在正文区域用 serif 字体（serif 只用于标题和文学展示）
- 不用 `!important`
- 不在组件中硬编码 `oklch()` 值 — 走 CSS 变量

---

## 8. Responsive Behavior

| Breakpoint | Layout |
|------------|--------|
| < 1024px | 单栏，sidebar 折叠 |
| 1024-1280px | 双栏（sidebar + content） |
| ≥ 1280px | 三栏工作台（explorer + editor + narrator） |

- 触摸目标最小 32px (h-8)
- 移动端 sidebar 变为 overlay drawer
- 叙述者面板在小屏幕下折叠为底部 sheet

---

## 9. Agent Prompt Guide

当 AI 生成 NovelFork Studio 的 UI 代码时：

1. **先读 `src/index.css`** 确认当前 CSS 变量
2. **用 Tailwind class** 引用语义色（`bg-card`, `text-muted-foreground`），不写内联样式
3. **间距用 3/4 为主**（`gap-3`, `p-4`），紧凑场景用 2，宽松场景用 6
4. **圆角用 `rounded-md` 或 `rounded-lg`**，不用 arbitrary values
5. **新组件先看现有组件的 class 模式**，保持一致
6. **状态反馈用颜色+图标**，不只靠颜色（无障碍）
7. **中文文案优先**，英文仅用于技术标识符
