import { describe, expect, it } from "vitest";

import { RunStore } from "../lib/run-store.js";
import { createRunsRouter } from "./runs.js";

describe("createRunsRouter", () => {
  it("streams global run snapshots for admin subscribers", async () => {
    const runStore = new RunStore();
    const run = runStore.create({
      bookId: "demo-book",
      chapterNumber: 3,
      action: "tool",
    });
    const app = createRunsRouter(runStore);

    const response = await app.request("http://localhost/api/runs/events");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();
    const firstChunk = await reader!.read();
    const body = new TextDecoder().decode(firstChunk.value);

    expect(body).toContain('"type":"snapshot"');
    expect(body).toContain('"runs"');
    expect(body).toContain(run.id);

    await reader!.cancel();
  });
});
