import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NEXT_OVERLAY_LAYER_CLASS,
  NextShell,
  ResourceWorkspaceLayout,
  SectionLayout,
  SettingsLayout,
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

  it("supports the native grouped settings navigation and active detail", () => {
    render(
      <SettingsLayout
        title="设置"
        sections={[
          { id: "profile", label: "个人资料", group: "个人设置" },
          { id: "models", label: "模型", group: "个人设置" },
          { id: "server", label: "服务器", group: "实例管理" },
        ]}
        activeSectionId="models"
        onSectionChange={() => {}}
      >
        <section aria-label="当前设置详情">模型详情</section>
      </SettingsLayout>,
    );

    expect(screen.getByRole("navigation", { name: "设置分区" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "个人设置" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "实例管理" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "模型" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByLabelText("当前设置详情")).toBeTruthy();
    expect(screen.getByText("模型详情")).toBeTruthy();
  });

  it("supports the mobile settings index and back navigation", () => {
    const onBack = vi.fn();
    const onSectionChange = vi.fn();
    const { rerender } = render(
      <SettingsLayout
        title="设置"
        sections={[{ id: "profile", label: "个人资料", group: "个人设置" }]}
        activeSectionId="profile"
        onSectionChange={onSectionChange}
        mobileDetailOpen={false}
        onMobileBack={onBack}
      >
        <section>个人资料详情</section>
      </SettingsLayout>,
    );

    fireEvent.click(screen.getByRole("button", { name: "个人资料" }));
    expect(onSectionChange).toHaveBeenCalledWith("profile");

    rerender(
      <SettingsLayout
        title="设置"
        sections={[{ id: "profile", label: "个人资料", group: "个人设置" }]}
        activeSectionId="profile"
        onSectionChange={onSectionChange}
        mobileDetailOpen
        onMobileBack={onBack}
      >
        <section>个人资料详情</section>
      </SettingsLayout>,
    );
    fireEvent.click(screen.getByRole("button", { name: "返回设置列表" }));
    expect(onBack).toHaveBeenCalledTimes(1);
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
