import { useEffect, useMemo, useRef, useState } from "react";
import {
  narratorWSManager,
  type NarratorWsListenerHandle,
} from "@vivy1024/narrafork-runtime-bridge/frontend/narrator-ws";

import { chapterNumberFromRuntimeFilePath } from "./chapter-file-open";

export interface LiveChapterStreamState {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly title: string;
  readonly filePath: string;
  readonly toolName: "Write" | "Edit";
  readonly toolUseId: string;
  readonly content: string;
  readonly status: "streaming" | "completing";
  readonly startedAt: number;
}

type WriteBuffer = Pick<LiveChapterStreamState, "content" | "status">;

interface ChapterStreamMachine {
  readonly streams: ReadonlyMap<string, LiveChapterStreamState>;
  readonly pendingWrites: ReadonlyMap<string, WriteBuffer>;
}

interface ChapterStreamScope {
  readonly bookId: string;
  readonly narratorId: string | null | undefined;
  readonly bookRoot?: string | null;
}

interface ChapterStreamTransition {
  readonly state: ChapterStreamMachine;
  readonly completedChapterNumbers: readonly number[];
}

const EMPTY_BUFFER: WriteBuffer = { content: "", status: "streaming" };
const EMPTY_MACHINE: ChapterStreamMachine = { streams: new Map(), pendingWrites: new Map() };
// JSON 字段没有固定顺序；限量等候尚未识别路径的 Write，不为任意文件积攒整份正文。
const MAX_PENDING_WRITE_CHARS = 64 * 1024;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

/** 只读消费 Runtime 帧；完成通知作为返回值，不能在 reducer 内触发刷新。 */
export function reduceChapterLiveStreamEvent(
  state: ChapterStreamMachine = EMPTY_MACHINE,
  frame: Record<string, unknown>,
  scope: ChapterStreamScope,
  now: number,
): ChapterStreamTransition {
  const unchanged = { state, completedChapterNumbers: [] };
  if (!scope.narratorId || frame.narratorId !== scope.narratorId) return unchanged;
  if (frame.type === "streaming_reset") {
    return {
      state: EMPTY_MACHINE,
      completedChapterNumbers: [...new Set([...state.streams.values()].map((stream) => stream.chapterNumber))],
    };
  }

  const { toolUseId, toolName } = frame;
  if (typeof toolUseId !== "string" || !toolUseId) return unchanged;
  const current = state.streams.get(toolUseId);
  const pending = state.pendingWrites.get(toolUseId);
  const forget = (completedChapterNumbers: readonly number[] = []): ChapterStreamTransition => {
    if (!current && !pending) return unchanged;
    const streams = new Map(state.streams);
    const pendingWrites = new Map(state.pendingWrites);
    streams.delete(toolUseId);
    pendingWrites.delete(toolUseId);
    return { state: { streams, pendingWrites }, completedChapterNumbers };
  };
  if (frame.type === "tool_completed") return forget(current ? [current.chapterNumber] : []);
  if (frame.type !== "tool_use_chunk" || (toolName !== "Write" && toolName !== "Edit")) return unchanged;

  const extractedPath = frame.extractedFilePath;
  const fieldPath = asRecord(frame.extractedFields)?.file_path;
  const filePath = (typeof extractedPath === "string" && extractedPath)
    || (typeof fieldPath === "string" && fieldPath)
    || current?.filePath;
  const chapterNumber = filePath ? chapterNumberFromRuntimeFilePath(filePath, scope.bookRoot) : null;
  if (filePath && chapterNumber === null) return forget();

  const field = asRecord(frame.streamingField);
  const previous = current ?? pending ?? EMPTY_BUFFER;
  let { content, status } = previous;
  if (field?.name === (toolName === "Write" ? "content" : "new_string") && typeof field.delta === "string") {
    if (toolName === "Write") content = (field.startsField === true ? "" : content) + field.delta;
    status = field.complete === true ? "completing" : "streaming";
  }

  if (!filePath || chapterNumber === null) {
    if (toolName === "Edit" || (content === previous.content && status === previous.status)) return unchanged;
    return {
      state: {
        ...state,
        pendingWrites: new Map(state.pendingWrites).set(toolUseId, { content: content.slice(0, MAX_PENDING_WRITE_CHARS), status }),
      },
      completedChapterNumbers: [],
    };
  }
  if (current?.filePath === filePath && current.content === content && current.status === status) return unchanged;

  const fileName = filePath.split(/[\\/]/u).at(-1) ?? "";
  const title = /^\d{1,9}[_-](.+)\.md$/iu.exec(fileName)?.[1]?.trim() || `第${chapterNumber}章`;
  const streams = new Map(state.streams).set(toolUseId, {
    bookId: scope.bookId,
    chapterNumber,
    title,
    filePath,
    toolName,
    toolUseId,
    content,
    status,
    startedAt: current?.startedAt ?? now,
  });
  const pendingWrites = pending ? new Map(state.pendingWrites) : null;
  pendingWrites?.delete(toolUseId);
  return { state: { streams, pendingWrites: pendingWrites ?? state.pendingWrites }, completedChapterNumbers: [] };
}

function visibleStream(state: ChapterStreamMachine): LiveChapterStreamState | null {
  let write: LiveChapterStreamState | null = null;
  let edit: LiveChapterStreamState | null = null;
  for (const stream of state.streams.values()) {
    if (stream.toolName === "Write") write = stream;
    else edit = stream;
  }
  return write ?? edit;
}

interface UseChapterLiveStreamOptions extends ChapterStreamScope {
  readonly onChapterWriteCompleted: (chapterNumber: number) => void;
}

export function useChapterLiveStream({ bookId, narratorId, bookRoot, onChapterWriteCompleted }: UseChapterLiveStreamOptions): LiveChapterStreamState | null {
  const scope = useMemo(() => ({ bookId, narratorId, bookRoot }), [bookId, narratorId, bookRoot]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const onCompleted = useRef(onChapterWriteCompleted);
  onCompleted.current = onChapterWriteCompleted;
  const [published, setPublished] = useState<{ scope: ChapterStreamScope; stream: LiveChapterStreamState | null } | null>(null);

  useEffect(() => {
    setPublished(null);
    if (!scope.narratorId) return;
    let state = EMPTY_MACHINE;
    let visible: LiveChapterStreamState | null = null;
    let disposed = false;
    let handle: NarratorWsListenerHandle;
    try {
      // Dock 已负责订阅。这里只旁听，不能改变 Runtime 会话的游标或快照。
      handle = narratorWSManager.addListener({
        narratorIds: [scope.narratorId],
        types: ["tool_use_chunk", "tool_completed", "streaming_reset"],
      }, (frame) => {
        if (disposed || currentScope.current !== scope) return;
        const transition = reduceChapterLiveStreamEvent(state, frame, scope, Date.now());
        state = transition.state;
        const next = visibleStream(state);
        if (next !== visible) {
          visible = next;
          setPublished({ scope, stream: next });
        }
        for (const chapterNumber of transition.completedChapterNumbers) {
          onCompleted.current(chapterNumber);
        }
      });
    } catch {
      // 轻量宿主或测试替身可能没有 WS 管理器；原有工作区刷新仍可用。
      return;
    }
    return () => {
      disposed = true;
      try { narratorWSManager.removeListener(handle); } catch { /* 测试替身可能未实现清理。 */ }
    };
  }, [scope]);

  return published?.scope === scope ? published.stream : null;
}
