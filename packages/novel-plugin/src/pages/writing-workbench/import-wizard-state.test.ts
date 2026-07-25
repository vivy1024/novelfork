import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMPORT_OPTIONS,
  INITIAL_IMPORT_WIZARD_STATE,
  buildImportToolInput,
  buildStyleToolInput,
  canLeaveInputStep,
  canStartImport,
  computeImportStats,
  progressForPhase,
  suggestNextActions,
  summarizePreflight,
  validateSplitPattern,
  type ImportWizardState,
} from "./import-wizard-state";

function stateWith(overrides: Partial<ImportWizardState>): ImportWizardState {
  return { ...INITIAL_IMPORT_WIZARD_STATE, ...overrides };
}

describe("import wizard step validation", () => {
  it("blocks leaving input when text is empty or too short", () => {
    expect(canLeaveInputStep(INITIAL_IMPORT_WIZARD_STATE).ok).toBe(false);
    expect(canLeaveInputStep(stateWith({ plainText: "短文本" })).ok).toBe(false);
    expect(canLeaveInputStep(stateWith({ plainText: "字".repeat(1000) })).ok).toBe(true);
  });

  it("blocks import when no chapters were detected", () => {
    const ready = stateWith({ plainText: "字".repeat(1200) });
    expect(canStartImport(ready).ok).toBe(false);
    const withChapters = stateWith({
      plainText: "字".repeat(1200),
      previewChapters: [{ title: "第一章", content: "正文" }],
    });
    expect(canStartImport(withChapters).ok).toBe(true);
  });

  it("validates split pattern regex", () => {
    expect(validateSplitPattern("").ok).toBe(true);
    expect(validateSplitPattern("^第\\d+章").ok).toBe(true);
    expect(validateSplitPattern("([unclosed").ok).toBe(false);
  });
});

describe("import wizard stats", () => {
  it("computes chapter count words and average", () => {
    const stats = computeImportStats([
      { title: "1", content: "字".repeat(100) },
      { title: "2", content: "字".repeat(300) },
    ]);
    expect(stats).toEqual({ chapterCount: 2, totalWords: 400, averageWords: 200 });
  });

  it("handles empty chapter list", () => {
    expect(computeImportStats([])).toEqual({ chapterCount: 0, totalWords: 0, averageWords: 0 });
  });
});

describe("tool payload building", () => {
  it("builds import tool input without bookId and omits empty split pattern", () => {
    const input = buildImportToolInput(stateWith({
      plainText: "正文".repeat(600),
      fileName: "book.epub",
      options: { ...DEFAULT_IMPORT_OPTIONS, sourceName: "" },
    }));
    expect(input.bookId).toBeUndefined();
    expect(input.splitPattern).toBeUndefined();
    expect(input.sourceName).toBe("book.epub");
    expect(input.autoSettle).toBe(true);
    expect(input.extractBrief).toBe(true);
    expect(input.applyDissectDraft).toBe(false);
  });

  it("passes a custom split pattern through", () => {
    const input = buildImportToolInput(stateWith({
      plainText: "正文".repeat(600),
      options: { ...DEFAULT_IMPORT_OPTIONS, splitPattern: "^Chapter \\d+" },
    }));
    expect(input.splitPattern).toBe("^Chapter \\d+");
  });

  it("returns style payload only when enabled and long enough", () => {
    expect(buildStyleToolInput(stateWith({ plainText: "字".repeat(5000) }))).toBeNull();
    const enabled = buildStyleToolInput(stateWith({
      plainText: "字".repeat(5000),
      options: { ...DEFAULT_IMPORT_OPTIONS, runStyleImport: true, sourceName: "仙逆" },
    }));
    expect(enabled).toMatchObject({ applyPreset: true, enableOnBook: true, sourceName: "仙逆" });
    const tooShort = buildStyleToolInput(stateWith({
      plainText: "字".repeat(500),
      options: { ...DEFAULT_IMPORT_OPTIONS, runStyleImport: true },
    }));
    expect(tooShort).toBeNull();
  });
});

describe("preflight summary and next actions", () => {
  it("maps preflight payload into a traffic light", () => {
    expect(summarizePreflight({ ok: true, blockers: [], warningItems: [] }).light).toBe("green");
    expect(summarizePreflight({
      ok: true,
      blockers: [],
      warningItems: [{ code: "style-disabled", message: "x" }],
    }).light).toBe("yellow");
    const red = summarizePreflight({
      ok: false,
      blockers: [{ code: "empty-recent-progress", message: "x" }],
      warningItems: [],
    });
    expect(red.light).toBe("red");
    expect(red.blockerCodes).toContain("empty-recent-progress");
  });

  it("suggests writing next when preflight is green", () => {
    const actions = suggestNextActions({
      preflight: { ok: true, light: "green", blockerCodes: [], warningCodes: [] },
      appliedDissectDraft: true,
      ranStyleImport: true,
    });
    expect(actions[0]).toMatchObject({ id: "write-next", primary: true });
  });

  it("suggests settling when memory is empty", () => {
    const actions = suggestNextActions({
      preflight: { ok: false, light: "red", blockerCodes: ["empty-recent-progress"], warningCodes: [] },
      appliedDissectDraft: false,
      ranStyleImport: false,
    });
    expect(actions[0]).toMatchObject({ id: "settle-range", primary: true });
    expect(actions.some((action) => action.id === "run-style")).toBe(true);
  });
});

describe("progress mapping", () => {
  it("increases monotonically across phases", () => {
    expect(progressForPhase("importing")).toBeLessThan(progressForPhase("settling"));
    expect(progressForPhase("settling")).toBeLessThan(progressForPhase("dissecting"));
    expect(progressForPhase("dissecting")).toBeLessThan(progressForPhase("styling"));
    expect(progressForPhase("styling")).toBeLessThan(progressForPhase("done"));
    expect(progressForPhase("done")).toBe(100);
  });
});
