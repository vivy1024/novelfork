import { describe, expect, it } from "vitest";

import { SETTINGS_SECTIONS, SETTINGS_SECTION_IDS, isSettingsSectionId, resolveSettingsSectionId } from "./sections";

describe("NovelFork shadcn settings registry", () => {
  it("covers every NarraFork native settings section exactly once", () => {
    expect(SETTINGS_SECTION_IDS).toEqual([
      "profile",
      "security",
      "models",
      "agents",
      "notifications",
      "appearance",
      "gateway",
      "providers",
      "search",
      "proxy",
      "chapters",
      "server",
      "authentication",
      "users",
      "terminals",
      "devices",
      "storage",
      "runtime",
      "usage",
      "about",
    ]);
    expect(new Set(SETTINGS_SECTIONS.map((item) => item.id)).size).toBe(SETTINGS_SECTION_IDS.length);
  });

  it("preserves legacy route entry points and fails closed for unknown sections", () => {
    expect(isSettingsSectionId("providers")).toBe(true);
    expect(resolveSettingsSectionId("custom-subagents")).toBe("agents");
    expect(resolveSettingsSectionId("mcp")).toBe("agents");
    expect(resolveSettingsSectionId("data")).toBe("storage");
    expect(resolveSettingsSectionId("resources")).toBe("runtime");
    expect(resolveSettingsSectionId("unknown")).toBe("profile");
    expect(isSettingsSectionId(undefined)).toBe(false);
  });

  it("keeps personal sections available without admin access", () => {
    expect(SETTINGS_SECTIONS.filter((item) => !item.adminOnly).map((item) => item.id)).toEqual([
      "profile",
      "security",
      "models",
      "agents",
      "notifications",
      "appearance",
      "gateway",
    ]);
  });
});
