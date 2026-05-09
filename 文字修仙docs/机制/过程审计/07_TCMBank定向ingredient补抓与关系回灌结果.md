# 07_TCMBank定向ingredient补抓与关系回灌结果

> 状态日期：2026-03-12  
> 目的：不再顺序抓取 `TCMBank` 前排 ingredient，而是针对当前主库实际命中的 herb 关系，定向补抓缺失 ingredient 明细与关系。
> 文档类型：过程 / 审计文档。快速理解当前系统，请先看 [[02_本草系统精简总览]]、[[03_本草世界化补全规则]]、[[04_本草给玩法层的直接接口]]。

## 1. 为什么要做这一轮

主库在字段层已经很完整，但关系层长期偏薄。根因不在主库，而在两件事：

1. herb 关系表里的 ingredient id 多是 `HBIN...`
2. ingredient 主表与 target / disease 关系表多用 `TCMBANKIN...`

再加上顺序抓取前排 ingredient，覆盖不到当前主库真正命中的 ingredient 集合，所以必须改成定向补抓。

## 2. 这轮具体做了什么

新增脚本：

- `scripts/enrich_tcmbank_targeted_ingredients.py`

这条脚本负责：

1. 从当前 `tcm_materia_medica_master.csv` 反推主库命中的 herb
2. 从 `tcmbank_herb_ingredients.csv` 中找出这些 herb 实际关联的 ingredient
3. 通过 `HBIN id + 名称 / 别名回对`，定向找出缺失的 ingredient 明细
4. 把结果回灌到：
   - `tcmbank_ingredients.csv`
   - `tcmbank_ingredient_herbs.csv`
   - `tcmbank_ingredient_targets.csv`
   - `tcmbank_ingredient_diseases.csv`

同时补了 `cache-only` 模式，可以把已抓缓存直接回写到 processed 层。

## 3. 当前 TCMBank 结果

来自 [tcmbank_summary.json](d:/DESKTOP/narrafork/文字修仙/data/processed/tcmbank_summary.json) 的最新数字：

- `herb_detail_fetched = 300`
- `ingredient_detail_fetched = 300`
- `herb_ingredients = 1017`
- `herb_targets = 16`
- `herb_diseases = 22`
- `ingredient_herbs = 1365`
- `ingredient_targets = 1749`
- `ingredient_diseases = 452`

这说明当前 `TCMBank` 关系层已经明显超过最早的采样阶段，但仍远未吃满。

## 4. 回灌到主库后的效果

重建 [tcm_materia_medica_master_summary.json](d:/DESKTOP/narrafork/文字修仙/data/processed/tcm_materia_medica_master_summary.json) 后，主库关系层目前是：

- `rows_with_ingredient_links = 23`
- `rows_with_direct_targets = 4`
- `rows_with_direct_diseases = 5`
- `rows_with_ingredient_targets = 7`
- `rows_with_ingredient_diseases = 6`

也就是说：

- 关系链已经真正接进主库
- 但还没有形成大规模覆盖

## 5. 这轮的真实价值

这一轮最重要的不是“把 ingredient 一次抓完”，而是验证了三件事：

- 顺序抓 ingredient 不够用
- 必须按当前 herb 主库反推 ingredient
- `HBIN` 和 `TCMBANKIN` 的 id 体系必须显式打通

一旦 ingredient 层补起来，主库的 `target / disease` 关系就会开始增长。

## 6. 下一步

后续最合理的顺序是：

1. 继续按主库命中情况分批补 `TCMBank ingredient` 详情
2. 每补一批就执行一次 `cache-only` 回灌
3. 再重建 `tcm_materia_medica_master*`
4. 等关系层再上一个量级后，把这些关系正式接进玩法、经济和剧情节点
