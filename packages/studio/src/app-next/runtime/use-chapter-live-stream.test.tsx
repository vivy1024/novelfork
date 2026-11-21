import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { narratorWSManager } from "@vivy1024/narrafork-runtime-bridge/frontend/narrator-ws";
import { reduceChapterLiveStreamEvent, useChapterLiveStream } from "./use-chapter-live-stream";

vi.mock("@vivy1024/narrafork-runtime-bridge/frontend/narrator-ws", () => ({
  narratorWSManager: { addListener: vi.fn(), removeListener: vi.fn() },
}));

const scope = { bookId: "book-1", narratorId: "narrator-1", bookRoot: "D:\\books\\本书" };
const filePath = "chapters/卷一/0012_暗账风云.md";
const start = {
  type: "tool_use_chunk",
  narratorId: scope.narratorId,
  toolUseId: "write-1",
  toolName: "Write",
};
const complete = { ...start, type: "tool_completed" };
const text = (delta: string, options?: { startsField?: boolean; complete?: boolean }) => ({ name: "content", delta, ...options });

describe("reduceChapterLiveStreamEvent", () => {
  it("识别本书绝对路径，在正文到达前就创建流；只拼接 content 字段", () => {
    const absolutePath = "d:\\books\\本书\\chapters\\卷一\\0012_暗账风云.md";
    const first = reduceChapterLiveStreamEvent(undefined, { ...start, extractedFilePath: absolutePath }, scope, 10);
    expect(first.state.streams.get(start.toolUseId)).toEqual({
      bookId: scope.bookId, chapterNumber: 12, title: "暗账风云", filePath: absolutePath,
      toolName: "Write", toolUseId: start.toolUseId, content: "", status: "streaming", startedAt: 10,
    });
    const second = reduceChapterLiveStreamEvent(first.state, { ...start, streamingField: text("落雪\n", { startsField: true }) }, scope, 20);
    const unrelatedField = reduceChapterLiveStreamEvent(second.state, { ...start, streamingField: { name: "new_string", delta: "忽略" } }, scope, 25);
    const third = reduceChapterLiveStreamEvent(unrelatedField.state, { ...start, streamingField: text("入夜", { complete: true }) }, scope, 30);
    expect(third.state.streams.get(start.toolUseId)).toMatchObject({ content: "落雪\n入夜", status: "completing", startedAt: 10 });
    const restarted = reduceChapterLiveStreamEvent(third.state, { ...start, streamingField: text("重写", { startsField: true }) }, scope, 40);
    expect(restarted.state.streams.get(start.toolUseId)).toMatchObject({ content: "重写", status: "streaming" });
    const finished = reduceChapterLiveStreamEvent(restarted.state, complete, scope, 50);
    expect(finished.state.streams.size).toBe(0);
    expect(finished.completedChapterNumbers).toEqual([12]);
    expect(reduceChapterLiveStreamEvent(finished.state, complete, scope, 60).completedChapterNumbers).toEqual([]);
  });

  it("忽略非本书、非章节、路径穿越、其它会话和工具", () => {
    for (const frame of [
      { ...start, extractedFilePath: "D:/books/他书/chapters/0012_x.md" },
      { ...start, extractedFilePath: "D:/books/本书-copy/chapters/0012_x.md" },
      { ...start, extractedFilePath: "story/0012_x.md" },
      { ...start, extractedFilePath: "chapters/index.json" },
      { ...start, extractedFilePath: "chapters/../story/0012_x.md" },
      { ...start, extractedFilePath: filePath, toolName: "Read" },
      { ...start, extractedFilePath: filePath, narratorId: "other-narrator" },
    ]) {
      const result = reduceChapterLiveStreamEvent(undefined, frame, scope, 10);
      expect(result.state.streams.size).toBe(0);
      expect(result.completedChapterNumbers).toEqual([]);
    }
  });

  it("按 toolUseId 隔离正文，允许 content 先到；Edit 不泄漏替换片段到正文", () => {
    const first = reduceChapterLiveStreamEvent(undefined, { ...start, streamingField: text("开头") }, scope, 10);
    expect(first.state.streams.size).toBe(0);
    const second = reduceChapterLiveStreamEvent(first.state, {
      ...start, extractedFields: { file_path: filePath }, streamingField: text("下文"),
    }, scope, 20);
    const edit = reduceChapterLiveStreamEvent(second.state, {
      ...start, toolUseId: "edit-1", toolName: "Edit", extractedFilePath: "chapters/0013_次章.md",
      streamingField: { name: "new_string", delta: "局部内容" },
    }, scope, 30);
    expect(edit.state.streams.get("write-1")).toMatchObject({ chapterNumber: 12, content: "开头下文" });
    expect(edit.state.streams.get("edit-1")).toMatchObject({ chapterNumber: 13, toolName: "Edit", content: "" });
    expect(reduceChapterLiveStreamEvent(edit.state, { ...complete, toolUseId: "unrelated" }, scope, 35).state).toBe(edit.state);
    const reset = reduceChapterLiveStreamEvent(edit.state, { type: "streaming_reset", narratorId: scope.narratorId }, scope, 40);
    expect(reset.state.streams.size).toBe(0);
    expect(reset.completedChapterNumbers).toEqual([12, 13]);
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const addListener = vi.mocked(narratorWSManager.addListener);
const removeListener = vi.mocked(narratorWSManager.removeListener);

describe("useChapterLiveStream", () => {
  it("只旁听指定会话，完成时调用最新回调且不重绑监听器", () => {
    const handle = { _id: 1 };
    addListener.mockReturnValue(handle);
    const onCompleted = vi.fn();
    const latestOnCompleted = vi.fn();
    const { result, rerender, unmount } = renderHook((props) => useChapterLiveStream(props), {
      initialProps: { ...scope, onChapterWriteCompleted: onCompleted },
    });
    expect(addListener).toHaveBeenCalledWith({
      narratorIds: [scope.narratorId], types: ["tool_use_chunk", "tool_completed", "streaming_reset"],
    }, expect.any(Function));
    const receive = addListener.mock.calls[0]![1];
    act(() => receive({ ...start, extractedFilePath: filePath }));
    expect(result.current).toMatchObject({ chapterNumber: 12, status: "streaming", content: "" });
    rerender({ ...scope, onChapterWriteCompleted: latestOnCompleted });
    act(() => receive({ ...start, streamingField: text("正文") }));
    expect(result.current?.content).toBe("正文");
    act(() => receive(complete));
    expect(result.current).toBeNull();
    expect(onCompleted).not.toHaveBeenCalled();
    expect(latestOnCompleted).toHaveBeenCalledExactlyOnceWith(12);
    expect(addListener).toHaveBeenCalledTimes(1);
    unmount();
    expect(removeListener).toHaveBeenCalledWith(handle);
  });

  it("切书或切会话时清空预览并丢弃旧监听帧", () => {
    addListener.mockReturnValueOnce({ _id: 1 }).mockReturnValueOnce({ _id: 2 });
    const onChapterWriteCompleted = vi.fn();
    const { result, rerender } = renderHook((props) => useChapterLiveStream(props), {
      initialProps: { ...scope, onChapterWriteCompleted },
    });
    const oldReceive = addListener.mock.calls[0]![1];
    act(() => oldReceive({ ...start, extractedFilePath: filePath }));
    expect(result.current?.bookId).toBe("book-1");
    rerender({ ...scope, bookId: "book-2", narratorId: "narrator-2", onChapterWriteCompleted });
    expect(result.current).toBeNull();
    expect(removeListener).toHaveBeenCalledWith({ _id: 1 });
    act(() => {
      oldReceive(complete);
      oldReceive({ ...start, extractedFilePath: filePath });
    });
    expect(result.current).toBeNull();
    expect(onChapterWriteCompleted).not.toHaveBeenCalled();
    const receive = addListener.mock.calls[1]![1];
    act(() => receive({ ...start, narratorId: "narrator-2", extractedFilePath: filePath }));
    expect(result.current?.bookId).toBe("book-2");
    act(() => receive({ type: "streaming_reset", narratorId: "narrator-2" }));
    expect(onChapterWriteCompleted).toHaveBeenCalledExactlyOnceWith(12);
    expect(result.current).toBeNull();
  });

  it("没有会话时不挂监听；WS 替身不可用时仍可加载编辑器", () => {
    addListener.mockImplementation(() => { throw new TypeError("listener unavailable"); });
    const onChapterWriteCompleted = vi.fn();
    const { result, rerender } = renderHook(({ narratorId }: { narratorId: string | null }) =>
      useChapterLiveStream({ ...scope, narratorId, onChapterWriteCompleted }), { initialProps: { narratorId: null } });
    expect(addListener).not.toHaveBeenCalled();
    rerender({ narratorId: scope.narratorId });
    expect(result.current).toBeNull();
    expect(onChapterWriteCompleted).not.toHaveBeenCalled();
  });
});
