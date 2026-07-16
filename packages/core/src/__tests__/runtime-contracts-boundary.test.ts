import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type {
  NovelRuntimeContribution,
  RuntimeAgentDefinition,
  RuntimeHost,
  RuntimeHttpRoute,
  RuntimePermissionContribution,
  RuntimeSessionContribution,
  RuntimeToolContribution,
  RuntimeWebSocketChannel,
} from "../runtime-contracts/index.js";

describe("runtime contracts boundary", () => {
  it("stays type-only and independent from concrete runtime packages", async () => {
    const source = await readFile(new URL("../runtime-contracts/index.ts", import.meta.url), "utf8");

    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\bBun\b|bun:sqlite|SQLite|novel-plugin|runtime-(?:core-)?private/);
  });

  it("composes all slice-one extension points without implementation types", () => {
    const contribution: NovelRuntimeContribution = {
      id: "contract-test",
      projectType: "novel",
      httpRoutes: [] satisfies RuntimeHttpRoute[],
      webSocketChannels: [] satisfies RuntimeWebSocketChannel[],
      agents: [] satisfies RuntimeAgentDefinition[],
      tools: [] satisfies RuntimeToolContribution[],
      sessions: [] satisfies RuntimeSessionContribution[],
      permissions: [] satisfies RuntimePermissionContribution[],
    };
    const hostShape: Pick<RuntimeHost, "registerContribution"> = {
      registerContribution: () => undefined,
    };

    hostShape.registerContribution(contribution);
    expect(contribution.id).toBe("contract-test");
  });
});
