import { describe, expect, it } from "vitest";

import { getMockDebtItem } from "../api/lib/mock-debt-ledger";
import * as toolComponents from "./tool-components";

describe("tool component production barrel", () => {
  it("keeps ToolUsageExample isolated as an internal demo", () => {
    expect("ToolUsageExample" in toolComponents).toBe(false);
    expect(getMockDebtItem("tool-usage-example")).toMatchObject({ status: "internal-demo" });
  });
});
