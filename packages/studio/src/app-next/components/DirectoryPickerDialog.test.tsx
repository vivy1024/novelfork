import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DirectoryPickerDialog } from "./DirectoryPickerDialog";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type BrowseResponse = {
  path: string | null;
  parent: string | null;
  entries: Array<{ name: string; path: string }>;
  drives?: Array<{ name: string; path: string }>;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("DirectoryPickerDialog", () => {
  it("maps Runtime shortcut keys and exposes Windows drives and directories", async () => {
    const onSelect = vi.fn();
    const browseResponses: BrowseResponse[] = [
      {
        path: null,
        parent: null,
        entries: [],
        drives: [{ name: "C:", path: "C:\\" }],
      },
      {
        path: "C:\\",
        parent: null,
        entries: [{ name: "workspace", path: "C:\\workspace" }],
        drives: [{ name: "C:", path: "C:\\" }],
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/fs/shortcuts") {
        return jsonResponse({ shortcuts: [{ key: "home", path: "C:\\Users\\writer" }] });
      }
      if (url.startsWith("/api/fs/browse")) {
        return jsonResponse(browseResponses.shift() ?? browseResponses[0]);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <DirectoryPickerDialog
        open
        onClose={() => {}}
        onSelect={onSelect}
      />,
    );

    expect(await screen.findByRole("button", { name: "主目录" })).toBeTruthy();
    const driveButtons = await screen.findAllByRole("button", { name: "C:" });
    expect(driveButtons.length).toBeGreaterThan(0);

    fireEvent.click(driveButtons[0]);
    expect(await screen.findByRole("button", { name: "workspace" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "workspace" }));
    expect(await screen.findByText("C:\\workspace")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "选择此目录" }));

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("C:\\workspace"));
  });
});
