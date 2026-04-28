import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vivy1024/novelfork-core", () => ({
  pipelineEvents: { on: vi.fn() },
}));

import {
  completePipelineRun,
  createPipelineRouter,
  createPipelineRun,
  updatePipelineStage,
} from "./pipeline";
import type { RouterContext } from "./context";

function createTestContext(): RouterContext {
  return {} as RouterContext;
}

describe("pipeline route process-memory transparency", () => {
  let runId: string;

  beforeEach(() => {
    runId = `run-${crypto.randomUUID()}`;
    createPipelineRun(runId, "book-1", "测试书");
    updatePipelineStage(runId, "plan", {
      status: "completed",
      agent: "planner",
      startTime: 1,
      endTime: 2,
    });
    completePipelineRun(runId, "completed");
  });

  it("marks pipeline run, stages, and stage responses as current-process state", async () => {
    const app = createPipelineRouter(createTestContext());

    const statusResponse = await app.request(`http://localhost/${runId}/status`);
    await expect(statusResponse.json()).resolves.toMatchObject({
      runId,
      status: "completed",
      persistence: "process-memory",
      persistenceLabel: "当前进程临时运行状态",
    });

    const stagesResponse = await app.request(`http://localhost/${runId}/stages`);
    await expect(stagesResponse.json()).resolves.toMatchObject({
      persistence: "process-memory",
      stages: expect.arrayContaining([
        expect.objectContaining({ name: "plan", status: "completed", agent: "planner" }),
      ]),
    });

    const stageResponse = await app.request(`http://localhost/${runId}/stages/0`);
    await expect(stageResponse.json()).resolves.toMatchObject({
      name: "plan",
      status: "completed",
      persistence: "process-memory",
    });

    const listResponse = await app.request("http://localhost/");
    await expect(listResponse.json()).resolves.toMatchObject({
      persistence: "process-memory",
      runs: expect.arrayContaining([
        expect.objectContaining({ runId, persistence: "process-memory" }),
      ]),
    });
  });
});
