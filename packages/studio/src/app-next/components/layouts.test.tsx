import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  NEXT_OVERLAY_LAYER_CLASS,
  NextShell,
  ResourceWorkspaceLayout,
  SectionLayout,
} from "./layouts";

afterEach(cleanup);

describe("Studio Next layout primitives", () => {
  it("renders the sidebar shell with navigation", () => {
    render(
      <NextShell
        activeRoute={{ kind: "book", bookId: "default" }}
        onRouteChange={() => {}}
      >
        <div>页面内容</div>
      </NextShell>,
    );

    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Studio Next 主导航" })).toBeTruthy();
    expect(screen.getByText("页面内容")).toBeTruthy();
  });

  it("supports the three-column writing workspace layout", () => {
    render(
      <ResourceWorkspaceLayout
        explorer={<div>作品 / 卷 / 已有章节 / 生成章节 / 版本</div>}
        editor={<div>正文编辑器</div>}
        assistant={<div>叙述者会话</div>}
      />,
    );

    expect(screen.getByRole("complementary", { name: "小说资源管理器" })).toBeTruthy();
    expect(screen.getByRole("main", { name: "正文编辑区" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "叙述者会话" })).toBeTruthy();
  });

  it("keeps overlay content on the shared high z-index layer", () => {
    render(
      <SectionLayout title="分区" overlay={<div role="dialog">弹窗内容</div>}>
        <p>背景内容</p>
      </SectionLayout>,
    );

    expect(screen.getByRole("dialog").parentElement?.className).toContain(NEXT_OVERLAY_LAYER_CLASS);
  });
});
