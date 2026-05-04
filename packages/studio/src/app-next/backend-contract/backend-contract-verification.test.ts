import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  BACKEND_CONTRACT_VERIFICATION_COMMANDS,
  buildBackendContractVerificationReport,
  findUnregisteredAppNextApiStrings,
  listUnverifiedBackendContractItems,
  type SourceFileSnapshot,
} from "./backend-contract-verification";

describe("backend contract verification", () => {
  it("keeps task 9 verification commands unverified until fresh successful runs are recorded", () => {
    expect(BACKEND_CONTRACT_VERIFICATION_COMMANDS.map((command) => command.id)).toEqual([
      "backend-contract-vitest",
      "studio-typecheck",
      "docs-verify",
      "diff-check",
      "app-next-api-guard",
    ]);

    const report = buildBackendContractVerificationReport([
      {
        id: "backend-contract-vitest",
        command: "pnpm --dir packages/studio exec vitest run src/app-next/backend-contract",
        exitCode: 0,
        output: "PASS",
      },
      {
        id: "studio-typecheck",
        command: "pnpm --dir packages/studio typecheck",
        exitCode: 1,
        output: "TS error",
      },
    ]);

    expect(report.items.find((item) => item.id === "backend-contract-vitest")).toMatchObject({ status: "passed" });
    expect(report.items.find((item) => item.id === "studio-typecheck")).toMatchObject({ status: "failed" });
    expect(listUnverifiedBackendContractItems(report).map((item) => item.id)).toEqual([
      "studio-typecheck",
      "docs-verify",
      "diff-check",
      "app-next-api-guard",
    ]);
  });

  it("flags direct app-next API strings outside the centralized backend-contract layer", () => {
    const findings = findUnregisteredAppNextApiStrings([
      {
        path: "src/app-next/shell/ShellRoute.tsx",
        content: "async function load() { return fetch(\"/api/books\"); }\n",
      },
      {
        path: "src/app-next/backend-contract/resource-client.ts",
        content: "contract.get(\"/api/books\");\n",
      },
    ]);

    expect(findings).toEqual([
      {
        path: "src/app-next/shell/ShellRoute.tsx",
        apiString: "/api/books",
        line: 1,
        column: 39,
      },
    ]);
  });

  it("keeps current app-next source free of unregistered API strings outside backend-contract", () => {
    const appNextRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const sources = collectSourceFiles(appNextRoot);

    expect(findUnregisteredAppNextApiStrings(sources)).toEqual([]);
  });
});

function collectSourceFiles(root: string): SourceFileSnapshot[] {
  if (!existsSync(root)) return [];

  const result: SourceFileSnapshot[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name) || /\.test\./.test(entry.name)) continue;
      result.push({
        path: path.relative(process.cwd(), fullPath).split(path.sep).join("/"),
        content: readFileSync(fullPath, "utf-8"),
      });
    }
  };

  if (statSync(root).isDirectory()) walk(root);
  return result;
}
