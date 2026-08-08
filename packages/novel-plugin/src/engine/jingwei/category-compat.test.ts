import { describe, expect, it } from "vitest";

import { getJingweiCategoryAliases, sqlInPlaceholders } from "./category-compat.js";

describe("category compatibility", () => {
  it("keeps canonical and legacy character category values readable", () => {
    expect(getJingweiCategoryAliases("characters")).toEqual(expect.arrayContaining(["characters", "character"]));
  });

  it("returns parameter placeholders without interpolating values", () => {
    expect(sqlInPlaceholders(["characters", "character"])).toBe("?, ?");
  });
});
