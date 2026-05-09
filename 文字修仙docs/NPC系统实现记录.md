# NPC + 世界模拟系统 — 实现记录与后续任务

> **日期**: 2026-03-15
> **状态**: Step 1-3 已完成，Step 4-6 待实现
> **测试**: 10/10 passed (test_npc_system.py)

---

## 一、已完成工作

### Step 1: NPC 数据层 ✅

#### 1.1 数据模型 (schemas.py)
新增 `NpcState` 和 `Relationship` 两个 Pydantic 模型。

NPC 核心字段：
- 身份：npc_id, name, is_fixed, age, lifespan, backstory, title
- 修炼：realm_major/minor, l_fit_base, prof_cultivate/alchemy/gather/explore
- 状态：fatigue, pollution_load, heart_stability
- 社会：location_id, faction_id, relation_to_player, wealth, spirit_reserve
- 行为：current_activity, activity_tick, traits (性格标签列表)
- 生命：alive, death_tick, death_cause
- 灵根：ling_root_profile (五行频谱 dict)

关系字段：entity_a, entity_b, relation_type, value (-100~100), last_change_tick

#### 1.2 数据库 (state_store.py)
- 新增 `npc_state` 表 (29 列) 和 `relationship` 表 (复合主键)
- DDL 追加在 `_DDL` 字符串末尾，遵循 CREATE TABLE IF NOT EXISTS 模式
- 新增 CRUD 方法：
  - `get_all_npcs(alive_only)`, `get_npc(id)`, `get_npcs_at_location(loc)`, `get_npcs_in_faction(fac)`
  - `add_npc(dict)`, `update_npc(id, **kwargs)`, `batch_update_npcs(list[tuple])`
  - `get_relationship(a,b)`, `set_relationship(a,b,**kwargs)`, `get_relationships_for(entity)`
- `_parse_npc_row()` 统一反序列化 JSON 字段 (traits_json → list, ling_root_profile_json → dict)
- `batch_update_npcs()` 使用单事务批量写入，不逐条 commit

#### 1.3 固定 NPC 数据 (npcs_fixed.yaml)
10 个固定 NPC，按势力分布：

| NPC | 势力 | 境界 | 角色定位 |
|-----|------|------|---------|
| 陈守正 | 学院 | 练气6 | 导师，严谨正直 |
| 林若水 | 学院 | 胎息3 | 同学，勤奋内向，擅长水系 |
| 赵天行 | 学院 | 胎息4 | 同学，冒险急躁，潜在走火者 |
| 周明德 | 学院 | 筑基2 | 院长，睿智远见 |
| 孙小雨 | 学院 | 练气2 | 助教，开朗热心 |
| 玄清子 | 古法 | 筑基1 | 长老，固执博学 |
| 柳如烟 | 古法 | 练气1 | 弟子，坚韧好奇 |
| 方自由 | 开源 | 练气4 | 发起人，理想主义 |
| 钱多多 | 开源 | 胎息8 | 成员，贪财务实 |
| 老张 | 散修 | 练气3 | 灵材商人，消息灵通 |

YAML 还包含：
- `realm_lifespan` 映射 (胎息120 / 练气200 / 筑基350 / ...)
- `random_gen` 参数 (姓名池20姓+30名 / 性格池16种 / 年龄16-60 / 境界权重)
- `faction_weights` (学院40% / 古法25% / 开源20% / 散修15%)
- `faction_locations` (势力→可分配地点映射)
- `initial_relationships` (8 条固定关系：师徒/同门/友好/竞争/敌对)

#### 1.4 随机生成器 (npc_generator.py)

函数：
- `get_fixed_npcs()` — 从 YAML 加载固定 NPC 列表
- `get_initial_relationships()` — 从 YAML 加载初始关系
- `get_realm_lifespan(realm)` — 境界→寿命映射
- `generate_random_npc(npc_id, faction_id, location_id, rng)` — 生成单个随机 NPC
- `generate_initial_population(seed, count=50)` — 批量生成初始群体

随机生成逻辑：
- 名字 = 随机姓 + 随机名（从 YAML 池中选取）
- 性格 = 从 16 个 trait 中随机 2-3 个
- 境界 = 加权随机（胎息50% / 练气30% / 筑基5%）
- 灵根 = 五行随机生成，归一化到总和约 2.0
- L_fit = 基于灵根集中度 (0.25 + max_elem×0.3 + 随机偏移)
- 熟练度 = 境界基准值 + 随机偏移（胎息0.0 / 练气0.30 / 筑基0.60）
- 财富/灵储 = 境界基准 × 随机系数 (0.5~1.5)
- 心性 = 境界基准 + 随机偏移

#### 1.5 存档创建集成 (state_store.py → create_character_save)

在 `create_character_save()` 末尾新增：
1. 加载 10 个固定 NPC → INSERT OR REPLACE 写入 npc_state
2. 生成 50 个随机 NPC → INSERT OR REPLACE 写入 npc_state
3. 写入 8 条初始关系 → INSERT OR REPLACE 写入 relationship
4. 单次 commit

创建存档后世界中共有 60 个 NPC（10 固定 + 50 随机）。

---

### Step 2: NPC 每日推演 ✅

#### 2.1 推演引擎 (npc_simulator.py)

核心函数：`simulate_npc_day(store, tick, seed) → list[str]`

**设计决策：简化公式 vs 完整公式**

不调用完整 rule_engine（calc_l_fit → calc_risk → resolve_cultivation），而是用 O(1) 统计等效公式。原因：60 个 NPC 每天推演不能让 sleep() 变慢。

**行为决策 `_decide_activity(npc, rng)`**：

加权随机，权重受性格 trait 和当前状态影响：

| 行动 | 基础权重 | 性格修正 | 状态修正 |
|------|---------|---------|---------|
| cultivate | 40 | 勤奋+10, 懒惰-15, 好胜+5 | — |
| gather | 15 | — | 财富<500 +10, 灵储≤2 +30 |
| trade | 10 | 贪财+10 | 灵储≤2 +20 |
| rest | 15 | — | 疲劳>0.6 +20 |
| socialize | 10 | 热心+10 | — |
| explore | 5 | 冒险+10, 谨慎-10 | — |
| study | 10 | 好奇+10 | — |

特殊规则：疲劳≥0.8 时强制 rest/socialize/study (80/15/5)。

**简化结算 `_simplified_daily_result(npc, activity, rng)`**：

每种行动返回 6 个 delta 值：

| 行动 | lfit_delta | fatigue_delta | pollution_delta | heart_delta | wealth_delta | reserve_delta |
|------|-----------|--------------|----------------|------------|-------------|--------------|
| cultivate | +微量 | +0.15×(1-prof×0.3) | +0.005 | -0.005 | 0 | -1.0 |
| gather | 0 | +0.10 | +0.002 | 0 | +20~80 | -0.5 |
| trade | 0 | +0.03 | 0 | +0.005 | -100~200 | 0 |
| rest | -0.0005 | -0.20 | -0.01 | +0.01 | 0 | 0 |
| socialize | 0 | +0.02 | 0 | +0.015 | -30~30 | 0 |
| explore | +0.0002 | +0.12 | +danger×0.3 | -danger×0.2 | +0~120 | -0.8 |
| study | +0.0001 | +0.05 | 0 | +0.01 | 0 | -0.3 |
| alchemy | 0 | +0.12 | +0.008 | -0.003 | -50~150 | -1.5 |

**夜间恢复**（每个 NPC 每天自动执行）：
- 疲劳 -0.3
- 污染 -0.015
- 心性 +0.008
- 灵储 -0.8（消耗），耗尽时疲劳 +0.15

**熟练度增长**：对应行动的 prof 字段 +0.02×(1-当前值)，上限 0.95。

**消息生成**：仅固定 NPC 的重要事件（10% 概率闭关消息、灵储耗尽警告）。

#### 2.2 集成到 day_manager.sleep()

在 sleep() 的"L_fit 自然衰减"之后、"推进 1 天"之前插入：

```python
from core.npc_simulator import simulate_npc_day
meta = await self.store.get_meta()
npc_msgs = await simulate_npc_day(self.store, meta.current_tick, meta.seed)
messages.extend(npc_msgs[:3])  # 最多展示 3 条 NPC 动态
```

---

### Step 3: 月度世界推演 ✅

#### 3.1 推演引擎 (world_engine.py)

核心函数：`monthly_settle(store, tick, seed) → dict`

每 30 tick 触发，执行 7 步：

**① NPC 突破判定 `_step1_breakthroughs`**

简化版 HardGate 条件：

| 当前境界 | l_fit_min | pollution_max | prof_min | heart_min | minor_min | base_prob |
|---------|----------|--------------|---------|----------|----------|----------|
| 胎息→练气 | 0.40 | 0.30 | 0.30 | 0.30 | 6 | 0.40 |
| 练气→筑基 | 0.55 | 0.20 | 0.50 | 0.50 | 5 | 0.25 |
| 筑基→紫府 | 0.70 | 0.15 | 0.65 | 0.60 | 3 | 0.15 |

流程：
1. 满足 HardGate 的 NPC 有 30% 概率尝试突破
2. 成功概率 = base_prob + prof×0.2 + heart×0.1（上限 0.85）
3. 成功 → 境界提升，寿命更新
4. 失败 → 30% 概率走火（心性<0.3 且随机<0.4 时致死）

**② NPC 死亡检查 `_step2_deaths`**

age ≥ lifespan → 标记死亡，记录 death_tick 和 death_cause。

**③ NPC 老化 `_step3_aging`**

所有存活 NPC age +1（30 tick = 1 岁游戏时间）。

**④ 新 NPC 生成 `_step4_spawn`**

维持活跃人口目标 60 人，每月最多新增 3 个。新生 NPC 年龄 16-25，胎息期。

**⑤ 势力变量更新 `_step5_factions`**

```
控制力 = 0.2 + 成员数×0.015 + 平均境界分×0.03（上限 1.0）
资源获取 = 0.1 + 总财富/200000（上限 1.0）
```

境界分：胎息1 / 练气3 / 筑基8 / 紫府20 / 金丹50 / 道胎100。

**⑥ 世界变量更新 `_step6_world`**

- 灵压季节性波动：sin(tick/90×π) × 0.05 + 随机噪声 ±0.02
- 全局污染：每月 +0.002
- 资源压力：0.1 + NPC人数×0.004

**⑦ 生成月报**

汇总突破/死亡/新生/势力变化/世界变化消息，最多各取 3-5 条。

#### 3.2 集成到 day_manager.sleep()

在"推进 1 天"之后检查月度边界：

```python
if new_tick > 0 and new_tick % 30 == 0:
    from core.world_engine import monthly_settle
    month_meta = await self.store.get_meta()
    month_report = await monthly_settle(self.store, new_tick, month_meta.seed)
    messages.extend(month_report.get("messages", []))
```

#### 3.3 API 端点 (api/main.py)

新增 3 个端点：
- `GET /state/npcs` — 当前地点的存活 NPC 列表
- `GET /state/npcs/all` — 所有存活 NPC（调试/总览）
- `GET /npc/{npc_id}` — NPC 详情

---

### 附：Bug 修复

修复了已有的 `_apply_event_immediate` 中 `free_herb` 事件的 item_uid 冲突问题（改用 uuid 后缀）。

---

## 二、文件变更清单

| 操作 | 文件路径 | 改动 |
|------|---------|------|
| 新建 | `runtime/data/npcs_fixed.yaml` | 10 固定 NPC + 随机生成参数 + 初始关系 (~250行) |
| 新建 | `runtime/core/npc_generator.py` | NPC 随机生成器 (~170行) |
| 新建 | `runtime/core/npc_simulator.py` | NPC 每日推演引擎 (~200行) |
| 新建 | `runtime/core/world_engine.py` | 月度推演引擎 (~300行) |
| 新建 | `runtime/tests/test_npc_system.py` | 10 个测试用例 (~200行) |
| 修改 | `runtime/models/schemas.py` | +NpcState +Relationship 模型 (~40行) |
| 修改 | `runtime/core/state_store.py` | +DDL +CRUD +存档初始化 (~250行) |
| 修改 | `runtime/core/day_manager.py` | +NPC推演调用 +月度推演调用 +bug修复 (~15行) |
| 修改 | `runtime/api/main.py` | +3 个 NPC 端点 (~25行) |

---

## 三、测试覆盖

`runtime/tests/test_npc_system.py` — 10/10 passed (3.82s)

| 测试 | 验证内容 |
|------|---------|
| test_npc_generator_fixed | 固定 NPC 加载，≥10个，字段完整 |
| test_npc_generator_random | 随机 NPC 生成，名字/性格/灵根/境界合理 |
| test_npc_generator_population | 批量生成 50 个，无重复 ID，多势力分布 |
| test_session_creates_npcs | 创建存档后有 60 个 NPC (10固定+50随机) |
| test_npcs_at_location | /state/npcs 返回当前地点 NPC |
| test_npc_detail | /npc/{id} 返回正确的固定 NPC 详情 |
| test_npc_daily_simulation | sleep 后 NPC activity 从 idle 变为具体行动 |
| test_monthly_settle_triggers | 30 天后触发月度推演，消息含"月度推演" |
| test_npc_aging_after_month | 月度推演后 NPC 年龄 +1 |
| test_world_variables_change | 月度推演后全局污染 ≥ 初始值 |

---

## 四、后续任务（待实现）

### Step 4: 玩家-NPC 交互

**目标**：将当前的 `socialize` 行动升级为有深度的 NPC 交互系统。

**需要实现**：
- 交互类型：对话 / 切磋 / 交易 / 拜师 / 赠礼
- 交互条件：关系阈值（如拜师需 relation ≥ 40）
- 交互效果：关系变化 + 物品/知识奖励 + FormulaTrace
- 交互冷却：防止无限刷关系
- NPC 对话模板：YAML 驱动，按性格/关系/境界差异生成不同对话

**参考**：
- cultivation-world-simulator 的关系系统 (`relation/relation.py`)
  - **对偶自动维护**：设 A→B 为"师傅"时自动设 B→A 为"徒弟"
  - **15 种关系类型**：父母/子女/师傅/徒弟/道侣/朋友/仇人/同门等
  - **二阶衍生关系**：自动计算师祖/徒孙/同门
  - 代码位置：`references/cultivation-world-simulator/src/classes/relation/`

**改动文件**：
- `runtime/core/state_store.py` — set_relationship 加对偶自动维护
- `runtime/services/action_service.py` — socialize 升级
- `runtime/data/npc_dialogues.yaml` — 新建，对话模板
- `runtime/api/main.py` — 新增 /action/interact 端点

---

### Step 5: YAML 事件引擎

**目标**：替代 day_manager.py 中的 9 个硬编码事件，实现三级事件系统。

**三级事件**：
- 世界事件：灵压异变、污染风暴、灵材价格波动（影响所有地点）
- 势力事件：招募、任务发布、势力冲突（影响某势力成员）
- 个人事件：NPC 来访、仇敌寻仇、机缘偶遇（影响玩家或特定 NPC）

**事件 YAML 结构**：
```yaml
- id: "spirit_surge_global"
  type: world          # world / faction / personal
  conditions:
    tick_range: [60, 90]
    global_pollution: {lt: 0.3}
  probability: 0.15
  effects:
    all_locations.spirit_pressure: "+0.2"
  narrative: "南瞻外环灵压异常升高..."
```

**参考**：
- cultivation-world-simulator 的奇遇/霉运系统 (`fortune.py`)
  - **配表驱动 + 规则引擎决定奖励**：奖励由规则硬编码，LLM 只负责叙事
  - 6 种奇遇（兵器/装备/功法/拜师/灵石/修为）+ 3 种霉运（破财/受伤/倒退）
  - 每条记录有 kind/min_realm/max_realm/weight 字段
  - 代码位置：`references/cultivation-world-simulator/src/systems/fortune.py`
- cultivation-world-simulator 的关系型事件触发系统 (`tribulation.py`，原作称"天劫"，本项目不采用该概念)
  - **关系型事件**：寻仇需要仇人关系，情劫需要道侣关系
  - 社交关系直接影响修炼风险（本项目中等效于心魔积累和走火入魔机制）
  - 代码位置：`references/cultivation-world-simulator/src/systems/tribulation.py`

**改动文件**：
- `runtime/core/event_engine.py` — 新建，YAML 驱动事件引擎
- `runtime/data/events/daily.yaml` — 迁移 9 个硬编码事件
- `runtime/data/events/world.yaml` — 世界事件定义
- `runtime/data/events/faction.yaml` — 势力事件定义
- `runtime/data/events/personal.yaml` — 个人事件定义
- `runtime/core/day_manager.py` — 替换硬编码事件为事件引擎调用

---

### Step 6: 叙事节奏控制器

**目标**：借鉴 RimWorld 的 AI Storyteller，控制事件密度和烈度，防止世界太平或太乱。

**核心逻辑**：
- 最近 7 天无事件 → 事件概率 ×1.5
- 最近 3 天连续负面事件 → 负面事件概率 ×0.3
- 玩家刚突破 → 社交事件概率 ×3.0
- 玩家濒死 → 暂停高危事件

**参考**：
- cultivation-world-simulator 的 20 步月循环 (`simulator.py`)
  - 结构化 phase 编排：感知→决策→执行→交互→关系→死亡→环境
  - 代码位置：`references/cultivation-world-simulator/src/sim/simulator_engine/simulator.py`

**改动文件**：
- `runtime/core/storyteller.py` — 新建，节奏控制器

---

### 可并行：Batch 3 知识/记录系统

**目标**：给世界装上"记忆"。

**需要实现**：
- `experiment_log` 表 — 自动记录每次行动的 FormulaTrace
- `recipe_known` 表 — 已发现配方
- `trade_price` 表 — 交易价格历史
- `/knowledge/list` 和 `/knowledge/detail` API 端点
- `data/knowledge.yaml` — 知识条目定义
- Task 1.6 知识解锁过滤（FormulaTrace 根据知识状态过滤）

---

### 额外参考：可借鉴的开源设计模式

以下模式来自 `analysis_report.md` 分析的两个开源项目，可在后续实现中参考：

#### 战斗公式（from battle.py）
```
胜率 = sigmoid(0.15 × 战力差)
战力 = 境界基准 + 阶段加成 + 克制 + 效果加成
伤害 = base(24~36) × HP缩放 × e^(0.04×|战力差|)
```
加入 LEVSS 环境修正（灵压影响战力基准）后可用于 NPC 争斗和探索危险。
代码位置：`references/cultivation-world-simulator/src/systems/battle.py`

#### 宗门决策结构（from sect_decider.py）
```python
@dataclass
class SectDecisionPlan:
    declare_war_target_ids    # 宣战
    seek_peace_target_ids     # 议和
    recruit_avatar_ids        # 招收
    expel_avatar_ids          # 驱逐
    reward_avatar_ids         # 赐功法
    support_avatar_ids        # 资助
```
LLM 只生成计划（一组 ID），所有实际执行由规则代码完成。不合法目标自动过滤。
代码位置：`references/cultivation-world-simulator/src/classes/sect_decider.py`

#### 丹药时限效果（from elixir.py）
`ConsumedElixir` 记录服用时间，`get_active_effects(current_month)` 检查有效性。
可用于我们的 inventory_item.extra_json 存储服用时间。
代码位置：`references/cultivation-world-simulator/src/classes/items/elixir.py`

#### AI 行动链（from ai.py）
一次决策 → 多步行动序列（action_name_params_pairs），而非每步独立决策。
可用于 NPC 复合行为（"先采集再炼丹"）。
代码位置：`references/cultivation-world-simulator/src/classes/ai.py`
