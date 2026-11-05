import { z } from "zod";

import type { RuntimeTextGenerationRequest } from "@vivy1024/novelfork-core/plugins";
import { modelJsonFailureAdvice, parseModelJson, type ModelJsonFailureReason } from "../model-output/lenient-json.js";
import {
  STYLE_DISTILLATION_CHAPTER_CHAR_LIMIT,
  STYLE_MODEL_RULE_CATEGORIES,
  type DistillableChapter,
  type StyleDistillationExplanation,
  type StyleRuleCategory,
} from "./style-distillation.js";
import { normalizeEvidenceForMatch, normalizeEvidenceWithMap } from "./style-distillation-normalize.js";
import { collectSourceTerms, findSourceTerms, type SourceTermIndex } from "./style-distillation-terms.js";

/**
 * 文风蒸馏的模型批次：只把一批章节交给 Runtime 会话模型（或宿主已有的服务端模型路径），
 * 抽取写法规则。模型输出经宽容 JSON 解析与 zod 校验、证据回查原文、专名后检，
 * 失败时带 explanation 返回，不静默丢弃。
 */

export const STYLE_DISTILLATION_MAX_RULES_PER_BATCH = 12;

/**
 * 每批的输出上限。
 *
 * JSON 体量估算：一批 ≤12000 字 / ≤5 章，最多 12 条规则；每条 text ≤120 字、evidence 8–120 字、
 * reason 一句话（约 40–80 字），加字段名与引号约 60 字符，单条约 250–380 字符，12 条约 3–4.6 千字符，
 * 中文按 1–1.5 token/字计约 4.5–7 千 token。
 *
 * 思考型模型的推理 token 也计入输出上限：2026-10 真模型验收里 gemini-3.8-flash-high 一批
 * output_tokens=7996（原上限 8000），推理把额度耗尽、JSON 一个字没写出来。产品侧目前不能为
 * 服务端文本生成指定思考强度（见下方 extractStyleRulesFromBatch 注释），所以给推理预留约 9 千 token，
 * 总上限取 16000。Runtime 会按模型卡声明的输出上限再收紧（resolveOutputTokenLimit），
 * 声明了更低上限的模型不会因此被拒。
 */
export const STYLE_DISTILLATION_BATCH_MAX_TOKENS = 16_000;

/** 输出 token 达到上限的这个比例即视为被截断（宿主不报 outputTruncated 时的兜底判定）。 */
export const STYLE_DISTILLATION_TRUNCATION_USAGE_RATIO = 0.98;

/**
 * 宿主可选地告知输出是否因上限被截断，以及本次输出用了多少 token；
 * Runtime 会话生成器只返回 text 时视为未知。
 */
export type StyleDistillationTextGenerator = (
  input: RuntimeTextGenerationRequest,
) => Promise<{
  readonly text: string;
  readonly outputTruncated?: boolean;
  readonly usage?: { readonly completionTokens?: number };
}>;

/** 宿主报截断，或输出 token 达到上限的 98% 以上，都按截断处理。 */
export function isStyleDistillationOutputTruncated(
  response: { readonly outputTruncated?: boolean; readonly usage?: { readonly completionTokens?: number } },
  maxTokens: number = STYLE_DISTILLATION_BATCH_MAX_TOKENS,
): boolean {
  if (response.outputTruncated === true) return true;
  const used = response.usage?.completionTokens;
  return typeof used === "number" && Number.isFinite(used) && used >= maxTokens * STYLE_DISTILLATION_TRUNCATION_USAGE_RATIO;
}

const TRANSFER_ALIASES: Readonly<Record<string, "transferable" | "source-only">> = {
  transferable: "transferable",
  "source-only": "source-only",
  source_only: "source-only",
  sourceonly: "source-only",
  可迁移: "transferable",
  作品专属: "source-only",
};

const ModelRuleSchema = z.object({
  category: z.enum(STYLE_MODEL_RULE_CATEGORIES),
  text: z.string().trim().min(4).max(400),
  evidence: z.string().trim().min(4).max(400),
  transfer: z.preprocess(
    (value) => typeof value === "string" ? TRANSFER_ALIASES[value.trim().toLowerCase()] ?? value : value,
    z.enum(["transferable", "source-only"]),
  ),
  reason: z.string().trim().min(1).max(300),
});

export const StyleDistillationModelOutputSchema = z.object({
  rules: z.array(z.unknown()).max(20),
});

export interface ExtractedStyleRule {
  readonly category: StyleRuleCategory;
  readonly text: string;
  /** 已回查原文的证据，取原文里的逐字片段，前缀标明所在章。 */
  readonly evidence: string;
  readonly transfer: "transferable" | "source-only";
  readonly reason: string;
}

/** 因证据未在原文中找到而未收录的模型规则，原样保留供作者审阅（证据是模型给的原话，未经回查）。 */
export interface RejectedStyleRule {
  /** 被丢弃的只会是模型规则，类别已经过 ModelRuleSchema 校验；general 只给确定性基线用。 */
  readonly category: (typeof STYLE_MODEL_RULE_CATEGORIES)[number];
  readonly text: string;
  readonly evidence: string;
  readonly reason: string;
}

/**
 * 一批里被证据校验丢弃的规则占比超过这个阈值（或全部被丢弃）时，本批需要作者关注：
 * 全部丢弃判为失败批次（可重试）；部分丢弃但超过阈值，批次照常完成并带提醒。
 * 一半以上的证据都对不上原文，通常是模型在改写原文或比对口径有问题，不能看起来像正常成功。
 */
export const STYLE_DISTILLATION_EVIDENCE_REJECTION_ATTENTION_RATIO = 0.5;

export type StyleBatchExtraction =
  | {
    readonly ok: true;
    readonly rules: readonly ExtractedStyleRule[];
    readonly issues: readonly string[];
    /** 证据校验未通过的规则；缺省视为没有。 */
    readonly rejected?: readonly RejectedStyleRule[];
  }
  | { readonly ok: false; readonly explanation: StyleDistillationExplanation };

const SYSTEM_PROMPT = `你是 NovelFork 的文风分析助手。任务：从作者提供的参考正文中提取可以指导写作的「写法规则」。只分析表达方法，不复述剧情，不整理人物、地点或世界设定。

只输出一个 JSON 对象，不要输出解释或 Markdown 代码块以外的文字。格式：
{"rules":[{"category":"voice","text":"一条可执行的写法规则","evidence":"从原文逐字摘录的片段","transfer":"transferable","reason":"为什么可迁移或只属于该作品"}]}

字段要求：
- category 只能取：voice（叙事声音与视角距离）、language（用词与句法）、rhythm（节奏与段落推进）、dialogue（对话写法）、scene（场景写法：动作、描写、心理、转场的处理方式）、consistency（贯穿全文需保持一致的写法约束）。
- text 写成作者可以直接照做的写法，不超过 120 字。不要写句长、对话比例之类的统计数字，系统另有统计。
- evidence 必须是原文中连续出现的逐字片段（8 到 120 字），不得改写、拼接、概括或补标点；原文引号照抄。
- JSON 字符串里如需引号，用中文引号“”或「」，不要用未转义的英文双引号。
- transfer 判断（逐条想清楚，拿不准时标 source-only）：
  · transferable：换一本人物、题材都不同的书，照这条写仍然成立。正例：「人物受辱后，用一句平静的概括句收束，制造反讽落差」「对白只写一两句，随即转入叙述者对动作的描写」「转场不写过渡段，用人物的一个念头直接切入下一场」。
  · source-only：离开本作的人物、地名、组织、专属道具或意象、口头禅、题材设定或标志性原句就不成立。反例（都应标 source-only）：「让沈砚每次受挫都念叨『青云宗迟早是我的』」依赖本作人物与口头禅；「用铜铃意象象征主角的处境」依赖本作专属意象；「用外门、内门、真传的等级称谓制造压迫感」依赖本作设定。
  · transferable 的 text 不得出现来源作品的人名、地名、组织名、专属道具或原句；source-only 的 text 可以写出这些专名，说明依赖什么。
- reason 用一句话说明 transfer 的判断依据。
- 每批最多 ${STYLE_DISTILLATION_MAX_RULES_PER_BATCH} 条，宁缺毋滥；没有把握的规则不要输出。没有可提取的规则时输出 {"rules":[]}。`;

export function buildStyleDistillationBatchMessages(input: {
  readonly sourceName: string;
  readonly chapters: readonly DistillableChapter[];
}): { role: "system" | "user"; content: string }[] {
  const numbers = input.chapters.map((chapter) => chapter.number);
  const range = numbers.length > 1 ? `第 ${numbers[0]}–${numbers.at(-1)} 章` : `第 ${numbers[0]} 章`;
  const body = input.chapters.map((chapter) => {
    const content = chapter.content.slice(0, STYLE_DISTILLATION_CHAPTER_CHAR_LIMIT);
    const truncated = chapter.content.length > STYLE_DISTILLATION_CHAPTER_CHAR_LIMIT ? "\n（本章其余部分未送入本批）" : "";
    return `### 第${chapter.number}章 ${chapter.title}\n${content}${truncated}`;
  }).join("\n\n");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `参考来源：${input.sourceName}\n以下是${range}的正文，请按要求输出 JSON。\n\n${body}` },
  ];
}

export interface LocatedStyleEvidence {
  readonly chapterNumber: number;
  /** 取自原文的逐字片段；多段证据用「……」连接。 */
  readonly excerpt: string;
}

/**
 * 证据按省略号切段，每段都必须在同一章原文中按顺序逐字出现。比对前两边做同样的逐字归一
 * （引号与括引号一律忽略（换样式或省略都不计），全半角、ASCII 大小写、常见繁简异体、空白不计差异，见 style-distillation-normalize），
 * 返回的片段仍取自原文原字。
 */
export function locateStyleEvidenceInChapters(
  evidence: string,
  chapters: readonly DistillableChapter[],
): LocatedStyleEvidence | null {
  // 归一会删去引号与括引号：模型在证据外再套一层引号、换引号样式或整个省掉引号，都不计差异。
  const segments = evidence
    .trim()
    .split(/…+|\.{3,}/u)
    .map(normalizeEvidenceForMatch);
  const usable = segments.filter((segment) => segment.length >= 2);
  if (usable.length === 0) return null;
  for (const chapter of chapters) {
    const content = normalizeEvidenceWithMap(chapter.content);
    const pieces: string[] = [];
    let cursor = 0;
    let matched = true;
    for (const segment of usable) {
      const at = content.value.indexOf(segment, cursor);
      if (at < 0) { matched = false; break; }
      // 归一删去了空白与引号，归一串第 i 个码点经 starts/ends 映射回原文下标；
      // 片段从原文取原字，落在命中范围中间的引号随之取回。
      const first = [...content.value.slice(0, at)].length;
      const last = first + [...segment].length - 1;
      pieces.push(chapter.content.slice(content.starts[first], content.ends[last]));
      cursor = at + segment.length;
    }
    if (matched) return { chapterNumber: chapter.number, excerpt: pieces.join("……") };
  }
  return null;
}

/** 兼容旧调用：只返回证据所在章号。 */
export function locateStyleEvidence(evidence: string, chapters: readonly DistillableChapter[]): number | null {
  return locateStyleEvidenceInChapters(evidence, chapters)?.chapterNumber ?? null;
}

function issueSummary(error: z.ZodError): string {
  return error.issues.slice(0, 3).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(根)";
    return `${path}：${issue.message}`;
  }).join("；");
}

function failure(what: string, why: string, next: string): StyleBatchExtraction {
  return { ok: false, explanation: { what: what.slice(0, 4_000), why, next } };
}

const JSON_FAILURE_WHY: Readonly<Record<ModelJsonFailureReason, string>> = {
  truncated: "本批输出没有写完，拿半截输出当规则会漏掉或截断条目，所以整批不收录。",
  "no-json": "本批规则无法可靠解析，不能把自由文本当成写法规则。",
  invalid: "本批规则无法可靠解析，不能猜测模型的原意。",
};

/**
 * 蒸馏批次被截断时的建议。思考型模型会把输出额度先花在推理上，换「更守格式」的模型解决不了，
 * 应缩小批次或降低思考强度。
 */
const TRUNCATED_NEXT = "重试本批；仍被截断时缩小参考文本范围（每批章节更少），或在设置里把默认模型的思考强度调低、换用非思考型模型后再重试失败批次。";

/** 输出被截断（宿主报告或输出 token 用满上限）时，不论解析成什么样都按截断报告。 */
function truncatedFailure(detail: string): StyleBatchExtraction {
  return failure(
    `模型输出被截断：${detail}`,
    `${JSON_FAILURE_WHY.truncated}思考型模型的推理也计入输出上限，推理过长时正文 JSON 可能一个字都来不及写。`,
    TRUNCATED_NEXT,
  );
}

function termList(terms: readonly { readonly term: string; readonly count: number }[]): string {
  return terms.slice(0, 3).map((term) => `「${term.term}」（来源中出现 ${term.count} 次）`).join("、");
}

export interface ParseStyleBatchOptions {
  /** 来源全文的专名统计；缺省时只用本批章节统计。 */
  readonly sourceTerms?: SourceTermIndex;
  /** 宿主告知输出因上限被截断，或输出 token 已用满上限（见 isStyleDistillationOutputTruncated）。 */
  readonly outputTruncated?: boolean;
}

/** 解析并校验一批模型输出；纯函数，便于单测覆盖各种坏输出。 */
export function parseStyleDistillationBatchOutput(
  text: string,
  chapters: readonly DistillableChapter[],
  options: ParseStyleBatchOptions = {},
): StyleBatchExtraction {
  const parsedJson = parseModelJson(text, { expect: "object", outputTruncated: options.outputTruncated });
  if (!parsedJson.ok) {
    // 截断是根因时，「没有 JSON」「JSON 无效」都只是表象，统一报截断并给出可执行建议。
    if (options.outputTruncated || parsedJson.reason === "truncated") {
      return truncatedFailure(options.outputTruncated && parsedJson.reason !== "truncated"
        ? `输出达到了长度上限（${STYLE_DISTILLATION_BATCH_MAX_TOKENS} token），没有写出完整的 JSON。`
        : parsedJson.message.replace(/^模型输出被截断：/u, ""));
    }
    return failure(parsedJson.message, JSON_FAILURE_WHY[parsedJson.reason], modelJsonFailureAdvice(parsedJson.reason));
  }
  const shape = StyleDistillationModelOutputSchema.safeParse(parsedJson.value);
  if (!shape.success) {
    return failure(
      `模型输出不符合规则格式：${issueSummary(shape.error)}`,
      "每条规则都必须带类别、逐字证据和可迁移判断，缺项的输出不能进入审阅。",
      "重试本批；多次失败时换用输出更稳定的模型。",
    );
  }

  const issues: string[] = [];
  if (parsedJson.repaired) {
    issues.push("模型输出的 JSON 有格式瑕疵（如字符串里未转义的引号），已按确定性规则修补后解析；证据仍逐字回查原文。");
  }
  const candidates = shape.data.rules;
  if (candidates.length > STYLE_DISTILLATION_MAX_RULES_PER_BATCH) {
    issues.push(`模型返回 ${candidates.length} 条规则，超过每批 ${STYLE_DISTILLATION_MAX_RULES_PER_BATCH} 条上限，仅收录前 ${STYLE_DISTILLATION_MAX_RULES_PER_BATCH} 条。`);
  }

  // 逐条校验：个别条目缺字段只丢这一条并说明；全部不合格才判整批失败。
  const valid: z.infer<typeof ModelRuleSchema>[] = [];
  let firstError: z.ZodError | null = null;
  candidates.slice(0, STYLE_DISTILLATION_MAX_RULES_PER_BATCH).forEach((candidate, index) => {
    const parsed = ModelRuleSchema.safeParse(candidate);
    if (parsed.success) {
      valid.push(parsed.data);
      return;
    }
    const prefixed = new z.ZodError(parsed.error.issues.map((issue) => ({ ...issue, path: ["rules", index, ...issue.path] })));
    firstError ??= prefixed;
    issues.push(`第 ${index + 1} 条未收录：不符合规则格式（${issueSummary(prefixed)}）。`);
  });
  if (valid.length === 0 && firstError) {
    return failure(
      `模型输出不符合规则格式：${issueSummary(firstError)}`,
      "每条规则都必须带类别、逐字证据和可迁移判断，缺项的输出不能进入审阅。",
      "重试本批；多次失败时换用输出更稳定的模型。",
    );
  }

  const sourceTerms = options.sourceTerms ?? collectSourceTerms(chapters);
  const rules: ExtractedStyleRule[] = [];
  const rejected: RejectedStyleRule[] = [];
  for (const candidate of valid) {
    const located = locateStyleEvidenceInChapters(candidate.evidence, chapters);
    if (!located) {
      issues.push(`未收录「${candidate.text.slice(0, 60)}」：证据未在本批原文中逐字找到，可能是模型改写或编造。`);
      rejected.push({ category: candidate.category, text: candidate.text, evidence: candidate.evidence, reason: "证据未在本批原文中逐字找到" });
      continue;
    }
    let transfer = candidate.transfer;
    let reason = candidate.reason;
    if (transfer === "transferable") {
      const hits = findSourceTerms(candidate.text, sourceTerms);
      if (hits.length > 0) {
        transfer = "source-only";
        reason = `后检：规则正文含来源专名${termList(hits)}，离开来源作品不成立，已按作品专属保存；去掉专名改写成通用写法后可另行确认。模型原判断：${candidate.reason}`;
        issues.push(`「${candidate.text.slice(0, 60)}」正文含来源专名${termList(hits)}，已由可迁移降为作品专属。`);
      }
    }
    rules.push({
      category: candidate.category,
      text: candidate.text,
      evidence: `第${located.chapterNumber}章原文：「${located.excerpt}」`,
      transfer,
      reason,
    });
  }
  if (candidates.length === 0) issues.push("模型认为本批没有可提取的写法规则。");
  return { ok: true, rules, issues, rejected };
}

export type StyleBatchEvidenceAssessment =
  | { readonly level: "ok" }
  /** 部分规则被丢弃且占比超过阈值：批次完成，但带提醒。 */
  | { readonly level: "warning"; readonly explanation: StyleDistillationExplanation }
  /** 模型给出的规则全部因证据被丢弃：按失败批次处理，可重试。 */
  | { readonly level: "failed"; readonly explanation: StyleDistillationExplanation };

/** 判断一批的证据丢弃情况是否需要作者关注；文案统一在这里，前端与叙述者不自造。 */
export function assessStyleBatchEvidence(
  kept: number,
  rejected: number,
): StyleBatchEvidenceAssessment {
  if (rejected <= 0) return { level: "ok" };
  const total = kept + rejected;
  const what = `${rejected} 条模型规则因证据未在原文找到被丢弃${kept > 0 ? `，仅收录 ${kept} 条` : "，本批没有收录任何规则"}。`;
  const why = "证据必须是原文里的逐字片段，对不上的规则可能是模型改写或编造原文，不能进入审阅；但大面积对不上也可能是模型改了原文的写法（如繁简、引号），不应当作正常完成。";
  const next = "展开本批「被丢弃的规则」查看模型给出的证据与原文差在哪里；重试本批，多次仍大面积丢弃时换用更忠于原文的模型。";
  if (kept === 0) return { level: "failed", explanation: { what, why, next } };
  if (rejected / total > STYLE_DISTILLATION_EVIDENCE_REJECTION_ATTENTION_RATIO) {
    return { level: "warning", explanation: { what, why, next } };
  }
  return { level: "ok" };
}

export async function extractStyleRulesFromBatch(input: {
  readonly generateText: StyleDistillationTextGenerator;
  readonly sourceName: string;
  readonly chapters: readonly DistillableChapter[];
  readonly sourceTerms?: SourceTermIndex;
}): Promise<StyleBatchExtraction> {
  let text: string;
  let outputTruncated = false;
  try {
    // 思考强度：蒸馏是格式固定的抽取任务，用不上深推理，理想做法是像 Runtime 的摘要类辅助生成那样
    // 显式压低思考强度。但产品侧的文本生成契约（core RuntimeTextGenerationRequest、Bridge
    // RuntimeProductTextGenerationRequest、Runtime ToolContext.generateText）都没有 reasoningEffort 字段，
    // product-host 的 default 角色沿用模型配置的默认思考强度，只能在 Runtime fork 层加字段后再传。
    // 在那之前靠更高的输出上限给推理留余量，并把用满上限如实报成截断。
    const response = await input.generateText({
      messages: buildStyleDistillationBatchMessages(input),
      temperature: 0.2,
      maxTokens: STYLE_DISTILLATION_BATCH_MAX_TOKENS,
    });
    text = response.text;
    outputTruncated = isStyleDistillationOutputTruncated(response);
  } catch (error) {
    return failure(
      `模型调用失败：${error instanceof Error ? error.message : String(error)}`,
      "本批没有拿到模型结果，已完成的批次与确定性基线不受影响。",
      "检查模型配置或网络后，继续任务并重试失败批次。",
    );
  }
  return parseStyleDistillationBatchOutput(text, input.chapters, { sourceTerms: input.sourceTerms, outputTruncated });
}
