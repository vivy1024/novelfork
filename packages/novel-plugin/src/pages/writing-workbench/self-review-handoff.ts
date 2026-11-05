/**
 * 自审 → 叙述者的交接消息（纯函数，不依赖 React 与路径别名）。
 *
 * 两档：人文化（只改规则命中的句子，≤10%）与通篇润色。两档都约定引号内对白一字不改：
 * 自审本身已不检查对白（engine/compliance/paragraph-self-review），这里再兜底剔除
 * 命中落在对白里的旧格式条目，并在指令里写明，免得叙述者照建议改掉人物原话。
 */
import { groupSelfReviewIssues, type ParagraphSelfReviewIssue } from "../../engine/compliance/paragraph-self-review";
import { fragmentOnlyInDialogue } from "../../engine/compliance/dialogue-spans";
import { composeCustomConstraintsSection } from "../../engine/writing-layers/style-preset-custom-constraints";
import { toWireToolName } from "../../engine/workflows/run-brief";

/**
 * 交接指令里点名的工具，一律写成模型实际拿到的线上名：Runtime 把目录名的点换成下划线
 * （novelfork-product-runtime 的 toRuntimeToolName），前端交过去的消息不经过那层翻译，
 * 写点号名叙述者对不上号，会先去乱搜。线上名只从同一映射函数生成，不手写。
 */
export const HANDOFF_TOOL_NAMES = {
  proposeSelection: toWireToolName("chapter.propose_selection"),
  readChapter: toWireToolName("chapter.read"),
} as const;

/** 一条消息里最多列出的命中数；多出来的只报数量，先处理前面这些。 */
export const HUMANIZE_MAX_LISTED_ISSUES = 20;

export const DIALOGUE_UNTOUCHED_RULE =
  "- 引号（“” 「」 『』 ‘’）内的对白一字不改：命中句里带对白时只改引号外的叙述，candidateText 里的对白部分必须与原文逐字相同。";

/** 润色只疏通文字，不替作者统一标点体例：换写法会让自审规则新增命中，也改掉了原书的排版习惯。 */
export const PUNCTUATION_STYLE_UNTOUCHED_RULE =
  "- 不改动原文的标点体例：破折号（「──」「——」）、省略号、引号形式一律保持原样，不在两种写法之间互换；「标点规范」只指错用、漏用的标点。";

/** 交给叙述者的命中：剔除命中文字只出现在对白里的条目（对白不改，交过去只会诱导改台词）。 */
export function humanizeHandoffIssues(issues: readonly ParagraphSelfReviewIssue[]): ParagraphSelfReviewIssue[] {
  return issues.filter((issue) => !fragmentOnlyInDialogue(issue.evidence, issue.matchedText));
}

/**
 * 把自审命中交给叙述者做整章语感体检：逐条生成定点候选（≤10% 改动），
 * 不带编辑器坐标，候选回到正文按原文定位由作者逐条确认。
 */
export function buildHumanizeMessage(
  chapterNumber: number,
  allIssues: readonly ParagraphSelfReviewIssue[],
  customConstraints?: readonly string[],
): string {
  const issues = humanizeHandoffIssues(allIssues);
  // 同一规则命中同一句的多处归并成一条，免得叙述者对同一句产出重叠候选。
  const groups = groupSelfReviewIssues(issues);
  const merged = groups.length < issues.length ? `（同句合并后 ${groups.length} 条）` : "";
  const lines = [
    `第 ${chapterNumber} 章的表达检查发现了 ${issues.length} 处规则命中的写法问题${merged}。请逐条生成「语感体检」候选，用 ${HANDOFF_TOOL_NAMES.proposeSelection} 提交（每条问题一条候选；同一句只交一条）。`,
    "",
    "要求：",
    "- 只改被命中的句子，改动不超过原句的 10%；情节、对白、设定一律不动。",
    DIALOGUE_UNTOUCHED_RULE,
    "- from/to 是编辑器坐标你拿不到：不要编造坐标，直接省略 from/to，编辑器会按候选原文在正文里定位。sourceText 必须是正文里的原文，candidateText 是改写后的句子。",
    "- requestId 自行生成，每条候选一个稳定编号。",
  ];
  // 作者硬约束先于人文化手法说明；没有约束时不出这一段。
  lines.push(...composeCustomConstraintsSection(customConstraints));
  lines.push(
    "- 可选的人文化手法（按需选择，不必全用）：矛盾的情绪、小身体细节、无关的随机念头、不完美的对话、环境作用于身体、注意到无关事物、刻意的节奏断裂。",
    "- 不要改正文；作者会在编辑器里逐条确认。",
    "",
    "问题清单：",
  );
  groups.slice(0, HUMANIZE_MAX_LISTED_ISSUES).forEach(({ issue, hitCount, paragraphs }, index) => {
    const where = `第 ${paragraphs.join("、")} 段`;
    const count = hitCount > 1 ? `（本句命中 ${hitCount} 处）` : "";
    lines.push(`${index + 1}. ${where}「${issue.evidence}」${count}：${issue.reason}${issue.suggestion ? `。参考方向：${issue.suggestion}` : ""}`);
  });
  if (groups.length > HUMANIZE_MAX_LISTED_ISSUES) {
    lines.push(`（另有 ${groups.length - HUMANIZE_MAX_LISTED_ISSUES} 条未列出，先处理上面这些。）`);
  }
  return lines.join("\n");
}

/**
 * 人文化之后的一档：通篇润色。不限于规则命中的句子、幅度不再限 10%，
 * 但仍是逐处定点候选、作者逐条确认；情节、对白与设定不动，不整章重写。
 */
export function buildPolishMessage(
  chapterNumber: number,
  customConstraints?: readonly string[],
): string {
  const lines = [
    `请对第 ${chapterNumber} 章做一遍通篇语言润色：先用 ${HANDOFF_TOOL_NAMES.readChapter} 读这一章正文，通读之后逐处打磨，每处用 ${HANDOFF_TOOL_NAMES.proposeSelection} 提交一条候选（action 用 "polish"），按正文先后顺序交。`,
    "",
    "要求：",
    "- 打磨范围：错别字与病句、重复用词与搭配不当、句式与节奏、段落衔接、标点规范、叙述视角与称呼的一致性。",
    "- 情节、对白内容、人物与设定、章节结构一律不动；不增删内容，不大段重写，不整章重写。",
    PUNCTUATION_STYLE_UNTOUCHED_RULE,
    DIALOGUE_UNTOUCHED_RULE,
  ];
  // 作者硬约束先于润色机制说明；没有约束时不出这一段。
  lines.push(...composeCustomConstraintsSection(customConstraints));
  lines.push(
    "- from/to 是编辑器坐标你拿不到：不要编造坐标，直接省略 from/to，编辑器会按候选原文在正文里定位。sourceText 必须是正文里的原文（一句话或一个需要整体疏通的自然段），candidateText 是润色后的对应文字。",
    "- sourceText 在正文里必须只出现一次，重复出现会导致定位失败；没有把握唯一定位时就缩小到一句。",
    "- requestId 自行生成，每条候选一个稳定编号。",
    "- 不要改正文；作者会在编辑器里逐条确认。",
  );
  return lines.join("\n");
}
