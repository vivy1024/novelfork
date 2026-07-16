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
  // Batch retirement: old components not used by app-next
  "src/components/Admin",
  "src/components/ai",
  "src/components/Bible",
  "src/components/compliance",
  "src/components/filter",
  "src/components/Git",
  "src/components/jingwei",
  "src/components/layout",
  "src/components/Model",
  "src/components/Monitor",
  "src/components/Project",
  "src/components/runtime",
  "src/components/Search",
  "src/components/workbench",
  "src/components/writing-modes",
  "src/components/writing-tools",
  "src/components/ToolCall",
  "src/components/AgentConfigPanel.tsx",
  "src/components/AutoCompressToggle.tsx",
  "src/components/BranchTree.tsx",
  "src/components/ChapterMeta.tsx",
  "src/components/ChatBar.tsx",
  "src/components/ChatInput.tsx",
  "src/components/ContextCircle.tsx",
  "src/components/ContextPanel.tsx",
  "src/components/DiffPanel.tsx",
  "src/components/DiffViewer.tsx",
  "src/components/EmbeddedTerminal.tsx",
  "src/components/FileModPanel.tsx",
  "src/components/GoldenChaptersPanel.tsx",
  "src/components/HistoryPanel.tsx",
  "src/components/HookCountdown.tsx",
  "src/components/InkEditor.tsx",
  "src/components/InstallPrompt.tsx",
  "src/components/LorebookPanel.tsx",
  "src/components/MessageEditor.tsx",
  "src/components/MessageItem.tsx",
  "src/components/MessageList.tsx",
  "src/components/OutlinePanel.tsx",
  "src/components/PermissionPrompt.tsx",
  "src/components/PoisonDetectorPanel.tsx",
  "src/components/ProviderCard.tsx",
  "src/components/RecoveryBadge.tsx",
  "src/components/ReferencePanel.tsx",
  "src/components/RhythmChart.tsx",
  "src/components/ToolResultCard.tsx",
  "src/components/ToolUsageExample.tsx",
  "src/components/ToolUseCard.tsx",
  "src/components/WindowControls.tsx",
  "src/components/WorktreeCard.tsx",
  "src/components/WorldDimensions.tsx",
  "src/components/tool-components.ts",
] as const;

function readStudioTsconfig(): { exclude?: string[] } {
  return JSON.parse(readFileSync(join(process.cwd(), "tsconfig.json"), "utf-8")) as { exclude?: string[] };
}

function readStudioManifest(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as Record<string, unknown>;
}

describe("legacy source retirement", () => {
  it("keeps retired frontend paths deleted instead of hidden behind tsconfig exclude", () => {
    const tsconfig = readStudioTsconfig();
    const exclude = new Set(tsconfig.exclude ?? []);

    expect(retiredFrontendPaths.filter((path) => existsSync(join(process.cwd(), path)))).toEqual([]);
    expect(retiredFrontendPaths.filter((path) => exclude.has(path) || exclude.has(`${path}/**`))).toEqual([]);
  });

  it("retires the complete Studio backend instead of preserving an unmounted second runtime", () => {
    expect(existsSync(join(process.cwd(), "src", "api"))).toBe(false);
    expect(existsSync(join(process.cwd(), "tsconfig.server.json"))).toBe(false);
    expect(existsSync(join(process.cwd(), "scripts", "compile.ts"))).toBe(false);
  });

  it("keeps Studio as a private frontend-only package", () => {
    const manifest = readStudioManifest();
    const scripts = manifest.scripts as Record<string, string>;
    expect(manifest.private).toBe(true);
    expect(manifest.main).toBeUndefined();
    expect(manifest.exports).toBeUndefined();
    expect(scripts["build:server"]).toBeUndefined();
    expect(scripts.compile).toBeUndefined();
    expect(scripts.build).toBe("vite build");
  });

  it("preserves the Runtime product contract and workspace routes", () => {
    const contractSource = readFileSync(join(process.cwd(), "src", "app-next", "runtime", "product-contract.ts"), "utf-8");
    expect(contractSource).toContain('RUNTIME_BOOTSTRAP_PATH = "/api/novelfork/bootstrap"');
    expect(contractSource).toContain("buildBookScopedNarratorPath");
    expect(contractSource).toContain("buildBookWorkspacePath");
  });
});
