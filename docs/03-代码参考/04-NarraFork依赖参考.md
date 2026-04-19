# NarraFork 依赖参考

**版本**: v0.1.17  
**创建日期**: 2026-04-20  
**更新日期**: 2026-04-20  
**状态**: ✅ 已完成

---

## 说明

本文件记录 NarraFork v0.1.17 的依赖结构，用来帮助判断 NovelFork 应向什么样的平台靠拢。

重点不是逐包照抄，而是观察 NarraFork 已经验证过的能力组合：
- Bun 运行时
- Hono 本地服务
- better-sqlite3 + drizzle 数据层
- React 19 前端
- MCP、PTY、浏览器抓取、拖拽、流程图、i18n 等外围基础设施

## 运行时依赖（按能力分组）

### 1. 基础框架
- `react` / `react-dom`
- `hono`
- `zod`

### 2. 本地数据库与结构化存储
- `drizzle-orm`
- （开发依赖）`better-sqlite3`

### 3. 交互与界面
- `@mantine/core`
- `@mantine/hooks`
- `@mantine/notifications`
- `@tabler/icons-react`
- `@dnd-kit/core`
- `@dnd-kit/sortable`
- `@dnd-kit/utilities`
- `@xyflow/react`
- `@dagrejs/dagre`
- `broad-infinite-list`
- `react-easy-crop`

### 4. 路由与数据请求
- `@tanstack/react-query`
- `@tanstack/react-router`

### 5. 终端与 PTY
- `bun-pty`
- `@xterm/xterm`
- `@xterm/addon-fit`
- `@xterm/addon-serialize`
- `@xterm/headless`

### 6. MCP / Agent 工具生态
- `@modelcontextprotocol/sdk`
- `ws`

### 7. 抓取与内容提取
- `puppeteer-core`
- `@mozilla/readability`
- `linkedom`
- `sanitize-html`
- `gray-matter`
- `chardet`
- `iconv-lite`
- `https-proxy-agent`

### 8. Markdown / 数学 / 高亮
- `react-markdown`
- `remark-gfm`
- `remark-math`
- `rehype-katex`
- `katex`
- `shiki`

### 9. 代码解析与语言处理
- `tree-sitter-bash`
- `web-tree-sitter`
- `lang-map`

### 10. 其他基础设施
- `@parcel/watcher`
- `archiver`
- `diff`
- `flowtoken`
- `nanoid`
- `pixi.js`
- `selfsigned`

## 开发依赖（关键项）

- `typescript`
- `vite`
- `@vitejs/plugin-react`
- `vite-plugin-pwa`
- `@types/bun`
- `drizzle-kit`
- `@biomejs/biome`
- `postcss` / `postcss-preset-mantine` / `postcss-simple-vars`

## 对 NovelFork 的启示

### 值得重点参考
1. **Bun 运行时与单文件分发**
2. **better-sqlite3 + drizzle 的本地数据库组合**
3. **Hono + React 19 的本地应用壳**
4. **MCP / PTY / 浏览器工具形成的完整本地 AI 工作台能力**

### 不必机械照抄
1. Mantine（NovelFork 当前是 shadcn / Base UI）
2. TanStack Router（NovelFork 目前不一定需要立刻切）
3. 某些和通用 AI 编程工作台强相关、但与网文写作关联不大的外围能力

## 结论

NarraFork 的依赖结构说明：

> 它已经不是“Web IDE demo”，而是一套围绕 Bun、本地数据库、本地服务和单体分发设计的完整产品。

NovelFork 回归 NarraFork 路线时，应优先学习这种 **平台组合**，而不是只学表层 UI。
