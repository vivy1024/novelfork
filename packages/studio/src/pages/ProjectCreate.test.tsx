import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useApiMock } = vi.hoisted(() => ({
  useApiMock: vi.fn(),
}));

vi.mock("../hooks/use-api", () => ({
  useApi: useApiMock,
}));

import { ProjectCreate } from "./ProjectCreate";

describe("ProjectCreate", () => {
  beforeEach(() => {
    cleanup();
    useApiMock.mockReturnValue({
      data: { language: "zh" },
    });
  });

  it("blocks the next step until a clone URL is entered", () => {
    const nav = {
      toDashboard: vi.fn(),
      toBookCreate: vi.fn(),
    };

    render(
      <ProjectCreate
        nav={nav}
        theme="light"
        t={(key: string) => key}
      />,
    );

    fireEvent.change(screen.getAllByPlaceholderText("例如：仙路长明")[0], {
      target: { value: "仙路长明" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: /克隆仓库/ })[0]);

    const nextButton = screen.getByRole("button", { name: "下一步：书籍骨架" }) as HTMLButtonElement;

    expect(nextButton.disabled).toBe(true);
    screen.getByText("初始化计划：等待填写克隆地址");

    fireEvent.click(nextButton);

    expect(nav.toBookCreate).not.toHaveBeenCalled();
  });

  it("pushes the normalized ProjectCreate object into BookCreate", () => {
    const nav = {
      toDashboard: vi.fn(),
      toBookCreate: vi.fn(),
    };

    render(
      <ProjectCreate
        nav={nav}
        theme="light"
        t={(key: string) => key}
      />,
    );

    fireEvent.change(screen.getAllByPlaceholderText("例如：仙路长明")[0], {
      target: { value: "仙路长明" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: /克隆仓库/ })[0]);
    fireEvent.change(screen.getByPlaceholderText("https://github.com/org/repo.git"), {
      target: { value: " https://github.com/vivy1024/novelfork.git " },
    });
    fireEvent.change(screen.getAllByDisplayValue("main")[0], {
      target: { value: " release " },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "下一步：书籍骨架" })[0]);

    expect(nav.toBookCreate).toHaveBeenCalledWith({
      title: "仙路长明",
      projectInit: {
        repositorySource: "clone",
        workflowMode: "outline-first",
        templatePreset: "genre-default",
        cloneUrl: "https://github.com/vivy1024/novelfork.git",
        gitBranch: "release",
        worktreeName: "draft-仙路长明",
      },
      initializationPlan: {
        phase: "project-create",
        nextStage: "book-create",
        readyToContinue: true,
      },
    });
  });
});
