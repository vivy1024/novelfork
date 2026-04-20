import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SettingsView } from "../../pages/SettingsView";

const t = ((value: string) => value) as never;

describe("SettingsView", () => {
  it("uses the scaffold header and empty state for placeholder sections", () => {
    render(<SettingsView nav={{}} theme="light" t={t} section="shortcuts" />);

    expect(screen.getByText("NovelFork Studio")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "快捷键" })).toBeTruthy();
    expect(screen.getByText("命令面板、保存、导航等快捷键说明会在这里统一收口。")).toBeTruthy();
  });
});
