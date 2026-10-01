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
import { collectSourceTerms, findSourceTerms, type SourceTermIndex } from "./style-distillation-terms.js";

/**
 * 文风蒸馏的模型批次：只把一批章节交给 Runtime 会话模型（或宿主已有的服务端模型路径），
 * 抽取写法规则。模型输出经宽容 JSON 解析与 zod 校验、证据回查原文、专名后检，
 * 失败时带 explanation 返回，不静默丢弃。
 */

export const STYLE_DISTILLATION_MAX_RULES_PER_BATCH = 12;

/**
 * 每批的输出上限。每批最多 12 条规则，每条含正文（≤120 字）、逐字证据（≤120 字）与判断理由，
 * 连同 JSON 结构约 4–5 千字、5 千 token 上下；思考型模型（W0 实测的 claude-opus-4-6、gemini-3.7-flash）
 * 还会先把上限的一部分花在推理上。原先的 3000 在 W0 里多次把输出截在半截，这里放宽到 8000，
 * 仍在主流模型的单次输出上限之内。
 */
export const STYLE_DISTILLATION_BATCH_MAX_TOKENS = 8_000;

/** 宿主可选地告知输出是否因上限被截断；Runtime 会话生成器只返回 text 时视为未知。 */
export type StyleDistillationTextGenerator = (
  input: RuntimeTextGenerationRequest,
) => Promise<{ readonly text: string; readonly outputTruncated?: boolean }>;

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

export type StyleBatchExtraction =
  | { readonly ok: true; readonly rules: readonly ExtractedStyleRule[]; readonly issues: readonly string[] }
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

// 引号与全半角标点归一：模型常把原文的 “” 写成 " 或「」，把，写成 ,；比对时视为同一个字符。
const QUOTE_CHARS = new Set([..."“”„‟〝〞＂\"'‘’‛「」『』﹁﹂﹃﹄"]);
const PUNCTUATION_PAIRS: Readonly<Record<string, string>> = {
  ",": "，", ";": "；", ":": "：", "!": "！", "?": "？", "(": "（", ")": "）",
};

function normalizeChar(char: string): string {
  if (QUOTE_CHARS.has(char)) return "\"";
  return PUNCTUATION_PAIRS[char] ?? char;
}

/**
 * 去空白并归一引号与标点（逐字一一对应，只删空白），同时记下每个归一后字符在原文里的起止位置，
 * 便于取回原文片段。
 */
function normalizeWithMap(text: string): {
  readonly value: string;
  readonly starts: readonly number[];
  readonly ends: readonly number[];
} {
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  for (const char of text) {
    if (!/\s/u.test(char)) {
      chars.push(normalizeChar(char));
      starts.push(offset);
      ends.push(offset + char.length);
    }
    offset += char.length;
  }
  return { value: chars.join(""), starts, ends };
}

function normalizeForMatch(text: string): string {
  return normalizeWithMap(text).value;
}

export interface LocatedStyleEvidence {
  readonly chapterNumber: number;
  /** 取自原文的逐字片段；多段证据用「……」连接。 */
  readonly excerpt: string;
}

/** 证据按省略号切段，每段都必须在同一章原文中按顺序逐字出现（引号、全半角标点、空白不计差异）。 */
export function locateStyleEvidenceInChapters(
  evidence: string,
  chapters: readonly DistillableChapter[],
): LocatedStyleEvidence | null {
  const segments = evidence
    .trim()
    .replace(/^[「『“"'‘]+|[」』”"'’]+$/gu, "")
    .split(/…+|\.{3,}/u)
    .map(normalizeForMatch)
    .filter((segment) => segment.length >= 2);
  if (segments.length === 0) return null;
  for (const chapter of chapters) {
    const content = normalizeWithMap(chapter.content);
    const pieces: string[] = [];
    let cursor = 0;
    let matched = true;
    for (const segment of segments) {
      const at = content.value.indexOf(segment, cursor);
      if (at < 0) { matched = false; break; }
      // 归一只替换等长字符、删空白，归一串的下标与 starts/ends 一一对应（按码点计）。
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

function termList(terms: readonly { readonly term: string; readonly count: number }[]): string {
  return terms.slice(0, 3).map((term) => `「${term.term}」（来源中出现 ${term.count} 次）`).join("、");
}

export interface ParseStyleBatchOptions {
  /** 来源全文的专名统计；缺省时只用本批章节统计。 */
  readonly sourceTerms?: SourceTermIndex;
  /** 宿主告知输出因上限被截断。 */
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
  for (const candidate of valid) {
    const located = locateStyleEvidenceInChapters(candidate.evidence, chapters);
    if (!located) {
      issues.push(`未收录「${candidate.text.slice(0, 60)}」：证据未在本批原文中逐字找到，可能是模型改写或编造。`);
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
  return { ok: true, rules, issues };
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
    const response = await input.generateText({
      messages: buildStyleDistillationBatchMessages(input),
      temperature: 0.2,
      maxTokens: STYLE_DISTILLATION_BATCH_MAX_TOKENS,
    });
    text = response.text;
    outputTruncated = response.outputTruncated === true;
  } catch (error) {
    return failure(
      `模型调用失败：${error instanceof Error ? error.message : String(error)}`,
      "本批没有拿到模型结果，已完成的批次与确定性基线不受影响。",
      "检查模型配置或网络后，继续任务并重试失败批次。",
    );
  }
  return parseStyleDistillationBatchOutput(text, input.chapters, { sourceTerms: input.sourceTerms, outputTruncated });
}
