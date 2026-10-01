import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchJsonMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-api", () => ({
  fetchJson: fetchJsonMock,
  ApiRequestError: class ApiRequestError extends Error {
    status?: number;
    constructor(message: string, options?: { status?: number }) {
      super(message);
      this.status = options?.status;
    }
  },
}));

import { ApiRequestError } from "@/hooks/use-api";
import { CharacterVoiceSection } from "./CharacterVoiceSection";

const PATH = "/api/books/book-1/jingwei/entries/char-1/voice";

function voiceResponse(version: number, fields: Record<string, unknown>) {
  return { entryId: "char-1", version, voice: { schemaVersion: 1, fields }, summary: { confirmed: 0, needsReview: 0, missing: 10 } };
}

afterEach(() => {
  cleanup();
  fetchJsonMock.mockReset();
});

describe("CharacterVoiceSection", () => {
  it("显示三种状态，生成草稿后逐项确认并回传最新声线", async () => {
    const onVoiceSaved = vi.fn();
    fetchJsonMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === PATH && !init) {
        return voiceResponse(3, { whenLying: { value: "撒谎时话多", status: "confirmed", source: "author" } });
      }
      if (url === `${PATH}/draft`) {
        return {
          ...voiceResponse(4, {
            whenLying: { value: "撒谎时话多", status: "confirmed", source: "author" },
            catchphrases: { value: ["啧"], status: "needs-review", source: "dialogue", evidence: ["啧，别碰它。"] },
          }),
          draft: { appliedKeys: ["catchphrases"], keptConfirmedKeys: [], sampleCount: 4, modelUsed: false },
          warnings: [{ code: "FIELDS_MISSING", message: "「声音定位」仍待补充。", explanation: { whyItMatters: "待补充的字段不会注入写作。", suggestedAction: "直接手填。" } }],
        };
      }
      if (url === PATH && init?.method === "PUT") {
        return voiceResponse(5, {
          whenLying: { value: "撒谎时话多", status: "confirmed", source: "author" },
          catchphrases: { value: ["啧", "滚"], status: "confirmed", source: "author" },
        });
      }
      throw new Error(`unexpected ${url}`);
    });

    render(<CharacterVoiceSection bookId="book-1" entryId="char-1" entryVersion={3} onVoiceSaved={onVoiceSaved} />);
    await waitFor(() => expect(screen.getByTestId("voice-field-whenLying").dataset.status).toBe("confirmed"));
    expect(screen.getByTestId("voice-field-positioning").dataset.status).toBe("missing");
    expect(screen.getByTestId("character-voice-summary").textContent).toContain("待补充 9");
    expect(screen.getByRole("button", { name: "已确认撒谎时" })).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText(/对白样本/), { target: { value: "啧。滚。\n不必。" } });
    fireEvent.click(screen.getByRole("switch", { name: "请模型增补" }));
    fireEvent.click(screen.getByRole("button", { name: /生成草稿/ }));
    await waitFor(() => expect(screen.getByTestId("voice-field-catchphrases").dataset.status).toBe("needs-review"));
    const draftCall = fetchJsonMock.mock.calls.find(([url]) => url === `${PATH}/draft`)!;
    expect(JSON.parse(String(draftCall[1].body))).toEqual({ expectedVersion: 3, dialogueSamples: ["啧。滚。", "不必。"], scanChapters: 10, useModel: true });
    expect(screen.getByText("依据：啧，别碰它。")).toBeTruthy();
    expect(screen.getByTestId("character-voice-warnings").textContent).toContain("建议：直接手填。");
    expect(screen.getByTestId("character-voice-draft-note").textContent).toContain("1 项待审草稿");

    fireEvent.change(screen.getByLabelText("口头禅"), { target: { value: "啧\n滚" } });
    fireEvent.click(screen.getByRole("button", { name: "确认口头禅" }));
    await waitFor(() => expect(screen.getByTestId("voice-field-catchphrases").dataset.status).toBe("confirmed"));
    const putCall = fetchJsonMock.mock.calls.find(([url, init]) => url === PATH && init?.method === "PUT")!;
    expect(JSON.parse(String(putCall[1].body))).toEqual({ expectedVersion: 4, fields: { catchphrases: { value: ["啧", "滚"], status: "confirmed" } } });
    expect(onVoiceSaved).toHaveBeenLastCalledWith(expect.objectContaining({ fields: expect.objectContaining({ catchphrases: expect.objectContaining({ status: "confirmed" }) }) }));
  });

  it("模型增补失败时显示发生了什么，草稿说明不写成「没有找到依据」", async () => {
    fetchJsonMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === PATH && !init) return voiceResponse(1, {});
      if (url === `${PATH}/draft`) {
        return {
          ...voiceResponse(1, {}),
          draft: { appliedKeys: [], keptConfirmedKeys: [], sampleCount: 0, modelUsed: false, modelStatus: "failed" },
          warnings: [{
            code: "MODEL_OUTPUT_TRUNCATED",
            message: "模型输出被截断，这次增补没有写入，已保留规则初稿。",
            explanation: { whatHappened: "模型输出被截断：JSON 没有闭合，可能达到了输出长度上限。", whyItMatters: "截断的输出缺后半部分字段。", suggestedAction: "重试一次。" },
          }],
        };
      }
      throw new Error(`unexpected ${url}`);
    });
    render(<CharacterVoiceSection bookId="book-1" entryId="char-1" />);
    await waitFor(() => expect(screen.getByTestId("voice-field-positioning")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /生成草稿/ }));
    await waitFor(() => expect(screen.getByTestId("character-voice-warnings").textContent).toContain("JSON 没有闭合"));
    expect(screen.getByTestId("character-voice-draft-note").textContent).toContain("模型增补失败");
    expect(screen.getByTestId("character-voice-draft-note").textContent).not.toContain("没有找到新的依据");
  });

  it("版本冲突时提示并可重新载入", async () => {
    let loads = 0;
    fetchJsonMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === PATH && !init) {
        loads += 1;
        return voiceResponse(loads === 1 ? 1 : 2, {});
      }
      throw new ApiRequestError("角色卡已在别处更新，请重新载入后再操作。", { status: 409 });
    });
    render(<CharacterVoiceSection bookId="book-1" entryId="char-1" />);
    await waitFor(() => expect(screen.getByTestId("voice-field-positioning")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("声音定位"), { target: { value: "话少" } });
    fireEvent.click(screen.getByRole("button", { name: "确认声音定位" }));
    expect((await screen.findByRole("alert")).textContent).toContain("别处更新");
    fireEvent.click(screen.getByRole("button", { name: "重新载入" }));
    await waitFor(() => expect(loads).toBe(2));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
