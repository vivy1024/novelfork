/**
 * 来源专名的确定性识别：给模型的「可迁移」判断做后检。
 *
 * 2026-09-30 真模型基准（W0）里 19 条模型规则全部标成可迁移。提示词只能劝，
 * 这里再加一道不依赖模型的检查：规则正文里出现来源作品的高频专名（人名、地名、
 * 组织、专属意象），这条规则离开来源就不成立，应降为作品专属。
 *
 * 只用来源文本自身的统计，不猜内容，宁可漏判也不误判：
 * - 2–4 字的汉字串（允许夹一两个拉丁字母，如「阿Q」「小D」）；
 * - 在来源中出现次数够多、分布在两章以上；
 * - 字与字粘得紧（凝固度高：拆开的任一半很少单独出现在别处）；
 * - 长得像专名：夹拉丁字母、以「阿」起头、以常见姓氏起头，或以地名 / 组织后缀结尾；
 * - 不含虚词、代词等功能字，不在常用词表里，不是 AA 叠字；
 * - 被更长的候选几乎完全包含时只留长的（「赵太」让位给「赵太爷」）。
 * 不满足全部条件的一律不当专名，普通词（「仿佛」「眼睛」「胜利」「人物」）不会触发降级。
 */

export interface SourceTerm {
  readonly term: string;
  /** 在来源全文中的出现次数。 */
  readonly count: number;
  /** 出现过的章数。 */
  readonly chapterCount: number;
}

export interface SourceTermIndex {
  readonly terms: readonly SourceTerm[];
  /** 本来源的最低出现次数门槛（随篇幅放大）。 */
  readonly minCount: number;
}

export interface SourceTermChapter {
  readonly number: number;
  readonly content: string;
}

export const SOURCE_TERM_MAX_TERMS = 300;
/** 凝固度门槛：候选出现次数 ÷ 任一拆分两半中较少的那半的出现次数。 */
export const SOURCE_TERM_MIN_COHESION = 0.75;
/** 被更长候选包含、且长候选次数达到本候选的该比例时，丢弃短的。 */
const SOURCE_TERM_ABSORB_RATIO = 0.7;

// 功能字：虚词、代词、助词、常用动词与方位字。专名极少含这些字；含了的串多半是普通短语。
const FUNCTION_CHARS = new Set([..."的了着过是在不也就都而又便说道这那他她它我你们和与及或把被将让给对向从以之其所因为但却只才很更还再已个些么吗呢吧啊呀得地一有没要能可到去来上下里中出起看想用做时候自己什如若虽然于并且此每各等使令叫请"]);

// 常见姓氏（作为专名起头信号）。与普通词冲突的由下方常用词表兜住。
const SURNAME_CHARS = new Set([..."赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏窦章苏潘葛范彭郎鲁韦马苗凤方俞任袁柳鲍史唐费廉岑薛雷贺倪汤殷罗毕郝安常傅卞齐康伍余顾孟黄穆萧尹姚邵汪祁毛狄米贝臧戴宋茅庞熊纪舒屈项祝董梁杜阮蓝闵季贾娄颜郭梅盛林钟徐邱骆高夏蔡田樊胡凌霍卢莫房裘缪邓郁单洪包左石崔龚程邢裴陆荣翁荀甄封储靳焦侯宁仇甘厉武符刘景詹龙叶黎白蒲赖卓蔺屠蒙乔谭姬申燕温庄晏柴瞿阎慕连艾容易廖耿聂晁敖冷辛简饶曾沙关荆欧楚"]);

// 地名 / 组织 / 称谓后缀。两字串只认这些较少构成普通词的后缀，三字以上再放宽。
const TWO_CHAR_SUFFIXES = new Set([..."庄村镇府祠庵寺宗帮党峰岭"]);
const LONG_SUFFIXES = [
  "庄", "村", "镇", "府", "祠", "庵", "寺", "庙", "宗", "门", "派", "帮", "会", "党", "阁", "殿", "宫",
  "城", "州", "县", "山", "峰", "岭", "谷", "岛", "国", "爷", "嫂", "大陆", "王朝", "学院", "集团", "公司",
];

// 常用词表：只收会命中上面「像专名」信号的普通词（姓氏字起头、后缀字结尾、「阿」起头、夹字母）。
// 其余普通词本来就不像专名，不必列入。
const COMMON_WORDS = new Set([
  // 姓氏字起头的常用词
  "许多", "许久", "许是", "许诺", "高兴", "高声", "高大", "高手", "高处", "张开", "张望", "张嘴", "张罗", "方才", "方法", "方向",
  "方面", "方便", "方式", "常常", "常识", "何况", "何必", "何处", "何苦", "何等", "周围", "周身", "周到", "黄昏", "黄色", "黄金",
  "白天", "白色", "白发", "白眼", "金色", "金钱", "金属", "石头", "石块", "林子", "林间", "安静", "安全", "安排", "安慰", "安心",
  "安稳", "齐声", "齐整", "陆续", "陆地", "顾客", "顾虑", "顾及", "马车", "马匹", "马路", "任何", "任务", "任凭", "严肃", "严重",
  "严格", "尤其", "尤为", "郑重", "曾经", "曾孙", "关系", "关心", "关键", "连忙", "连续", "简直", "简单", "简陋", "容易", "温柔",
  "温暖", "温和", "冷笑", "冷静", "冷漠", "焦急", "厉害", "宁可", "宁愿", "毕竟", "毕业", "舒服", "舒展", "颜色", "颜面", "程度",
  "程序", "包括", "包围", "包袱", "左右", "左手", "左边", "房间", "房子", "房屋", "毛病", "毛发", "范围", "范畴", "胡说", "胡乱",
  "夏天", "夏夜", "黎明", "叶子", "孙子", "孙女", "钱财", "钱包", "雷声", "雷电", "蓝色", "蓝天", "庄严", "苏醒", "华丽", "季节",
  "季度", "游戏", "武器", "武功", "甘心", "仇恨", "殷勤", "纪念", "纪律", "萧条", "施展", "施舍", "陶醉", "陶器", "鲁莽", "费力",
  "费用", "唐突", "凌乱", "凌晨", "乔装", "章节", "章法", "燕子", "景色", "符合", "申请", "申明", "单独", "单纯", "单位", "江湖",
  "江山", "田地", "田野", "田间", "柴火", "柳树", "柳枝", "梅花", "梅雨", "米饭", "米粒", "余下", "余光", "余地", "乐意", "康复",
  "沙发", "沙子", "易于", "辛苦", "饶恕", "屠夫", "卓越", "龙头", "荣誉", "洪水", "郁闷", "莫名", "霍然", "骆驼", "钟声", "盛开",
  "杜鹃", "祝福", "项目", "屈服", "庞大", "茅草", "戴上", "贝壳", "孟浪", "罗列", "汤水", "贺喜", "岑寂", "廉价", "史书", "凤凰",
  "苗头", "郎中", "范例", "姜汤", "孔雀", "朱红", "杨柳", "卫兵", "陈旧", "王者", "李子",
  // 后缀字结尾的常用词
  "村庄", "山庄", "农庄", "钱庄", "端庄", "乡村", "农村", "山村", "渔村", "全村", "本村", "邻村", "城镇", "乡镇", "小镇", "政府",
  "官府", "王府", "地府", "冥府", "首府", "城府", "学府", "知府", "祖宗", "正宗", "同宗", "匪帮", "马帮", "政党", "死党", "同党",
  "乱党", "余党", "高峰", "顶峰", "山峰", "巅峰", "主峰", "山岭", "佛寺", "古寺", "尼庵", "宗祠",
  // 称谓（家族与身份称呼，不是专名）
  "老爷", "少爷", "大爷", "太爷", "姥爷", "王爷", "大嫂", "阿姨", "阿爸", "阿妈", "阿婆", "阿公", "阿哥", "阿姐", "阿嫂", "阿伯",
  "阿叔", "阿婶", "阿弥", "阿弥陀佛", "知县",
  // 三字以上的普通后缀词
  "分水岭", "土地庙", "城隍庙",
  // 夹拉丁字母的常用词
  "T恤", "X光", "U盘", "B超", "A股", "K线", "AA制",
]);

const TERM_RUN = /[\p{Script=Han}A-Za-z]+/gu;
const HAN = /\p{Script=Han}/u;
const LATIN = /[A-Za-z]/u;

function runsOf(text: string): string[][] {
  return (text.match(TERM_RUN) ?? []).map((run) => [...run]);
}

function isReduplicated(chars: readonly string[]): boolean {
  if (chars.length === 2) return chars[0] === chars[1];
  if (chars.length === 4) return chars[0] === chars[1] && chars[2] === chars[3];
  return false;
}

/** 专名形状：夹拉丁字母、「阿」起头、姓氏起头，或地名 / 组织后缀结尾。 */
function looksLikeName(term: string, chars: readonly string[]): boolean {
  if (LATIN.test(term)) return HAN.test(term) && (term.match(/[A-Za-z]/gu)?.length ?? 0) <= 2;
  if (chars[0] === "阿") return true;
  if (SURNAME_CHARS.has(chars[0]!)) return true;
  if (chars.length === 2) return TWO_CHAR_SUFFIXES.has(chars[1]!);
  return LONG_SUFFIXES.some((suffix) => term.endsWith(suffix) && chars.length - [...suffix].length >= 2);
}

/** 按来源全文统计专名候选；纯函数，同一来源结果稳定。 */
export function collectSourceTerms(chapters: readonly SourceTermChapter[]): SourceTermIndex {
  const totalChars = chapters.reduce((sum, chapter) => sum + chapter.content.length, 0);
  const minCount = Math.max(5, Math.ceil(totalChars / 5_000));
  const minChapters = chapters.filter((chapter) => chapter.content.length > 0).length > 1 ? 2 : 1;

  const charCounts = new Map<string, number>();
  const counts = new Map<string, number>();
  const chapterSets = new Map<string, Set<number>>();
  const add = (term: string, chapter: number) => {
    counts.set(term, (counts.get(term) ?? 0) + 1);
    let seen = chapterSets.get(term);
    if (!seen) { seen = new Set(); chapterSets.set(term, seen); }
    seen.add(chapter);
  };

  const chapterRuns = chapters.map((chapter) => ({ number: chapter.number, runs: runsOf(chapter.content) }));
  for (const { number, runs } of chapterRuns) {
    for (const chars of runs) {
      for (const char of chars) charCounts.set(char, (charCounts.get(char) ?? 0) + 1);
      for (let index = 0; index + 2 <= chars.length; index += 1) add(chars.slice(index, index + 2).join(""), number);
    }
  }
  // 三、四字串只在两个子串都够频繁时才计数，长文本也不会枚举出海量组合。
  for (const size of [3, 4]) {
    for (const { number, runs } of chapterRuns) {
      for (const chars of runs) {
        for (let index = 0; index + size <= chars.length; index += 1) {
          const left = chars.slice(index, index + size - 1).join("");
          const right = chars.slice(index + 1, index + size).join("");
          if ((counts.get(left) ?? 0) >= minCount && (counts.get(right) ?? 0) >= minCount) {
            add(chars.slice(index, index + size).join(""), number);
          }
        }
      }
    }
  }

  const countOf = (part: string) => ([...part].length === 1 ? charCounts.get(part) : counts.get(part)) ?? 0;
  const cohesion = (term: string, chars: readonly string[]) => {
    const total = counts.get(term) ?? 0;
    let lowest = Number.POSITIVE_INFINITY;
    for (let split = 1; split < chars.length; split += 1) {
      const smaller = Math.min(countOf(chars.slice(0, split).join("")), countOf(chars.slice(split).join("")));
      lowest = Math.min(lowest, smaller > 0 ? total / smaller : 0);
    }
    return lowest;
  };

  const frequent: SourceTerm[] = [];
  for (const [term, count] of counts) {
    if (count < minCount) continue;
    const chapterCount = chapterSets.get(term)?.size ?? 0;
    if (chapterCount < minChapters) continue;
    const chars = [...term];
    if (!HAN.test(term)) continue;
    if (chars.some((char) => FUNCTION_CHARS.has(char))) continue;
    if (isReduplicated(chars) || COMMON_WORDS.has(term)) continue;
    frequent.push({ term, count, chapterCount });
  }
  const terms = frequent
    .filter((candidate) => !frequent.some((longer) => longer.term !== candidate.term
      && longer.term.includes(candidate.term)
      && longer.count >= SOURCE_TERM_ABSORB_RATIO * candidate.count))
    .filter((candidate) => {
      const chars = [...candidate.term];
      return looksLikeName(candidate.term, chars) && cohesion(candidate.term, chars) >= SOURCE_TERM_MIN_COHESION;
    })
    .sort((left, right) => right.count - left.count || left.term.localeCompare(right.term))
    .slice(0, SOURCE_TERM_MAX_TERMS);
  return { terms, minCount };
}

/** 在一段文字里找出来源专名；被另一个命中专名包含的短串不重复报告。 */
export function findSourceTerms(text: string, index: SourceTermIndex): SourceTerm[] {
  const hits = index.terms.filter((term) => text.includes(term.term));
  return hits.filter((hit) => !hits.some((other) => other.term !== hit.term && other.term.includes(hit.term)));
}
