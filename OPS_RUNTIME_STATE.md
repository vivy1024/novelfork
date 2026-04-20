# NovelFork 运维状态

**最后更新**: 2026-04-20

---

## 当前状态

| 组件 | 状态 | 备注 |
|------|------|------|
| 核心写作引擎 | ✅ 可用 | core 构建与 typecheck 通过 |
| CLI 入口 | ✅ 可用 | `novelfork studio` 已优先走 Bun 主入口 |
| Studio 工作台 | ✅ 可构建 | client/server 构建通过，legacy 入口已降级为兼容桥 |
| Bun 主入口 | ✅ 可用 | `bun run main.ts` 可启动并优先使用 embedded assets |
| 单文件产物 | ✅ 可用 | `pnpm bun:compile` 已生成 `dist/novelfork.exe`，且 smoke 运行通过 |
| 测试主链 | ✅ 基本收绿 | CLI typecheck 与关键测试已通过，Studio pack 主链通过 |
| 平台迁移 | 🔄 进行中 | 已推进到深层执行链去 Node 化阶段 |

---

## 已确认事实

- 当前项目身份是 **NovelFork**，不是 InkOS
- 核心写作能力大量已实现，可复用
- 当前主要问题在平台外壳：`pnpm + tsc + CLI spawn studio + Node`
- 当前目标是回归 **Bun 单入口 + bun compile 单可执行文件** 路线

---

## 当前待办

- [ ] 收剩余边角主路径 Node 绑定（如 `cli studio` 的主服务启动部分）
- [ ] 继续推进深层执行链去 Node 化（MCP / Bash / Git 已完成第一轮 adapter 接入）
- [ ] 评估 `sqlite-driver` 从 `createRequire` 迁到更干净的 Bun/Node 运行时探测方式
- [ ] 清理 Studio 非主链历史 typecheck 旧债
- [ ] 开始整理分发与安装体验（产物命名、首次启动、配置目录）

---

## 参考文档

- `docs/02-核心架构/01-系统架构/03-平台纠偏说明.md`
- `docs/04-开发指南/05-调研规划/01-平台迁移方案.md`
- `docs/03-代码参考/04-NarraFork依赖参考.md`
