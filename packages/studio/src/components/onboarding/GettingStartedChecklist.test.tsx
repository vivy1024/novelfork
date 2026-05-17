import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GettingStartedChecklist, type GettingStartedStatus } from "./GettingStartedChecklist";

afterEach(() => {
  cleanup();
});

function status(overrides: Partial<GettingStartedStatus> = {}): GettingStartedStatus {
  return {
    dismissedGettingStarted: false,
    provider: { hasUsableModel: false },
    tasks: {
      modelConfigured: false,
      hasAnyBook: false,
      hasMetNarrator: false,
      hasOpenedJingwei: false,
      hasTriedAiWriting: false,
    },
    ...overrides,
  };
}

describe("GettingStartedChecklist", () => {
  it("shows the fixed getting-started task order with model setup first", () => {
    render(
      <GettingStartedChecklist
        status={status()}
        onConfigureModel={() => {}}
        onCreateBook={() => {}}
        onMeetNarrator={() => {}}
        onOpenJingwei={() => {}}
        onTryAiWriting={() => {}}
        onDismiss={() => {}}
      />,
    );

    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => within(item).getByTestId("task-title").textContent)).toEqual([
      "配置 AI 模型",
      "创建第一本书",
      "进入书籍工作台",
      "了解经纬系统",
      "试用 AI 写作",
    ]);
    expect(screen.getByText("未配置模型，不影响本地写作")).toBeTruthy();
  });

  it("summarizes the default provider and model when model setup is usable", () => {
    render(
      <GettingStartedChecklist
        status={status({
          provider: { hasUsableModel: true, defaultProvider: "openai", defaultModel: "gpt-4-turbo" },
          tasks: {
            modelConfigured: true,
            hasAnyBook: true,
            hasMetNarrator: false,
            hasOpenedJingwei: false,
            hasTriedAiWriting: false,
          },
        })}
        onConfigureModel={() => {}}
        onCreateBook={() => {}}
        onMeetNarrator={() => {}}
        onOpenJingwei={() => {}}
        onTryAiWriting={() => {}}
        onDismiss={() => {}}
      />,
    );

    expect(screen.getByText("openai / gpt-4-turbo")).toBeTruthy();
    expect(screen.getAllByText("已完成").length).toBeGreaterThanOrEqual(2);
  });

  it("shows progress count", () => {
    render(
      <GettingStartedChecklist
        status={status({
          tasks: {
            modelConfigured: true,
            hasAnyBook: true,
            hasMetNarrator: true,
            hasOpenedJingwei: false,
            hasTriedAiWriting: false,
          },
        })}
        onConfigureModel={() => {}}
        onCreateBook={() => {}}
        onMeetNarrator={() => {}}
        onOpenJingwei={() => {}}
        onTryAiWriting={() => {}}
        onDismiss={() => {}}
      />,
    );

    expect(screen.getByText(/完成 3\/5 步/)).toBeTruthy();
  });

  it("delegates AI writing attempts to the parent gate even when no model is configured", () => {
    const onTryAiWriting = vi.fn();

    render(
      <GettingStartedChecklist
        status={status()}
        onConfigureModel={() => {}}
        onCreateBook={() => {}}
        onMeetNarrator={() => {}}
        onOpenJingwei={() => {}}
        onTryAiWriting={onTryAiWriting}
        onDismiss={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /试用 AI 写作/ }));

    expect(onTryAiWriting).toHaveBeenCalledTimes(1);
  });

  it("can be dismissed without affecting the rest of the dashboard", () => {
    const onDismiss = vi.fn();

    render(
      <GettingStartedChecklist
        status={status()}
        onConfigureModel={() => {}}
        onCreateBook={() => {}}
        onMeetNarrator={() => {}}
        onOpenJingwei={() => {}}
        onTryAiWriting={() => {}}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "关闭任务清单" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
