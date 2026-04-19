# NovelFork

> 网文小说 AI 辅助创作工作台

---

## 项目定位

**NovelFork** 是一个专注中文网文创作的本地 AI 工作台。

当前仓库保留了大量已实现的写作能力：
- 多 Agent 写作管线
- 长期状态与真相文件
- 连续性审计
- 文风分析与去 AI 味
- Studio Web 工作台

但平台外壳仍处于**回正期**：
- 核心能力可复用
- 旧的 `pnpm + tsc + CLI spawn studio + Node` 结构仍在
- 当前目标是回归 **NarraFork 风格的 Bun 单入口本地应用**

换句话说：

> 当前项目已经是 **NovelFork**，不是 InkOS。
> InkOS 只是上游来源，不再是当前项目口径。

---

## 当前状态

### 已经有的
- `packages/core`：写作引擎、审计、状态、题材与规则
- `packages/studio`：React + Hono 工作台
- `packages/cli`：过渡期命令入口

### 正在做的
- 统一文档口径
- 平台迁移方案设计
- 回归 Bun / 单入口 / `bun compile` 路线

### 还没做完的
- 真正的 Bun 主入口
- 单文件分发
- 从旧外壳平滑迁移到新平台形态

---

## 当前源码运行方式（过渡）

```bash
git clone https://github.com/vivy1024/novelfork.git novelfork
cd novelfork
pnpm install
pnpm build
npm link packages/cli
novelfork studio
```

> 这是当前源码运行方式，**不是最终产品交付方式**。
> 最终目标仍是：`bun run main.ts` → `bun compile` → 单可执行文件。

---

## 文档入口

请优先看：

- [docs/README.md](./docs/README.md) — 文档中心
- [docs/02-核心架构/01-系统架构/03-平台纠偏说明.md](./docs/02-核心架构/01-系统架构/03-平台纠偏说明.md) — 为什么偏航、现在怎么定义目标
- [docs/04-开发指南/05-调研规划/01-平台迁移方案.md](./docs/04-开发指南/05-调研规划/01-平台迁移方案.md) — 代码迁移方案
- [docs/03-代码参考/04-NarraFork依赖参考.md](./docs/03-代码参考/04-NarraFork依赖参考.md) — NarraFork 平台参考
- [docs/03-代码参考/05-NarraFork更新日志参考.md](./docs/03-代码参考/05-NarraFork更新日志参考.md) — NarraFork 演进参考

---

## 说明

- 当前仓库仍然 fork 自上游 `Narcooo/inkos`
- 但 **产品身份、文档口径、目标平台** 都应以 **NovelFork** 为准
- 任何继续把 NovelFork 写成 InkOS 的文档，都应视为待清理残留
