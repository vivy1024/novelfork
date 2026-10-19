import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/** 记录本轮渲染里 useApi 收到的所有路径。 */
const requestedPaths: string[] = [];
let stubs: Record<string, unknown> = {};

vi.mock("@/hooks/use-api", () => ({
  useApi: (path: string | null) => {
    if (path) requestedPaths.push(path);
    return { data: stubs[path ?? ""], loading: false, error: null, refetch: () => {} };
  },
  fetchJson: (path: string) => {
    requestedPaths.push(path);
    return Promise.resolve(stubs[path] ?? {});
  },
  putApi: () => Promise.resolve({}),
  postApi: () => Promise.resolve({}),
}));

beforeEach(() => {
  requestedPaths.length = 0;
  stubs = {};
});

// vitest globals 未开启，testing-library 不会自动 cleanup；
// 多个用例共享同一 jsdom document，残留渲染会让 getAllByRole 命中旧实例。
afterEach(async () => {
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});

const BOOK_ID = "book-narrative-memory";

function stubConfig() {
  stubs[`/api/books/${BOOK_ID}/narrative-memory/config`] = {
    config: {
      version: 1,
      settlement: { enabled: true, autoApplyLowRisk: true, autoApplyMediumRisk: false, highRiskAlwaysPending: true, minConfidence: 0.7, useLlmExtraction: true },
      ledger: { closeSupersededFacts: true, currentViewLimit: 50 },
      retrieval: { maxTokens: 6000, channels: { state: true, timeline: true, hooks: true, facts: true, style: false, semantic: false }, waveEnabled: false, semanticEnabled: false },
      characterKernel: { enabled: false, injectBudgetRatio: 0.1, stateSummaryMaxChars: 200 },
    },
  };
}

describe("NarrativeMemorySettingsSection", () => {
  // 「写作配置」外壳下线后，本面板是叙事记忆的唯一入口：
  // 不再有页签、不再在设置页复制一份写作技能列表。
  it("直接渲染叙事记忆本体，不出现页签式「写作配置」外壳，也不请求写作技能接口", async () => {
    stubConfig();
    const { render, screen } = await import("@testing-library/react");
    const { NarrativeMemorySettingsSection } = await import("./NarrativeMemorySettingsPanel");

    render(<NarrativeMemorySettingsSection bookId={BOOK_ID} />);
    expect(await screen.findByTestId("write-profile-preview")).toBeTruthy();

    expect(requestedPaths).toContain(`/api/books/${BOOK_ID}/narrative-memory/config`);
    expect(requestedPaths.join("\n")).not.toMatch(/\/writing-skills/);
    // 旧外壳的两个页签按钮都不该再出现（正文里的「写作技能」字样属通道说明，不算入口）。
    expect(screen.queryByRole("button", { name: "写作配置" })).toBeNull();
    expect(screen.queryByRole("button", { name: "写作技能" })).toBeNull();
    expect(screen.queryByRole("button", { name: "叙事记忆" })).toBeNull();
  });

  it("没有「高风险待审时阻断写作」开关（高风险待确认一律停写，放行走 NarraFork 权限）", async () => {
    stubConfig();
    const { render, screen } = await import("@testing-library/react");
    const { NarrativeMemorySettingsSection } = await import("./NarrativeMemorySettingsPanel");
    render(<NarrativeMemorySettingsSection bookId={BOOK_ID} />);

    expect(await screen.findByRole("switch", { name: "高风险事件始终待审" })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "高风险待审时阻断写作" })).toBeNull();
    expect(screen.queryByText("默认只提醒，不阻断；开启后需先处理高风险待审事件。")).toBeNull();
  });

  it("展示角色内核子区；默认关闭时字段编辑器不出现，开启后展示内置默认字段集", async () => {
    stubConfig();
    const { fireEvent, render, screen } = await import("@testing-library/react");
    const { NarrativeMemorySettingsSection } = await import("./NarrativeMemorySettingsPanel");
    render(<NarrativeMemorySettingsSection bookId={BOOK_ID} />);

    expect(await screen.findByText("角色内核")).toBeTruthy();
    // 默认关闭：编辑器不可见
    expect(screen.queryByTestId("kernel-fields-editor")).toBeNull();

    // 开启内核 → 字段编辑器出现并回落到引擎内置默认集（核心动机等）
    fireEvent.click(screen.getByRole("switch", { name: "启用角色内核" }));
    expect(screen.getByTestId("kernel-fields-editor")).toBeTruthy();
    expect((screen.getByLabelText("显示名 1") as HTMLInputElement).value).toBe("核心动机");
    expect(screen.getAllByTestId("kernel-field-row").length).toBeGreaterThanOrEqual(5);
  });

  it("写前七栏上限改动后预览栏标题和 0/cap 跟着变", async () => {
    stubConfig();
    const { fireEvent, render, screen } = await import("@testing-library/react");
    const { NarrativeMemorySettingsSection } = await import("./NarrativeMemorySettingsPanel");
    render(<NarrativeMemorySettingsSection bookId={BOOK_ID} />);

    expect(await screen.findByTestId("write-profile-preview")).toBeTruthy();
    expect(screen.getByText("0/6")).toBeTruthy();
    expect(screen.getByText("0/8")).toBeTruthy();
    expect(screen.getByText("近三章速记")).toBeTruthy();
    expect(screen.getByText("0/3")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("核心角色上限"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("活跃伏笔上限"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("近章速记上限"), { target: { value: "5" } });

    expect(screen.getByText("0/4")).toBeTruthy();
    expect(screen.getByText("0/10")).toBeTruthy();
    expect(screen.getByText("近5章速记")).toBeTruthy();
    expect(screen.getByText("0/5")).toBeTruthy();
  });
});
