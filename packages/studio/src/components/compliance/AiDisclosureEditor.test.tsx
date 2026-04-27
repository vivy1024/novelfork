import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { AiDisclosure } from "@vivy1024/novelfork-core/compliance";

import { AiDisclosureEditor } from "./AiDisclosureEditor";

const createObjectURLMock = vi.fn((_: Blob) => "blob:mock");
const revokeObjectURLMock = vi.fn((_: string) => undefined);
const anchorClickMock = vi.fn(() => undefined);

const sampleDisclosure: AiDisclosure = {
  bookId: "book-1",
  platform: "qidian",
  aiUsageTypes: ["大纲辅助", "改写"],
  estimatedAiRatio: 0.1,
  modelNames: ["claude-sonnet-4-6"],
  humanEditDescription: "已人工逐章校改。",
  markdownText: "# AI 使用标注\n\n- 辅助类型：大纲辅助、改写\n- 估算比例：10.0%",
};

afterEach(() => {
  cleanup();
});

describe("AiDisclosureEditor", () => {
  beforeEach(() => {
    createObjectURLMock.mockReset();
    revokeObjectURLMock.mockReset();
    anchorClickMock.mockReset();

    Object.defineProperty(URL, "createObjectURL", {
      writable: true,
      value: createObjectURLMock,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      writable: true,
      value: revokeObjectURLMock,
    });
    Object.defineProperty(HTMLAnchorElement.prototype, "click", {
      writable: true,
      value: anchorClickMock,
    });
  });

  it("renders disclosure metadata and allows editing markdown text", () => {
    const onChange = vi.fn();

    render(<AiDisclosureEditor disclosure={sampleDisclosure} onChange={onChange} />);

    expect(screen.getByText("AI 使用标注编辑器")).toBeTruthy();
    expect(screen.getByText("大纲辅助")).toBeTruthy();
    expect(screen.getByText("改写")).toBeTruthy();
    expect(screen.getByText("claude-sonnet-4-6")).toBeTruthy();
    expect(screen.getByText("10.0%")).toBeTruthy();
    expect(screen.getByText("已人工逐章校改。" )).toBeTruthy();

    const textarea = screen.getByRole("textbox", { name: "AI 使用标注内容" }) as HTMLTextAreaElement;
    expect(textarea.value).toBe(sampleDisclosure.markdownText);

    fireEvent.change(textarea, { target: { value: "新的 AI 标注" } });
    expect(textarea.value).toBe("新的 AI 标注");
    expect(onChange).toHaveBeenCalledWith("新的 AI 标注");
  });

  it("exports the edited disclosure as text and markdown", async () => {
    render(<AiDisclosureEditor disclosure={sampleDisclosure} />);

    const textarea = screen.getByRole("textbox", { name: "AI 使用标注内容" });
    fireEvent.change(textarea, { target: { value: "导出用的新声明" } });

    fireEvent.click(screen.getByRole("button", { name: "导出文本" }));
    fireEvent.click(screen.getByRole("button", { name: "导出 Markdown" }));

    expect(createObjectURLMock).toHaveBeenCalledTimes(2);
    expect(anchorClickMock).toHaveBeenCalledTimes(2);

    const textBlob = createObjectURLMock.mock.calls[0]?.[0];
    const markdownBlob = createObjectURLMock.mock.calls[1]?.[0];

    expect(textBlob).toBeInstanceOf(Blob);
    expect(markdownBlob).toBeInstanceOf(Blob);
    expect(await (textBlob as Blob).text()).toContain("导出用的新声明");
    expect(await (markdownBlob as Blob).text()).toContain("导出用的新声明");
  });
});
