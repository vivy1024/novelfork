import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { deriveActiveBookId } from "./route-utils";
import type { Route } from "./routes";

const { useTabsStateMock, useNovelForkMock, useApiMock, useThemeMock, useI18nMock, useLayoutConfigMock, useRecoveryMock } = vi.hoisted(() => ({
  useTabsStateMock: vi.fn(),
  useNovelForkMock: vi.fn(),
  useApiMock: vi.fn(),
  useThemeMock: vi.fn(),
  useI18nMock: vi.fn(),
  useLayoutConfigMock: vi.fn(),
  useRecoveryMock: vi.fn(),
}));

vi.mock("./providers/novelfork-context", () => ({
  NovelForkProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useNovelFork: () => useNovelForkMock(),
}));

vi.mock("./hooks/use-tabs", () => ({
  useTabsState: () => useTabsStateMock(),
}));

vi.mock("./hooks/use-api", () => ({
  fetchJson: vi.fn(),
  postApi: vi.fn(),
  useApi: (...args: unknown[]) => useApiMock(...args),
}));

vi.mock("./hooks/use-theme", () => ({
  useTheme: () => useThemeMock(),
}));

vi.mock("./hooks/use-i18n", () => ({
  useI18n: () => useI18nMock(),
}));

vi.mock("./hooks/use-layout-config", () => ({
  useLayoutConfig: () => useLayoutConfigMock(),
}));

vi.mock("./hooks/use-crash-recovery", () => ({
  useRecovery: () => useRecoveryMock(),
}));

vi.mock("./hooks/use-sse", () => ({
  useSSE: () => ({ connected: true }),
}));

vi.mock("./hooks/use-persisted-tabs", () => ({
  persistTabSession: vi.fn(async () => undefined),
  restoreTabSession: vi.fn(async () => null),
}));

vi.mock("./components/Sidebar", () => ({ Sidebar: () => <div>Sidebar Mock</div> }));
vi.mock("./components/ChatBar", () => ({ ChatPanel: () => <div>ChatPanel Mock</div> }));
vi.mock("./components/TabBar", () => ({ TabBar: () => <div>TabBar Mock</div> }));
vi.mock("./components/CommandPalette", () => ({ CommandPalette: () => <div>CommandPalette Mock</div> }));
vi.mock("./components/Search/SearchDialog", () => ({ SearchDialog: () => <div>SearchDialog Mock</div> }));
vi.mock("./components/UpdateChecker", () => ({ UpdateChecker: () => <div>UpdateChecker Mock</div> }));
vi.mock("./components/ReferencePanel", () => ({ ReferencePanel: () => <div>ReferencePanel Mock</div> }));
vi.mock("./components/RecoveryBanner", () => ({ RecoveryBanner: () => <div>RecoveryBanner Mock</div> }));

vi.mock("./pages/Dashboard", () => ({ Dashboard: () => <div>Dashboard Mock</div> }));
vi.mock("./pages/BookDetail", () => ({ BookDetail: () => <div>BookDetail Mock</div> }));
vi.mock("./pages/BookCreate", () => ({ BookCreate: () => <div>BookCreate Mock</div> }));
vi.mock("./pages/ChapterReader", () => ({ ChapterReader: () => <div>ChapterReader Mock</div> }));
vi.mock("./pages/Analytics", () => ({ Analytics: () => <div>Analytics Mock</div> }));
vi.mock("./pages/WorkspaceSelector", () => ({ WorkspaceSelector: () => <div>WorkspaceSelector Mock</div> }));
vi.mock("./pages/TruthFiles", () => ({ TruthFiles: () => <div>TruthFiles Mock</div> }));
vi.mock("./pages/DaemonControl", () => ({ DaemonControl: () => <div>DaemonControl Mock</div> }));
vi.mock("./pages/LogViewer", () => ({ LogViewer: () => <div>LogViewer Mock</div> }));
vi.mock("./pages/GenreManager", () => ({ GenreManager: () => <div>GenreManager Mock</div> }));
vi.mock("./pages/StyleManager", () => ({ StyleManager: () => <div>StyleManager Mock</div> }));
vi.mock("./pages/ImportManager", () => ({ ImportManager: () => <div>ImportManager Mock</div> }));
vi.mock("./pages/RadarView", () => ({ RadarView: () => <div>RadarView Mock</div> }));
vi.mock("./pages/DoctorView", () => ({ DoctorView: () => <div>DoctorView Mock</div> }));
vi.mock("./pages/DiffView", () => ({ DiffView: () => <div>DiffView Mock</div> }));
vi.mock("./pages/SearchView", () => ({ SearchView: () => <div>SearchView Mock</div> }));
vi.mock("./pages/BackupView", () => ({ BackupView: () => <div>BackupView Mock</div> }));
vi.mock("./pages/LanguageSelector", () => ({ LanguageSelector: () => <div>LanguageSelector Mock</div> }));
vi.mock("./pages/DetectView", () => ({ DetectView: () => <div>DetectView Mock</div> }));
vi.mock("./pages/IntentEditor", () => ({ IntentEditor: () => <div>IntentEditor Mock</div> }));
vi.mock("./pages/StateProjectionsView", () => ({ StateProjectionsView: () => <div>StateProjectionsView Mock</div> }));
vi.mock("./pages/PipelineVisualization", () => ({ PipelineVisualization: () => <div>PipelineVisualization Mock</div> }));
vi.mock("./pages/SettingsView", () => ({ SettingsView: () => <div>SettingsView Mock</div> }));
vi.mock("./pages/WorktreeManager", () => ({ WorktreeManager: () => <div>WorktreeManager Mock</div> }));
vi.mock("./pages/SessionCenter", () => ({ SessionCenter: () => <div>SessionCenter Mock</div> }));
vi.mock("./pages/WorkflowWorkbench", () => ({ WorkflowWorkbench: () => <div>WorkflowWorkbench Mock</div> }));
vi.mock("./components/Admin/Admin", () => ({
  Admin: ({ section, onOpenRun }: { section?: string; onOpenRun?: (runId: string) => void }) => (
    <div>
      <div>{`Admin Mock ${section ?? "overview"}`}</div>
      <div>{onOpenRun ? "OpenRun Ready" : "OpenRun Missing"}</div>
    </div>
  ),
}));

import { App } from "./App";

afterEach(() => {
  cleanup();
});

describe("deriveActiveBookId", () => {
  it("returns the current book across book-centered routes", () => {
    expect(deriveActiveBookId({ page: "book", bookId: "alpha" })).toBe("alpha");
    expect(deriveActiveBookId({ page: "chapter", bookId: "beta", chapterNumber: 3 })).toBe("beta");
    expect(deriveActiveBookId({ page: "truth", bookId: "gamma" })).toBe("gamma");
    expect(deriveActiveBookId({ page: "analytics", bookId: "delta" })).toBe("delta");
  });

  it("returns undefined for non-book routes", () => {
    expect(deriveActiveBookId({ page: "dashboard" })).toBeUndefined();
    expect(deriveActiveBookId({ page: "workflow" } as any)).toBeUndefined();
    expect(deriveActiveBookId({ page: "style" })).toBeUndefined();
  });
});

describe("App admin routing", () => {
  function mockAppState(route: Route) {
    useNovelForkMock.mockReturnValue({
      mode: "standalone",
      selectWorkspace: vi.fn(),
      workspace: null,
    });
    useApiMock.mockReturnValue({ data: { language: "zh", languageExplicit: true }, refetch: vi.fn() });
    useThemeMock.mockReturnValue({ theme: "light", setTheme: vi.fn() });
    useI18nMock.mockReturnValue({ t: (key: string) => key });
    useLayoutConfigMock.mockReturnValue({
      config: { sidebarWidth: 240, bottomPanelHeight: 180, bottomPanelCollapsed: true },
      loaded: true,
      updateConfig: vi.fn(),
    });
    useRecoveryMock.mockReturnValue({ hasRecovery: false, entries: [], recover: vi.fn(), dismissAll: vi.fn() });
    useTabsStateMock.mockReturnValue({
      tabs: [{ id: "tab-admin", route, label: "Admin", closable: true, dirty: false }],
      activeTabId: "tab-admin",
      activeTab: { id: "tab-admin", route, label: "Admin", closable: true, dirty: false },
      openTab: vi.fn(),
      closeTab: vi.fn(),
      activateTab: vi.fn(),
    });
  }

  it("renders the shared Admin logs surface instead of the legacy LogViewer route", () => {
    mockAppState({ page: "admin", section: "logs" });

    render(<App />);

    expect(screen.getByText("Admin Mock logs")).toBeTruthy();
    expect(screen.queryByText("LogViewer Mock")).toBeNull();
  });

  it("renders the shared Admin daemon surface instead of the legacy daemon control route", () => {
    mockAppState({ page: "admin", section: "daemon" });

    render(<App />);

    expect(screen.getByText("Admin Mock daemon")).toBeTruthy();
    expect(screen.queryByText("DaemonControl Mock")).toBeNull();
  });

  it("passes pipeline drill-down navigation into the admin requests surface", () => {
    mockAppState({ page: "admin", section: "requests" });

    render(<App />);

    expect(screen.getByText("Admin Mock requests")).toBeTruthy();
    expect(screen.getByText("OpenRun Ready")).toBeTruthy();
  });
});
