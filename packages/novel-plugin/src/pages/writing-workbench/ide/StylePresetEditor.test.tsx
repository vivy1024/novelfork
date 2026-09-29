import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, fetchJson } from "@/hooks/use-api";
import { composeStyleGuide, createStylePreset, type StylePreset } from "../../../engine/writing-layers/style-preset";
import { StylePresetEditor, type StylePresetResponse } from "./StylePresetEditor";

vi.mock("@/hooks/use-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/use-api")>(), fetchJson: vi.fn(),
}));

const request = vi.mocked(fetchJson);
const fingerprint = { avgSentenceLength: 18, sentenceLengthStdDev: 7, vocabularyDiversity: 0.8, extra: { kept: true } };

function fixture(): StylePreset {
  return { ...createStylePreset(fingerprint), name: "冷静克制", generalRules: ["让动作承载情绪"],
    bookVoice: { tone: "冷峻", narrativeVoice: "贴近人物的第三人称", principles: ["代价要落到实处"] },
    sources: [{ id: "source-1", title: "参考作品", rules: [
      { text: "用停顿呈现犹豫", evidence: "第三段句末停顿", transfer: "transferable", status: "needs-review" },
      { text: "角色惯说青云归我", evidence: "角色原话", transfer: "source-only", status: "needs-review" },
    ], samples: [{ id: "sample-1", sceneType: "dialogue", text: "只属于样文的对白", evidence: "原文第六段",
      transfer: "transferable", status: "confirmed" }] }],
  };
}

function response(preset: StylePreset | null = fixture(), revision: string | null = "r1", source: StylePresetResponse["source"] = "preset"): StylePresetResponse {
  return { preset, revision, source, guideText: preset ? composeStyleGuide(preset) : "" };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function edit(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function savedBody() {
  const call = request.mock.calls.find(([, init]) => init?.method === "PUT");
  return JSON.parse(String(call?.[1]?.body)) as { expectedRevision: string | null; preset: StylePreset };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("本书文风预设编辑", () => {
  it("无预设时用空版本创建，编码书籍标识并发送更新事件", async () => {
    request.mockResolvedValueOnce(response(null, null, "none"));
    request.mockImplementationOnce(async (_path, init) => response(JSON.parse(String(init?.body)).preset, "r2"));
    const updated = vi.fn();
    window.addEventListener("novelfork:style-preset-updated", updated);
    try {
      render(<StylePresetEditor bookId="新书/甲" />);
      await screen.findByLabelText("预设名称");
      edit("通用写法（每行一条）", "短句收束\n\n动作推进");
      expect(screen.getByLabelText("合成指南内容").textContent).toContain("短句收束");
      fireEvent.click(screen.getByRole("button", { name: "保存文风预设" }));
      await screen.findByText("文风预设已保存。");
      expect(savedBody()).toEqual({ expectedRevision: null, preset: { ...createStylePreset(), generalRules: ["短句收束", "动作推进"] } });
      expect(request.mock.calls[0]?.[0]).toBe("/api/books/%E6%96%B0%E4%B9%A6%2F%E7%94%B2/style/preset");
      expect(updated).toHaveBeenCalledTimes(1);
      expect((updated.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ bookId: "新书/甲" });
    } finally { window.removeEventListener("novelfork:style-preset-updated", updated); }
  });

  it("首次编辑旧指纹时保留完整指纹和来源，保存全部创作字段", async () => {
    const original = fixture();
    request.mockResolvedValueOnce(response(original, "legacy-r1", "legacy"));
    request.mockImplementationOnce(async (_path, init) => response(JSON.parse(String(init?.body)).preset, "r2"));
    render(<StylePresetEditor bookId="book-a" />);
    await screen.findByText(/首次保存后升级/);
    edit("预设名称", " 新预设 ");
    edit("通用写法（每行一条）", " 第一条 \n\n 第二条 ");
    edit("基调", " 温暖 ");
    edit("叙事声音", "第一人称");
    edit("本书创作原则（每行一条）", "兑现承诺\n留下余地");
    fireEvent.click(screen.getByRole("button", { name: "保存文风预设" }));
    await screen.findByText("文风预设已保存。");
    expect(savedBody()).toEqual({ expectedRevision: "legacy-r1", preset: { ...original, name: "新预设",
      generalRules: ["第一条", "第二条"], bookVoice: { tone: "温暖", narrativeVoice: "第一人称", principles: ["兑现承诺", "留下余地"] } } });
    expect(screen.queryByText(/首次保存后升级/)).toBeNull();
  });

  it("确认来源保留证据和迁移边界，作品专属及样文不进入合成指南", async () => {
    request.mockResolvedValueOnce(response());
    request.mockImplementationOnce(async (_path, init) => response(JSON.parse(String(init?.body)).preset, "r2"));
    render(<StylePresetEditor bookId="book-a" />);
    await screen.findByText("参考作品");
    expect(screen.getByText("证据：第三段句末停顿")).toBeTruthy();
    expect(screen.getByText("作品专属")).toBeTruthy();
    expect(screen.getAllByText("待审")).toHaveLength(2);
    expect(screen.getByText("对话样文")).toBeTruthy();
    expect(screen.getByLabelText("合成指南内容").textContent).not.toContain("用停顿呈现犹豫");
    fireEvent.click(screen.getByRole("button", { name: "确认：角色惯说青云归我" }));
    fireEvent.click(screen.getByRole("button", { name: "确认：用停顿呈现犹豫" }));
    expect(screen.getByLabelText("合成指南内容").textContent).toContain("用停顿呈现犹豫");
    expect(screen.getByLabelText("合成指南内容").textContent).not.toContain("青云归我");
    expect(screen.getByLabelText("合成指南内容").textContent).not.toContain("只属于样文的对白");
    fireEvent.click(screen.getByRole("button", { name: "撤回确认：用停顿呈现犹豫" }));
    expect(screen.getByLabelText("合成指南内容").textContent).not.toContain("用停顿呈现犹豫");
    fireEvent.click(screen.getByRole("button", { name: "确认：用停顿呈现犹豫" }));
    fireEvent.click(screen.getByRole("button", { name: "保存文风预设" }));
    await screen.findByText("文风预设已保存。");
    expect(savedBody().preset.sources[0]?.rules[1]).toEqual({ ...fixture().sources[0]!.rules[1], status: "confirmed" });
    expect(savedBody().preset.sources[0]?.samples).toEqual(fixture().sources[0]!.samples);
    expect(screen.getByLabelText("合成指南内容").textContent).not.toContain("青云归我");
  });

  it("409 保留草稿并阻止覆盖，明确重载后才能使用新版本保存", async () => {
    request.mockResolvedValueOnce(response());
    request.mockRejectedValueOnce(new ApiRequestError("版本过期", { status: 409 }));
    request.mockResolvedValueOnce(response({ ...fixture(), name: "远端新版本" }, "r2"));
    request.mockImplementationOnce(async (_path, init) => response(JSON.parse(String(init?.body)).preset, "r3"));
    render(<StylePresetEditor bookId="book-a" />);
    await screen.findByLabelText("预设名称");
    edit("预设名称", "本地修改");
    fireEvent.click(screen.getByRole("button", { name: "保存文风预设" }));
    expect((await screen.findByRole("alert")).textContent).toContain("保存冲突");
    expect((screen.getByLabelText("预设名称") as HTMLInputElement).value).toBe("本地修改");
    expect((screen.getByRole("button", { name: "保存文风预设" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "保存文风预设" }));
    expect(request).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "重新载入" }));
    await screen.findByDisplayValue("远端新版本");
    edit("基调", "新基调");
    fireEvent.click(screen.getByRole("button", { name: "保存文风预设" }));
    await screen.findByText("文风预设已保存。");
    expect(JSON.parse(String(request.mock.calls[3]?.[1]?.body)).expectedRevision).toBe("r2");
  });

  it("读取失败时不允许创建覆盖，重载及普通保存失败后可重试", async () => {
    request.mockRejectedValueOnce(new Error("暂时无法读取"));
    request.mockResolvedValueOnce(response());
    request.mockRejectedValueOnce(new Error("暂时无法保存"));
    request.mockImplementationOnce(async (_path, init) => response(JSON.parse(String(init?.body)).preset, "r2"));
    render(<StylePresetEditor bookId="book-a" />);
    await screen.findByText("暂时无法读取");
    expect(screen.queryByRole("button", { name: "保存文风预设" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重新载入" }));
    await screen.findByLabelText("预设名称");
    edit("基调", "舒缓");
    fireEvent.click(screen.getByRole("button", { name: "保存文风预设" }));
    await screen.findByText("暂时无法保存");
    expect((screen.getByLabelText("基调") as HTMLInputElement).value).toBe("舒缓");
    fireEvent.click(screen.getByRole("button", { name: "保存文风预设" }));
    await screen.findByText("文风预设已保存。");
  });

  it("切书忽略晚到的旧 GET，即使回到同一书也不接受旧会话结果", async () => {
    const old = deferred<StylePresetResponse>();
    request.mockReturnValueOnce(old.promise);
    request.mockResolvedValueOnce(response({ ...fixture(), name: "书乙" }));
    request.mockResolvedValueOnce(response({ ...fixture(), name: "书甲新会话" }));
    const { rerender } = render(<StylePresetEditor bookId="book-a" />);
    rerender(<StylePresetEditor bookId="book-b" />);
    await screen.findByDisplayValue("书乙");
    rerender(<StylePresetEditor bookId="book-a" />);
    await screen.findByDisplayValue("书甲新会话");
    await act(async () => old.resolve(response({ ...fixture(), name: "书甲过期结果" })));
    expect(screen.queryByDisplayValue("书甲过期结果")).toBeNull();
    expect(screen.getByDisplayValue("书甲新会话")).toBeTruthy();
  });

  it("切书后旧保存完成只通知原书，不覆盖新书", async () => {
    const saving = deferred<StylePresetResponse>();
    request.mockResolvedValueOnce(response());
    request.mockReturnValueOnce(saving.promise);
    request.mockResolvedValueOnce(response({ ...fixture(), name: "书乙" }, "b1"));
    const updated = vi.fn();
    window.addEventListener("novelfork:style-preset-updated", updated);
    try {
      const { rerender } = render(<StylePresetEditor bookId="book-a" />);
      await screen.findByLabelText("预设名称");
      edit("预设名称", "书甲修改");
      fireEvent.click(screen.getByRole("button", { name: "保存文风预设" }));
      rerender(<StylePresetEditor bookId="book-b" />);
      await screen.findByDisplayValue("书乙");
      await act(async () => saving.resolve(response({ ...fixture(), name: "书甲修改" }, "a2")));
      expect(screen.getByDisplayValue("书乙")).toBeTruthy();
      expect(screen.queryByText("文风预设已保存。")).toBeNull();
      expect((updated.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ bookId: "book-a" });
    } finally { window.removeEventListener("novelfork:style-preset-updated", updated); }
  });

  it("统计刷新只更新指纹与版本，保留本地文字", async () => {
    const latest = { ...fixture(), fingerprint: { ...fingerprint, avgSentenceLength: 22 } };
    request.mockResolvedValueOnce(response());
    request.mockResolvedValueOnce(response(latest, "r2"));
    request.mockImplementationOnce(async (_path, init) => response(JSON.parse(String(init?.body)).preset, "r3"));
    const { rerender } = render(<StylePresetEditor bookId="book-a" refreshKey={0} />);
    await screen.findByLabelText("预设名称");
    edit("基调", "本地新基调");
    rerender(<StylePresetEditor bookId="book-a" refreshKey={1} />);
    await waitFor(() => expect(screen.queryByText("正在读取文风预设…")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "保存文风预设" }));
    await screen.findByText("文风预设已保存。");
    expect(savedBody().expectedRevision).toBe("r2");
    expect(savedBody().preset.fingerprint).toEqual(latest.fingerprint);
    expect(savedBody().preset.bookVoice.tone).toBe("本地新基调");
  });

  it("统计刷新遇到他人同时编辑时保留本地草稿并要求重载", async () => {
    request.mockResolvedValueOnce(response());
    request.mockResolvedValueOnce(response({ ...fixture(), generalRules: ["他人的新规则"] }, "r2"));
    const { rerender } = render(<StylePresetEditor bookId="book-a" refreshKey={0} />);
    await screen.findByLabelText("预设名称");
    edit("基调", "本地修改");
    rerender(<StylePresetEditor bookId="book-a" refreshKey={1} />);
    expect((await screen.findByRole("alert")).textContent).toContain("已有新版本");
    expect(screen.getByDisplayValue("本地修改")).toBeTruthy();
    expect((screen.getByRole("button", { name: "保存文风预设" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
