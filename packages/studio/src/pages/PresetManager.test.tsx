import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useApiMock, fetchJsonMock, notifySuccessMock, notifyErrorMock, refetchBookPresetsMock } = vi.hoisted(() => ({
  useApiMock: vi.fn(),
  fetchJsonMock: vi.fn(),
  notifySuccessMock: vi.fn(),
  notifyErrorMock: vi.fn(),
  refetchBookPresetsMock: vi.fn(),
}));

vi.mock("../hooks/use-api", () => ({
  useApi: useApiMock,
  fetchJson: fetchJsonMock,
}));

vi.mock("@/lib/notify", () => ({
  notify: {
    success: notifySuccessMock,
    error: notifyErrorMock,
  },
}));

import PresetManager from "./PresetManager";

const presets = [
  { id: "anti-ai-full-scan", name: "12 特征全量扫描", category: "anti-ai", description: "扫描 AI 味", promptInjection: "scan", compatibleGenres: ["xianxia"] },
  { id: "literary-controlling-idea", name: "控制观念锚定", category: "literary", description: "锚定主题", promptInjection: "idea" },
  { id: "austere-pragmatic", name: "冷峻质朴", category: "tone", description: "克制冷峻", promptInjection: "tone", conflictGroup: "tone" },
];

const bundles = [
  {
    id: "industrial-occult-mystery",
    name: "工业神秘悬疑",
    category: "bundle",
    description: "工业神秘组合",
    genreIds: ["mystery"],
    toneId: "austere-pragmatic",
    settingBaseId: "victorian-industrial-occult",
    logicRiskIds: ["information-flow"],
    difficulty: "hard",
    suitableFor: ["工业悬疑"],
    notSuitableFor: ["轻松日常"],
    prerequisites: ["制度边界"],
  },
];

function mockApi(enabledPresetIds: string[] = []) {
  useApiMock.mockImplementation((path: string | null) => {
    if (path === "/api/presets") return { data: { presets }, refetch: vi.fn() };
    if (path === "/api/presets/bundles") return { data: { bundles }, refetch: vi.fn() };
    if (path === "/api/presets/beats") return { data: { beats: [] }, refetch: vi.fn() };
    if (path === "/api/books/book-a/presets") {
      return {
        data: { enabledPresetIds, enabledPresets: presets.filter((p) => enabledPresetIds.includes(p.id)) },
        refetch: refetchBookPresetsMock,
      };
    }
    return { data: null, refetch: vi.fn() };
  });
}

describe("PresetManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchJsonMock.mockResolvedValue({ ok: true });
    mockApi();
  });

  it("renders preset tabs and applies a bundle to the current book", async () => {
    render(<PresetManager bookId="book-a" />);

    expect(screen.getByText("推荐组合")).toBeTruthy();
    expect(screen.getByText("工业神秘悬疑")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "应用组合" }));

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith("/api/books/book-a/presets", expect.objectContaining({ method: "PUT" }));
    });
    const body = JSON.parse(fetchJsonMock.mock.calls[0]![1].body as string) as { enabledPresetIds: string[] };
    expect(body.enabledPresetIds).toEqual(["austere-pragmatic", "victorian-industrial-occult", "information-flow"]);
    expect(notifySuccessMock).toHaveBeenCalledWith("已应用组合「工业神秘悬疑」");
  });

  it("toggles a single preset and shows conflict groups", async () => {
    render(<PresetManager bookId="book-a" />);

    const toneTab = screen.getAllByRole("tab").find((tab) => tab.textContent?.trim() === "文风");
    expect(toneTab).toBeTruthy();
    fireEvent.click(toneTab!);
    expect(screen.getByText("冲突组：tone")).toBeTruthy();

    fireEvent.click(screen.getByRole("switch", { name: "启用/禁用 冷峻质朴" }));

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith("/api/books/book-a/presets", expect.objectContaining({ method: "PUT" }));
    });
    const body = JSON.parse(fetchJsonMock.mock.calls[0]![1].body as string) as { enabledPresetIds: string[] };
    expect(body.enabledPresetIds).toEqual(["austere-pragmatic"]);
  });
});
