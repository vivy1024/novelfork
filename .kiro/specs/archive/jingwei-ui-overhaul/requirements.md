# 经纬系统重做 + 未实现 Spec 补全 — 需求文档

## 背景

### 问题 1：经纬前端 CRUD UI 不存在

后端 Bible 4 表（角色/事件/设定/章节摘要）+ 三种可见性 + Aho-Corasick 别名匹配 + token 预算 + 嵌套引用递归全部已实现（`novel-bible-v1` spec），但用户在界面上**看不到、编不了**这些数据。这是当前最大的功能缺口。

### 问题 2：经纬数据模型不够

对标云笔 AI / NovelCrafter Codex，当前经纬缺少：
- 层级树结构（父子关系）
- 关系图谱（节点间连线 + 类型）
- 结构化字段（每个分类有专属字段 schema）
- 更细分的分类（当前 7 个 → 目标 16 个）
- Progressions（角色状态随章节演进）

### 问题 3：长篇连贯性机制不完整

写到 100-1000 章时需要：
- 递归摘要（卷→篇→书）
- 经纬自动更新（写后自动更新角色状态）
- 写前 Briefing 自动生成
- 因果链状态机
- 角色生命周期自动降级

### 问题 4：已有 Spec 未实现的功能

从 `novel-bible-v1`、`novel-creation-closure`、`smart-preset-system`、`onboarding-and-story-jingwei`、`narrafork-feature-parity` 等 spec 中遗留的未实现功能。

---

## 竞品参考

| 竞品 | 核心机制 | NovelFork 对标 |
|------|---------|---------------|
| NovelCrafter Codex | Relations 递归级联 + Progressions 时间演进 + Series Codex 跨书 | 本 spec Phase 2-3 |
| Sudowrite | Story Bible 自动提取 + 25 章滚动上下文 + Muse 模型 | 本 spec Phase 4 |
| VCPChat/Wave Memory | Tag 共现图 + 脉冲传播 + 残差金字塔 + 做梦系统 | 本 spec Phase 5 |
| 云笔 AI | 16 分类面板 + 层级树 + 节点图谱 | 本 spec Phase 1 |

---

## Phase 1：经纬前端 CRUD UI（P0 — 最紧急）

### 1.1 Bible 条目管理面板

**现状**: 后端 API 完整（`/api/books/:bookId/bible/characters` 等），前端无入口
**目标**: 左侧分类面板 + 中间条目列表 + 右侧编辑表单

**分类扩展**（7 → 16）：
1. 角色管理（character）
2. 事件记录（event）
3. 世界观设定（worldview）
4. 力量体系（power-system）
5. 地理地图（geography）
6. 势力阵营（faction）
7. 物品列表（item）
8. 功法体系（skill）
9. 货币体系（currency）
10. 特殊设定（special）
11. 大纲设定（outline）
12. 人物关系（relationship）
13. 伏笔管理（foreshadowing）
14. 情节脉络（plot）
15. 时间线（timeline）
16. 章节摘要（chapter-summary）

**验证**: 用户能在 UI 中新建/编辑/删除/搜索经纬条目

### 1.2 结构化表单（动态 schema）

**现状**: 所有条目只有 title + contentMd 两个字段
**目标**: 每个分类有专属字段 schema，前端动态渲染表单

**示例 — 角色分类字段**：
```json
[
  { "key": "name", "type": "text", "label": "姓名", "required": true },
  { "key": "aliases", "type": "tags", "label": "别名" },
  { "key": "roleType", "type": "select", "label": "角色类型", "options": ["主角", "配角", "反派", "路人"] },
  { "key": "realm", "type": "text", "label": "当前境界" },
  { "key": "personality", "type": "tags", "label": "性格标签" },
  { "key": "goal", "type": "textarea", "label": "当前目标" },
  { "key": "appearance", "type": "textarea", "label": "外貌描述" },
  { "key": "backstory", "type": "textarea", "label": "背景故事" }
]
```

**验证**: 添加角色时看到专属表单字段，不是纯 markdown 文本框

### 1.3 新书引导 → 经纬模板对应补全

**现状**: 26 个题材选项中只有 6 个有专属经纬模板
**目标**: 所有 26 个题材都有对应的经纬模板（section + 字段 schema + 示例数据）

**缺失映射补全**：
- 武侠 → 武功/门派/江湖势力/武器
- 游戏 → 技能树/副本/装备/NPC
- 末日 → 变异体/据点/资源/生存规则
- 穿越/重生 → 前世记忆/蝴蝶效应/金手指限制
- 系统流 → 系统面板/任务/奖励/限制
- 无限流 → 副本规则/积分/队伍/世界观
- 诡秘 → 序列/途径/非凡特性/规则
- 种田 → 领地/产业/技术树/NPC
- 官场 → 权力结构/派系/升迁路径
- 军事 → 编制/装备/战役/地形
- 同人 → 原作设定/OC/时间线偏离
- 轻小说 → 日常/校园/社团/事件
- 克苏鲁 → 神话体系/SAN值/禁忌知识
- 赛博朋克 → 义体/公司/黑市/网络空间
- 灵异 → 灵体/规则/禁忌/道具

**验证**: 选择任何题材建书后，经纬自动创建对应的完整 section 结构

---

## Phase 2：层级树 + 关系图谱（P1）

### 2.1 层级树（parentId）

**数据模型**: `jingwei_entries` 表新增 `parent_id` 字段
**前端**: 递归树组件，支持展开/折叠/拖拽排序

**示例**：
```
觅灵界
├── 煅域大陆
│   ├── 黑煅矿脉
│   └── 炎煅城
└── 灵域大陆
    ├── 天南地区
    └── 乱星海
```

**验证**: 用户能创建多级层级，拖拽调整父子关系

### 2.2 关系图谱（react-flow）

**数据模型**: 新增 `jingwei_relations` 表
```sql
CREATE TABLE jingwei_relations (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  source_entry_id TEXT NOT NULL,
  target_entry_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,  -- parent-child/ally/enemy/master-disciple/lover/belongs-to/located-in/custom
  label TEXT,
  metadata_json TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL
);
```

**前端**: react-flow 图谱视图
- 节点 = 经纬条目（自定义卡片节点：名称 + 类型图标 + 摘要）
- 边 = 关系（带标签 + 方向箭头 + 颜色按类型）
- 交互：拖拽连线创建关系、点击节点编辑、右键删除

**验证**: 用户能在图谱上看到角色关系网，拖拽创建新关系

### 2.3 Progressions（时间演进）

**对标 NovelCrafter**: 角色状态随章节变化

**数据模型**: 新增 `jingwei_progressions` 表
```sql
CREATE TABLE jingwei_progressions (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  field_key TEXT NOT NULL,      -- 哪个字段变化了（如 "realm"）
  old_value TEXT,
  new_value TEXT NOT NULL,
  chapter_number INTEGER,       -- 在哪一章发生的
  description TEXT,             -- 变化描述
  created_at INTEGER NOT NULL
);
```

**前端**: 条目详情页显示"演变时间线"
**AI 注入**: 写章时只注入当前章节对应的最新状态，不注入未来状态

**验证**: 角色境界提升后，AI 在后续章节中使用新境界

---

## Phase 3：长篇连贯性机制（P1）

### 3.1 递归摘要（卷→篇→书）

**现状**: 只有章节摘要（`bible_chapter_summary`）
**目标**: 三级摘要金字塔

```
书级摘要（1 个，~500 tokens）— 每 100 章重新生成
├── 篇级摘要（每 100 章 1 个，~1000 tokens）
│   ├── 卷级摘要（每 30 章 1 个，~800 tokens）
│   │   └── 章节摘要（每章 1 个，~200 tokens）
```

**触发时机**：
- 章节摘要：每章写完后自动生成
- 卷级摘要：每 30 章自动生成（LLM 压缩该卷所有章节摘要）
- 篇级摘要：每 100 章自动生成
- 书级摘要：每 100 章重新生成

**验证**: 写到第 100 章时，系统自动有卷级摘要 + 篇级摘要

### 3.2 经纬自动更新（写后）

**现状**: 写完章节后不更新经纬
**目标**: Pipeline 写完章节后，自动提取变化并更新经纬

**实现**：
- Writer Agent 写完章节 → ContinuityAuditor 审计 → 提取变化列表
- 变化列表：角色境界变化 / 新地点出现 / 关系变化 / 伏笔推进
- 自动创建 Progression 记录
- 自动更新条目字段（如角色当前境界）

**验证**: 主角突破金丹期后，经纬中角色境界自动更新

### 3.3 写前 Briefing 自动生成

**现状**: 无
**目标**: 写每章前自动生成一份 Briefing 注入 prompt

**Briefing 内容**：
- 当前主线（来自大纲）
- 本章计划（来自 volume_outline）
- 活跃角色（本章可能涉及的角色当前状态）
- 未解决事项（到期伏笔 + 未闭合因果链）
- 硬约束（不可违反的设定规则）
- 文风参照（句长/对话比例/禁用词）

**验证**: Agent 写章时 prompt 中包含结构化 Briefing

### 3.4 因果链状态机

**数据模型**: 新增 `jingwei_causal_chains` 表
```sql
CREATE TABLE jingwei_causal_chains (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  trigger_chapter INTEGER NOT NULL,
  trigger_event TEXT NOT NULL,
  expected_resolution TEXT,
  status TEXT NOT NULL DEFAULT 'open',  -- open/progressing/resolved/abandoned
  last_progress_chapter INTEGER,
  urgency TEXT DEFAULT 'low',  -- low/medium/high/overdue
  created_at INTEGER NOT NULL
);
```

**自动升级规则**：
- 20 章未推进 → urgency: medium
- 50 章未推进 → urgency: high
- 100 章未推进 → urgency: overdue（强制提醒）

**验证**: PGI 追问中包含"overdue"因果链的强制提醒

### 3.5 角色生命周期自动降级

**规则**：
- 50 章未出场 → lifecycle: dormant（不主动注入）
- 100 章未出场 → lifecycle: retired（只在被提及时注入）
- 死亡 → lifecycle: dead（只在回忆时注入）

**验证**: 100 章前出场的配角不再占用 token 预算

---

## Phase 4：智能预设补全（P2 — 来自 smart-preset-system spec）

### 4.1 反思模型自动选预设

**现状**: 预设只能手动启用
**目标**: 写完章节后，反思模型分析内容并建议启用/禁用预设

### 4.2 写后预设合规检查

**现状**: 无
**目标**: 写完章节后检查是否违反已启用预设的规则

---

## Phase 5：联想层（P3 — 来自 Wave Memory/VCP 启发）

### 5.1 Tag 共现图自动构建

**现状**: 无
**目标**: 从已写章节中自动提取 Tag，构建共现图

**实现**：
- 每章写完后，提取出现的实体名称（角色/地点/物品）
- 同一章出现的实体之间建立共现边
- 共现次数越多，边权重越高

### 5.2 脉冲传播联想检索

**现状**: 经纬注入只用精确匹配（alias-matcher）
**目标**: 除了精确匹配，还能通过共现图发现"弱相关但可能有用"的条目

### 5.3 做梦系统

**现状**: 无
**目标**: 每写完一卷，后台自动发现跨章节的隐藏联系

---

## 技术选型

| 层 | 技术 | 理由 |
|---|------|------|
| 数据存储 | SQLite（已有） | 新增 relations/progressions/causal_chains 表 |
| 层级树前端 | 自建递归组件 | 轻量，项目已有 BranchTree 可参考 |
| 关系图谱前端 | react-flow（已安装） | 项目已用于章节图，风格统一 |
| 结构化表单 | 动态 schema 渲染 | 根据 section.fieldsJson 生成 Input/Select/Tags/Textarea |
| 联想计算 | 后端 TypeScript | 共现矩阵 + 脉冲传播，纯数值计算 |
| 递归摘要 | LLM 调用 | 定时任务，用 summaryModel |

---

## 实施顺序

```
Phase 1 (5-7 天) — 经纬 CRUD UI + 结构化表单 + 模板补全
Phase 2 (3-5 天) — 层级树 + 关系图谱 + Progressions
Phase 3 (3-5 天) — 递归摘要 + 自动更新 + Briefing + 因果链
Phase 4 (2-3 天) — 智能预设反思
Phase 5 (3-5 天) — 联想层（共现图 + 脉冲传播 + 做梦）
```

总计约 16-25 天。Phase 1 是最高优先级——没有前端 UI，其他一切都是空中楼阁。
