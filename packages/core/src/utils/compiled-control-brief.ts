import type { ChapterTrace, ContextPackage, RuleStack } from "../models/input-governance.js";

type PromptLanguage = "zh" | "en";
type ProcessBriefKind = "analysis" | "review" | "revision";

interface BriefInput {
  readonly chapterIntent: string;
  readonly contextPackage: ContextPackage;
  readonly ruleStack: RuleStack;
  readonly language: PromptLanguage;
  readonly trace?: ChapterTrace;
}

interface CompiledControlSummary {
  readonly goal?: string;
  readonly mustKeep: string[];
  readonly mustAvoid: string[];
  readonly styleEmphasis: string[];
  readonly creativePressure: string[];
  readonly hookFocus: string[];
  readonly stateAnchors: string[];
  readonly storyGuardrails: string[];
  readonly outlineAnchors: string[];
  readonly canonGuardrails: string[];
  readonly titleHistory?: string;
  readonly moodTrail?: string;
  readonly overrideLines: string[];
  readonly traceNotes: string[];
}

export function buildStoryBrief(params: BriefInput): string {
  const summary = compileControlSummary(params);
  const continuityAnchors = uniqueContextLines([
    ...summary.stateAnchors,
    ...summary.storyGuardrails,
    ...summary.outlineAnchors,
  ]);

  if (params.language === "en") {
    return [
      "## Story Brief",
      summary.goal ? `Goal: ${summary.goal}` : "",
      renderCompactList("Keep continuity on", summary.mustKeep),
      renderCompactList("Avoid this chapter", summary.mustAvoid),
      renderCompactList("Style emphasis", summary.styleEmphasis),
      renderCompactList("Creative pressure", summary.creativePressure),
      renderCompactList("Hook focus", summary.hookFocus),
      renderCompactList("Continuity anchors", continuityAnchors),
      renderCompactList("Canon guardrails", summary.canonGuardrails),
      summary.titleHistory ? `Recent title history: ${summary.titleHistory}` : "",
      summary.moodTrail ? `Recent mood/type trail: ${summary.moodTrail}` : "",
      renderCompactList("Local overrides", summary.overrideLines),
      renderCompactList("Trace notes", summary.traceNotes),
    ].filter(Boolean).join("\n\n");
  }

  return [
    "## Story Brief",
    summary.goal ? `目标：${summary.goal}` : "",
    renderCompactList("本章必须守住", summary.mustKeep),
    renderCompactList("本章避免", summary.mustAvoid),
    renderCompactList("文风强调", summary.styleEmphasis),
    renderCompactList("创作压力", summary.creativePressure),
    renderCompactList("伏笔焦点", summary.hookFocus),
    renderCompactList("连续性锚点", continuityAnchors),
    renderCompactList("正典护栏", summary.canonGuardrails),
    summary.titleHistory ? `近期标题历史：${summary.titleHistory}` : "",
    summary.moodTrail ? `近期情绪/章节类型轨迹：${summary.moodTrail}` : "",
    renderCompactList("局部覆盖", summary.overrideLines),
    renderCompactList("追踪备注", summary.traceNotes),
  ].filter(Boolean).join("\n\n");
}

export function buildSettlementFocus(params: Omit<BriefInput, "trace">): string {
  const summary = compileControlSummary(params);
  const continuityAnchors = uniqueContextLines([
    ...summary.stateAnchors,
    ...summary.storyGuardrails,
    ...summary.outlineAnchors,
    ...summary.canonGuardrails,
  ]);

  if (params.language === "en") {
    return `\n## Settlement Focus
${summary.goal ? `Goal: ${summary.goal}\n` : ""}${renderCompactList("Keep synced with", summary.mustKeep)}${renderCompactList("Hook settlement cues", summary.hookFocus)}${renderCompactList("Continuity anchors", continuityAnchors)}${renderCompactList("Local overrides", summary.overrideLines)}\n`;
  }

  return `\n## 结算焦点
${summary.goal ? `目标：${summary.goal}\n` : ""}${renderCompactList("结算时守住", summary.mustKeep)}${renderCompactList("伏笔结算提示", summary.hookFocus)}${renderCompactList("连续性锚点", continuityAnchors)}${renderCompactList("局部覆盖", summary.overrideLines)}\n`;
}

export function buildProcessBrief(
  params: BriefInput & { readonly kind: ProcessBriefKind },
): string {
  const summary = compileControlSummary(params);
  const heading = params.kind === "analysis"
    ? "## Analysis Brief"
    : params.kind === "review"
      ? "## Review Brief"
      : "## Revision Brief";

  if (params.language === "en") {
    return [
      heading,
      summary.goal ? `Goal: ${summary.goal}` : "",
      renderCompactList(
        params.kind === "analysis"
          ? "Keep analysis aligned with"
          : params.kind === "review"
            ? "Review against"
            : "Preserve while revising",
        summary.mustKeep,
      ),
      renderCompactList(
        params.kind === "analysis"
          ? "Avoid misreading"
          : params.kind === "review"
            ? "Flag if chapter drifts into"
            : "Avoid while revising",
        summary.mustAvoid,
      ),
      renderCompactList(
        params.kind === "analysis"
          ? "Update hook state around"
          : params.kind === "review"
            ? "Hook focus"
            : "Hook details to preserve",
        summary.hookFocus,
      ),
      renderCompactList("Current-state anchors", summary.stateAnchors),
      renderCompactList("Outline anchor", summary.outlineAnchors),
      renderCompactList("World rules", summary.storyGuardrails),
      renderCompactList("Canon guardrails", summary.canonGuardrails),
      renderCompactList("Local overrides", summary.overrideLines),
      params.kind === "analysis" ? renderCompactList("Trace notes", summary.traceNotes) : "",
    ].filter(Boolean).join("\n\n");
  }

  return [
    heading,
    summary.goal ? `目标：${summary.goal}` : "",
    renderCompactList(
      params.kind === "analysis"
        ? "更新时守住"
        : params.kind === "review"
          ? "重点核对"
          : "修订时守住",
      summary.mustKeep,
    ),
    renderCompactList(
      params.kind === "analysis"
        ? "避免误读"
        : params.kind === "review"
          ? "若出现则重点标记"
          : "修订时避免",
      summary.mustAvoid,
    ),
    renderCompactList(
      params.kind === "analysis"
        ? "更新伏笔时参考"
        : params.kind === "review"
          ? "伏笔焦点"
          : "伏笔细节保留",
      summary.hookFocus,
    ),
    renderCompactList("当前状态锚点", summary.stateAnchors),
    renderCompactList("卷纲锚点", summary.outlineAnchors),
    renderCompactList("世界规则", summary.storyGuardrails),
    renderCompactList("正典护栏", summary.canonGuardrails),
    renderCompactList("局部覆盖", summary.overrideLines),
    params.kind === "analysis" ? renderCompactList("追踪备注", summary.traceNotes) : "",
  ].filter(Boolean).join("\n\n");
}

function compileControlSummary(params: BriefInput): CompiledControlSummary {
  return {
    goal: readIntentScalar(params.chapterIntent, "## Goal"),
    mustKeep: readIntentList(params.chapterIntent, "## Must Keep"),
    mustAvoid: readIntentList(params.chapterIntent, "## Must Avoid"),
    styleEmphasis: readIntentList(params.chapterIntent, "## Style Emphasis"),
    creativePressure: readIntentList(params.chapterIntent, "## Creative Pressure"),
    hookFocus: buildHookFocusLines(params.chapterIntent, params.contextPackage, params.language),
    stateAnchors: collectContextExcerpts(params.contextPackage, (entry) =>
      entry.source.startsWith("story/current_state.md"),
    ),
    storyGuardrails: collectContextExcerpts(params.contextPackage, (entry) =>
      entry.source === "story/story_bible.md",
    ),
    outlineAnchors: collectContextExcerpts(params.contextPackage, (entry) =>
      entry.source === "story/volume_outline.md",
    ),
    canonGuardrails: collectContextExcerpts(params.contextPackage, (entry) =>
      entry.source === "story/parent_canon.md" || entry.source === "story/fanfic_canon.md",
    ),
    titleHistory: findContextExcerpt(params.contextPackage, "story/chapter_summaries.md#recent_titles"),
    moodTrail: findContextExcerpt(
      params.contextPackage,
      "story/chapter_summaries.md#recent_mood_type_trail",
    ),
    overrideLines: params.ruleStack.activeOverrides
      .map((override) => `${override.reason} (${override.target})`),
    traceNotes: params.trace?.notes.filter(Boolean) ?? [],
  };
}

function readIntentScalar(chapterIntent: string, heading: string): string | undefined {
  const section = extractMarkdownSection(chapterIntent, heading);
  if (!section) {
    return undefined;
  }

  return section
    .split("\n")
    .map((value) => value.trim())
    .find((value) => value.length > 0 && !value.startsWith("-") && value.toLowerCase() !== "(not found)");
}

function readIntentList(chapterIntent: string, heading: string): string[] {
  const section = extractMarkdownSection(chapterIntent, heading);
  if (!section) {
    return [];
  }

  return section
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => value.startsWith("- "))
    .map((value) => value.slice(2).trim())
    .filter((value) => value.length > 0 && value.toLowerCase() !== "none");
}

function extractMarkdownSection(content: string, heading: string): string | undefined {
  const lines = content.split("\n");
  let buffer: string[] | null = null;

  for (const line of lines) {
    if (line.trim() === heading) {
      buffer = [];
      continue;
    }

    if (buffer && line.startsWith("## ") && line.trim() !== heading) {
      break;
    }

    if (buffer) {
      buffer.push(line);
    }
  }

  const section = buffer?.join("\n").trim();
  return section && section.length > 0 ? section : undefined;
}

function buildHookFocusLines(
  chapterIntent: string,
  contextPackage: ContextPackage,
  language: PromptLanguage,
): string[] {
  const hookDebtLines = collectContextExcerpts(
    contextPackage,
    (entry) => entry.source.startsWith("runtime/hook_debt#"),
  );
  const fallbackLines = [
    ...formatAgendaLines(chapterIntent, "Must Advance", language === "en" ? "Must advance" : "必须推进"),
    ...formatAgendaLines(chapterIntent, "Eligible Resolve", language === "en" ? "Eligible payoff" : "可兑现"),
    ...formatAgendaLines(chapterIntent, "Stale Debt", language === "en" ? "Stale debt" : "旧债"),
    ...formatAgendaLines(
      chapterIntent,
      "Avoid New Hook Families",
      language === "en" ? "Avoid new hook families" : "避免新增同类 hook",
    ),
  ];

  return uniqueContextLines([
    ...(hookDebtLines.length > 0 ? hookDebtLines : []),
    ...fallbackLines,
  ]).slice(0, 6);
}

function formatAgendaLines(
  chapterIntent: string,
  subheading: string,
  label: string,
): string[] {
  const hookAgenda = extractMarkdownSection(chapterIntent, "## Hook Agenda");
  if (!hookAgenda) {
    return [];
  }

  const lines = hookAgenda.split("\n");
  const values: string[] = [];
  let capture = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === `### ${subheading}`) {
      capture = true;
      continue;
    }
    if (capture && line.startsWith("### ")) {
      break;
    }
    if (capture && line.startsWith("- ")) {
      const value = line.slice(2).trim();
      if (value && value.toLowerCase() !== "none") {
        values.push(`${label}: ${value}`);
      }
    }
  }

  return values;
}

function collectContextExcerpts(
  contextPackage: ContextPackage,
  predicate: (entry: ContextPackage["selectedContext"][number]) => boolean,
): string[] {
  return uniqueContextLines(
    contextPackage.selectedContext
      .filter(predicate)
      .map((entry) => entry.excerpt ?? entry.reason)
      .filter(Boolean),
  );
}

function findContextExcerpt(
  contextPackage: ContextPackage,
  source: string,
): string | undefined {
  return contextPackage.selectedContext.find((entry) => entry.source === source)?.excerpt;
}

function renderCompactList(heading: string, items: ReadonlyArray<string>): string {
  if (items.length === 0) {
    return "";
  }

  return `${heading}:\n${items.map((item) => `- ${item}`).join("\n")}`;
}

function uniqueContextLines(items: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(trimmed);
  }

  return result;
}
