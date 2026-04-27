import { chatCompletion, createLLMClient, type LLMClient, type LLMMessage } from "../../llm/provider.js";
import type { LLMConfig } from "../../models/project.js";
import type { GeneratedHook, HookGeneratorInput, HookStyle, RetentionEstimate } from "./hook-types.js";

const HOOK_STYLES = new Set<HookStyle>([
  "suspense",
  "reversal",
  "emotional",
  "info-gap",
  "action",
  "mystery",
  "cliffhanger",
]);
const RETENTION_ESTIMATES = new Set<RetentionEstimate>(["high", "medium", "low"]);

export interface GenerateChapterHooksParams {
  readonly input: HookGeneratorInput;
  readonly llmConfig?: LLMConfig;
  readonly client?: LLMClient;
  readonly model?: string;
  readonly chat?: (messages: ReadonlyArray<LLMMessage>) => Promise<{ readonly content: string }>;
}

export async function generateChapterHooks(params: GenerateChapterHooksParams): Promise<GeneratedHook[]> {
  const messages = buildHookPrompt(params.input);
  const response = params.chat
    ? await params.chat(messages)
    : await chatCompletion(
        params.client ?? createClient(params.llmConfig),
        params.model ?? params.llmConfig?.model ?? "",
        messages,
        { temperature: 0.7, maxTokens: 1600 },
      );
  return parseGeneratedHooks(response.content);
}

export function parseGeneratedHooks(content: string): GeneratedHook[] {
  const parsed = parseJsonArray(content);
  return parsed
    .map((item, index) => normalizeHook(item, index))
    .filter((hook): hook is GeneratedHook => hook !== null)
    .slice(0, 5);
}

function buildHookPrompt(input: HookGeneratorInput): LLMMessage[] {
  const recentContent = input.chapterContent.slice(-2000);
  return [
    {
      role: "system",
      content: [
        "你是一位中文网文章末悬念设计专家。",
        "请只输出 JSON 数组，不要输出 Markdown。",
        "每项字段：style, text, rationale, retentionEstimate, relatedHookIds。",
        "style 只能是 suspense/reversal/emotional/info-gap/action/mystery/cliffhanger。",
        "retentionEstimate 只能是 high/medium/low。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `章节号：${input.chapterNumber}`,
        `书籍流派：${input.bookGenre ?? "未指定"}`,
        `下章意图：${input.nextChapterIntent ?? "未指定"}`,
        "当前伏笔：",
        input.pendingHooks || "无",
        "本章末尾内容：",
        recentContent,
        "请生成 3-5 个自然延伸的章末钩子方案。",
      ].join("\n\n"),
    },
  ];
}

function parseJsonArray(content: string): unknown[] {
  const trimmed = content.trim();
  const direct = tryParseJson(trimmed);
  if (Array.isArray(direct)) return direct;
  if (direct && typeof direct === "object" && Array.isArray((direct as { hooks?: unknown }).hooks)) {
    return (direct as { hooks: unknown[] }).hooks;
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    const parsed = tryParseJson(fenced.trim());
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { hooks?: unknown }).hooks)) {
      return (parsed as { hooks: unknown[] }).hooks;
    }
  }
  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    const parsed = tryParseJson(arrayMatch[0]);
    if (Array.isArray(parsed)) return parsed;
  }
  return [];
}

function normalizeHook(item: unknown, index: number): GeneratedHook | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const style = normalizeStyle(record.style);
  const text = readString(record.text);
  const rationale = readString(record.rationale) || readString(record.reason);
  const retentionEstimate = normalizeRetention(record.retentionEstimate ?? record.retention);
  const relatedHookIds = Array.isArray(record.relatedHookIds)
    ? record.relatedHookIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : undefined;
  if (!style || !text || !rationale || !retentionEstimate) return null;
  return {
    id: readString(record.id) || `hook-${index + 1}`,
    style,
    text,
    rationale,
    retentionEstimate,
    ...(relatedHookIds && relatedHookIds.length > 0 ? { relatedHookIds } : {}),
  };
}

function normalizeStyle(value: unknown): HookStyle | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase() as HookStyle;
  if (HOOK_STYLES.has(normalized)) return normalized;
  const mapped = mapChineseStyle(value);
  return mapped;
}

function mapChineseStyle(value: string): HookStyle | null {
  if (value.includes("悬念")) return "suspense";
  if (value.includes("反转")) return "reversal";
  if (value.includes("情感")) return "emotional";
  if (value.includes("信息")) return "info-gap";
  if (value.includes("动作")) return "action";
  if (value.includes("谜") || value.includes("疑")) return "mystery";
  if (value.includes("悬崖")) return "cliffhanger";
  return null;
}

function normalizeRetention(value: unknown): RetentionEstimate | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase() as RetentionEstimate;
  if (RETENTION_ESTIMATES.has(normalized)) return normalized;
  if (value.includes("高")) return "high";
  if (value.includes("中")) return "medium";
  if (value.includes("低")) return "low";
  return null;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function tryParseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function createClient(config?: LLMConfig): LLMClient {
  if (!config) {
    throw new Error("生成章末钩子需要配置 LLM，或在测试中注入 chat 函数。");
  }
  return createLLMClient(config);
}
