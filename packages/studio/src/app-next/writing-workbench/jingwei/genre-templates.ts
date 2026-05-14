/**
 * Genre Templates — 26 genre templates for auto-creating jingwei sections
 * when a user creates a new book via NewBookGuide.
 */

export interface GenreTemplateEntry {
  category: string;
  title: string;
  fieldsJson?: Record<string, unknown>;
  description?: string;
}

export interface GenreTemplate {
  genre: string;
  aliases: string[];
  sections: string[];
  sampleEntries?: GenreTemplateEntry[];
}

const UNIVERSAL_SECTIONS = ["character", "event", "chapter-summary"];

export const GENRE_TEMPLATES: GenreTemplate[] = [
  // ─── 玄幻 ───
  {
    genre: "玄幻",
    aliases: ["fantasy", "玄幻小说", "东方玄幻"],
    sections: [...UNIVERSAL_SECTIONS, "power-system", "geography", "faction", "item", "skill"],
    sampleEntries: [
      {
        category: "power-system",
        title: "境界体系",
        fieldsJson: { name: "修炼境界", levels: "练气、筑基、金丹、元婴、化神、渡劫、大乘", description: "修炼者的等级划分" },
      },
    ],
  },
  // ─── 仙侠 ───
  {
    genre: "仙侠",
    aliases: ["修仙", "仙侠小说", "仙道"],
    sections: [...UNIVERSAL_SECTIONS, "power-system", "geography", "faction", "item", "skill"],
    sampleEntries: [
      {
        category: "power-system",
        title: "仙道境界",
        fieldsJson: { name: "仙道境界", levels: "炼气、筑基、金丹、元婴、化神、合体、渡劫、大乘、真仙", description: "仙道修炼体系" },
      },
    ],
  },
  // ─── 修真 ───
  {
    genre: "修真",
    aliases: ["修真小说", "修仙文"],
    sections: [...UNIVERSAL_SECTIONS, "power-system", "geography", "faction", "item", "skill"],
    sampleEntries: [
      {
        category: "power-system",
        title: "修真境界",
        fieldsJson: { name: "修真等级", levels: "练气、筑基、结丹、元婴、化神、渡劫、飞升", description: "修真者的修为划分" },
      },
    ],
  },
  // ─── 武侠 ───
  {
    genre: "武侠",
    aliases: ["武侠小说", "江湖", "古龙风"],
    sections: [...UNIVERSAL_SECTIONS, "skill", "faction", "item", "geography"],
    sampleEntries: [
      {
        category: "skill",
        title: "内功心法",
        fieldsJson: { name: "九阳神功", grade: "天级", effects: "纯阳内力，百毒不侵" },
      },
    ],
  },
  // ─── 都市 ───
  {
    genre: "都市",
    aliases: ["都市小说", "现代都市", "urban"],
    sections: [...UNIVERSAL_SECTIONS, "faction", "relationship", "geography", "currency"],
    sampleEntries: [
      {
        category: "faction",
        title: "商业集团",
        fieldsJson: { name: "天宇集团", type: "商会", goals: "控制城市经济命脉" },
      },
    ],
  },
  // ─── 科幻 ───
  {
    genre: "科幻",
    aliases: ["sci-fi", "科幻小说", "硬科幻", "软科幻"],
    sections: [...UNIVERSAL_SECTIONS, "worldview", "geography", "faction", "item", "special"],
    sampleEntries: [
      {
        category: "worldview",
        title: "星际文明等级",
        fieldsJson: { name: "文明等级", description: "基于卡尔达肖夫指数的文明分级", rules: "I型：行星级，II型：恒星级，III型：星系级" },
      },
    ],
  },
  // ─── 历史 ───
  {
    genre: "历史",
    aliases: ["历史小说", "架空历史", "历史穿越"],
    sections: [...UNIVERSAL_SECTIONS, "worldview", "faction", "geography", "timeline", "special"],
    sampleEntries: [
      {
        category: "timeline",
        title: "朝代纪年",
        fieldsJson: { name: "开国大典", date: "建元元年", description: "新朝建立的标志性事件" },
      },
    ],
  },
  // ─── 言情 ───
  {
    genre: "言情",
    aliases: ["言情小说", "romance", "甜宠", "虐恋"],
    sections: [...UNIVERSAL_SECTIONS, "relationship", "plot", "timeline"],
    sampleEntries: [
      {
        category: "relationship",
        title: "主CP关系",
        fieldsJson: { sourceName: "女主", targetName: "男主", relationType: "情侣", description: "核心感情线" },
      },
    ],
  },
  // ─── 悬疑 ───
  {
    genre: "悬疑",
    aliases: ["悬疑推理", "推理", "盗墓", "mystery"],
    sections: [...UNIVERSAL_SECTIONS, "foreshadowing", "timeline", "plot", "special"],
    sampleEntries: [
      {
        category: "foreshadowing",
        title: "核心谜题",
        fieldsJson: { name: "第一具尸体", status: "已埋设", description: "开篇悬念，贯穿全文的核心谜题" },
      },
    ],
  },
  // ─── 游戏 ───
  {
    genre: "游戏",
    aliases: ["游戏小说", "网游", "电竞", "game-lit"],
    sections: [...UNIVERSAL_SECTIONS, "power-system", "item", "skill", "geography", "special"],
    sampleEntries: [
      {
        category: "power-system",
        title: "等级系统",
        fieldsJson: { name: "玩家等级", levels: "1-10新手、11-30进阶、31-60精英、61-99大师、100满级", description: "游戏角色等级" },
      },
    ],
  },
  // ─── 末日 ───
  {
    genre: "末日",
    aliases: ["末日小说", "废土", "末世", "apocalypse"],
    sections: [...UNIVERSAL_SECTIONS, "worldview", "geography", "faction", "item", "special"],
    sampleEntries: [
      {
        category: "worldview",
        title: "末日起源",
        fieldsJson: { name: "灾变", description: "导致文明崩溃的核心事件", rules: "灾变后的世界运行规则" },
      },
    ],
  },
  // ─── 穿越 ───
  {
    genre: "穿越",
    aliases: ["穿越小说", "异世界", "isekai"],
    sections: [...UNIVERSAL_SECTIONS, "worldview", "timeline", "special", "foreshadowing"],
    sampleEntries: [
      {
        category: "special",
        title: "穿越设定",
        fieldsJson: { name: "穿越机制", description: "主角穿越的方式与限制", rules: "穿越后保留的能力与记忆" },
      },
    ],
  },
  // ─── 重生 ───
  {
    genre: "重生",
    aliases: ["重生小说", "重生文"],
    sections: [...UNIVERSAL_SECTIONS, "timeline", "foreshadowing", "relationship", "special"],
    sampleEntries: [
      {
        category: "foreshadowing",
        title: "前世记忆",
        fieldsJson: { name: "前世关键事件", status: "已埋设", description: "主角前世经历中可利用的信息" },
      },
    ],
  },
  // ─── 系统流 ───
  {
    genre: "系统流",
    aliases: ["系统文", "金手指", "system"],
    sections: [...UNIVERSAL_SECTIONS, "power-system", "item", "special", "plot"],
    sampleEntries: [
      {
        category: "special",
        title: "系统规则",
        fieldsJson: { name: "系统", description: "主角获得的系统金手指", rules: "任务发布、奖惩机制、升级条件" },
      },
    ],
  },
  // ─── 无限流 ───
  {
    genre: "无限流",
    aliases: ["无限恐怖", "副本流", "infinite"],
    sections: [...UNIVERSAL_SECTIONS, "worldview", "power-system", "special", "geography"],
    sampleEntries: [
      {
        category: "worldview",
        title: "主神空间",
        fieldsJson: { name: "主神空间", description: "轮回者休息与交易的中转站", rules: "副本选择、积分兑换、团队机制" },
      },
    ],
  },
  // ─── 诡秘 ───
  {
    genre: "诡秘",
    aliases: ["诡秘小说", "克苏鲁风", "诡异"],
    sections: [...UNIVERSAL_SECTIONS, "power-system", "faction", "special", "foreshadowing"],
    sampleEntries: [
      {
        category: "power-system",
        title: "序列途径",
        fieldsJson: { name: "序列", levels: "序列9→序列0", description: "非凡者的力量等级，数字越小越强" },
      },
    ],
  },
  // ─── 赘婿 ───
  {
    genre: "赘婿",
    aliases: ["赘婿文", "上门女婿"],
    sections: [...UNIVERSAL_SECTIONS, "relationship", "faction", "plot", "special"],
    sampleEntries: [
      {
        category: "relationship",
        title: "家族关系",
        fieldsJson: { sourceName: "主角", targetName: "岳父", relationType: "其他", description: "入赘后的家族权力关系" },
      },
    ],
  },
  // ─── 种田 ───
  {
    genre: "种田",
    aliases: ["种田文", "经营", "基建"],
    sections: [...UNIVERSAL_SECTIONS, "geography", "item", "currency", "faction"],
    sampleEntries: [
      {
        category: "geography",
        title: "领地",
        fieldsJson: { name: "起始村庄", locationType: "其他", description: "主角经营发展的起始据点" },
      },
    ],
  },
  // ─── 官场 ───
  {
    genre: "官场",
    aliases: ["官场小说", "权谋", "宫斗"],
    sections: [...UNIVERSAL_SECTIONS, "faction", "relationship", "plot", "special"],
    sampleEntries: [
      {
        category: "faction",
        title: "派系",
        fieldsJson: { name: "改革派", type: "联盟", goals: "推动制度变革" },
      },
    ],
  },
  // ─── 军事 ───
  {
    genre: "军事",
    aliases: ["军事小说", "战争", "军旅"],
    sections: [...UNIVERSAL_SECTIONS, "faction", "geography", "item", "timeline"],
    sampleEntries: [
      {
        category: "timeline",
        title: "战役时间线",
        fieldsJson: { name: "首战", date: "第一年秋", description: "第一场关键战役" },
      },
    ],
  },
  // ─── 体育 ───
  {
    genre: "体育",
    aliases: ["体育小说", "竞技", "sports"],
    sections: [...UNIVERSAL_SECTIONS, "plot", "timeline", "special"],
    sampleEntries: [
      {
        category: "special",
        title: "赛事规则",
        fieldsJson: { name: "联赛赛制", description: "核心赛事的规则与晋级机制" },
      },
    ],
  },
  // ─── 同人 ───
  {
    genre: "同人",
    aliases: ["同人小说", "fanfic", "二创"],
    sections: [...UNIVERSAL_SECTIONS, "worldview", "timeline", "special"],
    sampleEntries: [
      {
        category: "worldview",
        title: "原作设定",
        fieldsJson: { name: "原作世界观", description: "沿用的原作核心设定", rules: "与原作的偏离点" },
      },
    ],
  },
  // ─── 轻小说 ───
  {
    genre: "轻小说",
    aliases: ["轻小说风", "light-novel", "日轻"],
    sections: [...UNIVERSAL_SECTIONS, "relationship", "plot"],
    sampleEntries: [
      {
        category: "relationship",
        title: "角色关系图",
        fieldsJson: { sourceName: "主角", targetName: "女主", relationType: "情侣", description: "核心人物关系" },
      },
    ],
  },
  // ─── 克苏鲁 ───
  {
    genre: "克苏鲁",
    aliases: ["cthulhu", "洛夫克拉夫特", "宇宙恐怖"],
    sections: [...UNIVERSAL_SECTIONS, "worldview", "special", "foreshadowing", "item"],
    sampleEntries: [
      {
        category: "special",
        title: "SAN值机制",
        fieldsJson: { name: "理智值", description: "角色接触不可名状之物后的精神状态", rules: "SAN值归零则永久疯狂" },
      },
    ],
  },
  // ─── 赛博朋克 ───
  {
    genre: "赛博朋克",
    aliases: ["cyberpunk", "赛博", "高科技低生活"],
    sections: [...UNIVERSAL_SECTIONS, "worldview", "faction", "item", "geography", "special"],
    sampleEntries: [
      {
        category: "item",
        title: "义体改造",
        fieldsJson: { name: "神经接口", effect: "直连网络，加速信息处理", limitations: "过度改造导致人性丧失" },
      },
    ],
  },
  // ─── 灵异 ───
  {
    genre: "灵异",
    aliases: ["灵异小说", "鬼怪", "恐怖", "horror"],
    sections: [...UNIVERSAL_SECTIONS, "worldview", "special", "foreshadowing", "item"],
    sampleEntries: [
      {
        category: "special",
        title: "灵异规则",
        fieldsJson: { name: "鬼怪规则", description: "灵异现象的运行法则", rules: "鬼怪出没的条件与限制" },
      },
    ],
  },
];

/**
 * Find a genre template by genre name or alias (case-insensitive).
 */
export function getGenreTemplate(genre: string): GenreTemplate | undefined {
  const normalized = genre.trim().toLowerCase();
  return GENRE_TEMPLATES.find(
    (t) =>
      t.genre.toLowerCase() === normalized ||
      t.aliases.some((a) => a.toLowerCase() === normalized),
  );
}
