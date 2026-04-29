import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MOCK_DEBT_ITEMS, type MockDebtItem } from "./mock-debt-ledger";
import {
  assertNoUnregisteredMockDebtHits,
  buildMockDebtScanReport,
  scanMockDebtLedgerCoverage,
  scanProductionSourceForMockDebt,
} from "./mock-debt-scan";

const REGISTERED_ITEM: MockDebtItem = {
  id: "registered-route",
  module: "Registered route",
  files: ["packages/studio/src/api/routes/registered.ts"],
  currentBehavior: "fixture",
  userRisk: "high",
  status: "must-replace",
  targetBehavior: "fixture",
  ownerSpec: "project-wide-real-runtime-cleanup",
  verification: ["fixture"],
};

describe("mock debt scan", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "novelfork-mock-scan-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeSource(relativePath: string, content: string) {
    const absolutePath = join(root, relativePath);
    await mkdir(join(absolutePath, ".."), { recursive: true });
    await writeFile(absolutePath, content, "utf-8");
  }

  it("scans production source and reports unregistered high-risk hits", async () => {
    await writeSource("packages/studio/src/api/routes/registered.ts", "export const value = 'TODO: registered debt';\n");
    await writeSource("packages/studio/src/api/routes/unregistered.ts", "export const value = 'fake success';\n");
    await writeSource("packages/studio/src/api/routes/registered.test.ts", "vi.mock('ignored');\n");
    await writeSource("packages/studio/src/api/routes/__tests__/ignored.ts", "const ignored = 'TODO in test';\n");

    const hits = await scanProductionSourceForMockDebt(root);
    const report = buildMockDebtScanReport(hits, [REGISTERED_ITEM]);

    expect(hits.map((hit) => hit.relativePath)).toEqual([
      "packages/studio/src/api/routes/registered.ts",
      "packages/studio/src/api/routes/unregistered.ts",
    ]);
    expect(report.registered.map((hit) => hit.relativePath)).toEqual(["packages/studio/src/api/routes/registered.ts"]);
    expect(report.unregistered.map((hit) => `${hit.relativePath}:${hit.keyword}`)).toEqual([
      "packages/studio/src/api/routes/unregistered.ts:fake",
    ]);
    expect(() => assertNoUnregisteredMockDebtHits(report)).toThrow(/Unregistered mock debt hit/);
  });

  it("keeps current production high-risk hits registered or explicitly allowlisted", async () => {
    const repoRoot = join(process.cwd(), "../..");

    const report = await scanMockDebtLedgerCoverage({
      rootDir: repoRoot,
      ledger: MOCK_DEBT_ITEMS,
    });

    expect(report.hits.length).toBeGreaterThan(0);
    expect(report.unregistered).toEqual([]);
  }, 20000);

  it("confirms Core and CLI low-risk audit boundaries", async () => {
    const repoRoot = join(process.cwd(), "../..");
    const hits = await scanProductionSourceForMockDebt(repoRoot);
    const coreHits = hits.filter((hit) => hit.relativePath.startsWith("packages/core/src/"));
    const cliHits = hits.filter((hit) => hit.relativePath.startsWith("packages/cli/src/"));

    expect(coreHits).toEqual([
      expect.objectContaining({
        relativePath: "packages/core/src/utils/config-loader.ts",
        keyword: "noop",
        lineText: expect.stringContaining("noop-model"),
      }),
    ]);
    expect(cliHits).toEqual([]);
  }, 20000);

  it("keeps residual production hits out of must-replace status", async () => {
    const repoRoot = join(process.cwd(), "../..");
    const statusByDebt = new Map<string, string>(MOCK_DEBT_ITEMS.map((item) => [item.id, item.status]));
    const report = await scanMockDebtLedgerCoverage({
      rootDir: repoRoot,
      ledger: MOCK_DEBT_ITEMS,
    });

    const mustReplaceHits = report.registered.filter((hit) => statusByDebt.get(hit.debtId) === "must-replace");

    expect(mustReplaceHits).toEqual([]);
  }, 20000);
});
