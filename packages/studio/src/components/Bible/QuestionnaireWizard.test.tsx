import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const postApiMock = vi.fn();
const useApiMock = vi.fn();

vi.mock("../../hooks/use-api", () => ({
  postApi: (...args: unknown[]) => postApiMock(...args),
  useApi: (...args: unknown[]) => useApiMock(...args),
}));

import { QuestionnaireWizard, type QuestionnaireTemplateView } from "./QuestionnaireWizard";

const template: QuestionnaireTemplateView = {
  id: "tier1-common-premise",
  tier: 1,
  targetObject: "premise",
  questions: [
    { id: "logline", prompt: "一句话", type: "text", mapping: { fieldPath: "logline" }, defaultSkippable: false },
    { id: "tone", prompt: "基调", type: "single", options: ["热血", "轻松"], mapping: { fieldPath: "tone" }, defaultSkippable: false },
  ],
};

describe("QuestionnaireWizard", () => {
  beforeEach(() => {
    postApiMock.mockReset();
    useApiMock.mockReset();
    useApiMock.mockImplementation((path: string) => {
      if (path === "/providers/status") {
        return {
          data: { status: { hasUsableModel: true } },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });
  });

  afterEach(() => cleanup());

  it("walks questions, accepts AI suggestions, submits, and can save draft", async () => {
    postApiMock.mockResolvedValueOnce({ suggestion: { answer: "凡人靠小瓶求长生", reason: "基于题材", degraded: false } });
    postApiMock.mockResolvedValueOnce({ response: { id: "response-1", status: "submitted" } });
    const onDone = vi.fn();

    render(<QuestionnaireWizard bookId="book-1" template={template} onDone={onDone} />);

    expect(screen.getByText("第 1 / 2 题")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "AI 建议" }));
    await waitFor(() => expect(screen.getByDisplayValue("凡人靠小瓶求长生")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "下一题" }));
    fireEvent.click(screen.getByRole("button", { name: "热血" }));
    fireEvent.click(screen.getByRole("button", { name: "提交问卷" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ status: "submitted" })));
    expect(postApiMock).toHaveBeenLastCalledWith("/books/book-1/questionnaires/tier1-common-premise/responses", expect.objectContaining({
      answers: { logline: "凡人靠小瓶求长生", tone: "热血" },
    }));
  });

  it("saves a draft for later re-entry", async () => {
    postApiMock.mockResolvedValueOnce({ response: { id: expect.any(String), status: "draft" } });
    const onDone = vi.fn();

    render(<QuestionnaireWizard bookId="book-1" template={template} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText("一句话"), { target: { value: "先存草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "稍后再填" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ status: "draft" })));
    expect(postApiMock).toHaveBeenCalledWith("/books/book-1/questionnaires/tier1-common-premise/responses", expect.objectContaining({
      status: "draft",
      answers: { logline: "先存草稿" },
    }));
  });

  it("gates AI suggestions without clearing the current questionnaire answer", async () => {
    useApiMock.mockImplementation((path: string) => {
      if (path === "/providers/status") {
        return {
          data: { status: { hasUsableModel: false } },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });
    const onConfigureModel = vi.fn();

    render(<QuestionnaireWizard bookId="book-1" template={template} onConfigureModel={onConfigureModel} />);
    fireEvent.change(screen.getByLabelText("一句话"), { target: { value: "保留当前上下文" } });
    fireEvent.click(screen.getByRole("button", { name: "AI 建议" }));

    expect(await screen.findByText("此功能需要配置 AI 模型")).toBeTruthy();
    expect(screen.getByDisplayValue("保留当前上下文")).toBeTruthy();
    expect(postApiMock).not.toHaveBeenCalledWith(
      "/books/book-1/questionnaires/tier1-common-premise/ai-suggest",
      expect.anything(),
    );

    fireEvent.click(screen.getByRole("button", { name: "配置模型" }));
    expect(onConfigureModel).toHaveBeenCalledTimes(1);
  });
});
