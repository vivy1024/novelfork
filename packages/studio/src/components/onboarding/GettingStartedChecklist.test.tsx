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
      hasOpenedJingwei: false,
      hasAnyChapter: false,
      hasTriedAiWriting: false,
      hasTriedAiTasteScan: false,
      hasReadWorkbenchIntro: false,
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
        onOpenJingwei={() => {}}
        onCreateChapter={() => {}}
        onTryAiWriting={() => {}}
        onTryAiTasteScan={() => {}}
        onOpenWorkbenchIntro={() => {}}
        onDismiss={() => {}}
      />,
    );

    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => within(item).getByTestId("task-title").textContent)).toEqual([
      "配置 AI 模型",
      "创建第一本书",
      "认识故事经纬",
      "创建第一章 / 导入正文",
      "试用 AI 写作与评点",
      "试用 AI 味检测",
      "了解工作台模式",
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
            hasOpenedJingwei: false,
            hasAnyChapter: false,
            hasTriedAiWriting: false,
            hasTriedAiTasteScan: false,
            hasReadWorkbenchIntro: false,
          },
        })}
        onConfigureModel={() => {}}
        onCreateBook={() => {}}
        onOpenJingwei={() => {}}
        onCreateChapter={() => {}}
        onTryAiWriting={() => {}}
        onTryAiTasteScan={() => {}}
        onOpenWorkbenchIntro={() => {}}
        onDismiss={() => {}}
      />,
    );

    expect(screen.getByText("openai / gpt-4-turbo")).toBeTruthy();
    expect(screen.getAllByText("已完成").length).toBeGreaterThanOrEqual(2);
  });

  it("delegates AI writing attempts to the parent gate even when no model is configured", () => {
    const onConfigureModel = vi.fn();
    const onTryAiWriting = vi.fn();

    render(
      <GettingStartedChecklist
        status={status()}
        onConfigureModel={onConfigureModel}
        onCreateBook={() => {}}
        onOpenJingwei={() => {}}
        onCreateChapter={() => {}}
        onTryAiWriting={onTryAiWriting}
        onTryAiTasteScan={() => {}}
        onOpenWorkbenchIntro={() => {}}
        onDismiss={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /试用 AI 写作与评点/ }));

    expect(onTryAiWriting).toHaveBeenCalledTimes(1);
    expect(onConfigureModel).not.toHaveBeenCalled();
  });

  it("can be dismissed without affecting the rest of the dashboard", () => {
    const onDismiss = vi.fn();

    render(
      <GettingStartedChecklist
        status={status()}
        onConfigureModel={() => {}}
        onCreateBook={() => {}}
        onOpenJingwei={() => {}}
        onCreateChapter={() => {}}
        onTryAiWriting={() => {}}
        onTryAiTasteScan={() => {}}
        onOpenWorkbenchIntro={() => {}}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "关闭任务清单" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
