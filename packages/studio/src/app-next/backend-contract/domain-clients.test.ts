import { describe, expect, it, vi } from "vitest";

import { createContractClient } from "./contract-client";
import { createProviderClient } from "./provider-client";
import { createResourceClient } from "./resource-client";
import { createSessionClient } from "./session-client";
import { createWritingActionClient } from "./writing-action-client";

describe("domain contract clients", () => {
  it("wraps first-screen resource/provider/session routes with registered capabilities", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const contract = createContractClient({ fetch: fetchMock });

    await createResourceClient(contract).listBooks();
    await createSessionClient(contract).listActiveSessions();
    await createProviderClient(contract).getStatus();

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/books", expect.objectContaining({ method: "GET" }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/sessions?sort=recent&status=active", expect.objectContaining({ method: "GET" }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/providers/status", expect.objectContaining({ method: "GET" }));
  });

  it("marks create-status as process-memory capability", async () => {
    const contract = createContractClient({ fetch: vi.fn(async () => new Response(JSON.stringify({ status: "creating" }), { status: 200 })) });

    const result = await createResourceClient(contract).getBookCreateStatus("book one");

    expect(result.capability.status).toBe("process-memory");
    expect(result.capability.ui.recoveryNoteVisible).toBe(true);
  });

  it("marks writing mode prompt preview as prompt-preview capability", async () => {
    const contract = createContractClient({ fetch: vi.fn(async () => new Response(JSON.stringify({ mode: "prompt-preview", promptPreview: "写下一章" }), { status: 200 })) });

    const result = await createWritingActionClient(contract).previewWritingMode("b1", { modeId: "x" });

    expect(result.capability.status).toBe("prompt-preview");
    expect(result.capability.ui.previewOnly).toBe(true);
    expect(result.data).toMatchObject({ mode: "prompt-preview", promptPreview: "写下一章" });
  });

  it("keeps unsupported provider model test envelope visible", async () => {
    const contract = createContractClient({
      fetch: vi.fn(async () => new Response(JSON.stringify({ error: { code: "unsupported", message: "adapter 不支持" } }), { status: 400 })),
    });

    const result = await createProviderClient(contract).testProviderModel("p1", "m1");

    expect(result.ok).toBe(false);
    expect(result.capability.status).toBe("current");
    expect(result.error).toEqual({ error: { code: "unsupported", message: "adapter 不支持" } });
  });
});
