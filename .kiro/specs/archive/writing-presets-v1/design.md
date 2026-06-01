# Design Document

## Overview

本设计为 NovelFork 的写作预设体系填充真实内容，使流派配置、文风预设、时代/社会基底、逻辑风险自检、节拍模板、AI 味过滤预设、文学技法预设和经纬题材推荐从空壳变为开箱即用。

本次升级的关键变化：`tone` 不再承担全部创作基底。文风只是语言气质；真正决定文本是否可信的，是题材、时代基底、制度逻辑、生产力水平、阶层结构、信息传播方式和人物动机共同形成的约束。

因此本 spec 将预设拆成四层：

1. **Genre**：题材骨架，回答“写什么类型”。
2. **Tone**：语言气质，回答“怎么叙述”。
3. **Setting Base**：时代/社会/制度基底，回答“这个世界如何运转”。
4. **Logic Risk**：逻辑风险自检，回答“哪里容易违和”。

`Bundle` 用于把四层组合成作者可直接选择的创作基底包。

## Goals

- 预置 6+ 热门流派的完整 GenreProfile。
- 内置 5 个文风 tone 预设模板，但 tone 只管语言气质。
- 内置 6 个时代/社会基底 setting base。
- 内置一组逻辑风险 logic risk 规则，用于写前约束和写后审计。
- 内置 6 个推荐 bundle，把 genre/tone/setting/logic 组合起来。
- 内置 5 个叙事节拍模板。
- 内置 4 个 AI 味过滤预设。
- 内置 4 个文学技法预设。
- 为 6 个题材填充经纬推荐栏目的具体内容。
- 提供预设管理 UI。

## Non-Goals

- 不实现完整模板市场（后续 `template-market-v1`）。
- 不自动生成流派资产（后续 `coding-agent-workbench`）。
- 不替代作者自己的世界观设定，只提供可修改的默认基底。
- 不把现实历史当作必须复刻的设定；历史只作为架空创作的参照锚点。
- 不在 `platform-compliance-v1` 中处理小说内部逻辑自洽；合规只处理平台/法律/发布风险。

## Cross-Spec Boundaries

| Spec | 职责 | 与 writing-presets 的关系 |
|---|---|---|
| `writing-presets-v1` | 提供 genre/tone/setting/logic/bundle 默认内容 | 当前 spec 主体 |
| `writing-modes-v1` | 选段续写、扩写、对话、多版本、大纲分支 | 生成时注入 tone、setting、logic 约束 |
| `writing-tools-v1` | 文风偏离、设定漂移、全书健康、矛盾/弧线追踪 | 写后复用 logic risk 和 setting boundary 做审计 |
| `platform-compliance-v1` | 敏感词、AI 比例、格式、发布就绪 | 与内部逻辑自检并列展示，不互相替代 |
| `narrafork-platform-upgrade` | Bun/SQLite/API gate/恢复链底座 | 后续持久化启用预设、审计日志和书籍配置 |

## Architecture

### 文件组织

```text
packages/core/src/presets/
  index.ts                           ← 预设注册中心
  types.ts                           ← Preset / Tone / SettingBase / LogicRisk / Bundle 类型
  genres/
    xianxia.md                       ← 修仙/玄幻 GenreProfile
    urban.md                         ← 都市异能
    mystery.md                       ← 悬疑/盗墓
    romance.md                       ← 女频/宅斗
    scifi.md                         ← 科幻
    history.md                       ← 历史穿越
  tones/
    tragic-solitude.md               ← 悲苦孤独（纯语言气质）
    austere-pragmatic.md             ← 冷峻质朴（纯语言气质）
    classical-imagery.md             ← 古典意境（纯语言气质）
    dark-humor-social.md             ← 黑色幽默+社会批判（纯语言气质与讽刺口吻）
    comedic-light.md                 ← 沙雕轻快（纯语言气质）
  setting-bases/
    victorian-industrial-occult.md   ← 维多利亚/工业革命影子的神秘学城市
    classical-travelogue-jianghu.md  ← 古典游历、志怪、江湖与地方秩序
    sect-family-xianxia.md           ← 宗门/家族/资源分配修仙社会
    modern-platform-economy-satire.md← 现代平台经济讽刺
    historical-court-livelihood.md   ← 朝堂、民生、军政、技术差
    near-future-industrial-scifi.md  ← 近未来工业科幻
  logic-risks/
    anachronism.ts                   ← 时代错位
    information-flow.ts              ← 信息传播速度
    economy-resource.ts              ← 经济/资源体系
    institution-response.ts          ← 权力机构响应
    technology-boundary.ts           ← 技术/魔法边界
    character-motivation.ts          ← 人物动机与阶层行为
    geography-transport.ts           ← 地理/交通
    satisfaction-cost.ts             ← 爽点代价
  bundles/
    industrial-occult-mystery.ts
    classical-travel-xianxia.ts
    mortal-sect-xianxia.ts
    institutional-cultivation-satire.ts
    historical-governance.ts
    near-future-hard-scifi.ts
  beats/
    heros-journey.ts
    save-the-cat.ts
    three-act.ts
    opening-hooks.ts
    chapter-ending-hooks.ts
  anti-ai/
    full-scan.ts
    sentence-variance.ts
    emotion-concretize.ts
    dialogue-colloquial.ts
  literary/
    character-multidim.ts
    hook-four-states.ts
    consistency-audit.ts
    controlling-idea.ts

packages/core/src/jingwei/
  genre-recommendations.ts           ← 题材推荐栏目内容

packages/studio/src/pages/
  PresetManager.tsx                  ← 预设管理页面
packages/studio/src/api/routes/
  presets.ts                         ← 预设 API
```

## Data Model

### Preset 基础类型

```ts
export type PresetCategory =
  | "beat"
  | "tone"
  | "setting-base"
  | "logic-risk"
  | "bundle"
  | "anti-ai"
  | "literary";

export interface Preset {
  id: string;
  category: PresetCategory;
  name: string;
  description: string;
  applicableGenres: string[];       // 空=通用
  conflictGroup?: string;           // 同 group 互斥
  promptInjection: string;          // 注入 writer system prompt 的文本
  postWriteChecks?: PostWriteCheck[];
  metadata: Record<string, unknown>;
}
```

### TonePreset

`tone` 是预生成的 `style_guide.md` 模板，只描述语言与叙述气质，不混写时代基底。

```ts
export interface TonePreset extends Preset {
  category: "tone";
  dimensions: {
    narrativeVoice: string;
    dialogueStyle: string;
    sceneDescription: string;
    transitionMethod: string;
    pacing: string;
    vocabularyPreference: string;
    emotionalExpression: string;
    driftWarnings: string[];
  };
  sourceReferences: Array<{
    label: string;
    usableTechnique: string;
    boundary: "reference-only" | "do-not-copy";
  }>;
  recommendedSettingBases: string[];
}
```

### SettingBasePreset

`settingBase` 是可写入 `setting_guide.md` 或 `book_rules.md` 的时代/社会基底。

```ts
export interface SettingBasePreset extends Preset {
  category: "setting-base";
  referenceAnchors: string[];       // 历史/现实参照，不等于复刻
  socialHierarchy: string[];        // 阶层/职业/身份结构
  powerInstitutions: string[];      // 教会/警察/宗门/朝廷/平台/企业等
  economy: string[];                // 钱、资源、税、贷款、交易、生产方式
  techMagicBoundary: string[];      // 技术/魔法/超凡/生产力边界
  transportAndInformation: string[];// 交通速度、报纸、信件、网络、传音等
  dailyLifeMaterials: string[];     // 日常物件、空间、职业、生活材料
  borrowableElements: string[];     // 可借用元素
  forbiddenElements: string[];      // 不可照搬或易违和元素
  commonContradictions: string[];   // 常见违和点
}
```

### LogicRiskRule

`logicRisk` 同时服务写前 prompt 约束和写后审计。

```ts
export interface LogicRiskRule extends Preset {
  category: "logic-risk";
  riskType:
    | "anachronism"
    | "information-flow"
    | "economy-resource"
    | "institution-response"
    | "technology-boundary"
    | "character-motivation"
    | "geography-transport"
    | "satisfaction-cost";
  appliesToSettingBases: string[];
  writerConstraint: string;         // 生成前注入
  auditQuestion: string;            // 写后检查问题
  evidenceHints: string[];          // 审计时要找的证据
  uncertainHandling: string;        // 不确定时让作者确认
}
```

### PresetBundle

`bundle` 是给作者的一键推荐组合，但必须允许拆开。

```ts
export interface PresetBundle extends Preset {
  category: "bundle";
  genreIds: string[];
  toneId: string;
  settingBaseId: string;
  logicRiskIds: string[];
  difficulty: "easy" | "medium" | "hard";
  prerequisites: string[];
  suitableFor: string[];
  notSuitableFor: string[];
}
```

## Content Design

### Tone 预设边界

Tone 文件必须回答：

- 叙事声音与语气
- 对话风格
- 场景描写特征
- 转折与衔接手法
- 节奏特征
- 词汇偏好
- 情绪表达方式
- 禁止漂移方向
- 参考来源与可学习技法
- 推荐搭配的 setting base

Tone 文件不得完整描述时代制度。比如 `austere-pragmatic.md` 可以说明冷峻、克制、信息密度，但不能把维多利亚城市、警察、报纸、教会和工厂都写在 tone 里；这些应放到 `victorian-industrial-occult.md`。

### Setting Base 预设内容规范

每个 setting base `.md` 使用 Markdown，固定包含：

```markdown
## 现实/历史参照
## 社会阶层
## 权力结构
## 经济系统
## 技术/魔法边界
## 交通与信息传播
## 日常生活材料
## 可借用元素
## 不可照搬元素
## 常见违和点
```

#### `victorian-industrial-occult`

重点：工业城市、阶层分化、报纸/信件/警察/教会/工厂/码头、科学与神秘学并置。适合克苏鲁、诡秘、蒸汽、工业悬疑。风险：现代信息传播错位、超凡体系无成本、机构反应过慢或过快。

#### `modern-platform-economy-satire`

重点：平台经济、教育内卷、贷款、绩效、外包、算法审核、职业资格和制度话术。适合制度讽刺和黑色幽默。风险：只堆梗不形成制度逻辑；现实映射太直白导致失去架空安全距离。

#### `classical-travelogue-jianghu`

重点：交通慢、地理远、地方秩序、客栈/庙宇/市集/驿站、民俗和神灵。适合古典游历、志怪、轻仙侠。风险：古风辞藻替代生活材料；人物信息获取速度过快。

### Logic Risk 规则设计

每条 logic risk 至少包括：

- 写前约束：提醒 Writer Agent 不要犯什么错。
- 写后审计问题：供 `writing-tools-v1` 后续实现审计。
- 证据提示：审计时应看哪些文本迹象。
- 不确定处理：提示作者确认，而不是自动修改。

示例：

```ts
const informationFlowRisk: LogicRiskRule = {
  id: "information-flow",
  category: "logic-risk",
  name: "信息传播速度",
  riskType: "information-flow",
  appliesToSettingBases: ["victorian-industrial-occult", "classical-travelogue-jianghu", "historical-court-livelihood"],
  writerConstraint: "角色只能通过本时代允许的媒介获得信息，不得无解释地掌握远方即时消息。",
  auditQuestion: "本章是否出现信息传播速度超过所选 setting base 边界的情况？",
  evidenceHints: ["远方消息即时抵达", "普通人掌握机密", "机构无成本同步行动"],
  uncertainHandling: "标注为需要作者确认，并要求补充信息来源。",
};
```

### Bundle 推荐表

| Bundle | Genre | Tone | SettingBase | LogicRisks | 难度 |
|---|---|---|---|---|---|
| 工业神秘悬疑 | 悬疑/科幻 | 冷峻质朴 | victorian-industrial-occult | 信息传播、机构响应、技术边界 | hard |
| 古典游历仙侠 | 仙侠 | 古典意境 | classical-travelogue-jianghu | 交通地理、日常材料、人物动机 | medium |
| 凡人宗门修仙 | 修仙 | 悲苦/克制 | sect-family-xianxia | 资源经济、境界边界、组织成本 | medium |
| 制度修仙讽刺 | 都市/修仙 | 黑色幽默 | modern-platform-economy-satire | 制度响应、经济资源、爽点代价 | hard |
| 历史穿越治世 | 历史 | 古典/质朴 | historical-court-livelihood | 财政、技术差、军政响应 | hard |
| 近未来硬科幻 | 科幻 | 冷峻质朴 | near-future-industrial-scifi | 技术边界、组织响应、信息传播 | medium |

## Preset Injection 机制

预设注入分四段，顺序固定：

```text
## 流派规则
{genre_profile 摘要}

## 文风规则
{tone promptInjection}

## 时代/社会基底
{settingBase promptInjection}

## 逻辑风险约束
{logicRisk writerConstraint 列表}
```

`writing-modes-v1` 中的选段续写、扩写、对话生成、多版本和大纲分支都读取同一套 `enabledPresets`。`writing-tools-v1` 的文风偏离、设定漂移和逻辑自检读取同一套 setting/logic 声明。

## Post-Write Checks

| 类型 | 来源 | 后续执行位置 |
|---|---|---|
| 句长方差 | anti-ai preset | Writer Agent 后置检查 / writing-tools rhythm |
| 情感具体化 | anti-ai preset | Writer Agent 后置检查 |
| 对话口语化 | anti-ai preset | dialogue analyzer |
| 文风偏离 | tone preset | writing-tools tone drift |
| 时代/设定漂移 | setting base | writing-tools setting drift |
| 逻辑风险 | logic risk | writing-tools logic audit |
| 伏笔四态 | literary preset | pending_hooks / health dashboard |

## UI 设计

### PresetManager 页面

```text
写作预设
  Tab：推荐组合 / 流派 / 文风 / 时代基底 / 逻辑自检 / 节拍 / AI味 / 文学技法

  推荐组合卡片：
    - 名称 + 难度
    - 适用题材
    - 包含：genre/tone/setting/logic
    - 适用/不适用场景
    - [启用组合] [自定义拆分]

  单项预设卡片：
    - 名称 + 一句话说明
    - 适用流派标签
    - 冲突提示
    - 启用/禁用
    - 展开详情
```

使用 shadcn/ui：`Tabs`、`Card`、`Switch`、`Badge`、`Dialog`、`Button`、`ScrollArea`、`Accordion`。

### 建书流程集成

在 `BookCreate.tsx` 的题材字段后增加：

1. 选择流派。
2. 推荐 bundle。
3. 展示 bundle 内的 tone / settingBase / logicRisks。
4. 作者可一键启用或拆分修改。
5. 写入 `book_rules.md` / `style_guide.md` / `setting_guide.md` / enabled presets 配置。

## Testing Strategy

### Unit Tests

- GenreProfile：所有 `.md` YAML 解析正确，必填字段完整。
- Tone：包含规定维度；包含来源说明；不得包含完整 setting base 标题集合。
- SettingBase：6 个文件存在；每个包含 10 个固定章节；包含现实/历史参照和常见违和点。
- LogicRisk：每条规则包含 `writerConstraint`、`auditQuestion`、`uncertainHandling`。
- Bundle：每个 bundle 引用的 genre/tone/settingBase/logicRisk 都存在；高难度 bundle 标注 prerequisite。
- BeatTemplate：节拍数量和 wordRatio 正确。
- AI 味过滤：promptInjection 非空，postWriteChecks 阈值合理。
- 文学技法：promptInjection 非空。
- 经纬推荐：栏目数量和名称正确。

### Integration Tests

- 启用 bundle → 生成 style_guide / setting_guide / enabled presets。
- `writing-modes` 读取 enabled presets → prompt 中包含 tone + setting + logic。
- 声明 setting base → logic risk 审计能读取边界。
- 选择互斥 tone 或冲突 setting → UI 给出冲突提示。

## Migration Note

当前已创建的 5 个 tone 文件视为草稿。后续实现应先重写 tone，使其只承担语言气质；再新增 setting base 和 logic risk 文件。`writing-presets-v1/tasks.md` 中 Task 3 应降级为“需升级”，不能继续把当前 tone 当完成态。
