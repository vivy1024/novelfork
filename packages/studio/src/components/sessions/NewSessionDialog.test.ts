import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NewSessionDialog } from "./NewSessionDialog";

const fetchJsonMock = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (path: string) => fetchJsonMock(path),
}));

afterEach(() => {
  cleanup();
  fetchJsonMock.mockReset();
});

describe("NewSessionDialog runtime contract", () => {
  it("submits the full Runtime model reference instead of legacy provider/model fields", async () => {
    fetchJsonMock.mockResolvedValue({ models: [{ modelId: "sub2api:gpt-5.6", modelName: "GPT-5.6", providerName: "Sub2API" }] });
    const onCreate = vi.fn();

    render(React.createElement(NewSessionDialog, { open: true, onOpenChange: vi.fn(), onCreate }));
    await screen.findAllByText("Sub2API · GPT-5.6");
    fireEvent.click(screen.getByRole("button", { name: "创建叙述者" }));

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "sub2api:gpt-5.6" }));
    expect(onCreate.mock.calls[0]?.[0]).not.toHaveProperty("agentId");
    expect(onCreate.mock.calls[0]?.[0]).not.toHaveProperty("sessionConfig");
  });
});
