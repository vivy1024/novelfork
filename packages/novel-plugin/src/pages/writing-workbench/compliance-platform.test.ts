import { describe, expect, it } from "vitest";
import { toCompliancePlatform } from "./compliance-platform";

describe("toCompliancePlatform", () => {
  it("映射番茄到 fanqie", () => {
    expect(toCompliancePlatform("tomato")).toBe("fanqie");
  });

  it("保留起点枚举", () => {
    expect(toCompliancePlatform("qidian")).toBe("qidian");
  });

  it("将飞卢和 other 映射到 generic", () => {
    expect(toCompliancePlatform("feilu")).toBe("generic");
    expect(toCompliancePlatform("other")).toBe("generic");
  });

  it("缺省平台也使用 generic", () => {
    expect(toCompliancePlatform(undefined)).toBe("generic");
    expect(toCompliancePlatform("unknown")).toBe("generic");
  });
});
