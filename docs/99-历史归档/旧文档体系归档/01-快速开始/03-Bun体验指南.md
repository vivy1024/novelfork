# Bun体验指南

**版本**: v1.0.0
**创建日期**: 2026-04-28
**更新日期**: 2026-04-28
**状态**: 🗄️ 历史归档
**文档类型**: archived

---

> 归档日期：2026-04-28。归档原因：旧文档体系迁移，仅供历史追溯；当前事实请从新文档中心入口查阅。

## 这份文档解决什么问题

如果你现在就想**亲手跑 NovelFork 的 Bun 主入口**，并体验当前已经完成的：

- Bun 单入口
- embedded 前端资源
- `bun compile` 单文件产物

就按这份文档做。

---

## 当前你可以实际体验的 3 条路径

### 1. 直接跑 Bun 主入口

```bash
bun run main.ts --root=. --port=4567
```

预期日志：

```text
[bun:main] Using embedded Studio assets.
NovelFork mode: standalone
NovelFork Studio running on http://localhost:4567
```

然后浏览器打开：

- `http://localhost:4567`

---

### 2. 通过 CLI 走主入口

```bash
novelfork studio --port 4567
```

当前 `novelfork studio` 已经优先走：

- 根 `main.ts`
- Bun 主入口

它不再优先把 `packages/studio/src/api/index.ts` 当成正式入口。

---

### 3. 生成单文件产物

```bash
pnpm bun:compile
```

预期产物：

- `dist/novelfork.exe`

---

## 推荐体验顺序

### 第一步：先生成 embedded 资源并编译

```bash
pnpm bun:compile
```

这一步会自动执行：

1. `pnpm bun:build-client`
2. `pnpm bun:embed-assets`
3. `bun build ./main.ts --compile --outfile dist/novelfork`

也就是说你**不需要自己手动先 build client**。

---

### 第二步：直接运行 exe

```bash
./dist/novelfork.exe --root=. --port=4567
```

如果你在 Windows PowerShell / CMD：

```powershell
.\dist\novelfork.exe --root=. --port=4567
```

预期日志：

```text
[bun:main] Using embedded Studio assets.
NovelFork mode: standalone
NovelFork Studio running on http://localhost:4567
```

---

### 第三步：验证它不依赖源码目录下的前端 dist

当前已经验证过：

- `dist/novelfork.exe` 可以在隔离目录下运行
- 主入口会优先使用 embedded assets
- 不再把 `packages/studio/dist` 当成唯一资源来源

所以你接下来体验时，重点看：

- 页面能不能正常打开
- 基础 API 是否可用
- 写作工作台是否能正常加载

---

## 当前推荐命令清单

### Bun 主入口

```bash
bun run main.ts --root=. --port=4567
```

### CLI 入口

```bash
novelfork studio --port 4567
```

### 只构建前端

```bash
pnpm bun:build-client
```

### 只生成 embedded 资源模块

```bash
pnpm bun:embed-assets
```

### 完整 compile

```bash
pnpm bun:compile
```

---

## 你现在体验时应该知道的事实

### 已经完成

- Bun 主入口已建立
- `novelfork studio` 已优先走 Bun 主入口
- embedded assets 已接线
- `bun compile` 已通过
- `dist/novelfork.exe` 已可运行

### 仍是过渡态

- 仍有部分历史测试/类型债未全清
- 仍有少量边角 Node 绑定留在测试与构建兜底层
- 还没有做安装器 / 自动更新 / 首次启动 UX 收尾

所以你现在体验到的，是：

> **一个已经可运行、可编译、可体验的 Bun-first NovelFork 原型**

而不是最终商业化打磨完成版。

---

## 建议你怎么体验

### 最小体验

1. 跑 `pnpm bun:compile`
2. 跑 `dist/novelfork.exe --root=. --port=4567`
3. 打开浏览器
4. 看首页是否正常加载
5. 试一次最小流程：
   - 书籍列表
   - 章节/工作台
   - 基础设置页

### 开发态体验

如果你还想直接看源码运行链：

```bash
bun run main.ts --root=. --port=4567
```

这样更适合边看日志边体验。

---

## 如果体验中遇到问题，优先看哪里

### 先看日志
看是否出现：

- `Using embedded Studio assets`
- `NovelFork Studio running on http://localhost:xxxx`

### 再看运维状态

- git 日志 / 相关运维文档 / 记忆记录

### 再看部署/运行说明

- `docs/06-部署运维/01-当前运行与启动方式.md`

---

## 一句话总结

如果你现在就要体验 NovelFork 的 Bun 路线，用这两个命令就够了：

```bash
pnpm bun:compile
./dist/novelfork.exe --root=. --port=4567
```
