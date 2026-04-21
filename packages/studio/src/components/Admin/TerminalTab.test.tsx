import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TerminalTab } from "./TerminalTab";

describe("TerminalTab", () => {
  it("shows the terminal entry state and planned runtime capabilities", () => {
    render(<TerminalTab />);

    expect(screen.getByRole("heading", { name: "Terminal / 终端" })).toBeTruthy();
    expect(screen.getAllByText("未接线").length).toBeGreaterThan(0);
    expect(screen.getAllByText("本地 shell").length).toBeGreaterThan(0);
    expect(screen.getByText(/stdout \/ stderr/)).toBeTruthy();
    expect(screen.getByText(/任务联动/)).toBeTruthy();
  });
});
