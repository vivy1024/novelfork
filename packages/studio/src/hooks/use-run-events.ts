import { useEffect, useRef, useState } from "react";

import { fetchJson } from "./use-api";
import type { RunHistory, RunStatus, RunStreamEvent, StudioRun } from "../shared/contracts";

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

function mergeRunEvents(current: StudioRun | null, events: ReadonlyArray<RunStreamEvent>) {
  return events.reduce((nextRun, event) => mergeRunEvent(nextRun, event), current);
}

export function useRunDetails(runId?: string | null) {
  const [run, setRun] = useState<StudioRun | null>(null);
  const lastSeqRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!runId || typeof EventSource === "undefined") {
      setRun(null);
      lastSeqRef.current = 0;
      return;
    }

    let cancelled = false;
    let source: EventSource | null = null;

    const connect = () => {
      if (cancelled) {
        return;
      }

      source = new EventSource(`/api/runs/${runId}/events`);
      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as RunStreamEvent;
          if (typeof payload.seq === "number" && Number.isFinite(payload.seq)) {
            lastSeqRef.current = Math.max(lastSeqRef.current, Math.floor(payload.seq));
          }
          setRun((current) => mergeRunEvent(current, payload));
        } catch {
          // ignore invalid event payloads
        }
      };
      source.onerror = () => {
        source?.close();
        source = null;
        if (cancelled) {
          return;
        }

        void fetchJson<RunHistory>(`/api/runs/${runId}/history?sinceSeq=${lastSeqRef.current}`)
          .then((history) => {
            if (cancelled || !history) {
              return;
            }

            const nextLastSeq = history.cursor?.lastSeq ?? lastSeqRef.current;
            lastSeqRef.current = Math.max(lastSeqRef.current, nextLastSeq);
            setRun((current) => {
              if (history.resetRequired) {
                const latestSnapshot = [...history.events].reverse().find((entry) => entry.type === "snapshot");
                return latestSnapshot?.run ?? current;
              }
              return mergeRunEvents(current, history.events ?? []);
            });
          })
          .catch(() => {
            // keep the latest local run snapshot when history fetch fails
          })
          .finally(() => {
            if (cancelled) {
              return;
            }
            reconnectTimerRef.current = window.setTimeout(() => {
              reconnectTimerRef.current = null;
              connect();
            }, 0);
          });
      };
    };

    connect();

    return () => {
      cancelled = true;
      source?.close();
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
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
