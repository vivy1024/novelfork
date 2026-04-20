# NovelFork 运维状态

**最后更新**: 2026-04-21

---

## 当前状态

| 组件 | 状态 | 备注 |
|------|------|------|
| 核心写作引擎 | ✅ 可用 | core 仍是主能力承载层 |
| CLI 入口 | ✅ 过渡可用 | `novelfork studio` 当前优先转交仓库级 `main.ts`，fallback 仍保留兼容桥 |
| Studio 工作台 | ✅ 源码可启动 | `main.ts` 可拉起 API + 静态资源服务 |
| Bun 主入口 | ✅ 可用 | `main.ts` 已是源码主入口，embedded assets 优先，filesystem dist 次级回退 |
| embedded assets | ✅ 已接线 | 由 `scripts/generate-embedded-assets.mjs` 生成 `embedded-assets.generated.ts` |
| compile 链路 | 🔄 已接线待持续验证 | `pnpm bun:compile` 会串联 client build / embed / bun compile，但不能等同于正式分发已完成 |
| 启动期修复编排 | ⚠️ 未集中化 | 当前只有最小项目初始化 + 按需惰性迁移/修复，没有启动时全量 orchestrator |

---

## 已确认事实

- 当前项目身份是 **NovelFork**，不是 InkOS
- 仓库根 `main.ts` 已经承担源码主入口职责
- `packages/studio/src/api/index.ts` 仍存在，但当前口径是**兼容桥**，不是主路径
- `novelfork studio` 还没有消失，但职责已收敛为**优先拉起 Bun 主入口**
- `pnpm bun:compile` 是当前仓内构建链路，不应写成安装器/正式分发能力
- 启动时自动动作目前只到“项目根目录初始化 + 启动静态资源服务”为止

---

## 当前待办

- [x] 启动期迁移、索引恢复、状态修复任务整理成正式清单
- [ ] 把启动期全量迁移 / 索引恢复 orchestrator 从目标变成实现
- [ ] 继续压缩 CLI / package fallback 对 legacy Studio 入口的依赖面
- [ ] 继续验证 `bun compile` 产物在脱离源码目录后的 smoke 口径
- [ ] 整理正式分发缺口：安装器、签名、首次启动 UX、自动更新

---

## 参考文档

- `docs/06-部署运维/01-当前运行与启动方式.md`
- `docs/06-部署运维/03-启动期迁移与修复清单.md`
- `docs/02-核心架构/01-系统架构/03-平台纠偏说明.md`
- `docs/04-开发指南/05-调研规划/01-平台迁移方案.md`
