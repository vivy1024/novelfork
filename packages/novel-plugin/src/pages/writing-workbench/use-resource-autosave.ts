import { useCallback, useLayoutEffect, useMemo, useReducer } from "react";
import { resourceNeedsDetailHydration } from "./ResourceDetailLoader";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";

type SaveResource = (node: WorkbenchResourceNode, content: string) => Promise<void> | void;

interface SaveSession {
  node: WorkbenchResourceNode | null;
  onSave: SaveResource;
  content: string;
  savedContent: string | null;
  sourceContent: string | undefined;
  revision: number;
  dirty: boolean;
  error: string | null;
  writable: boolean;
  automatic: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: Promise<void> | null;
  queued: boolean;
  notify?: () => void;
}

function clearTimer(session: SaveSession) {
  if (session.timer !== null) clearTimeout(session.timer);
  session.timer = null;
}

function flush(session: SaveSession): Promise<void> {
  clearTimer(session);
  if (!session.writable || !session.node || !session.dirty) return Promise.resolve();
  session.queued = true;
  if (session.inFlight) return session.inFlight;

  // 同步占住在途槽位，连按保存或防抖到期都只能排队，不能并发覆盖同一章节。
  session.inFlight = Promise.resolve().then(async () => {
    while (session.queued && session.dirty && session.writable && session.node) {
      session.queued = false;
      const snapshot = {
        node: { ...session.node, ...(session.node.metadata ? { metadata: { ...session.node.metadata } } : {}) },
        content: session.content,
        revision: session.revision,
        onSave: session.onSave,
      };
      session.error = null;
      session.notify?.();
      try {
        await snapshot.onSave(snapshot.node, snapshot.content);
        session.savedContent = snapshot.content;
        session.dirty = session.revision !== snapshot.revision && session.content !== snapshot.content;
      } catch (cause) {
        // 失败时无法确认磁盘是否已写入，撤回到旧正文也必须重新保存确认。
        // 不无限重试；保留正文和错误，下一次输入或手动保存可重试。
        session.savedContent = null;
        session.error = cause instanceof Error ? cause.message : String(cause);
        session.dirty = true;
        session.queued = false;
        clearTimer(session);
      }
      session.notify?.();
    }
  }).finally(() => {
    session.inFlight = null;
    session.notify?.();
  });
  session.notify?.();
  return session.inFlight;
}

/** 真实画布的保存状态：每本书/资源独立会话，保存响应只推进发出的正文快照。 */
export function useResourceAutosave(
  node: WorkbenchResourceNode | null,
  bookId: string | undefined,
  onSave: SaveResource,
) {
  const [, render] = useReducer((value: number) => value + 1, 0);
  const resourceKey = JSON.stringify([bookId ?? node?.metadata?.bookId, node?.id, node?.path, node?.metadata?.filePath]);
  const session = useMemo<SaveSession>(() => ({
    node, onSave,
    content: node?.content ?? "",
    savedContent: node?.content ?? "",
    sourceContent: node?.content,
    revision: 0,
    dirty: false,
    error: null,
    writable: false,
    automatic: false,
    timer: null,
    inFlight: null,
    queued: false,
    // 同一身份的服务端刷新由下方 effect 合并，不能重建本地草稿。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [resourceKey]);

  useLayoutEffect(() => {
    session.notify = render;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!session.dirty && !session.inFlight) return;
      // 页面关闭不能等待异步保存，只请求浏览器显示离开确认。
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      session.notify = undefined;
      clearTimer(session);
      session.queued = false;
      // 已发出的请求仍属于旧会话；卸载后不再启动排队写入或更新新画布。
    };
  }, [session]);

  useLayoutEffect(() => {
    session.node = node;
    session.onSave = onSave;
    session.writable = !!node && node.capabilities.edit && !node.capabilities.readonly
      && !node.capabilities.unsupported && !resourceNeedsDetailHydration(node);
    session.automatic = !!node && (node.kind === "chapter" || node.metadata?.isChapter === true);
    if (!session.writable) {
      clearTimer(session);
      session.queued = false;
    }
    if (session.sourceContent !== node?.content) {
      session.sourceContent = node?.content;
      // 保存回包、资源树刷新都可能返回较旧的正文，不能覆盖在途请求或未保存输入。
      if (!session.dirty && !session.inFlight) {
        session.content = node?.content ?? "";
        session.savedContent = session.content;
        session.revision += 1;
        render();
      }
    }
  }, [node, onSave, session]);

  const setContent = useCallback((content: string) => {
    if (!session.writable || content === session.content) return;
    session.content = content;
    session.revision += 1;
    // 即使撤回到旧基准，在途写入仍可能改变磁盘，必须等它结束再核对。
    session.dirty = !!session.inFlight || content !== session.savedContent;
    session.error = null;
    clearTimer(session);
    if (session.automatic && session.dirty) {
      session.timer = setTimeout(() => { void flush(session); }, 3000);
    }
    session.notify?.();
  }, [session]);

  const save = useCallback(() => flush(session), [session]);
  const setSaveError = useCallback((error: string) => {
    session.error = error;
    session.notify?.();
  }, [session]);

  return { resourceKey, content: session.content, dirty: session.dirty, saving: !!session.inFlight,
    saveError: session.error, setContent, save, setSaveError };
}
