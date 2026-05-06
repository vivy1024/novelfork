import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const retiredFrontendPaths = [
  "src/app-next/StudioApp.tsx",
  "src/app-next/StudioApp.test.tsx",
  "src/app-next/editor",
  "src/app-next/conversation/ConversationPanel.tsx",
  "src/app-next/conversation/ConversationPanel.test.tsx",
  "src/app-next/conversation/GitChangesView.tsx",
  "src/app-next/hooks/useStudioData.ts",
  "src/app-next/workspace",
  "src/components/split-view",
  "src/components/ChatWindow.tsx",
  "src/components/ChatWindow.test.tsx",
  "src/components/ChatWindowManager.tsx",
] as const;

const retiredRoutePaths = [
  "src/api/routes/hooks-countdown.ts",
  "src/api/routes/poison-detector.ts",
] as const;

const retiredChatRoutePaths = [
  "src/api/routes/chat.ts",
  "src/api/routes/chat.test.ts",
  "src/components/ChatPanel.tsx",
  "src/components/ChatPanel.test.tsx",
] as const;

function readStudioTsconfig(): { exclude?: string[] } {
  return JSON.parse(readFileSync(join(process.cwd(), "tsconfig.json"), "utf-8")) as { exclude?: string[] };
}

function readStudioServerTsconfig(): { exclude?: string[] } {
  return JSON.parse(readFileSync(join(process.cwd(), "tsconfig.server.json"), "utf-8")) as { exclude?: string[] };
}

describe("legacy source retirement", () => {
  it("keeps retired frontend paths deleted instead of hidden behind tsconfig exclude", () => {
    const tsconfig = readStudioTsconfig();
    const exclude = new Set(tsconfig.exclude ?? []);

    expect(retiredFrontendPaths.filter((path) => existsSync(join(process.cwd(), path)))).toEqual([]);
    expect(retiredFrontendPaths.filter((path) => exclude.has(path) || exclude.has(`${path}/**`))).toEqual([]);
  });

  it("keeps unmounted legacy route files deleted and removed from route exports and typecheck excludes", () => {
    const tsconfig = readStudioTsconfig();
    const serverTsconfig = readStudioServerTsconfig();
    const clientExclude = new Set(tsconfig.exclude ?? []);
    const serverExclude = new Set(serverTsconfig.exclude ?? []);
    const routeIndexSource = readFileSync(join(process.cwd(), "src", "api", "routes", "index.ts"), "utf-8");
    const serverSource = readFileSync(join(process.cwd(), "src", "api", "server.ts"), "utf-8");

    expect(retiredRoutePaths.filter((path) => existsSync(join(process.cwd(), path)))).toEqual([]);
    expect(retiredRoutePaths.filter((path) => clientExclude.has(path) || serverExclude.has(path))).toEqual([]);
    expect(routeIndexSource).not.toContain("poison-detector");
    expect(routeIndexSource).not.toContain("hooks-countdown");
    expect(serverSource).not.toContain("createPoisonDetectorRouter");
    expect(serverSource).not.toContain("createHooksCountdownRouter");
  });

  it("keeps retired lightweight book chat route deleted from source, exports, server mount, and debt ledgers", () => {
    const routeIndexSource = readFileSync(join(process.cwd(), "src", "api", "routes", "index.ts"), "utf-8");
    const serverSource = readFileSync(join(process.cwd(), "src", "api", "server.ts"), "utf-8");
    const matrixSource = readFileSync(join(process.cwd(), "src", "api", "backend-contract-matrix.ts"), "utf-8");
    const mockDebtSource = readFileSync(join(process.cwd(), "src", "api", "lib", "mock-debt-ledger.ts"), "utf-8");

    expect(retiredChatRoutePaths.filter((path) => existsSync(join(process.cwd(), path)))).toEqual([]);
    expect(routeIndexSource).not.toContain("createChatRouter");
    expect(serverSource).not.toContain("createChatRouter");
    expect(serverSource).not.toContain("/api/chat");
    expect(matrixSource).not.toContain("legacy.book-chat.process-memory");
    expect(matrixSource).not.toContain("routes/chat.ts");
    expect(mockDebtSource).not.toContain("book-chat-history");
    expect(mockDebtSource).not.toContain("routes/chat.ts");
  });

  it("keeps the retired direct /api/agent loop removed while preserving /api/agent/config", () => {
    const aiRouteSource = readFileSync(join(process.cwd(), "src", "api", "routes", "ai.ts"), "utf-8");
    const serverSource = readFileSync(join(process.cwd(), "src", "api", "server.ts"), "utf-8");
    const matrixSource = readFileSync(join(process.cwd(), "src", "api", "backend-contract-matrix.ts"), "utf-8");

    expect(aiRouteSource).not.toContain('app.post("/api/agent"');
    expect(aiRouteSource).not.toContain("runAgentLoop");
    expect(serverSource).toContain('app.route("/api/agent/config", createAgentConfigRouter())');
    expect(matrixSource).toContain('id: "legacy.ai-agent.unsupported"');
    expect(matrixSource).not.toContain('id: "legacy.ai-agent.deprecated"');
  });
});
