import { describe, expect, it } from "vitest";

import { resolveStartupPort, resolveStartupRoot } from "./startup-args";

describe("startup args", () => {
  it("prefers --root named argument over legacy positional root and env", () => {
    expect(
      resolveStartupRoot(
        ["node", "index.js", "--root=.", "D:/legacy"],
        { NOVELFORK_PROJECT_ROOT: "D:/env" },
        () => "D:/default",
      ),
    ).toBe(".");
  });

  it("keeps legacy positional root fallback for compiled binary startup", () => {
    expect(
      resolveStartupRoot(
        ["node", "index.js", "D:/project"],
        { NOVELFORK_PROJECT_ROOT: "D:/env" },
        () => "D:/default",
      ),
    ).toBe("D:/project");
  });

  it("prefers --port named argument over NOVELFORK_STUDIO_PORT", () => {
    expect(
      resolveStartupPort(
        ["node", "index.js", "--port=4575"],
        { NOVELFORK_STUDIO_PORT: "4567" },
      ),
    ).toBe(4575);
  });
});
