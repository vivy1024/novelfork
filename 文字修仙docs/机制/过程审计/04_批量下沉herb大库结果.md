# 04_批量下沉herb大库结果

> 状态日期：2026-03-12  
> 目的：记录从 `TCMID 1206` 主索引批量下沉到当前 Rule-C herb / materia medica 大库的结果。
> 文档类型：过程 / 审计文档。快速理解当前系统，请先看 [[02_本草系统精简总览]]、[[03_本草世界化补全规则]]、[[04_本草给玩法层的直接接口]]。

## 1. 当前结论

这条线已经不再停留在 `118` 条的方剂样板库，也不再是之前的 `718` 条阶段结果。  
**当前最新可用大库是 `1018` 条。**

这 `1018` 条的意义是：

- 已经过 Rule-C 映射
- 已经能直接进入玩法与世界资产层
- 已经足够支撑后续分类、认证、主库合并

## 2. 这轮实际做了什么

核心脚本仍然是：

- `scripts/build_rule_c_herb_library.py`

它做的事情是：

- 以 `tcm_herb_rulec_expanded.csv` 作为基础库
- 从 `TCMID herb` 主索引中继续筛选还未下沉的条目
- 用 `source_hit_count / formula_count / ingredient_count / human_target_count / barcode / TCMBank 匹配` 做优先级排序
- 批量下沉更大一批高价值条目

对应产物：

- `data/processed/tcm_herb_rulec_library.csv`
- `data/processed/tcm_herb_rulec_library.sqlite`
- `data/processed/tcm_herb_rulec_library_summary.json`

## 3. 当前数量

这一轮之后，三层数量已经可以明确区分：

- `TCMID herb` 主索引：`1206`
- `expanded herb` 方剂定向精炼库：`118`
- `Rule-C herb library` 批量下沉大库：`1018`

也就是说：

- `118` 是规则接线和方剂样板层
- `1018` 才是当前真正可用于世界资产层的成品大库

## 4. 大库核心统计

来自 `tcm_herb_rulec_library_summary.json` 的最新数字：

- `base_rows = 118`
- `candidate_pool_rows = 1059`
- `selected_rows = 900`
- `supplement_rows = 900`
- `library_rows = 1018`

补入的 `900` 条里：

- `selected_tcmbank_matched_rows = 852`
- `selected_detail_fetched_rows = 16`
- `selected_barcoded_rows = 425`

成分来源分布：

- `tcmbank_ranked = 340`
- `tcmid_proxy = 666`
- `proxy_fallback = 12`

这说明大库已经不是“纯 proxy 草表”，而是：

- 一部分有 `TCMBank ranked` 成分支持
- 一部分仍以 `TCMID proxy` 兜底
- 极少量仍是纯 fallback

## 5. 这 `1018` 条到底是什么

这批条目应该理解成：

- **本草 / materia medica 大库**

而不是：

- **纯植物灵植库**

原因很简单，当前 `TCMID / TCMBank` 上游原始数据本身混合了：

- 植物药
- 动物药
- 矿物药
- 炮制品
- 油脂、胶类、粉类等加工态条目

所以这一步完成后，后续重点就从“继续堆总量”转向：

1. 分类拆层
2. 物种认证
3. 产地压实
4. ingredient 关系扩深

## 6. 判断

当前最准确的判断是：

- 上游源并不少
- 规则层也已经能批量工作
- 现在真正要解决的，不是“有没有 herb”
- 而是“怎么把 `1018` 条继续压成高置信、可运营、可分布、可定价的世界资产”

## 7. 下一步

这篇文档之后的自然延伸已经不是继续盲目扩库，而是看：

- [26_本草资产分类与物种产地认证首轮结果](26_本草资产分类与物种产地认证首轮结果.md)
- [27_本草主库与四层子表落地结果](27_本草主库与四层子表落地结果.md)
- [29_本草主库现状速览](../本草系统/29_本草主库现状速览.md)
