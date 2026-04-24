import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { notify } from "./notify";
import { maybeShowClosedWindowHint, resetClosedWindowHintForTests } from "./closed-window-hint";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let infoSpy: any;

beforeEach(() => {
  infoSpy = vi.spyOn(notify, "info").mockImplementation(() => "mocked");
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
  resetClosedWindowHintForTests();
});

afterEach(() => {
  infoSpy.mockRestore();
  resetClosedWindowHintForTests();
});

describe("maybeShowClosedWindowHint", () => {
  it("does nothing for empty windows", () => {
    maybeShowClosedWindowHint({ hasContent: false });
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("fires exactly once for the first populated-window close", () => {
    maybeShowClosedWindowHint({ hasContent: true });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith(
      "窗口已关闭",
      expect.objectContaining({
        description: "会话仍在会话中心，随时可重新打开",
      }),
    );
  });

  it("suppresses subsequent fires after the first hint", () => {
    maybeShowClosedWindowHint({ hasContent: true });
    maybeShowClosedWindowHint({ hasContent: true });
    maybeShowClosedWindowHint({ hasContent: true });
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });

  it("still uses the in-memory flag when localStorage.getItem throws (embedded / file:// modes)", () => {
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    try {
      // With broken storage the hint still fires once for the current session
      // (fail-open) — otherwise the user would never see the reassurance.
      expect(() => maybeShowClosedWindowHint({ hasContent: true })).not.toThrow();
      expect(infoSpy).toHaveBeenCalledTimes(1);
      // And the in-memory fallback still dedupes within the session:
      maybeShowClosedWindowHint({ hasContent: true });
      expect(infoSpy).toHaveBeenCalledTimes(1);
    } finally {
      Storage.prototype.getItem = getItem;
    }
  });
});
