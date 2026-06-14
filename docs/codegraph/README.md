# CodeGraph 代码索引

**版本**: v1.0.0
**创建日期**: 2026-06-14
**更新日期**: 2026-06-14
**状态**: ✅ 当前有效
**文档类型**: current

---

给 AI 用的代码导航索引（借鉴 aider repomap：符号图 + 重要性排序）。

## 产物

| 文件 | 说明 | 是否入仓 |
|------|------|---------|
| `CODEMAP.md` | 紧凑导航图：每文件一行（路径 + 导出符号 + 被引用数），按包分组、按 PageRank 排序。**AI 用法**：先读本图定位「符号在哪个文件」，再 Read 该文件看细节。 | ✅ 是 |
| `codegraph.json` | 母库：全量符号 + 签名 + 依赖边 + 排序。供程序化查询/增量更新。 | ❌ 否（可重生，避免 1.3MB git 噪音） |

## 生成 / 更新

```bash
bun run codegraph
```

纯正则提取（零依赖），扫描 `packages/*/src/**/*.{ts,tsx}`（排除 test/dist）。
代码结构变化后重跑即可刷新。

## 设计

- **粒度**：符号级（导出的 function/class/interface/type/const + re-export）
- **排序**：PageRank（文件=节点，import=边，被重要文件引用的文件分高）
- **消费**：会话需要理解/定位代码时读 CODEMAP.md，把"盲目 grep"变"看图精确定位再 Read"
