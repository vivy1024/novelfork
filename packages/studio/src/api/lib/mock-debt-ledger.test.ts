import { describe, expect, it } from "vitest";

import {
  MOCK_DEBT_ITEMS,
  getMockDebtItem,
  listMockDebtItems,
  updateMockDebtItemStatus,
  type MockDebtStatus,
} from "./mock-debt-ledger";

const REQUIRED_DEBT_IDS = [
  "provider-runtime",
  "platform-integrations",
  "runtime-model-pool",
  "session-chat-runtime",
  "legacy-model-ui",
  "book-chat-history",
  "pipeline-runs",
  "monitor-status",
  "agent-config-service",
  "admin-users",
  "writing-modes-apply",
  "writing-tools-health",
  "ai-complete-streaming",
  "tool-usage-example",
  "transparent-admin-placeholders",
  "core-missing-file-sentinel",
  "cli-production-source",
] as const;

const VALID_STATUSES: MockDebtStatus[] = [
  "must-replace",
  "transparent-placeholder",
  "internal-demo",
  "confirmed-real",
  "test-only",
];

const VALID_RISKS = ["critical", "high", "medium", "low"];

describe("mock debt ledger", () => {
  it("registers every known project-wide runtime cleanup debt item", () => {
    const ids = MOCK_DEBT_ITEMS.map((item) => item.id);

    expect(new Set(ids)).toEqual(new Set(REQUIRED_DEBT_IDS));
    expect(ids).toHaveLength(REQUIRED_DEBT_IDS.length);
  });

  it("records status, target behavior and verification for each debt item", () => {
    for (const item of MOCK_DEBT_ITEMS) {
      expect(item.module, item.id).not.toBe("");
      expect(item.files.length, item.id).toBeGreaterThan(0);
      expect(item.currentBehavior, item.id).not.toBe("");
      expect(VALID_RISKS, item.id).toContain(item.userRisk);
      expect(VALID_STATUSES, item.id).toContain(item.status);
      expect(item.targetBehavior, item.id).not.toBe("");
      expect(item.ownerSpec, item.id).toBe("project-wide-real-runtime-cleanup");
      expect(item.verification.length, item.id).toBeGreaterThan(0);
    }
  });

  it("can query and update a ledger copy without mutating the default ledger", () => {
    const original = getMockDebtItem("provider-runtime");
    const updatedItems = updateMockDebtItemStatus("provider-runtime", "transparent-placeholder");
    const updated = getMockDebtItem("provider-runtime", updatedItems);

    expect(original?.status).toBe("confirmed-real");
    expect(updated?.status).toBe("transparent-placeholder");
    expect(getMockDebtItem("provider-runtime")?.status).toBe("confirmed-real");
    expect(listMockDebtItems(updatedItems)).toHaveLength(MOCK_DEBT_ITEMS.length);
  });

  it("has no must-replace items left after final provider-runtime cleanup", () => {
    const remainingMustReplaceIds = MOCK_DEBT_ITEMS
      .map((item) => ({ id: item.id, status: String(item.status) }))
      .filter((item) => item.status === "must-replace")
      .map((item) => item.id);

    expect(remainingMustReplaceIds).toEqual([]);
  });
});
