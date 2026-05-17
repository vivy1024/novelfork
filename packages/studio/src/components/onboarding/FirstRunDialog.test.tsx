import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FirstRunDialog } from "./FirstRunDialog";

describe("FirstRunDialog", () => {
  it("introduces model setup as the recommended first step without blocking local writing", () => {
    render(
      <FirstRunDialog
        open
        onOpenChange={() => {}}
        onConfigureModel={() => {}}
        onCreateBook={() => {}}
        onOpenLearnCenter={() => {}}
        onDismiss={() => {}}
      />,
    );

    expect(screen.getByRole("heading", { name: "欢迎使用 NovelFork" })).toBeTruthy();
    expect(screen.getByText(/建议先配置 AI 模型/)).toBeTruthy();
    expect(screen.getByText(/未配置也可以先创建书籍/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /配置 AI 模型/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /创建第一本书/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /打开学习中心/ })).toBeTruthy();
  });

  it("dispatches entry actions while preserving a closeable first-run dialog", () => {
    const onConfigureModel = vi.fn();
    const onCreateBook = vi.fn();
    const onOpenLearnCenter = vi.fn();

    render(
      <FirstRunDialog
        open
        onOpenChange={() => {}}
        onConfigureModel={onConfigureModel}
        onCreateBook={onCreateBook}
        onOpenLearnCenter={onOpenLearnCenter}
        onDismiss={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /配置 AI 模型/ }));
    fireEvent.click(screen.getByRole("button", { name: /创建第一本书/ }));
    fireEvent.click(screen.getByRole("button", { name: /打开学习中心/ }));

    expect(onConfigureModel).toHaveBeenCalledTimes(1);
    expect(onCreateBook).toHaveBeenCalledTimes(1);
    expect(onOpenLearnCenter).toHaveBeenCalledTimes(1);
  });

  it("persists dismissal when the user skips or closes the welcome dialog", () => {
    const onOpenChange = vi.fn();
    const onDismiss = vi.fn();

    render(
      <FirstRunDialog
        open
        onOpenChange={onOpenChange}
        onConfigureModel={() => {}}
        onCreateBook={() => {}}
        onOpenLearnCenter={() => {}}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "暂时跳过" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
