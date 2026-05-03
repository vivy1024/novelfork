import { describe, expect, it } from "vitest";

import { getVisibleToolsForWorkbenchMode, TOOL_CATALOG } from "./tool-catalog.js";

describe("tool catalog workbench visibility", () => {
  it("marks NovelFork writing tools as author-visible and raw engineering tools as advanced", () => {
    expect(TOOL_CATALOG.find((tool) => tool.name === "plan_chapter")).toMatchObject({ visibility: "author" });
    expect(TOOL_CATALOG.find((tool) => tool.name === "Bash")).toMatchObject({ visibility: "advanced" });
    expect(TOOL_CATALOG.find((tool) => tool.name === "Terminal")).toMatchObject({ visibility: "advanced" });
    expect(TOOL_CATALOG.find((tool) => tool.name === "Browser")).toMatchObject({ visibility: "advanced" });
    expect(TOOL_CATALOG.find((tool) => tool.name === "NarraForkAdmin")).toMatchObject({ visibility: "advanced" });
  });

  it("hides advanced tools from author mode and restores them in advanced workbench mode", () => {
    const authorTools = getVisibleToolsForWorkbenchMode(false).map((tool) => tool.name);
    expect(authorTools).toContain("plan_chapter");
    expect(authorTools).not.toContain("Bash");
    expect(authorTools).not.toContain("Terminal");
    expect(authorTools).not.toContain("Browser");
    expect(authorTools).not.toContain("NarraForkAdmin");

    const advancedTools = getVisibleToolsForWorkbenchMode(true).map((tool) => tool.name);
    expect(advancedTools).toEqual(expect.arrayContaining(["plan_chapter", "Bash", "Terminal", "Browser", "NarraForkAdmin"]));
  });
});
