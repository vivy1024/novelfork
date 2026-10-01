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

const BOOK_ID = "book-writing-config";

describe("WritingConfigSection", () => {
  it("首屏只显示写作技能，并且只请求新的全局和书籍作用域路由", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { WritingConfigSection } = await import("./WritingConfigSection");
    stubs["/writing-skills"] = {
      skills: [{ id: "skill-a", slug: "cool-prose", name: "冷峻叙述", description: "克制的叙述语气。", kind: "prose", source: "builtin", editable: false }],
    };
    stubs[`/books/${BOOK_ID}/writing-skills`] = { projectSkillSlugs: ["cool-prose"] };

    const html = renderToStaticMarkup(<WritingConfigSection bookId={BOOK_ID} />);

    expect(requestedPaths).toContain("/writing-skills");
    expect(requestedPaths).toContain(`/books/${BOOK_ID}/writing-skills`);
    expect(requestedPaths.join("\n")).not.toMatch(/\/presets|\/beat|\/market\/templates/);
    expect(html).toContain("写作技能");
    expect(html).not.toContain("Writing Skills");
    expect(html).toContain("冷峻叙述");
    expect(html).not.toContain("写作预设");
    expect(html).not.toContain("节拍模板");
  });

  it("Optional tools 使用 writing-skills.check_compliance", async () => {
    const { fireEvent, render, screen } = await import("@testing-library/react");
    const { WritingConfigSection } = await import("./WritingConfigSection");
    render(<WritingConfigSection sessionId="session-1" />);

    fireEvent.click(screen.getByRole("button", { name: "辅助工具" }));
    expect(screen.getByText("writing-skills.check_compliance")).toBeTruthy();
    expect(screen.queryByText("presets.check_compliance")).toBeNull();
  });

  it("叙事记忆页展示角色内核子区；默认关闭时字段编辑器不出现，开启后展示内置默认字段集", async () => {
    // 组件直接把带 /api 前缀的完整路径传给 fetchJson，stub 键必须一致。
    stubs[`/api/books/${BOOK_ID}/narrative-memory/config`] = {
      config: {
        version: 1,
        settlement: { enabled: true, autoApplyLowRisk: true, autoApplyMediumRisk: false, highRiskAlwaysPending: true, minConfidence: 0.7, blockWriteOnHighRiskPending: false, useLlmExtraction: true },
        ledger: { closeSupersededFacts: true, currentViewLimit: 50 },
        retrieval: { maxTokens: 6000, channels: { state: true, timeline: true, hooks: true, facts: true, style: false, semantic: false }, waveEnabled: false, semanticEnabled: false },
        characterKernel: { enabled: false, injectBudgetRatio: 0.1, stateSummaryMaxChars: 200 },
      },
    };
    const { fireEvent, render, screen } = await import("@testing-library/react");
    const { WritingConfigSection } = await import("./WritingConfigSection");
    render(<WritingConfigSection bookId={BOOK_ID} />);

    fireEvent.click(screen.getAllByRole("button", { name: "叙事记忆" })[0]!);
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
    stubs[`/api/books/${BOOK_ID}/narrative-memory/config`] = {
      config: {
        version: 1,
        settlement: { enabled: true, autoApplyLowRisk: true, autoApplyMediumRisk: false, highRiskAlwaysPending: true, minConfidence: 0.7, blockWriteOnHighRiskPending: false, useLlmExtraction: true },
        ledger: { closeSupersededFacts: true, currentViewLimit: 50 },
        retrieval: { maxTokens: 6000, channels: { state: true, timeline: true, hooks: true, facts: true, style: false, semantic: false }, waveEnabled: false, semanticEnabled: false },
        characterKernel: { enabled: false, injectBudgetRatio: 0.1, stateSummaryMaxChars: 200 },
      },
    };
    const { fireEvent, render, screen } = await import("@testing-library/react");
    const { WritingConfigSection } = await import("./WritingConfigSection");
    render(<WritingConfigSection bookId={BOOK_ID} />);

    fireEvent.click(screen.getAllByRole("button", { name: "叙事记忆" })[0]!);
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
