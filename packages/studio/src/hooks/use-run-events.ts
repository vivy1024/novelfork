import { useEffect, useState } from "react";

import type { RunStatus, RunStreamEvent, StudioRun } from "../shared/contracts";

function mergeRunEvent(current: StudioRun | null, event: RunStreamEvent): StudioRun | null {
  if (event.type === "snapshot") {
    return event.run ?? current;
  }
  if (!current) {
    return current;
  }

  if (event.type === "status") {
    return {
      ...current,
      status: (event.status ?? current.status) as RunStatus,
      result: event.result ?? current.result,
      error: event.error ?? current.error,
    };
  }

  if (event.type === "stage") {
    return {
      ...current,
      stage: event.stage ?? current.stage,
    };
  }

  if (event.type === "log" && event.log) {
    return {
      ...current,
      logs: [...current.logs, event.log],
    };
  }

  return current;
}

export function useRunDetails(runId?: string | null) {
  const [run, setRun] = useState<StudioRun | null>(null);

  useEffect(() => {
    if (!runId || typeof EventSource === "undefined") {
      setRun(null);
      return;
    }

    const source = new EventSource(`/api/runs/${runId}/events`);
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as RunStreamEvent;
        setRun((current) => mergeRunEvent(current, payload));
      } catch {
        // ignore invalid event payloads
      }
    };
    source.onerror = () => {
      source.close();
    };

    return () => {
      source.close();
    };
  }, [runId]);

  return run;
}

export function useRunListStream() {
  const [runs, setRuns] = useState<ReadonlyArray<StudioRun>>([]);

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      setRuns([]);
      return;
    }

    const source = new EventSource("/api/runs/events");
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as RunStreamEvent;
        if (payload.type === "snapshot" && Array.isArray(payload.runs)) {
          setRuns(payload.runs);
        }
      } catch {
        // ignore invalid event payloads
      }
    };
    source.onerror = () => {
      source.close();
    };

    return () => {
      source.close();
    };
  }, []);

  return runs;
}
