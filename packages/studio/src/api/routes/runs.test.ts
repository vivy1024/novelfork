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

  it("keeps the per-run stream open long enough to deliver the terminal snapshot", async () => {
    const runStore = new RunStore();
    const run = runStore.create({
      bookId: "demo-book",
      chapterNumber: 7,
      action: "tool",
    });
    const app = createRunsRouter(runStore);

    const response = await app.request(`http://localhost/api/runs/${run.id}/events`);
    expect(response.status).toBe(200);

    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();

    const firstChunk = await reader!.read();
    const firstBody = new TextDecoder().decode(firstChunk.value);
    expect(firstBody).toContain('"type":"snapshot"');
    expect(firstBody).toContain('"stage":"Queued"');

    runStore.markRunning(run.id, "Writing");
    runStore.appendLog(run.id, {
      timestamp: "2026-04-20T10:00:00.000Z",
      level: "info",
      message: "tool finished",
    });
    runStore.succeed(run.id, { ok: true });

    const chunks: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const nextChunk = await reader!.read();
      if (nextChunk.done || !nextChunk.value) {
        break;
      }
      chunks.push(new TextDecoder().decode(nextChunk.value));
    }

    const streamBody = chunks.join("");
    expect(streamBody).toContain('"type":"status"');
    expect(streamBody).toContain('"status":"succeeded"');
    expect(streamBody).toContain('"type":"snapshot"');
    expect(streamBody).toContain('"stage":"Completed"');
    expect(streamBody).toContain('"finishedAt"');
  });

  it("serves incremental run history by sinceSeq", async () => {
    const runStore = new RunStore();
    const run = runStore.create({
      bookId: "demo-book",
      chapterNumber: 9,
      action: "tool",
    });
    runStore.markRunning(run.id, "Writing");
    runStore.appendLog(run.id, {
      timestamp: "2026-04-20T10:00:00.000Z",
      level: "info",
      message: "第一段完成",
    });
    runStore.succeed(run.id, { ok: true });

    const app = createRunsRouter(runStore);
    const response = await app.request(`http://localhost/api/runs/${run.id}/history?sinceSeq=4`);

    expect(response.status).toBe(200);

    const history = await response.json();
    expect(history).toMatchObject({
      runId: run.id,
      sinceSeq: 4,
      availableFromSeq: 1,
      resetRequired: false,
      cursor: {
        lastSeq: 6,
      },
    });
    expect(history.events).toHaveLength(2);
    expect(history.events[0]).toMatchObject({
      type: "status",
      runId: run.id,
      seq: 5,
      status: "succeeded",
    });
    expect(history.events[1]).toMatchObject({
      type: "snapshot",
      runId: run.id,
      seq: 6,
      run: expect.objectContaining({
        id: run.id,
        status: "succeeded",
        stage: "Completed",
      }),
    });
  });
});
