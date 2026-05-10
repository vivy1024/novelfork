import type { BuiltinQuestionnaireTemplate, QuestionnaireQuestion } from "../../types.js";

const version = "1.0.0";

function q(
  id: string,
  prompt: string,
  fieldPath: string,
  options?: string[],
  type: QuestionnaireQuestion["type"] = options ? "single" : "text",
): QuestionnaireQuestion {
  return {
    id,
    prompt,
    type,
    ...(options ? { options } : {}),
    mapping: { fieldPath, transform: type === "multi" ? "join-comma" : "identity" },
    defaultSkippable: false,
  };
}

function template(
  id: string,
  tier: BuiltinQuestionnaireTemplate["tier"],
  targetObject: BuiltinQuestionnaireTemplate["targetObject"],
  genreTags: string[],
  questions: QuestionnaireQuestion[],
): BuiltinQuestionnaireTemplate {
  return { id, version, tier, targetObject, genreTags, questions };
}

export const builtinQuestionnaireTemplates: BuiltinQuestionnaireTemplate[] = [
  template("tier1-common-premise", 1, "premise", ["通用"], [
    q("logline", "用一句话说清这本书最核心的爽点和主角目标。", "logline"),
    q("theme", "这本书最想反复证明的主题是什么？", "theme", undefined, "text"),
    q("tone", "整体基调更接近哪一种？", "tone", ["热血", "轻松", "沉郁", "黑暗", "治愈"]),
    q("target-readers", "你最想服务哪类读者？", "targetReaders"),
    q("unique-hook", "这本书和同类作品最大的差异化钩子是什么？", "uniqueHook"),
    q("genre-tags", "列出 2-4 个核心类型标签。", "genreTags", undefined, "text"),
  ]),
  template("tier1-xuanhuan-premise", 1, "premise", ["玄幻", "修仙"], [
    q("logline", "主角如何用独特资源或天赋撬动升级路径？", "logline"),
    q("power-hook", "力量体系最能制造期待的钩子是什么？", "uniqueHook"),
    q("tone", "玄幻体验更偏哪种？", "tone", ["热血升级", "谨慎经营", "群像史诗", "黑暗求生"]),
    q("theme", "升级背后要表达的主题是什么？", "theme"),
    q("target-readers", "面向哪类玄幻/修仙读者？", "targetReaders"),
    q("genre-tags", "补充流派标签。", "genreTags"),
  ]),
  template("tier1-dushi-premise", 1, "premise", ["都市"], [
    q("logline", "主角在现实社会中解决什么强冲突？", "logline"),
    q("social-hook", "都市题材的现实差异化钩子是什么？", "uniqueHook"),
    q("tone", "都市体验更偏哪种？", "tone", ["轻松爽文", "现实逆袭", "悬疑商战", "情感治愈"]),
    q("theme", "现实矛盾背后的主题是什么？", "theme"),
    q("target-readers", "面向哪类都市读者？", "targetReaders"),
    q("genre-tags", "补充都市子类型标签。", "genreTags"),
  ]),
  template("tier2-xuanhuan-world", 2, "world-model", ["玄幻", "修仙"], [
    q("level-tiers", "列出主要境界/等级分层。", "powerSystem.levelTiers"),
    q("bottleneck", "突破瓶颈资源是什么？", "powerSystem.bottleneckResources"),
    q("breakthrough-cost", "突破失败或强行突破要付出什么代价？", "powerSystem.breakthroughCost"),
    q("scarcity", "世界最核心的稀缺物是什么？", "economy.scarcity"),
    q("factions", "最重要的门派/势力及其职能是什么？", "society.keyInstitutions"),
  ]),
  template("tier2-dushi-world", 2, "world-model", ["都市"], [
    q("currency", "主要财富单位或资源指标是什么？", "economy.currency"),
    q("class-income", "不同阶层的典型收入或资源差距是什么？", "economy.classIncomeLevels"),
    q("government", "关键制度或行业监管是什么？", "society.governmentType"),
    q("mobility", "阶层流动的真实难点是什么？", "society.classMobility"),
    q("regions", "核心城市/区域差异是什么？", "geography.keyRegions"),
  ]),
  template("tier2-common-conflict", 2, "conflict", ["通用"], [
    q("name", "这个矛盾的短名称是什么？", "name"),
    q("type", "它属于哪类矛盾？", "type", ["external-character", "external-power", "external-world", "internal-value", "system-scarcity"]),
    q("scope", "影响范围是什么？", "scope", ["main", "arc", "chapter", "scene"]),
    q("stakes", "如果主角失败会失去什么？", "stakes"),
    q("root-cause", "矛盾的根因是什么？", "rootCause.summary"),
  ]),
  template("tier2-common-character-arc", 2, "character-arc", ["通用"], [
    q("character-id", "这条弧线属于哪个角色？", "characterId"),
    q("arc-type", "弧线类型是什么？", "arcType", ["成长", "堕落", "平移", "反转", "救赎"]),
    q("start", "角色起点状态是什么？", "startingState"),
    q("end", "角色终点状态是什么？", "endingState"),
    q("current", "当前章节附近处于弧线哪一段？", "currentPosition"),
  ]),
  template("tier2-common-character", 2, "character", ["通用"], [
    q("name", "角色姓名是什么？", "name"),
    q("aliases", "角色别名/称号有哪些？", "aliases"),
    q("role", "角色定位是什么？", "roleType", ["protagonist", "supporting", "antagonist", "minor"]),
    q("summary", "用两句话概括角色功能。", "summary"),
    q("traits", "最稳定的性格/能力标签是什么？", "traits.tags"),
  ]),
  template("tier2-common-setting", 2, "setting", ["通用"], [
    q("name", "设定条目名称是什么？", "name"),
    q("category", "设定分类是什么？", "category", ["worldview", "power-system", "map", "faction", "golden-finger", "background", "other"]),
    q("content", "这条设定的硬规则是什么？", "content"),
    q("visibility", "它是否需要始终给 AI 看？", "visibilityRule.type", ["global", "tracked", "nested"]),
    q("refs", "它依赖哪些其他条目？", "nestedRefs"),
  ]),
  template("tier3-common-world-full", 3, "world-model", ["通用"], [
    q("economy-currency", "货币/通用资源单位是什么？", "economy.currency"),
    q("economy-scarcity", "稀缺性如何制造冲突？", "economy.scarcity"),
    q("society-government", "权力结构如何运行？", "society.governmentType"),
    q("society-taboos", "有哪些禁忌会影响剧情？", "society.taboos"),
    q("geography-climate", "气候如何影响生活和战斗？", "geography.climateImpact"),
    q("geography-transport", "交通限制如何制造剧情成本？", "geography.transportConstraints"),
    q("power-tiers", "力量等级如何分层？", "powerSystem.levelTiers"),
    q("power-contradictions", "力量体系内部有哪些矛盾？", "powerSystem.systemContradictions"),
    q("culture-languages", "语言/宗教/风俗如何区分群体？", "culture.languages"),
    q("timeline-era", "故事处于什么纪年或时代？", "timeline.era"),
  ]),
];
