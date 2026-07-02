# Lore / Narrative Memory 职责拆分 — Requirements

## 背景

NovelFork 早期把“经纬”同时用作作者设定库、关系图谱、时间线、角色弧线、伏笔状态和写作上下文来源。随着 Narrative Memory 已经具备 ContextCard、多通道召回、NarrativeFact、NarrativeEvent、retrieval diagnostics 和动态状态能力，经纬继续承担“记忆”会导致职责混乱：

- 静态设定与动态事实混在一起。
- 图谱、时间线、伏笔网络被错误放在经纬入口下。
- Agent prompt 容易把 `jingwei.read` 当成长篇记忆召回工具。
- 用户无法判断“我是在改设定”还是“我在查看 AI 记忆”。

本 spec 目标是拆清两套系统：

- **经纬 / Lore**：作者显式维护的静态设定库。
- **Narrative Memory**：AI 长篇连续性使用的动态叙事记忆系统。

本 spec 不处理作品诊断、市场雷达、选段写作、多版本、预设市场等非记忆能力。

---

## R1：经纬定义为静态设定库

1. WHEN 用户打开 IDE 左侧“经纬”入口 THEN 系统 SHALL 只展示作者显式维护的静态设定与资料。
2. 经纬 SHALL 支持人物、地点、势力、规则、物品、术语、作者备注、平台/书籍规则等分类。
3. 经纬 SHALL 保留条目树、分类筛选、条目编辑、手动创建、手动修改和静态资料导入能力。
4. 经纬 SHALL 表示 canon / reference / rules 等作者可审阅、可编辑、相对稳定的资料。
5. 经纬 SHALL NOT 承担动态记忆、章节状态、关系变化、时间线推演、伏笔状态、角色弧线或召回 diagnostics。
6. 经纬入口 SHALL NOT 使用“经纬图谱”作为产品能力名称。

---

## R2：Narrative Memory 定义为动态叙事记忆系统

1. WHEN 用户打开 IDE 左侧“叙事记忆”入口 THEN 系统 SHALL 展示动态叙事记忆相关能力。
2. Narrative Memory SHALL 展示最近一次 `buildNarrativeContext` 的 diagnostics，包括 purpose、chapterNumber、totalMs、totalEstimatedTokens、warnings。
3. Narrative Memory SHALL 展示 retrieval channel 状态，包括 hard、state、timeline、hooks、facts、style 等通道的状态、耗时、候选数、返回数和 token 估计。
4. Narrative Memory SHALL 展示 Pending NarrativeEvents，包括 eventType、entity、confidence、risk、evidence、chapterNumber。
5. Narrative Memory SHALL 承担关系图、时间线、角色弧线、伏笔网络、矛盾地图、事件链等动态图谱能力。
6. Narrative Memory SHALL 允许从动态图谱跳转到相关 Lore 条目，但 SHALL NOT 在图谱里直接替代 Lore 条目编辑器。
7. Narrative Memory SHALL 明确区分“已确认记忆”和“待确认事件”。

---

## R3：图谱类能力从经纬迁移到 Narrative Memory

1. 原 `JingweiGraphWorkspace` 中的关系图、时间线、角色弧线、矛盾地图能力 SHALL 迁移为 Narrative Memory 下的记忆图谱能力。
2. `ForeshadowingBoard` 的入口 SHALL 从经纬设定区迁移到 Narrative Memory 的伏笔网络视图。
3. `CharacterArcsPanel` 的入口 SHALL 从经纬/驾驶舱旧入口迁移到 Narrative Memory 的角色弧线视图。
4. 所有 UI 文案 SHALL 避免“经纬图谱”，改用“记忆图谱”“关系图”“时间线”“角色弧线”“伏笔网络”等名称。
5. 迁移后，经纬入口中 SHALL 不再出现图谱、时间线、角色弧线、矛盾地图和伏笔网络的主入口。
6. 迁移 SHALL 复用现有组件能力，优先改入口、命名和数据边界，不做无关 UI 重写。

---

## R4：工具协议边界

1. 系统 SHALL 引入或规划 `lore.read` 与 `lore.write` 作为静态设定读写工具语义。
2. `lore.read` SHALL 用于读取作者显式维护的静态设定，不得宣称返回完整动态剧情记忆。
3. `lore.write` SHALL 用于创建或修改作者可审阅的静态设定。
4. 系统 SHALL 引入或规划 `memory.read`、`memory.graph`、`memory.events` 作为动态记忆工具语义。
5. `memory.read` SHALL 用于写作、修订、审计、诊断前的动态上下文召回。
6. `memory.graph` SHALL 用于读取关系图、时间线、角色弧线、伏笔网络、矛盾地图等动态图谱。
7. `memory.events` SHALL 用于列出、批准或拒绝 Pending NarrativeEvents。
8. 现有 `jingwei.read` / `jingwei.write` SHALL 作为兼容别名保留一段迁移期，但工具说明 MUST 标记为 deprecated 或明确等价于 Lore 静态设定工具。
9. Agent 不得再通过 `jingwei.read` 获取动态叙事记忆。
10. `lore.read` / `jingwei.read` 读取静态设定时 SHALL 默认排除 archived、draft、needs-review、`participates_in_ai=0` 或等价生命周期/参与标记的条目。
11. `lore.write` / `jingwei.write` 写入 canon/rules 层时 SHALL 要求 reason、source 或等价确认语义；动态事实 SHALL NOT 直接写入 Lore。

---

## R5：Agent prompt 与写作链路语义改写

1. Agent system prompt SHALL 明确：经纬是静态设定库，Narrative Memory 是动态记忆系统。
2. 写作前上下文流程 SHALL 从旧语义：

   ```txt
   cockpit.snapshot → jingwei.read → pgi.ask → scene.spec → pipeline.write
   ```

   调整为新语义：

   ```txt
   lore.read 静态设定 → memory.read 动态记忆 → scene.spec / writing plan → pipeline.write → pending NarrativeEvents
   ```

3. Tool descriptions SHALL 明确禁止把市场材料、诊断结果、pending events 直接写入 Lore canon。
4. 写作后产生的新动态事实 SHALL 进入 Pending NarrativeEvents 或 Narrative Memory 事件流程，而不是直接写入经纬。
5. 静态设定变更 SHALL 继续要求可审阅理由和明确来源。

---

## R6：兼容与迁移

1. 迁移 SHALL 不破坏已有书籍的经纬条目数据。
2. 迁移 SHALL 不删除现有组件，除非后续任务证明其无引用且无产品价值。
3. 迁移 SHALL 先完成入口与语义迁移，再考虑重构内部数据源。
4. 旧文档、功能地图和用户可见文案中关于“经纬图谱”的表述 SHALL 更新。
5. Browser 验证 SHALL 包含：
   - 经纬入口只展示静态设定编辑能力。
   - 叙事记忆入口展示 diagnostics 与动态图谱入口。
   - 关系图、时间线、角色弧线、伏笔网络不再作为经纬主入口出现。

---

## Non-Goals

本 spec 不做以下事项：

- 不整合作品诊断、质量监控、AI 味、文风漂移、合规检查。
- 不恢复市场雷达 / 扫榜。
- 不改造选段写作、多版本、章节蓝图、章节健康。
- 不重构预设库、推荐预设、模板市场。
- 不解决预设绕过 style channel 的完整问题；该问题后续由 `preset-style-channel-boundary` 或同等 spec 处理。
- 不实现完整 Lore 审计系统；`jingwei.audit` / `lore.audit` 后续由 `lore-audit-gate` 或同等 spec 处理。
- 不删除经纬数据模型。
- 不把 Narrative Memory 做成通用工具箱。

---

## Success Criteria

1. 用户能清楚区分：经纬是静态设定库，Narrative Memory 是动态记忆系统。
2. “经纬图谱”产品名从主 UI 消失，图谱能力归入 Narrative Memory。
3. 经纬入口不再承担关系图、时间线、角色弧线、伏笔网络、矛盾地图主入口。
4. Narrative Memory 入口可以到达记忆总览、关系图、时间线、角色弧线、伏笔网络、矛盾地图。
5. Agent prompt 和工具说明不再把 `jingwei.read` 当动态记忆召回。
6. typecheck 通过，前端改动有 Browser 截图验证。
