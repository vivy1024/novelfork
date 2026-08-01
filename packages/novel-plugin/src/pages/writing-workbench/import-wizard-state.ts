/**
 * Import wizard state machine — pure logic so it can be unit tested without React.
 *
 * Step flow: input → preview → executing
 * Format normalization comes from core (`normalizeImportSource`); this module owns
 * user-facing options, validation and the tool payloads.
 */

import type { ImportFormat, SplitChapter } from "@vivy1024/novelfork-core";

export type ImportWizardStep = "input" | "preview" | "executing";
export type ImportSourceType = "paste" | "file";
export type ImportPhase = "importing" | "settling" | "dissecting" | "styling" | "done";

export interface ImportWizardOptions {
  readonly sourceName: string;
  readonly maxChapters: number;
  readonly autoSettle: boolean;
  readonly extractBrief: boolean;
  readonly applyDissectDraft: boolean;
  readonly runStyleImport: boolean;
  readonly splitPattern: string;
}

export interface ImportWizardState {
  readonly step: ImportWizardStep;
  readonly sourceType: ImportSourceType;
  readonly fileName: string;
  readonly rawText: string;
  readonly plainText: string;
  readonly format: ImportFormat | null;
  readonly formatEvidence: string;
  readonly metadata: { readonly title?: string; readonly author?: string };
  readonly previewChapters: readonly SplitChapter[];
  readonly options: ImportWizardOptions;
  readonly warnings: readonly string[];
  readonly progress: { readonly phase: ImportPhase; readonly percent: number };
  readonly error: string | null;
}

export const DEFAULT_IMPORT_OPTIONS: ImportWizardOptions = {
  sourceName: "导入文本",
  maxChapters: 500,
  autoSettle: true,
  extractBrief: true,
  applyDissectDraft: false,
  runStyleImport: false,
  splitPattern: "",
};

export const INITIAL_IMPORT_WIZARD_STATE: ImportWizardState = {
  step: "input",
  sourceType: "paste",
  fileName: "",
  rawText: "",
  plainText: "",
  format: null,
  formatEvidence: "",
  metadata: {},
  previewChapters: [],
  options: DEFAULT_IMPORT_OPTIONS,
  warnings: [],
  progress: { phase: "importing", percent: 0 },
  error: null,
};

/** 最小可导入正文长度，与 pipeline.import_chapters handler 一致。 */
export const MIN_IMPORT_CHARS = 1000;

export interface ImportWizardStats {
  readonly chapterCount: number;
  readonly totalWords: number;
  readonly averageWords: number;
}

export function computeImportStats(chapters: readonly SplitChapter[]): ImportWizardStats {
  const chapterCount = chapters.length;
  const totalWords = chapters.reduce((sum, chapter) => sum + chapter.content.length, 0);
  return {
    chapterCount,
    totalWords,
    averageWords: chapterCount > 0 ? Math.round(totalWords / chapterCount) : 0,
  };
}

export interface StepValidation {
  readonly ok: boolean;
  readonly reason?: string;
}

export function canLeaveInputStep(state: ImportWizardState): StepValidation {
  if (!state.plainText.trim()) return { ok: false, reason: "请先粘贴文本或选择文件。" };
  if (state.plainText.length < MIN_IMPORT_CHARS) {
    return { ok: false, reason: `正文至少需要 ${MIN_IMPORT_CHARS} 字，当前 ${state.plainText.length} 字。` };
  }
  return { ok: true };
}

export function canStartImport(state: ImportWizardState): StepValidation {
  const base = canLeaveInputStep(state);
  if (!base.ok) return base;
  if (state.previewChapters.length === 0) {
    return { ok: false, reason: "未识别出章节，请调整分章规则。" };
  }
  if (state.options.maxChapters <= 0) return { ok: false, reason: "maxChapters 必须为正整数。" };
  return { ok: true };
}

export function validateSplitPattern(pattern: string): StepValidation {
  if (!pattern.trim()) return { ok: true };
  try {
    new RegExp(pattern);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `分章正则无效：${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Payload for the Runtime tool `pipeline.import_chapters` (bookId injected by host). */
export function buildImportToolInput(state: ImportWizardState): Record<string, unknown> {
  const { options } = state;
  return {
    content: state.plainText,
    sourceName: options.sourceName.trim() || state.fileName || "导入文本",
    ...(options.splitPattern.trim() ? { splitPattern: options.splitPattern.trim() } : {}),
    maxChapters: options.maxChapters,
    autoSettle: options.autoSettle,
    extractBrief: options.extractBrief,
    applyDissectDraft: options.applyDissectDraft,
  };
}

/** Payload for the optional follow-up `style.import` call. */
export function buildStyleToolInput(state: ImportWizardState): Record<string, unknown> | null {
  if (!state.options.runStyleImport) return null;
  const referenceText = state.plainText.slice(0, 50_000);
  if (referenceText.length < 2000) return null;
  return {
    referenceText,
    sourceName: state.options.sourceName.trim() || state.fileName || "导入文本",
    saveAsWritingSkill: true,
    enableOnBook: true,
  };
}

export interface ImportPreflightSummary {
  readonly ok: boolean;
  readonly light: "green" | "yellow" | "red";
  readonly blockerCodes: readonly string[];
  readonly warningCodes: readonly string[];
}

/** Turn the preflight payload returned by the import tool into a UI light. */
export function summarizePreflight(preflight: unknown): ImportPreflightSummary {
  const record = preflight && typeof preflight === "object" ? preflight as Record<string, unknown> : null;
  if (!record) return { ok: false, light: "yellow", blockerCodes: [], warningCodes: [] };
  const blockers = Array.isArray(record.blockers) ? record.blockers : [];
  const warningItems = Array.isArray(record.warningItems) ? record.warningItems : [];
  const blockerCodes = blockers
    .map((item) => (item && typeof item === "object" ? String((item as { code?: unknown }).code ?? "") : ""))
    .filter(Boolean);
  const warningCodes = warningItems
    .map((item) => (item && typeof item === "object" ? String((item as { code?: unknown }).code ?? "") : ""))
    .filter(Boolean);
  const ok = record.ok === true;
  return {
    ok,
    light: ok ? (warningCodes.length > 0 ? "yellow" : "green") : "red",
    blockerCodes,
    warningCodes,
  };
}

export interface NextActionSuggestion {
  readonly id: "write-next" | "view-dissect" | "run-style" | "settle-range" | "close";
  readonly label: string;
  readonly primary?: boolean;
}

export function suggestNextActions(input: {
  readonly preflight: ImportPreflightSummary;
  readonly appliedDissectDraft: boolean;
  readonly ranStyleImport: boolean;
}): NextActionSuggestion[] {
  const actions: NextActionSuggestion[] = [];
  if (input.preflight.ok) {
    actions.push({ id: "write-next", label: "去写下一章", primary: true });
  } else if (input.preflight.blockerCodes.includes("empty-recent-progress")) {
    actions.push({ id: "settle-range", label: "补结算历史章节", primary: true });
  } else {
    actions.push({ id: "view-dissect", label: "查看拆书草案", primary: true });
  }
  if (!input.appliedDissectDraft) actions.push({ id: "view-dissect", label: "查看拆书草案" });
  if (!input.ranStyleImport) actions.push({ id: "run-style", label: "导入文风预设" });
  actions.push({ id: "close", label: "关闭" });
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = `${action.id}:${action.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function progressForPhase(phase: ImportPhase): number {
  switch (phase) {
    case "importing": return 25;
    case "settling": return 55;
    case "dissecting": return 80;
    case "styling": return 92;
    case "done": return 100;
    default: return 0;
  }
}
