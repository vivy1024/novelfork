import { z } from "zod";

import type { RuntimeTextGenerator } from "@vivy1024/novelfork-core/plugins";
import {
  STYLE_DISTILLATION_CHAPTER_CHAR_LIMIT,
  STYLE_MODEL_RULE_CATEGORIES,
  type DistillableChapter,
  type StyleDistillationExplanation,
  type StyleRuleCategory,
} from "./style-distillation.js";

/**
 * 文风蒸馏的模型批次：只把一批章节交给 Runtime 会话模型（或宿主已有的服务端模型路径），
 * 抽取写法规则。模型输出一律经 zod 校验、证据逐字回查原文，失败时带 explanation 返回，不静默丢弃。
 */

export const STYLE_DISTILLATION_MAX_RULES_PER_BATCH = 12;

const ModelRuleSchema = z.object({
  category: z.enum(STYLE_MODEL_RULE_CATEGORIES),
  text: z.string().trim().min(4).max(400),
  evidence: z.string().trim().min(4).max(400),
  transfer: z.enum(["transferable", "source-only"]),
  reason: z.string().trim().min(1).max(300),
});

export const StyleDistillationModelOutputSchema = z.object({
  rules: z.array(ModelRuleSchema).max(20),
});

export interface ExtractedStyleRule {
  readonly category: StyleRuleCategory;
  readonly text: string;
  /** 已回查原文的逐字证据，前缀标明所在章。 */
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
- text 写成作者可以直接照做的写法，不超过 120 字；不得包含来源作品的人名、地名、门派、道具等专有名词。
- evidence 必须是原文中连续出现的逐字片段（8 到 120 字），不得改写、拼接、概括或补标点。
- transfer：换一本书仍然成立的表达技法标 transferable；依赖该作品人物、设定、题材专有元素或口头禅的标 source-only。
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

function extractJsonText(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(text)?.[1];
  return /\{[\s\S]*\}/u.exec(fenced ?? text)?.[0] ?? null;
}

function compact(value: string): string {
  return value.replace(/\s+/gu, "");
}

/** 证据按省略号切段，每段都必须在同一章原文中逐字出现；返回所在章号。 */
export function locateStyleEvidence(evidence: string, chapters: readonly DistillableChapter[]): number | null {
  const segments = evidence
    .replace(/^[「『“"'‘]+|[」』”"'’]+$/gu, "")
    .split(/…+|\.{3,}/u)
    .map(compact)
    .filter((segment) => segment.length >= 2);
  if (segments.length === 0) return null;
  for (const chapter of chapters) {
    const content = compact(chapter.content);
    if (segments.every((segment) => content.includes(segment))) return chapter.number;
  }
  return null;
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

/** 解析并校验一批模型输出；纯函数，便于单测覆盖各种坏输出。 */
export function parseStyleDistillationBatchOutput(
  text: string,
  chapters: readonly DistillableChapter[],
): StyleBatchExtraction {
  const jsonText = extractJsonText(text);
  if (!jsonText) {
    return failure(
      "模型输出里找不到 JSON 对象。",
      "本批规则无法可靠解析，不能把自由文本当成写法规则。",
      "重试本批；多次失败时换用输出更稳定的模型。",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (error) {
    return failure(
      `模型输出不是有效 JSON：${error instanceof Error ? error.message : String(error)}`,
      "本批规则无法可靠解析，不能猜测模型的原意。",
      "重试本批；多次失败时换用输出更稳定的模型。",
    );
  }
  const parsed = StyleDistillationModelOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return failure(
      `模型输出不符合规则格式：${issueSummary(parsed.error)}`,
      "每条规则都必须带类别、逐字证据和可迁移判断，缺项的输出不能进入审阅。",
      "重试本批；多次失败时换用输出更稳定的模型。",
    );
  }
  const issues: string[] = [];
  const rules: ExtractedStyleRule[] = [];
  const candidates = parsed.data.rules;
  if (candidates.length > STYLE_DISTILLATION_MAX_RULES_PER_BATCH) {
    issues.push(`模型返回 ${candidates.length} 条规则，超过每批 ${STYLE_DISTILLATION_MAX_RULES_PER_BATCH} 条上限，仅收录前 ${STYLE_DISTILLATION_MAX_RULES_PER_BATCH} 条。`);
  }
  for (const candidate of candidates.slice(0, STYLE_DISTILLATION_MAX_RULES_PER_BATCH)) {
    const chapterNumber = locateStyleEvidence(candidate.evidence, chapters);
    if (chapterNumber === null) {
      issues.push(`未收录「${candidate.text.slice(0, 60)}」：证据未在本批原文中逐字找到，可能是模型改写或编造。`);
      continue;
    }
    rules.push({
      category: candidate.category,
      text: candidate.text,
      evidence: `第${chapterNumber}章原文：「${candidate.evidence}」`,
      transfer: candidate.transfer,
      reason: candidate.reason,
    });
  }
  if (candidates.length === 0) issues.push("模型认为本批没有可提取的写法规则。");
  return { ok: true, rules, issues };
}

export async function extractStyleRulesFromBatch(input: {
  readonly generateText: RuntimeTextGenerator;
  readonly sourceName: string;
  readonly chapters: readonly DistillableChapter[];
}): Promise<StyleBatchExtraction> {
  let text: string;
  try {
    const response = await input.generateText({
      messages: buildStyleDistillationBatchMessages(input),
      temperature: 0.2,
      maxTokens: 3_000,
    });
    text = response.text;
  } catch (error) {
    return failure(
      `模型调用失败：${error instanceof Error ? error.message : String(error)}`,
      "本批没有拿到模型结果，已完成的批次与确定性基线不受影响。",
      "检查模型配置或网络后，继续任务并重试失败批次。",
    );
  }
  return parseStyleDistillationBatchOutput(text, input.chapters);
}
