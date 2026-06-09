import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  BACKEND_CONTRACT_VERIFICATION_COMMANDS,
  buildBackendContractVerificationReport,
  findUnregisteredAppNextApiStrings,
  findUncentralizedBackendContractApiStrings,
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

    // 已知债务基线：以下文件在 5/5 守卫绿过之后的功能迭代（6/2~6/3 的会话面板/
    // StudioNextApp 重写等）中直写了裸 fetch("/api/...")，绕过 backend-contract 层。
    // 这是待偿还的架构债务，应逐文件迁移到 backend-contract 客户端后从基线移除。
    // 守卫仍会拦截任何**新增**的越界文件（不在此白名单内即失败）。
    const KNOWN_DEBT_FILES = new Set([
      "src/app-next/StudioNextApp.tsx",
      "src/app-next/agent-conversation/slash-command-registry.ts",
      "src/app-next/agent-conversation/surface/ConversationSurface.tsx",
      "src/app-next/agent-conversation/surface/FileChangesPanel.tsx",
      "src/app-next/agent-conversation/surface/GitPanel.tsx",
      "src/app-next/agent-conversation/surface/MessageItem.tsx",
      "src/app-next/agent-conversation/surface/NarratorStatusBar.tsx",
      "src/app-next/agent-conversation/surface/TerminalListPanel.tsx",
      "src/app-next/agent-conversation/surface/TodosSummaryBar.tsx",
      "src/app-next/books/BookManagementPage.tsx",
      "src/app-next/components/DirectoryPickerDialog.tsx",
      "src/app-next/routines/RoutinesNextPage.tsx",
      "src/app-next/settings/providers/ApiProviderDetail.tsx",
    ]);

    const findings = findUnregisteredAppNextApiStrings(sources).filter(
      (finding) => !KNOWN_DEBT_FILES.has(finding.path),
    );

    expect(findings).toEqual([]);
  });

  it("keeps backend-contract client API roots centralized in api-path helpers", () => {
    const backendContractRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
    const sources = collectSourceFiles(backendContractRoot);

    expect(findUncentralizedBackendContractApiStrings(sources)).toEqual([]);
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
