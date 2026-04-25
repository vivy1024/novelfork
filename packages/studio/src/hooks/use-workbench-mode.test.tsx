import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const putApiMock = vi.fn();
let settingsState = { preferences: { workbenchMode: false } };
const refetchMock = vi.fn(async () => settingsState);

vi.mock("./use-api", () => ({
  putApi: (...args: unknown[]) => putApiMock(...args),
  useApi: (path: string | null) => {
    if (path === "/settings/user") {
      return {
        data: settingsState,
        loading: false,
        error: null,
        refetch: refetchMock,
      };
    }
    return { data: null, loading: false, error: null, refetch: vi.fn() };
  },
}));

import { useWorkbenchMode } from "./use-workbench-mode";

describe("useWorkbenchMode", () => {
  beforeEach(() => {
    settingsState = { preferences: { workbenchMode: false } };
    putApiMock.mockReset();
    refetchMock.mockClear();
    refetchMock.mockImplementation(async () => settingsState);
    putApiMock.mockImplementation(async (_path: string, body?: { preferences?: { workbenchMode?: boolean } }) => {
      settingsState = {
        preferences: {
          workbenchMode: body?.preferences?.workbenchMode ?? false,
        },
      };
      return settingsState;
    });
  });

  it("defaults to author mode and persists enable/disable updates through /settings/user", async () => {
    const { result, rerender } = renderHook(() => useWorkbenchMode());

    expect(result.current.enabled).toBe(false);

    await act(async () => {
      await result.current.setEnabled(true);
    });

    expect(putApiMock).toHaveBeenCalledWith("/settings/user", {
      preferences: { workbenchMode: true },
    });

    rerender();
    await waitFor(() => {
      expect(result.current.enabled).toBe(true);
    });

    await act(async () => {
      await result.current.setEnabled(false);
    });

    expect(putApiMock).toHaveBeenLastCalledWith("/settings/user", {
      preferences: { workbenchMode: false },
    });

    rerender();
    await waitFor(() => {
      expect(result.current.enabled).toBe(false);
    });
  });
});
