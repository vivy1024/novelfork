import { fireEvent, render, screen } from "@testing-library/react";
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
    useApiMock.mockReturnValue({
      data: { language: "zh" },
    });
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

    fireEvent.change(screen.getByPlaceholderText("例如：仙路长明"), {
      target: { value: "仙路长明" },
    });
    fireEvent.click(screen.getByRole("button", { name: /克隆仓库/ }));
    fireEvent.change(screen.getByPlaceholderText("https://github.com/org/repo.git"), {
      target: { value: " https://github.com/vivy1024/novelfork.git " },
    });
    fireEvent.change(screen.getByDisplayValue("main"), {
      target: { value: " release " },
    });
    fireEvent.click(screen.getByRole("button", { name: "下一步：书籍骨架" }));

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
    });
  });
});
