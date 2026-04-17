# NovelFork 依赖清单

生成时间：2026-04-18

## 根目录依赖

### 生产依赖
- `@tiptap/core@2.27.2` - 富文本编辑器核心
- `@tiptap/extension-text-style@3.22.3` - Tiptap 文本样式扩展
- `@tiptap/pm@2.27.2` - ProseMirror 核心
- `@tiptap/react@3.22.3` - Tiptap React 绑定
- `@tiptap/starter-kit@3.22.3` - Tiptap 基础扩展包
- `glob@13.0.6` - 文件模式匹配
- `idb@8.0.3` - IndexedDB 封装
- `novel@1.0.2` - 小说编辑器组件
- `tiktoken@1.0.22` - OpenAI token 计数

### 开发依赖
- `@playwright/test@1.59.1` - E2E 测试框架
- `esbuild@0.28.0` - JavaScript 打包工具

## packages/core 依赖

### 生产依赖
- `@anthropic-ai/sdk@0.78.0` - Anthropic Claude API SDK
- `@modelcontextprotocol/sdk@1.0.4` - MCP 协议 SDK
- `dotenv@16.4.0` - 环境变量加载
- `eventsource@2.0.2` - SSE 客户端
- `js-yaml@4.1.1` - YAML 解析器
- `openai@4.80.0` - OpenAI API SDK
- `zod@3.24.0` - TypeScript schema 验证

### 开发依赖
- `@types/eventsource@1.1.15` - eventsource 类型定义
- `@types/js-yaml@4.0.9` - js-yaml 类型定义
- `typescript@5.7.0` - TypeScript 编译器
- `vitest@3.0.0` - 单元测试框架

## packages/cli 依赖

### 生产依赖
- `@vivy1024/novelfork-core@workspace:*` - NovelFork 核心引擎（workspace 依赖）
- `@vivy1024/novelfork-studio@workspace:*` - NovelFork Studio（workspace 依赖）
- `commander@13.0.0` - CLI 框架
- `dotenv@16.4.0` - 环境变量加载
- `epub-gen-memory@1.0.10` - EPUB 生成器
- `marked@15.0.0` - Markdown 解析器

### 开发依赖
- `@types/node@22.0.0` - Node.js 类型定义
- `typescript@5.7.0` - TypeScript 编译器
- `vitest@3.0.0` - 单元测试框架

## packages/studio 依赖

### 生产依赖
- `@vivy1024/novelfork-core@workspace:*` - NovelFork 核心引擎（workspace 依赖）
- `@base-ui/react@1.3.0` - Base UI React 组件
- `@dnd-kit/core@6.3.1` - 拖拽核心
- `@dnd-kit/sortable@10.0.0` - 拖拽排序
- `@dnd-kit/utilities@3.2.2` - 拖拽工具
- `@fontsource-variable/geist@5.2.8` - Geist 字体
- `@hono/node-server@1.13.0` - Hono Node.js 适配器
- `@tauri-apps/api@2.10.1` - Tauri API
- `@tauri-apps/plugin-process@2.3.1` - Tauri 进程插件
- `@tauri-apps/plugin-updater@2.10.1` - Tauri 更新插件
- `@types/react-grid-layout@2.1.0` - react-grid-layout 类型定义
- `class-variance-authority@0.7.1` - CSS 类变体工具
- `clsx@2.1.1` - 条件类名工具
- `cmdk@1.1.1` - 命令面板组件
- `dotenv@16.4.0` - 环境变量加载
- `hono@4.7.0` - Web 框架
- `lucide-react@0.577.0` - 图标库
- `novel@1.0.2` - 小说编辑器组件
- `react@19.0.0` - React 核心
- `react-dom@19.0.0` - React DOM
- `react-grid-layout@2.2.3` - 网格布局
- `react-resizable@3.1.3` - 可调整大小组件
- `shadcn@4.0.8` - shadcn/ui 组件
- `tailwind-merge@3.5.0` - Tailwind 类合并
- `tiptap-markdown@0.8.10` - Tiptap Markdown 扩展
- `tw-animate-css@1.4.0` - Tailwind 动画
- `zustand@5.0.12` - 状态管理

### 开发依赖
- `@tailwindcss/vite@4.0.0` - Tailwind Vite 插件
- `@tiptap/core@2.27.2` - Tiptap 核心
- `@tiptap/pm@2.27.2` - ProseMirror
- `@types/node@22.0.0` - Node.js 类型定义
- `@types/react@19.0.0` - React 类型定义
- `@types/react-dom@19.0.0` - React DOM 类型定义
- `@types/ws@8.18.1` - WebSocket 类型定义
- `@vitejs/plugin-react@4.4.0` - Vite React 插件
- `autoprefixer@10.4.0` - CSS 自动前缀
- `tailwindcss@4.0.0` - Tailwind CSS
- `tsx@4.20.6` - TypeScript 执行器
- `typescript@5.7.0` - TypeScript 编译器
- `vite@6.0.0` - 构建工具
- `vite-plugin-pwa@1.2.0` - PWA 插件
- `vitest@3.0.0` - 单元测试框架
- `workbox-window@7.4.0` - Service Worker 工具
- `ws@8.20.0` - WebSocket 服务器

## 依赖说明

### 版本固定策略
所有依赖版本已固定（移除 `^` 和 `~` 前缀），确保构建可重现性。

### Workspace 依赖
- `packages/cli` 依赖 `packages/core` 和 `packages/studio`
- `packages/studio` 依赖 `packages/core`
- 使用 pnpm workspace 协议管理内部依赖

### 核心技术栈
- **运行时**: Node.js >=22.5.0
- **包管理器**: pnpm >=9.0.0
- **语言**: TypeScript 5.7.0
- **前端框架**: React 19.0.0
- **构建工具**: Vite 6.0.0
- **Web 框架**: Hono 4.7.0
- **测试框架**: Vitest 3.0.0
- **AI SDK**: Anthropic SDK 0.78.0, OpenAI SDK 4.80.0

### 未使用依赖检查
所有列出的依赖均在项目中实际使用，未发现冗余依赖。
