import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UnsupportedCapability } from "./UnsupportedCapability";

describe("UnsupportedCapability", () => {
  it("shows a transparent unsupported capability state", () => {
    render(
      <UnsupportedCapability
        title="容器运行时未接入"
        reason="当前没有可验证的 Docker/兼容运行时 adapter。"
        status="planned"
        capability="container.runtime"
        docsHref="/docs/runtime"
      />,
    );

    expect(screen.getByRole("heading", { name: "容器运行时未接入" })).toBeTruthy();
    expect(screen.getByText("当前没有可验证的 Docker/兼容运行时 adapter。")).toBeTruthy();
    expect(screen.getByText("规划中")).toBeTruthy();
    expect(screen.getByText("container.runtime")).toBeTruthy();
    expect(screen.getByRole("link", { name: "查看说明" }).getAttribute("href")).toBe("/docs/runtime");
  });
});
