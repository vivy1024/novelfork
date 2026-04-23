import React from "react";
import { act, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonMock = vi.fn();

vi.mock("./use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import { useRunDetails } from "./use-run-events";

class MockEventSource {
  static instances: MockEventSource[] = [];

  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
  }

  close() {
    this.closed = true;
    return undefined;
  }
}

vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);

function RunDetailsProbe({ runId }: { runId: string }) {
  const run = useRunDetails(runId);
  return (
    <div>
      <div data-testid="run-status">{run?.status ?? "none"}</div>
      <div data-testid="run-stage">{run?.stage ?? "none"}</div>
      <div data-testid="run-log-count">{run?.logs.length ?? 0}</div>
      <div data-testid="run-latest-log">{run?.logs.at(-1)?.message ?? "none"}</div>
    </div>
  );
}

describe("useRunDetails", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    MockEventSource.instances = [];
  });

  afterEach(() => {
    cleanup();
  });

  it("backfills missed run events after stream errors and reconnects to the live run feed", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      runId: "run-1",
      sinceSeq: 3,
      availableFromSeq: 1,
      resetRequired: false,
      events: [
        {
          type: "status",
          runId: "run-1",
          seq: 4,
          status: "succeeded",
        },
        {
          type: "snapshot",
          runId: "run-1",
          seq: 5,
          run: {
            id: "run-1",
            bookId: "demo-book",
            chapter: 9,
            chapterNumber: 9,
            action: "tool",
            status: "succeeded",
            stage: "Completed",
            createdAt: "2026-04-20T10:00:00.000Z",
            updatedAt: "2026-04-20T10:01:00.000Z",
            startedAt: "2026-04-20T10:00:05.000Z",
            finishedAt: "2026-04-20T10:01:00.000Z",
            logs: [
              {
                timestamp: "2026-04-20T10:00:30.000Z",
                level: "info",
                message: "第一段完成",
              },
            ],
            result: { ok: true },
          },
        },
      ],
      cursor: {
        lastSeq: 5,
      },
    });

    render(<RunDetailsProbe runId="run-1" />);

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]?.url).toBe("/api/runs/run-1/events");

    await act(async () => {
      MockEventSource.instances[0]?.emit({
        type: "snapshot",
        runId: "run-1",
        seq: 1,
        run: {
          id: "run-1",
          bookId: "demo-book",
          chapter: 9,
          chapterNumber: 9,
          action: "tool",
          status: "queued",
          stage: "Queued",
          createdAt: "2026-04-20T10:00:00.000Z",
          updatedAt: "2026-04-20T10:00:00.000Z",
          startedAt: null,
          finishedAt: null,
          logs: [],
        },
      });
      MockEventSource.instances[0]?.emit({
        type: "stage",
        runId: "run-1",
        seq: 2,
        stage: "Writing",
      });
      MockEventSource.instances[0]?.emit({
        type: "log",
        runId: "run-1",
        seq: 3,
        log: {
          timestamp: "2026-04-20T10:00:20.000Z",
          level: "info",
          message: "开始写作",
        },
      });
    });

    expect(screen.getByTestId("run-stage").textContent).toBe("Writing");
    expect(screen.getByTestId("run-log-count").textContent).toBe("1");

    await act(async () => {
      MockEventSource.instances[0]?.onerror?.();
    });

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith("/api/runs/run-1/history?sinceSeq=3");
    });

    await waitFor(() => {
      expect(screen.getByTestId("run-status").textContent).toBe("succeeded");
      expect(screen.getByTestId("run-stage").textContent).toBe("Completed");
      expect(screen.getByTestId("run-log-count").textContent).toBe("1");
      expect(screen.getByTestId("run-latest-log").textContent).toBe("第一段完成");
    });

    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1]?.url).toBe("/api/runs/run-1/events");

    await act(async () => {
      MockEventSource.instances[1]?.emit({
        type: "log",
        runId: "run-1",
        seq: 6,
        log: {
          timestamp: "2026-04-20T10:01:10.000Z",
          level: "info",
          message: "收尾完成",
        },
      });
    });

    expect(screen.getByTestId("run-log-count").textContent).toBe("2");
    expect(screen.getByTestId("run-latest-log").textContent).toBe("收尾完成");
  });
});
