import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJson, putApi } from "@/hooks/use-api";
import { createStylePreset, composeStyleGuide, type StylePreset } from "../../../engine/writing-layers/style-preset";
import { SkillsAndStyleSidebarPanel } from "./SkillsAndStyleSidebarPanel";

vi.mock("@/hooks/use-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-api")>(), fetchJson: vi.fn(), putApi: vi.fn(),
}));
vi.mock("../WritingSkillsPanel", () => ({ WritingSkillsPanel: () => <div>技能列表</div> }));
vi.mock("@/components/ui/toast", () => ({ toast: vi.fn() }));

const request = vi.mocked(fetchJson);
const fingerprint = { avgSentenceLength: 18, sentenceLengthStdDev: 7, vocabularyDiversity: 0.8, sentenceLengthBuckets: [1, 2, 3, 4, 5, 6] };

function envelope(preset: StylePreset, revision = "r1") {
  return { preset, revision, source: "preset", guideText: composeStyleGuide(preset) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("技能与文风侧栏", () => {
  it("没有书籍时不发请求", () => {
    render(<SkillsAndStyleSidebarPanel />);
    expect(screen.getByText("先打开一本书，再查看技能与文风。")).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });

  it("有书时显示页头（设计板 sd-head），面板标题不再依赖宿主公共标题条", async () => {
    request.mockResolvedValue({ total: 0 } as never);
    render(<SkillsAndStyleSidebarPanel bookId="book-a" />);
    const head = await screen.findByTestId("sidebar-page-head");
    expect(head.textContent).toContain("技能文风");
    expect(head.textContent).toContain("文风基准在这里维护");
  });

  it("保留统计直方图和提取入口，更新预设版本后保存不自撞冲突", async () => {
    let preset = createStylePreset(fingerprint);
    let revision = "r1";
    const updatedFingerprint = { ...fingerprint, avgSentenceLength: 23 };
    request.mockImplementation(async (path, init) => {
      if (path.endsWith("/profile")) return { profile: fingerprint };
      if (path.endsWith("/distill")) {
        preset = { ...preset, fingerprint: updatedFingerprint };
        revision = "r2";
        return { profile: updatedFingerprint, persisted: true };
      }
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        expect(body.expectedRevision).toBe("r2");
        preset = body.preset;
        return envelope(preset, "r3");
      }
      return envelope(preset, revision);
    });
    const updated = vi.fn();
    window.addEventListener("novelfork:style-preset-updated", updated);
    try {
      render(<SkillsAndStyleSidebarPanel bookId="book-a" />);
      expect(screen.getByText("技能列表")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "文风" }));
      await screen.findByLabelText("预设名称");
      expect(screen.getByRole("img", { name: "句长分布直方图" })).toBeTruthy();
      expect(screen.queryByText(/style_profile\.json/)).toBeNull();
      fireEvent.change(screen.getByLabelText("基调"), { target: { value: "保留我的草稿" } });
      fireEvent.change(screen.getByLabelText("参考样文"), { target: { value: "参考正文。" } });
      fireEvent.click(screen.getByRole("button", { name: "提取并设为基线" }));
      await screen.findByText(/已更新统计基线/);
      await waitFor(() => expect(screen.queryByText("正在读取文风预设…")).toBeNull());
      expect(screen.getByText("23 字")).toBeTruthy();
      expect(screen.getByDisplayValue("保留我的草稿")).toBeTruthy();
      const distillCall = request.mock.calls.find(([path]) => path.endsWith("/distill"));
      expect(JSON.parse(String(distillCall?.[1]?.body))).toEqual({ samples: ["参考正文。"] });
      fireEvent.click(screen.getByRole("button", { name: "保存文风预设" }));
      await screen.findByText("文风预设已保存。");
      expect(preset.bookVoice.tone).toBe("保留我的草稿");
      expect(preset.fingerprint).toEqual(updatedFingerprint);
      expect(updated).toHaveBeenCalledTimes(2);
      expect(updated.mock.calls.map(([event]) => (event as CustomEvent).detail)).toEqual([{ bookId: "book-a" }, { bookId: "book-a" }]);
    } finally { window.removeEventListener("novelfork:style-preset-updated", updated); }
  });

  it("预设正在保存时禁用统计写入，防止并发修改版本", async () => {
    const saving = deferred<ReturnType<typeof envelope>>();
    request.mockImplementation(async (path, init) => {
      if (path.endsWith("/profile")) return { profile: fingerprint };
      if (init?.method === "PUT") return saving.promise;
      return envelope(createStylePreset(fingerprint));
    });
    render(<SkillsAndStyleSidebarPanel bookId="book-a" />);
    fireEvent.click(screen.getByRole("button", { name: "文风" }));
    await screen.findByLabelText("预设名称");
    fireEvent.change(screen.getByLabelText("基调"), { target: { value: "舒缓" } });
    fireEvent.change(screen.getByLabelText("参考样文"), { target: { value: "参考正文" } });
    fireEvent.click(screen.getByRole("button", { name: "保存文风预设" }));
    expect((screen.getByRole("button", { name: "提取并设为基线" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => saving.resolve(envelope(createStylePreset(fingerprint), "r2")));
    expect((screen.getByRole("button", { name: "提取并设为基线" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("统计未保存时不发送更新事件、不刷新预设", async () => {
    request.mockImplementation(async (path) => path.endsWith("/preset") ? envelope(createStylePreset())
      : path.endsWith("/distill") ? { profile: fingerprint, persisted: false } : { profile: null });
    const updated = vi.fn();
    window.addEventListener("novelfork:style-preset-updated", updated);
    try {
      render(<SkillsAndStyleSidebarPanel bookId="book-a" />);
      fireEvent.click(screen.getByRole("button", { name: "文风" }));
      await screen.findByLabelText("预设名称");
      fireEvent.change(screen.getByLabelText("参考样文"), { target: { value: "参考正文" } });
      fireEvent.click(screen.getByRole("button", { name: "提取并设为基线" }));
      await screen.findByText("已提取，但未保存统计基线。");
      expect(updated).not.toHaveBeenCalled();
      expect(request.mock.calls.filter(([path]) => path.endsWith("/preset"))).toHaveLength(1);
    } finally { window.removeEventListener("novelfork:style-preset-updated", updated); }
  });

  it("切书清空样文，忽略旧书迟到的统计读取与提取结果", async () => {
    const oldProfile = deferred<{ profile: typeof fingerprint }>();
    const oldDistill = deferred<{ profile: typeof fingerprint; persisted: boolean }>();
    request.mockImplementation(async (path) => {
      if (path.endsWith("/preset")) return envelope({ ...createStylePreset(), name: path.includes("book-a") ? "书甲" : "书乙" });
      if (path.endsWith("/distill")) return oldDistill.promise;
      if (path.includes("book-a")) return oldProfile.promise;
      return { profile: { ...fingerprint, avgSentenceLength: 29 } };
    });
    const { rerender } = render(<SkillsAndStyleSidebarPanel bookId="book-a" />);
    fireEvent.click(screen.getByRole("button", { name: "文风" }));
    await screen.findByDisplayValue("书甲");
    fireEvent.change(screen.getByLabelText("参考样文"), { target: { value: "甲书样文" } });
    fireEvent.click(screen.getByRole("button", { name: "提取并设为基线" }));
    rerender(<SkillsAndStyleSidebarPanel bookId="book-b" />);
    await screen.findByDisplayValue("书乙");
    expect((screen.getByLabelText("参考样文") as HTMLTextAreaElement).value).toBe("");
    await act(async () => { oldProfile.resolve({ profile: fingerprint }); oldDistill.resolve({ profile: fingerprint, persisted: true }); });
    expect(screen.getByText("29 字")).toBeTruthy();
    expect(screen.queryByText("18 字")).toBeNull();
    expect(screen.queryByText(/已更新统计基线/)).toBeNull();
    expect(screen.getByDisplayValue("书乙")).toBeTruthy();
  });

  it("提取期间切换页签发出的旧统计请求不会覆盖刚更新的基线", async () => {
    const staleProfile = deferred<{ profile: typeof fingerprint }>();
    const distill = deferred<{ profile: typeof fingerprint; persisted: boolean }>();
    request.mockImplementation(async (path) => path.endsWith("/preset") ? envelope(createStylePreset())
      : path.endsWith("/distill") ? distill.promise : staleProfile.promise);
    render(<SkillsAndStyleSidebarPanel bookId="book-a" />);
    fireEvent.click(screen.getByRole("button", { name: "文风" }));
    await screen.findByLabelText("预设名称");
    fireEvent.change(screen.getByLabelText("参考样文"), { target: { value: "参考正文" } });
    fireEvent.click(screen.getByRole("button", { name: "提取并设为基线" }));
    fireEvent.click(screen.getByRole("button", { name: "写作技能" }));
    fireEvent.click(screen.getByRole("button", { name: "文风" }));
    await screen.findByLabelText("预设名称");
    await act(async () => distill.resolve({ profile: { ...fingerprint, avgSentenceLength: 31 }, persisted: true }));
    await act(async () => staleProfile.resolve({ profile: fingerprint }));
    expect(screen.getByText("31 字")).toBeTruthy();
    expect(screen.queryByText("18 字")).toBeNull();
  });

  it("记住这种写法：预览推断规则与例句，勾选后确认写入手动写法记忆来源", async () => {
    const preview = {
      note: "对话收得干净",
      rules: [
        { text: "对话收得干净", evidence: "作者注解", origin: "note" },
        { text: "对话密度高：引文约占 64%，以对话推进场景。", evidence: "例：“车还来吗？”她问。", origin: "inferred" },
      ],
      samples: [{ text: "“车还来吗？”她问。", sceneType: "dialogue" }],
      sceneTypes: ["dialogue"],
      stats: { charCount: 80, sentenceCount: 7, avgSentenceLength: 6.1, shortSentenceRatio: 0.7, longSentenceRatio: 0, dialogueRatio: 0.64 },
      warnings: [],
    };
    request.mockImplementation(async (path) => {
      if (path.endsWith("/style/memories/preview")) return preview;
      if (path.endsWith("/style/memories/confirm")) return envelope(createStylePreset(), "r2");
      if (path.endsWith("/profile")) return { profile: fingerprint };
      return envelope(createStylePreset(), "r1");
    });
    const updated = vi.fn();
    window.addEventListener("novelfork:style-preset-updated", updated);
    try {
      render(<SkillsAndStyleSidebarPanel bookId="book-a" />);
      fireEvent.click(screen.getByRole("button", { name: "文风" }));
      await screen.findByLabelText("预设名称");
      fireEvent.change(screen.getByLabelText("写法注解"), { target: { value: "对话收得干净" } });
      fireEvent.change(screen.getByLabelText("写法示例文本"), { target: { value: "“车还来吗？”她问。" } });
      fireEvent.click(screen.getByRole("button", { name: "预览写法" }));
      await screen.findByText(/对话密度高/);
      expect(screen.getByText(/推断适用场景：对话/)).toBeTruthy();
      // 取消勾选注解规则，只采纳推断规则与例句
      fireEvent.click(screen.getByLabelText("选中规则 1"));
      fireEvent.click(screen.getByRole("button", { name: /确认写入文风预设（2 项）/ }));
      await screen.findByText(/已写入「手动写法记忆」来源：1 条规则、1 条例句/);
      const confirmCall = request.mock.calls.find(([path]) => path.endsWith("/style/memories/confirm"))!;
      expect(JSON.parse(String(confirmCall[1]?.body))).toEqual({
        expectedRevision: "r1",
        note: "对话收得干净",
        rules: [{ text: "对话密度高：引文约占 64%，以对话推进场景。", evidence: "例：“车还来吗？”她问。" }],
        samples: [{ text: "“车还来吗？”她问。", sceneType: "dialogue" }],
      });
      expect(updated).toHaveBeenCalledTimes(1);
      expect((screen.getByLabelText("写法示例文本") as HTMLTextAreaElement).value).toBe("");
    } finally { window.removeEventListener("novelfork:style-preset-updated", updated); }
  });

  it("酒馆 JSON 仍可解析并导入写作技能", async () => {
    vi.mocked(putApi).mockResolvedValue({});
    render(<SkillsAndStyleSidebarPanel bookId="book-a" />);
    fireEvent.click(screen.getByRole("button", { name: "导入酒馆预设" }));
    fireEvent.change(screen.getByPlaceholderText(/在此粘贴酒馆预设 JSON/), { target: { value: JSON.stringify({
      prompts: [{ identifier: "main", name: "写作规则", role: "system", content: "为{{user}}写小说。", enabled: true }],
    }) } });
    fireEvent.click(screen.getByRole("button", { name: "解析预设" }));
    fireEvent.click(screen.getByRole("button", { name: "确认导入为技能" }));
    await waitFor(() => expect(putApi).toHaveBeenCalledTimes(1));
    expect(vi.mocked(putApi).mock.calls[0]?.[0]).toBe("/api/books/book-a/writing-skills/st-sillytavern-preset");
    expect(vi.mocked(putApi).mock.calls[0]?.[1]).toEqual({ content: expect.stringContaining("为作者写小说") });
    await waitFor(() => expect(screen.queryByText("导入酒馆预设 (SillyTavern Preset)")).toBeNull());
    expect(screen.getByText("技能列表")).toBeTruthy();
  });

  it("待确认横幅：有总数才提示，点开聚合面板，文风规则的「去处理」切回文风页签", async () => {
    const pendingReview = {
      bookId: "book-a",
      total: 2,
      groups: [
        {
          kind: "styleRule",
          label: "文风规则",
          count: 1,
          items: [{ id: "styleRule:ref-1:0", kind: "styleRule", typeLabel: "文风规则", location: "来源包「某参考作品」", summary: "短句收在动作前", resolveAt: "文风自动蒸馏 › 审阅", target: { kind: "style-panel" } }],
        },
        {
          kind: "voice",
          label: "声线",
          count: 1,
          items: [{ id: "voice:e1", kind: "voice", typeLabel: "声线", location: "角色「陆沉」", summary: "1 项待审", resolveAt: "角色卡 › 声线", target: { kind: "jingwei-entry", entryId: "e1" } }],
        },
      ],
      explanation: "逐项确认。",
      warnings: [],
    };
    request.mockImplementation(async (path) => {
      if (path.includes("/pending-review")) return pendingReview;
      if (path.endsWith("/profile")) return { profile: null };
      return { preset: createStylePreset(), revision: "r1", source: "preset", guideText: "" };
    });

    render(<SkillsAndStyleSidebarPanel bookId="book-a" />);
    // 等待合计返回后横幅出现。
    const banner = await screen.findByRole("button", { name: /待确认 2 项/ });
    fireEvent.click(banner);
    // 聚合面板就地展开，行文风规则行可点「去处理」；声线没有入口回调，只显示去哪决定。
    const goButtons = await screen.findAllByRole("button", { name: /去处理/ });
    expect(goButtons).toHaveLength(1);
    expect(screen.getByText("角色卡 › 声线")).toBeTruthy();
    fireEvent.click(goButtons[0]!);
    // 切到文风页签并收起面板。
    await screen.findByLabelText("预设名称");
    expect(screen.queryByRole("button", { name: "收起" })).toBeNull();
  });

  it("待确认合计拿不到时不显示横幅，也不打扰原功能", async () => {
    request.mockImplementation(async (path) => {
      if (path.includes("/pending-review")) throw new Error("接口不可用");
      return { preset: createStylePreset(), revision: "r1", source: "preset", guideText: "" };
    });
    render(<SkillsAndStyleSidebarPanel bookId="book-a" />);
    await waitFor(() => expect(request.mock.calls.some(([path]) => path.includes("/pending-review"))).toBe(true));
    expect(screen.queryByRole("button", { name: /待确认/ })).toBeNull();
    expect(screen.getByText("技能列表")).toBeTruthy();
  });
});
