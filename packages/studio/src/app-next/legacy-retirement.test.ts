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
  // T1.7：套路页通用部分改为嵌入 Runtime 原页，Studio 复制品下线
  "src/app-next/routines/CommandsSection.tsx",
  "src/app-next/routines/ToolPermissionsSection.tsx",
  "src/app-next/routines/MCPServerPanel.tsx",
  "src/app-next/routines/RulesSection.tsx",
  // T1.7：设置页通用部分改为嵌入 Runtime 原页，Studio 复制品与死代码下线
  "src/app-next/settings/SettingsSectionContent.tsx",
  "src/app-next/settings/sections.ts",
  "src/app-next/settings/panels/ProfilePanel.tsx",
  "src/app-next/settings/panels/SecurityPanel.tsx",
  "src/app-next/settings/panels/RuntimeControlPanel.tsx",
  "src/app-next/settings/panels/AgentSettingsPanel.tsx",
  "src/app-next/settings/panels/NotificationSettingsPanel.tsx",
  "src/app-next/settings/panels/GatewayPanel.tsx",
  "src/app-next/settings/panels/SearchSettingsPanel.tsx",
  "src/app-next/settings/panels/ProxySettingsPanel.tsx",
  "src/app-next/settings/panels/ChaptersContainersPanel.tsx",
  "src/app-next/settings/panels/AuthenticationPanel.tsx",
  "src/app-next/settings/panels/TerminalsPanel.tsx",
  "src/app-next/settings/panels/TerminalEmbed.tsx",
  "src/app-next/settings/panels/DevicesPanel.tsx",
  "src/app-next/settings/panels/StorageDiagnosticsPanel.tsx",
  "src/app-next/settings/panels/DependencyStatusPanel.tsx",
  "src/app-next/settings/panels/RuntimeEnvironmentPanel.tsx",
  "src/app-next/settings/panels/UsagePanel.tsx",
  "src/app-next/settings/panels/DataPanel.tsx",
  "src/app-next/settings/panels/MonitoringPanel.tsx",
  "src/app-next/settings/panels/AgentRuntimeHardeningPanel.tsx",
  // 这些 Runtime 管理客户端只被上面的复制面板使用，随面板一起下线（用户与 Embedding 等保留项的客户端仍在）
  "src/app-next/runtime-admin/authentication.ts",
  "src/app-next/runtime-admin/chapter-containers.ts",
  "src/app-next/runtime-admin/devices.ts",
  "src/app-next/runtime-admin/gateway.ts",
  "src/app-next/runtime-admin/notification-sounds.ts",
  "src/app-next/runtime-admin/provider-models.ts",
  "src/app-next/runtime-admin/platform-providers.ts",
  "src/app-next/runtime-admin/proxy-overrides.ts",
  "src/app-next/runtime-admin/runtime-maintenance.ts",
  "src/app-next/runtime-admin/search-settings.ts",
  "src/app-next/runtime-admin/storage.ts",
  "src/app-next/runtime-admin/terminals.ts",
  "src/app-next/runtime-admin/usage-history.ts",
  "src/app-next/runtime-admin/account-profile.ts",
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

  it("套路页的通用部分只嵌 Runtime 原页，不再在 Studio 里实现全局套路的读写", () => {
    const routinesDir = join(process.cwd(), "src", "app-next", "routines");
    const page = readFileSync(join(routinesDir, "RoutinesNextPage.tsx"), "utf-8");
    expect(page).toContain('section="routines"');
    // 全局命令、工具权限、全局技能、全局提示词与全局钩子的客户端只该出现在 Runtime 原页里
    const globalClients = /create(?:UserPreferences|Settings|Skills|Hooks|Routines)Client|listGlobal|putGlobalPrompt/;
    const offenders = ["RoutinesNextPage.tsx", "BookRoutineSettingsPanel.tsx", "SubagentNovelToolsPanel.tsx", "routines-shared.tsx"]
      .concat(["BookHooksPanel.tsx", "BookMcpOverridesPanel.tsx", "BookRoutineOverridesPanel.tsx", "BookRulesPanel.tsx", "BookSkillsPanel.tsx"].map((file) => join("book", file)))
      .filter((file) => globalClients.test(readFileSync(join(routinesDir, file), "utf-8")));
    expect(offenders).toEqual([]);
  });

  it("设置页的通用部分只嵌 Runtime 原页，不再在 Studio 里实现通用设置的读写", () => {
    const settingsDir = join(process.cwd(), "src", "app-next", "settings");
    const page = readFileSync(join(settingsDir, "SettingsNextPage.tsx"), "utf-8");
    expect(page).toContain('section="settings"');
    // 个人资料、供应商、模型、AI 代理、搜索、代理、容器、服务器、认证、终端、设备、存储、使用历史
    // 与它们的管理客户端只该出现在 Runtime 原页里；SetupWizardPanel 写初始模型与监听地址是产品向导，豁免。
    const generalClients = /create(?:AccountProfile|Authentication|Gateway|NotificationSounds|SearchSettings|ProxyOverrides|ChapterContainerSettings|TerminalsAdmin|Devices|Storage|UsageHistory|RuntimeMaintenance|ProviderModels|PlatformProviders|Skills)Client/;
    const offenders = ["SettingsNextPage.tsx", "panels/AppearancePanel.tsx", "panels/EmbeddingSettingsPanel.tsx", "panels/UsersPanel.tsx", "panels/AboutPanel.tsx", "panels/SetupWizardPanel.tsx"]
      .filter((file) => generalClients.test(readFileSync(join(settingsDir, file), "utf-8")));
    expect(offenders).toEqual([]);
  });

  it("preserves the Runtime product contract and workspace routes", () => {
    const contractSource = readFileSync(join(process.cwd(), "src", "app-next", "runtime", "product-contract.ts"), "utf-8");
    expect(contractSource).toContain('RUNTIME_BOOTSTRAP_PATH = "/api/novelfork/bootstrap"');
    expect(contractSource).toContain("buildBookScopedNarratorPath");
    expect(contractSource).toContain("buildBookWorkspacePath");
  });
});
