# 经纬与上下文管理调研报告

## 概述

本文档汇总了开源项目、商业产品和学术论文中 AI 小说写作的上下文管理（分层压缩）方案，作为 NovelFork 经纬系统设计的参考依据。

---

## 一、开源项目对比（10 个）

| 项目 | Stars | 上下文策略 | 状态格式 | 写后自动更新 | Token 管理 | 独特特性 |
|------|-------|-----------|---------|-------------|-----------|---------|
| **InkOS**（上游） | 5,960 | 真相文件（current_state + particle_ledger + pending_hooks） | Markdown 文件 | ✅ continuity-auditor 自动审计+修订 | 未公开 | 5-Agent 管线；连续性审计员 |
| **MuMuAINovel** | 2,353 | 伏笔管理 + 章节关系图谱 + 角色/世界观 DB 注入 | PostgreSQL | ✅ 伏笔状态追踪 | 用户可配 max_tokens | 伏笔时间线可视化；拆书续写 |
| **AI-able-generates-novels** | 846 | 变量注入（`${background}` `${characters}` `${plot}` 拼入 prompt） | JSON 文件 | ✅ 知识库更新 | 双模型（高质量+廉价迭代） | 三层 prompt；AI 自迭代评分；思维导图 |
| **kimi-writer** | 437 | 滑动窗口 + 自动压缩：180K 阈值触发压缩，每 50 轮备份摘要 | 文件（每章 .md + .context_summary） | ✅ 压缩摘要自动保存 | 200K 窗口，90% 触发压缩 | 最清晰的 token 管理；断点续写 |
| **AIStoryWriter** | 237 | 章节摘要链：每章后生成结构化摘要（Plot/Setting/Characters/注意事项） | 内存变量 | ✅ 每章后自动生成摘要 | 逐章生成避免超限 | 4 阶段写作；Critic 反馈循环 |
| **storycraftr** | 135 | 向量数据库 RAG + LangGraph 状态机 | book.yaml + chapters/ + vectorstore | 推测 ✅ | 未公开 | CLI；子代理架构；VS Code 插件 |
| **NovelGenerator** | 125 | 角色知识图谱 + 章节状态对象 | metadata.json | 推测 ✅ | 未公开 | 多线程叙事；情感弧线推演 |
| **bookwriter** | 80 | 无记忆，仅靠大纲层级分解 | React 内存 | ❌ | 层级分解到最小单元 | 极简：一个标题生成整本书 |
| **openwrite** | 6 | Story Canvas（Acts→Chapters→Scenes→Beats）+ Codex 世界观 | SQLite | 推测 ✅ | 选择性注入 | 画布可视化；Cloudflare 部署 |
| **302_novel_writing** | 17 | 依赖模型自身窗口（无显式跨章记忆） | Jotai atoms（内存） | ❌ | 未公开 | 多语言 UI；多文风预设 |

---

## 二、商业产品对比（4 个）

| 产品 | 上下文策略 | 记忆形式 | 检索方式 | 自动更新 | Token 消耗 |
|------|-----------|---------|---------|---------|-----------|
| **Sudowrite** | Story Bible + 25 章滚动窗口（~20K 词） | 手动维护的 Bible + 全文滚动 | 无智能检索，纯滚动 | ❌ 手动 | ~25K tokens 固定 |
| **NovelCrafter** | Codex 条目 + Personas + 用户手动 attach | 结构化 Codex + 全局 Persona | 用户手动选择 | ❌ 手动 | 用户决定 |
| **SillyTavern** | Lorebook 关键词触发注入 | JSON 条目（key/content/weight） | 关键词匹配 + 递归扫描 | ❌ 手动 | 总上下文的 X%（可配） |
| **TunnelVision**（ST 扩展） | AI 自主 tool call 检索 + 读写双向 | Lorebook 树形结构 | AI 主动检索 | ✅ AI 自主写入/更新 | AI 按需取用 |

---

## 三、学术论文对比（3 篇）

### DOME（2024）— 动态层级大纲 + 时序知识图谱

```
粗大纲（五幕结构）→ 细大纲（逐章动态生成）→ 写作
                                    ↑
                    时序知识图谱（TKG）检索相关历史
                                    ↓
              写完后提取 <主体, 动作, 对象, 章节号> 四元组存入 TKG
```

- **记忆形式**：时序知识图谱（压缩后的事实四元组）
- **检索方式**：实体匹配 + 语义相似度 top-k
- **效果**：矛盾冲突减少 87.6%
- **代价**：每章多次 LLM 调用（提取 + 过滤 + 生成）

### SCORE（2025）— 动态状态追踪 + 混合检索

```
每章写完 → 提取摘要 + 物品状态表 + 情感分数 → 存入 FAISS 向量索引
写新章时 → 余弦相似度检索 top-N + TF-IDF 关键词 + 情感距离惩罚 → 注入
```

- **记忆形式**：章节摘要 + 物品状态机（active/lost/destroyed）+ 情感分数
- **检索方式**：向量相似度 + 关键词 + 情感一致性过滤
- **效果**：物品连续性从 0% → 98%
- **关键创新**：物品状态机防止"已死角色复活"

### 信息蒸馏度量（2025）— 层级压缩失真分析

- 100K 词小说压缩为 10K 词大纲再展开，比直接生成失真更小
- 验证了"大纲→章节"的层级生成比"一次性长文"更保真
- 为 NovelFork 的"大纲→章节意图→写作"管线提供理论支撑

---

## 四、上下文管理 5 个层级

| 层级 | 策略 | 代表 | NovelFork 现状 |
|------|------|------|---------------|
| **L0** | 无记忆，靠大纲结构 | bookwriter, 302_novel_writing | — |
| **L1** | 变量注入（设定/大纲拼入 prompt） | AI-able-generates-novels | ✅ 有（经纬文件注入） |
| **L2** | 章节摘要链（每章后生成摘要传给下一章） | AIStoryWriter, kimi-writer | ✅ 有（ChapterAnalyzerAgent） |
| **L3** | 持久化状态文件 + 审计 Agent | InkOS | ✅ 有（StateValidator + ContinuityAuditor） |
| **L4** | 关系数据库 + 伏笔追踪 + 向量/AI 检索 | MuMuAINovel, storycraftr, TunnelVision | ⚠️ 部分（SQLite 有，向量检索无，伏笔前端不可见） |

**NovelFork 在 L3-L4 之间，设计上比大多数开源项目先进。**

---

## 五、Token 管理策略分类

| 策略 | 项目 | 描述 | 适用场景 |
|------|------|------|---------|
| **层级分解** | bookwriter | 将书拆到最小单元，每次只生成一小段 | 小窗口模型（4K-8K） |
| **摘要压缩** | AIStoryWriter | 历史章节压缩为结构化摘要，只传摘要不传全文 | 中窗口（32K-128K） |
| **滑动窗口+自动压缩** | kimi-writer | 200K 窗口，90% 时自动压缩，带断点恢复 | 大窗口（200K） |
| **选择性注入** | AI-able-generates-novels, SillyTavern | 只注入当前相关的变量/条目 | 任何窗口 |
| **AI 自主检索** | TunnelVision | AI 通过 tool call 主动取需要的上下文 | 支持 tool calling 的模型 |
| **双模型分工** | AI-able-generates-novels | 高质量模型写正文，廉价模型做迭代/评分 | 成本敏感场景 |
| **token 预算裁剪** | SillyTavern, NovelFork | 按权重/优先级排序，超预算从低优先级裁剪 | 任何窗口 |

---

## 六、NovelFork 当前方案 vs 业界

### 已有优势

1. **5-Agent 管线**（与 InkOS 同源）— 业界最完整的多 Agent 协作
2. **可见性规则过滤**（global/nested/tracked）— 比 SillyTavern 的关键词匹配更语义化
3. **token 预算裁剪**（按优先级排序）— 与 SillyTavern 的 weight 系统等价
4. **连续性审计 Agent** — 专职检查矛盾，DOME 论文验证了此思路有效
5. **PGI 追问引擎** — 基于伏笔/矛盾状态生成追问，独特设计

### 缺失能力

| 能力 | 谁有 | NovelFork 现状 | 建议 |
|------|------|---------------|------|
| 向量检索（RAG） | storycraftr, SCORE | 无 | P2：可选增强，不阻塞核心流程 |
| AI 自主检索（tool call） | TunnelVision | 无 | P2：与 Agent 架构天然契合 |
| 伏笔时间线可视化 | MuMuAINovel | SQLite 有数据，前端不可见 | P1：资源树加伏笔分组 |
| 断点续写 | kimi-writer | 无 | P1：管线中断后恢复 |
| 物品状态机 | SCORE | 无显式实现 | P2：可融入 StateValidator |
| 时效控制（sticky/cooldown） | SillyTavern | 无 | P3：经纬条目加时效属性 |
| AI 自迭代评分 | AI-able-generates-novels | 有 Critic 但未循环 | P2：审计后自动修订已有 |
| 三层 prompt 体系 | AI-able-generates-novels | 有但不够显式 | P3：prompt 模板可配置化 |

---

## 七、行动建议优先级

| 优先级 | 行动 | 依据 |
|--------|------|------|
| **P0** | 修管线入口（executeNovelCommand handler） | 所有 L3+ 能力都依赖管线执行 |
| **P1** | 经纬文件夹重构（bible → jingwei，按类别分文件夹） | 可维护性 + 作者体验 |
| **P1** | 伏笔前端可见+可编辑 | MuMuAINovel 验证了此需求 |
| **P1** | 断点续写（管线中断恢复） | kimi-writer 的核心卖点 |
| **P2** | 写作工具面板 onRunTool 接通 | 7 个工具按钮空结果 |
| **P2** | Checkpoint 面板接入 UI | 代码完整但不可达 |
| **P2** | AI 自主检索经纬（tool call 模式） | TunnelVision 验证了可行性 |
| **P3** | 向量检索补充 | storycraftr/SCORE 路线，非必需 |
| **P3** | 经纬条目时效控制 | SillyTavern 的 sticky/cooldown |

---

## 参考来源

### 开源项目
- [InkOS](https://github.com/Narcooo/inkos) — 5,960 stars
- [MuMuAINovel](https://github.com/xiamuceer-j/MuMuAINovel) — 2,353 stars
- [AI-able-generates-novels](https://github.com/wfcz10086/AI-automatically-generates-novels) — 846 stars
- [kimi-writer](https://github.com/Doriandarko/kimi-writer) — 437 stars
- [AIStoryWriter](https://github.com/datacrystals/AIStoryWriter) — 237 stars
- [storycraftr](https://github.com/raestrada/storycraftr) — 135 stars
- [NovelGenerator](https://github.com/KazKozDev/NovelGenerator) — 125 stars
- [bookwriter](https://github.com/emilamaj/bookwriter) — 80 stars
- [302_novel_writing](https://github.com/302ai/302_novel_writing) — 17 stars
- [openwrite](https://github.com/ilrein/openwrite) — 6 stars
- [SillyTavern](https://github.com/SillyTavern/SillyTavern) — 13,600 stars（Lorebook/World Info）
- [TunnelVision](https://github.com/Coneja-Chibi/TunnelVision) — SillyTavern 扩展（AI 自主检索）

### 商业产品
- [Sudowrite](https://sudowrite.com) — Story Bible + 25 章滚动窗口
- [NovelCrafter](https://www.novelcrafter.com) — Codex + Personas + 手动 attach

### 学术论文
- [DOME](https://arxiv.org/html/2412.13575v1) — Dynamic Hierarchical Outlining with Memory-Enhancement (2024)
- [SCORE](https://arxiv.org/html/2503.23512v1) — Story Coherence and Retrieval Enhancement (2025)
- [信息蒸馏度量](https://arxiv.org/html/2505.12572v1) — Measuring Information Distortion in Hierarchical Novel Generation (2025)
