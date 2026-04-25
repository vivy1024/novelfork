import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { FeatureEmptyState, FEATURE_EMPTY_STATE_PRESETS, JingweiEmptyState } from "./FeatureEmptyState";

describe("FeatureEmptyState", () => {
  afterEach(() => cleanup());

  it("provides teaching copy for all required onboarding feature empty states", () => {
    expect(Object.keys(FEATURE_EMPTY_STATE_PRESETS).sort()).toEqual([
      "ai-flavor",
      "core-memory",
      "famous-scenes",
      "foreshadowing",
      "jingwei",
      "people",
      "settings",
      "workbench-mode",
    ]);

    for (const preset of Object.values(FEATURE_EMPTY_STATE_PRESETS)) {
      render(<FeatureEmptyState preset={preset.kind} />);
      expect(screen.getByRole("heading", { name: preset.title })).toBeTruthy();
      expect(screen.getByText(preset.description)).toBeTruthy();
      expect(screen.getByRole("button", { name: preset.primaryAction.label })).toBeTruthy();
      cleanup();
    }
  });

  it("keeps local actions while showing model configuration guidance for AI powered empty states", () => {
    const onPrimary = vi.fn();
    const onConfigureModel = vi.fn();

    render(
      <FeatureEmptyState
        preset="ai-flavor"
        modelConfigured={false}
        onPrimaryAction={onPrimary}
        onConfigureModel={onConfigureModel}
      />,
    );

    expect(screen.getByText("此功能需要配置 AI 模型")).toBeTruthy();
    expect(screen.getByRole("button", { name: "配置模型" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "先粘贴文本" }));
    fireEvent.click(screen.getByRole("button", { name: "配置模型" }));

    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(onConfigureModel).toHaveBeenCalledTimes(1);
  });

  it("renders a Jingwei empty state with section-specific local action", () => {
    const onCreate = vi.fn();
    render(<JingweiEmptyState sectionName="人物" onCreateEntry={onCreate} />);

    expect(screen.getByRole("heading", { name: "人物还没有经纬条目" })).toBeTruthy();
    expect(screen.getByText(/先写下第一个关键人物/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "新增人物条目" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});
