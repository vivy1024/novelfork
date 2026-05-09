# 02_灵植成分降噪与Rule-C接入方案

> 状态日期：2026-03-12
> 目的：把 `TCMBank / TCMID / 基础 herb Rule-C` 的原始成分池整理成可审计、可回放、可直接接入 [[02_物理公式与参数手册]] Rule-C 的 `Comp_i` 层。
> 文档类型：过程 / 审计文档。快速理解当前系统，请先看 [[02_本草系统精简总览]]、[[03_本草世界化补全规则]]、[[04_本草给玩法层的直接接口]]。

## 1. 为什么需要这一层

当前灵植数据线已经拿到了真实成分，但“拿到真实成分”不等于“可以直接进游戏层”。

原因很简单：

- `TCMBank` 的单味药成分列表经常很长，几十到上百个都可能出现
- 同一成分常以多种拼写、别名、分号拼接形式重复出现
- 一些常见脂肪酸、甾醇、基础代谢成分信号太泛，不适合直接当高权重 `Comp_i`
- 目前 `Rule-C` 需要的是“主活性成分/主化学基团”，不是无限长的原始成分池

所以这里必须新增一层“成分降噪”，把：

- 可审计原始成分池
- 证据分级后的候选成分
- 最终进入 `Rule-C` 的 Top-N 组件

明确拆开。

## 2. 当前数据状态

### 2.1 基础 herb 判定层

- `data/processed/tcm_herb_screening.csv`
- 当前去重 herb：`40`
- 仍保留一部分 proxy 判定逻辑，适合当基础评分入口

### 2.2 TCMID 主骨架

- `data/processed/tcmid_herbs.csv`
- `data/processed/tcmid_formulas.csv`
- `data/processed/tcmid_formula_components.csv`

当前结果：

- herb 索引 `1206`
- formula 索引 `7443`
- formula component `118`

`TCMID` 的价值是提供 herb / formula 骨架与方剂关系，不是直接解决成分降噪。

### 2.3 TCMBank 主成分池

- `data/processed/tcmbank_herbs.csv`
- `data/processed/tcmbank_ingredients.csv`
- `data/processed/tcmbank_herb_ingredients.csv`
- `data/processed/tcmbank_ingredient_targets.csv`
- `data/processed/tcmbank_ingredient_diseases.csv`

当前结果：

- herb 索引 `9191`
- ingredient 索引 `61965`
- herb 直连 ingredient `407`
- ingredient 反向 herb `1137`
- ingredient targets `1649`
- ingredient diseases `452`

`TCMBank` 的价值是给 `Comp_i` 提供真实成分池，但这批成分目前仍然偏“原始数据库层”。

### 2.4 基础 herb 富化层

- `data/processed/tcm_herb_screening_enriched.csv`
- `data/processed/tcm_herb_screening_enriched.sqlite`
- `data/processed/tcm_herb_screening_enriched_summary.json`
- `data/processed/tcm_herb_component_ranking_summary.json`
- `data/processed/tcm_herb_rulec_final.csv`
- `data/processed/tcm_herb_rulec_final.sqlite`
- `data/processed/tcm_herb_rulec_final_summary.json`
- `data/processed/tcm_formula_rulec_final.csv`
- `data/processed/tcm_formula_rulec_final.sqlite`
- `data/processed/tcm_formula_rulec_final_summary.json`

当前结果：

- 基础 herb `40`
- 匹配到 `TCMBank` 的 `30`
- 有真实成分的 `28`
- 有 targets 的 `17`
- 有 diseases 的 `14`
- 已完成 Top-N 主成分降噪并写回 `enriched` 层的 `28`
- 仍使用 `proxy_fallback` 的 `12`
- 已完成 Rule-C 最终整合输出的 `40`
- 已完成方剂聚合原型的 `10`

这说明 `Comp_i` 已经不再是纯 proxy，但也说明一个现实问题：

> 现在缺的不是“更多原始成分”，而是“怎样把原始成分压缩成游戏层有效成分”。

## 3. 降噪目标

这一层要同时满足 4 个目标：

1. 保留原始数据可审计
   - 后续任何一个 `Comp_i` 都能回溯到 `TCMBank / TCMID / proxy fallback`
2. 让 `Rule-C` 能直接消费
   - 输出必须足够短，适合做 `Comp_i`
3. 让玩法层可解释
   - 玩家看到的是“主活性家族 + 风险倾向”，不是一串化学垃圾文本
4. 给后续丹方与配伍留接口
   - 不能把所有低频成分都删光，要保留候补池

## 4. 证据优先级

进入最终 `Comp_i` 之前，成分证据按以下顺序排权：

1. herb 直连成分
   - `tcmbank_herb_ingredients`
2. ingredient 反向回链成分
   - `tcmbank_ingredient_herbs`
3. `TCMID` 方剂/药材成分支持
4. 现有 `effect_inferred` proxy

对应原则是：

- 有真实直连证据时，不再让 proxy 抢主位
- 只有在真实成分缺失时，proxy 才作为兜底
- 方剂支持可以提高“这味药常被怎样使用”的权重

## 5. 降噪流水线

### 5.1 原始文本清洗

第一步只做机械清理，不做药理判断：

- 拆开分号拼接的多成分字段
- 去除大小写、空格、标点差异
- 合并常见别名和拼写漂移
- 标记明显脏值、占位符、空字段

例如当前摘要里已经能看到这类问题：

- `kaemferol;kampferol;kaempferol;campherol`
- `oleic acid;cis-oleic acid;oleinic acid`
- `poriferast-5-en-3beta-ol;22,23-dihydrostigmasterol;gamma-sitosterol...`

这类记录如果不先清洗，`Top-N` 排名会完全失真。

### 5.2 成分类族归并

第二步要把化学名转成对 `Rule-C` 有意义的“主家族”：

- 生物碱 `alkaloid`
- 黄酮 `flavonoid`
- 萜类 `terpene`
- 皂苷 `saponin`
- 配糖体 `glycoside`
- 酚酸/多酚 `phenolic`
- 有机酸 `organic_acid`
- 甾醇/脂质 `sterol_lipid`
- 氨基酸/小肽 `amino_peptide`
- 多糖 `polysaccharide`

这样做的原因是：

- `Rule-C` 真正需要的是“药理方向 + 五行频谱 + 风险倾向”
- 不是每个具体化学名都应该成为独立玩法字段

### 5.3 成分权重排序

每个候选成分给一个综合分，至少考虑这些维度：

- `direct_evidence`
  - 是否来自 herb 直连关系
- `reverse_support`
  - 是否有 ingredient 反向回链
- `formula_support`
  - 是否在 `TCMID` 方剂网络中反复出现
- `pharmacology_support`
  - 是否具备 targets / diseases 证据
- `specificity`
  - 是否属于这味药的高识别度成分，而非到处都有的底噪
- `structure_quality`
  - 名称质量、结构信息完整度、别名归一质量

同时要施加 `ubiquity_penalty`：

- 过于常见的脂肪酸、基础甾醇、泛在代谢物降权
- 只保留它们作为候补，不抢占主成分位

### 5.4 输出层

最终不只输出一个 `Comp_i` 字段，而是输出 4 层结果：

| 字段 | 作用 |
|------|------|
| `Comp_i_raw_json` | 原始成分池，完整保留，供审计 |
| `Comp_i_primary_json` | Top-N 主成分，供 Rule-C 直接使用 |
| `Comp_i_reserve_json` | 候补成分池，供丹方和高级分析使用 |
| `Comp_i_family_json` | 成分类族摘要，供玩法和文本层解释 |
| `Comp_i_evidence_json` | 每个主成分的证据来源、权重和降权原因 |
| `comp_rank_mode` | `tcmbank_direct / tcmbank_hybrid / proxy_fallback` |

## 6. 与 Rule-C 的接法

`[[02_物理公式与参数手册]]` 里的 Rule-C 目前要求：

- `Comp_i`
- `Class_i`
- `Tox_i`
- `BioRoute_i`
- `Mineral_i`
- `ProcWindow_i`
- `Spec_i`

这里的建议是：

1. `Comp_i`
   - 改为读取 `Comp_i_primary_json`
   - 只取 `Top-3` 到 `Top-5`
2. `Class_i`
   - 保留原有药理分类
   - 叠加 `Comp_i_family_json`
3. `Tox_i`
   - 可由 `TCMBank` 疾病/targets 证据辅助校准，但不直接自动改写
4. `BioRoute_i`
   - 维持现有 herb 判定结果
5. `Mineral_i`
   - 仍由内部矿物联算决定，不由外部 herb 库直接给
6. `ProcWindow_i`
   - 等 `PolyU` 接入后再细化

一句话说，Rule-C 的接法应该是：

> 原始数据库保留全量，游戏层只消费降噪后的主成分层。

## 7. 例子：为什么不能直接把原始成分塞进游戏层

以当前富化结果为例：

- `党参`
  - 已匹配 `TCMBank`
  - 富化后分数最高
  - 但其真实成分池并不适合全部直接展示
- `石上柏`
  - 成分与 target 证据都已出现
  - 适合提炼为“清杂/排毒/载灵辅助”的主家族，而不是整串原始化学名
- `白果`
  - 成分多、风险也高
  - 更需要把 `SideVec` 风险和 `主成分` 分开表达

这正说明：

- 原始数据库适合分析
- 游戏规则需要压缩和解释

## 8. 工程状态与下一步

当前已经完成：

1. `rank_tcmbank_components.py`
   - 已完成
   - 当前已把 `Comp_i_primary_json / Comp_i_reserve_json / Comp_i_family_json / Comp_i_evidence_json / comp_rank_mode` 写回 `enriched` 层
2. `finalize_rule_c_herb_db.py`
   - 已完成
   - 当前已读取 `Comp_i_primary_json / Comp_i_family_json`，并输出 `EffVec_rulec_json / SideVec_rulec_json / UserFit_proxy / Match_C_final / grade_final`
3. `build_rule_c_formula_db.py`
   - 已完成方剂原型聚合
   - 当前基于 `TCMID` 已抓到组件明细的 `10` 个方剂生成原型结果，其中 `6` 个方剂已有部分 herb 覆盖

当前更合理的下一步是：

1. 提升 herb 覆盖率
   - 让 `TCMID` 方剂组件能匹配到更多 herb final 条目，不然方剂层长期只能做样板
2. 再接 `PolyU / POWO / GBIF / BOLD`
   - 补完工艺、物种与认证层

## 9. 当前结论

灵植这条线现在已经完成了两步：

- 从 proxy 走向真实成分
- 从真实成分走向 Rule-C 可用字段和最终 herb 结果
- 从单味 herb 结果走向方剂聚合原型

所以当前最重要的工作不再是继续抓更多网站，而是：

- 扩大 herb 主库覆盖面，让方剂组件不再大面积落空
- 再补工艺、物种与认证层

只有这样，灵植层才不会只停在“单味药评分 + 少量方剂样板”，而能真正进入炼丹、经济和剧情系统。
