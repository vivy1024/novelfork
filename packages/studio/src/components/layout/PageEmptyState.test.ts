import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageEmptyState } from "./PageEmptyState";

describe("PageEmptyState", () => {
  it("renders title, description and action content", () => {
    render(React.createElement(PageEmptyState, {
      title: "暂无结果",
      description: "换个关键词再试试。",
      action: React.createElement("button", null, "重新搜索"),
    }));

    expect(screen.getByText("暂无结果")).toBeTruthy();
    expect(screen.getByText("换个关键词再试试。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新搜索" })).toBeTruthy();
  });
});
