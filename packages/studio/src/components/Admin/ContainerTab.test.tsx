import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ContainerTab } from "./ContainerTab";

describe("ContainerTab", () => {
  it("shows the container entry state and planned runtime capabilities", () => {
    render(<ContainerTab />);

    expect(screen.getByRole("heading", { name: "Container / 容器" })).toBeTruthy();
    expect(screen.getAllByText("规划中").length).toBeGreaterThan(0);
    expect(screen.getAllByText("容器运行时").length).toBeGreaterThan(0);
    expect(screen.getByText(/exec \/ inspect/)).toBeTruthy();
    expect(screen.getAllByText("容器日志").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "容器运行时未接入" })).toBeTruthy();
    expect(screen.getByText("container.runtime")).toBeTruthy();
  });
});
