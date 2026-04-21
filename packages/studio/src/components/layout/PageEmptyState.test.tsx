import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";
import { PageEmptyState } from "./PageEmptyState";

describe("PageEmptyState", () => {
  it("renders title, description and action content", () => {
    render(
      <PageEmptyState
        title="暂无结果"
        description="换个关键词再试试。"
        action={<Button>重新搜索</Button>}
      />,
    );

    expect(screen.getByText("暂无结果")).toBeTruthy();
    expect(screen.getByText("换个关键词再试试。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新搜索" })).toBeTruthy();
  });
});
