import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const putApiMock = vi.fn();
let userSettingsState = { preferences: { workbenchMode: false } };
const refetchUserSettingsMock = vi.fn(async () => userSettingsState);
const fetchJsonMock = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
  putApi: (...args: unknown[]) => putApiMock(...args),
  useApi: (path: string | null) => {
    if (path === "/settings/user") {
      return {
        data: userSettingsState,
        loading: false,
        error: null,
        refetch: refetchUserSettingsMock,
      };
    }
    return { data: null, loading: false, error: null, refetch: vi.fn() };
  },
}));

import { WorkbenchModeGate } from "./WorkbenchModeGate";

describe("WorkbenchModeGate", () => {
  beforeEach(() => {
    userSettingsState = { preferences: { workbenchMode: false } };
    fetchJsonMock.mockReset();
    fetchJsonMock.mockResolvedValue({ status: { tasks: { hasReadWorkbenchIntro: true } } });
    putApiMock.mockReset();
    refetchUserSettingsMock.mockClear();
    refetchUserSettingsMock.mockImplementation(async () => userSettingsState);
    putApiMock.mockImplementation(async (_path: string, body?: { preferences?: { workbenchMode?: boolean } }) => {
      userSettingsState = {
        preferences: {
          workbenchMode: body?.preferences?.workbenchMode ?? false,
        },
      };
      return userSettingsState;
    });
  });

  afterEach(() => cleanup());

  it("shows the author-mode intro by default and marks workbench intro as read", async () => {
    render(
      <WorkbenchModeGate>
        <div>Workbench Content</div>
      </WorkbenchModeGate>,
    );

    expect(screen.getByRole("heading", { name: "当前处于作者模式" })).toBeTruthy();
    expect(screen.queryByText("Workbench Content")).toBeNull();

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith("/onboarding/status", expect.objectContaining({
        method: "PATCH",
      }));
    });
  });

  it("enables workbench mode after confirmation and can switch back to author mode", async () => {
    const { rerender } = render(
      <WorkbenchModeGate>
        <div>Workbench Content</div>
      </WorkbenchModeGate>,
    );

    fireEvent.click(screen.getByRole("button", { name: "开启工作台模式" }));
    expect(await screen.findByText("开启工作台模式？")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认开启" }));

    await waitFor(() => {
      expect(putApiMock).toHaveBeenCalledWith("/settings/user", {
        preferences: { workbenchMode: true },
      });
    });

    rerender(
      <WorkbenchModeGate>
        <div>Workbench Content</div>
      </WorkbenchModeGate>,
    );

    await waitFor(() => {
      expect(screen.getByText("Workbench Content")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "切回作者模式" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "切回作者模式" }));

    await waitFor(() => {
      expect(putApiMock).toHaveBeenLastCalledWith("/settings/user", {
        preferences: { workbenchMode: false },
      });
    });

    rerender(
      <WorkbenchModeGate>
        <div>Workbench Content</div>
      </WorkbenchModeGate>,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "当前处于作者模式" })).toBeTruthy();
    });
  });
});
