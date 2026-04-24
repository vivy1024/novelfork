import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RecoveryBadge } from "./RecoveryBadge";

afterEach(() => {
  cleanup();
});

describe("RecoveryBadge", () => {
  it("renders the stable idle+online badge with an emerald dot", () => {
    const { container } = render(<RecoveryBadge recoveryState="idle" wsConnected={true} />);
    expect(screen.getByText("实时同步")).toBeTruthy();
    const dot = container.querySelector("span.bg-emerald-500");
    expect(dot).toBeTruthy();
    // Stable state does not pulse.
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });

  it("hides the stable badge when hideWhenStable is set", () => {
    const { container } = render(
      <RecoveryBadge recoveryState="idle" wsConnected={true} hideWhenStable />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("surfaces offline idle with a neutral dot and banner", () => {
    render(<RecoveryBadge recoveryState="idle" wsConnected={false} variant="banner" />);
    expect(screen.getByText("会话暂时离线")).toBeTruthy();
  });

  it("pulses the dot for the four transient states", () => {
    for (const state of ["recovering", "reconnecting", "replaying", "resetting"] as const) {
      const { container, unmount } = render(
        <RecoveryBadge recoveryState={state} wsConnected={true} />,
      );
      expect(container.querySelector(".animate-pulse")).toBeTruthy();
      unmount();
    }
  });

  it("renders the banner with label + description for non-idle states", () => {
    render(<RecoveryBadge recoveryState="replaying" wsConnected={true} variant="banner" />);
    expect(screen.getByText("正在回放会话历史…")).toBeTruthy();
    expect(screen.getByText(/正在从服务端回放/)).toBeTruthy();
  });

  it("returns null from banner variant when bannerVisible=false (idle+online)", () => {
    const { container } = render(
      <RecoveryBadge recoveryState="idle" wsConnected={true} variant="banner" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("inline variant shows both badge and description", () => {
    render(<RecoveryBadge recoveryState="reconnecting" wsConnected={false} variant="inline" />);
    expect(screen.getByText("重连中")).toBeTruthy();
    expect(screen.getByText(/正在和服务端正式会话重新对齐/)).toBeTruthy();
  });

  it("sets an aria-label with offline marker when disconnected", () => {
    render(<RecoveryBadge recoveryState="reconnecting" wsConnected={false} />);
    const statusEl = screen.getByRole("status");
    expect(statusEl.getAttribute("aria-label")).toContain("离线");
  });
});
