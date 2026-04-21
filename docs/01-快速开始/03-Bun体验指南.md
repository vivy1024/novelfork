# Bun体验指南

**版本**: v1.0.0  
**创建日期**: 2026-04-20  
**更新日期**: 2026-04-21  
**状态**: 🔄 以当前源码事实为准

---

## 这份文档解决什么问题

如果你现在要体验 NovelFork 的 Bun 路线，这份文档只回答两件事：

1. **现在源码该怎么跑**
2. **现在 compile 链路能做到什么、还没做到什么**

---

## 先记住一句话

当前真实口径是：

> **Bun 主入口已经存在并可作为源码主路径使用；`novelfork studio` 仍是过渡期拉起方式；`pnpm bun:compile` 只是构建链路，不代表正式分发已完成。**

---

## 1. 最推荐的体验方式：直接跑 Bun 主入口

```bash
bun run main.ts --root=. --port=4567
```

预期现象：

- 控制台出现 `NovelFork Studio running on http://localhost:4567`
- 若 embedded 资源存在，会看到 `Using embedded Studio assets`
- 若 embedded 不存在但 `packages/studio/dist` 存在，会走 filesystem fallback

然后打开：

- `http://localhost:4567`

这是当前最适合验证运行时行为的方式。

---

## 2. 通过 CLI 走主入口

```bash
novelfork studio --port 4567
```

当前这条命令的职责不是继续当“正式运行时入口”，而是：

- 优先寻找仓库根 `main.ts`
- 命中后执行 `bun run <main.ts> --root=<project>`
- 只有 Bun 主入口不可用时，才回退到 legacy Studio package 入口

也就是说，它现在更像：

> **Bun 主入口的过渡期启动器。**

---

## 3. compile 链路现在怎么用

### 3.1 执行命令

```bash
pnpm bun:compile
```

它会顺序执行：

1. `pnpm bun:build-client`
2. `pnpm bun:embed-assets`
3. `bun build ./main.ts --compile --outfile dist/novelfork`

### 3.2 这条链路当前能证明什么

能证明：

- 仓库里已经接好了 compile 构建脚本
- embedded assets 会在 compile 前生成
- 产物目标是 `dist/novelfork`（Windows 下一般表现为 `dist/novelfork.exe`）

### 3.3 这条链路当前**不能**证明什么

当前还不能直接写成已完成的能力：

- 不能宣称安装器已完成
- 不能宣称自动更新已完成
- 不能宣称所有平台 smoke 已沉淀
- 不能宣称正式分发体验已经闭环

所以现在更准确的说法是：

> **compile 构建路径已接线，可用于本地验证；正式分发仍在 Phase H。**

---

## 4. 什么时候需要先 build client / embed assets

### 直接跑源码时

如果仓库里已经有可用的 embedded 资源，`bun run main.ts` 会优先直接使用。

如果没有，则会尝试回退到：

- `packages/studio/dist/index.html`

如果你看到前端资源缺失告警，再执行：

```bash
pnpm bun:build-client
pnpm bun:embed-assets
```

### 跑 compile 时

不用手动补，`pnpm bun:compile` 已经把这两步串起来了。

---

## 5. 体验时最值得看的不是“能不能编译”，而是这些事实

### 运行时事实

- `main.ts` 是当前源码主入口
- `novelfork studio` 优先转交给 `main.ts`
- embedded assets 与 filesystem fallback 都已接线

### 未完成事实

- 启动期全局迁移 / 索引恢复 orchestrator 还没有
- 首次启动产品化体验还没有
- 正式分发闭环还没有

相关清单：

- `docs/06-部署运维/01-当前运行与启动方式.md`
- `docs/06-部署运维/03-启动期迁移与修复清单.md`
- git 日志 / 相关运维文档 / 记忆记录

---

## 6. 建议体验顺序

### 最小体验

1. `bun run main.ts --root=. --port=4567`
2. 打开 `http://localhost:4567`
3. 验证页面能否正常加载

### 想顺便看 compile 链路

1. `pnpm bun:compile`
2. 查看 `dist/novelfork` 是否生成
3. 把它当作本地构建结果验证，不把它当成“正式分发已完成”

---

## 一句话总结

如果你现在要体验 NovelFork 的 Bun 路线，优先这样做：

```bash
bun run main.ts --root=. --port=4567
```

如果你要验证打包链路，再执行：

```bash
pnpm bun:compile
```
