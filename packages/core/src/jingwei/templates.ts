import type {
  AppliedJingweiTemplate,
  JingweiTemplateSection,
  JingweiTemplateSelection,
  JingweiVisibilityRuleType,
} from "./types.js";

function createSection(input: {
  key: string;
  name: string;
  description: string;
  builtinKind?: string;
  defaultVisibility?: JingweiVisibilityRuleType;
  sourceTemplate?: string;
}): Omit<JingweiTemplateSection, "order"> {
  return {
    key: input.key,
    name: input.name,
    description: input.description,
    enabled: true,
    showInSidebar: true,
    participatesInAi: true,
    defaultVisibility: input.defaultVisibility ?? "tracked",
    fieldsJson: [],
    ...(input.builtinKind ? { builtinKind: input.builtinKind } : {}),
    ...(input.sourceTemplate ? { sourceTemplate: input.sourceTemplate } : {}),
  };
}

const BASIC_SECTIONS: Array<Omit<JingweiTemplateSection, "order">> = [
  createSection({
    key: "people",
    name: "人物",
    description: "记录主角、配角、反派、群像关系与阶段变化。",
    builtinKind: "people",
  }),
  createSection({
    key: "events",
    name: "事件",
    description: "记录关键事件、转折、因果链和时间线推进。",
    builtinKind: "events",
  }),
  createSection({
    key: "settings",
    name: "设定",
    description: "记录世界观、力量体系、地图、规则、组织、物品和术语。",
    builtinKind: "settings",
    defaultVisibility: "global",
  }),
  createSection({
    key: "chapter-summary",
    name: "章节摘要",
    description: "按章节沉淀已发生内容，帮助长篇连续性追踪。",
    builtinKind: "chapter-summary",
    defaultVisibility: "global",
  }),
];

const ENHANCED_EXTRA_SECTIONS: Array<Omit<JingweiTemplateSection, "order">> = [
  createSection({
    key: "foreshadowing",
    name: "伏笔",
    description: "记录线索的埋设、推进、回收和遗落。",
    builtinKind: "foreshadowing",
  }),
  createSection({
    key: "iconic-scenes",
    name: "名场面",
    description: "记录爆点、反差桥段、成梗场景和高传播片段。",
    builtinKind: "iconic-scenes",
  }),
  createSection({
    key: "core-memory",
    name: "核心记忆",
    description: "记录给 AI 常驻使用的小而硬书设，不替代完整经纬。",
    builtinKind: "core-memory",
    defaultVisibility: "global",
  }),
];

const GENRE_RECOMMENDATIONS: Record<string, Array<Omit<JingweiTemplateSection, "order">>> = {
  xuanhuan: [
    createSection({ key: "power-system", name: "境界体系", description: "记录境界层级、突破条件、战力边界和代价。", sourceTemplate: "genre-recommended:xuanhuan", defaultVisibility: "global" }),
    createSection({ key: "skills", name: "功法", description: "记录功法、术法、神通、传承和修炼限制。", sourceTemplate: "genre-recommended:xuanhuan" }),
    createSection({ key: "factions", name: "势力", description: "记录宗门、家族、组织、阵营关系和利益冲突。", sourceTemplate: "genre-recommended:xuanhuan" }),
    createSection({ key: "resources", name: "资源", description: "记录灵石、丹药、材料、地脉、产业和稀缺性。", sourceTemplate: "genre-recommended:xuanhuan" }),
    createSection({ key: "artifacts", name: "法宝", description: "记录法器、灵宝、道具、装备和使用条件。", sourceTemplate: "genre-recommended:xuanhuan" }),
    createSection({ key: "secret-realms", name: "秘境", description: "记录秘境、副本、遗迹、禁地和进入规则。", sourceTemplate: "genre-recommended:xuanhuan" }),
  ],
  xiuxian: [
    createSection({ key: "power-system", name: "境界体系", description: "记录境界层级、突破条件、战力边界和代价。", sourceTemplate: "genre-recommended:xiuxian", defaultVisibility: "global" }),
    createSection({ key: "skills", name: "功法", description: "记录功法、术法、神通、传承和修炼限制。", sourceTemplate: "genre-recommended:xiuxian" }),
    createSection({ key: "factions", name: "势力", description: "记录宗门、家族、组织、阵营关系和利益冲突。", sourceTemplate: "genre-recommended:xiuxian" }),
    createSection({ key: "resources", name: "资源", description: "记录灵石、丹药、材料、地脉、产业和稀缺性。", sourceTemplate: "genre-recommended:xiuxian" }),
    createSection({ key: "artifacts", name: "法宝", description: "记录法器、灵宝、道具、装备和使用条件。", sourceTemplate: "genre-recommended:xiuxian" }),
    createSection({ key: "secret-realms", name: "秘境", description: "记录秘境、副本、遗迹、禁地和进入规则。", sourceTemplate: "genre-recommended:xiuxian" }),
  ],
  suspense: [
    createSection({ key: "clues", name: "线索", description: "记录线索来源、可信度、指向对象和揭示节点。", sourceTemplate: "genre-recommended:suspense" }),
    createSection({ key: "mysteries", name: "谜团", description: "记录核心谜题、阶段性答案和误导信息。", sourceTemplate: "genre-recommended:suspense" }),
    createSection({ key: "misdirections", name: "误导项", description: "记录红鲱鱼、伪证、错误推理和回收方式。", sourceTemplate: "genre-recommended:suspense" }),
    createSection({ key: "case-timeline", name: "案件时间线", description: "记录案发前后事实顺序与角色行动。", sourceTemplate: "genre-recommended:suspense", defaultVisibility: "global" }),
    createSection({ key: "truth-layer", name: "真相层", description: "记录读者未知但作者需要掌控的真相分层。", sourceTemplate: "genre-recommended:suspense", defaultVisibility: "global" }),
  ],
  romance: [
    createSection({ key: "relationship-changes", name: "关系变化", description: "记录人物关系阶段、亲密度变化和触发事件。", sourceTemplate: "genre-recommended:romance" }),
    createSection({ key: "emotional-beats", name: "情感节点", description: "记录心动、拉扯、确认、破裂、修复等节拍。", sourceTemplate: "genre-recommended:romance" }),
    createSection({ key: "misunderstandings", name: "误会与和解", description: "记录误会来源、持续成本和和解契机。", sourceTemplate: "genre-recommended:romance" }),
    createSection({ key: "family-relations", name: "家庭关系", description: "记录家庭背景、亲缘压力和关系边界。", sourceTemplate: "genre-recommended:romance" }),
    createSection({ key: "character-growth", name: "人物成长", description: "记录人物成长目标、伤口、选择和阶段变化。", sourceTemplate: "genre-recommended:romance" }),
  ],
  scifi: [
    createSection({ key: "tech-tree", name: "科技树", description: "记录关键科技、限制、代价和推演边界。", sourceTemplate: "genre-recommended:scifi", defaultVisibility: "global" }),
    createSection({ key: "star-map", name: "星图", description: "记录星系、航线、殖民地和空间距离。", sourceTemplate: "genre-recommended:scifi" }),
    createSection({ key: "organizations", name: "组织", description: "记录公司、舰队、联盟、实验室和权力结构。", sourceTemplate: "genre-recommended:scifi" }),
    createSection({ key: "glossary", name: "术语表", description: "记录专有名词、缩写、规则和首次解释。", sourceTemplate: "genre-recommended:scifi", defaultVisibility: "global" }),
    createSection({ key: "experiments", name: "实验记录", description: "记录实验目的、变量、结果和副作用。", sourceTemplate: "genre-recommended:scifi" }),
  ],
  urban: [
    createSection({ key: "career-line", name: "职业线", description: "记录职业阶段、目标、资源和竞争关系。", sourceTemplate: "genre-recommended:urban" }),
    createSection({ key: "relationship-network", name: "关系网", description: "记录人脉、利益关系、冲突关系和可调用资源。", sourceTemplate: "genre-recommended:urban" }),
    createSection({ key: "assets", name: "资产", description: "记录金钱、公司、房产、道具和商业资源。", sourceTemplate: "genre-recommended:urban" }),
    createSection({ key: "city-map", name: "城市地图", description: "记录地点、动线、势力范围和场景功能。", sourceTemplate: "genre-recommended:urban" }),
    createSection({ key: "social-identity", name: "社会身份", description: "记录角色身份、公开形象、隐藏身份和变化节点。", sourceTemplate: "genre-recommended:urban" }),
  ],
};

const GENRE_ALIASES: Record<string, string> = {
  fantasy: "xuanhuan",
  玄幻: "xuanhuan",
  修仙: "xiuxian",
  仙侠: "xiuxian",
  悬疑: "suspense",
  盗墓: "suspense",
  女频: "romance",
  感情流: "romance",
  科幻: "scifi",
  都市: "urban",
};

function normalizeGenreKey(genre?: string): string {
  const normalized = String(genre ?? "").trim().toLowerCase();
  return GENRE_ALIASES[normalized] ?? normalized;
}

function cloneSections(
  sections: Array<Omit<JingweiTemplateSection, "order">>,
  sourceTemplate: string,
): JingweiTemplateSection[] {
  return sections.map((section, order) => ({
    ...section,
    fieldsJson: section.fieldsJson.map((field) => ({ ...field, ...(field.options ? { options: [...field.options] } : {}) })),
    sourceTemplate,
    order,
  }));
}

export function getGenreJingweiCandidates(genre?: string): JingweiTemplateSection[] {
  const genreKey = normalizeGenreKey(genre) || "xuanhuan";
  const candidates = GENRE_RECOMMENDATIONS[genreKey] ?? GENRE_RECOMMENDATIONS.xuanhuan;
  return cloneSections(candidates, `genre-recommended:${genreKey}`);
}

export function applyJingweiTemplate(selection: JingweiTemplateSelection): AppliedJingweiTemplate {
  switch (selection.templateId) {
    case "blank":
      return { templateId: "blank", sections: [], availableCandidates: [] };
    case "basic":
      return { templateId: "basic", sections: cloneSections(BASIC_SECTIONS, "basic"), availableCandidates: [] };
    case "enhanced":
      return {
        templateId: "enhanced",
        sections: cloneSections([...BASIC_SECTIONS, ...ENHANCED_EXTRA_SECTIONS], "enhanced"),
        availableCandidates: [],
      };
    case "genre-recommended": {
      const genreKey = normalizeGenreKey(selection.genre) || "xuanhuan";
      const availableCandidates = getGenreJingweiCandidates(genreKey);
      const selected = new Set(selection.selectedSectionKeys ?? []);
      return {
        templateId: "genre-recommended",
        sourceGenre: genreKey,
        availableCandidates,
        sections: selected.size > 0
          ? availableCandidates.filter((section) => selected.has(section.key)).map((section, order) => ({ ...section, order }))
          : [],
      };
    }
    default: {
      const _exhaustive: never = selection.templateId;
      return _exhaustive;
    }
  }
}
