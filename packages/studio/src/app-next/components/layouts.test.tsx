import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  NEXT_OVERLAY_LAYER_CLASS,
  NextShell,
  ResourceWorkspaceLayout,
  SectionLayout,
  SettingsLayout,
} from "./layouts";

describe("Studio Next layout primitives", () => {
  it("renders the sidebar shell with navigation", () => {
    render(
      <NextShell
        activeRoute="workspace"
        onRouteChange={() => {}}
      >
        <div>页面内容</div>
      </NextShell>,
    );

    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Studio Next 主导航" })).toBeTruthy();
    expect(screen.getByText("页面内容")).toBeTruthy();
  });

  it("supports fixed settings navigation with only the active section detail on the right", () => {
    render(
      <SettingsLayout
        title="设置"
        sections={[
          { id: "profile", label: "个人资料" },
          { id: "models", label: "模型" },
        ]}
        activeSectionId="models"
        onSectionChange={() => {}}
      >
        <section aria-label="当前设置详情">模型详情</section>
      </SettingsLayout>,
    );

    expect(screen.getByRole("navigation", { name: "设置分区" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "模型" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByLabelText("当前设置详情")).toBeTruthy();
    expect(screen.getByText("模型详情")).toBeTruthy();
  });

  it("supports the three-column writing workspace layout", () => {
    render(
      <ResourceWorkspaceLayout
        explorer={<div>作品 / 卷 / 已有章节 / 生成章节 / 草稿</div>}
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
